#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <sstream>
#include <unordered_map>
#include <algorithm>

#include "brain.h"

bool load_graph(const std::string& path, Graph& g, std::string& err) {
  FILE* f = std::fopen(path.c_str(), "rb");
  if (!f) { err = "cannot open " + path; return false; }
  struct { char magic[4]; uint32_t version; uint32_t n; uint64_t e; } __attribute__((packed)) h;
  if (std::fread(&h, sizeof h, 1, f) != 1 || std::memcmp(h.magic, "FBRN", 4) != 0 || h.version != 1) {
    std::fclose(f); err = "bad graph header"; return false;
  }
  g.n = h.n; g.e = h.e;
  g.row_ptr.resize(g.n + 1); g.col.resize(g.e); g.w.resize(g.e);
  bool ok = std::fread(g.row_ptr.data(), 4, g.n + 1, f) == g.n + 1 && std::fread(g.col.data(), 4, g.e, f) == g.e &&
            std::fread(g.w.data(), 4, g.e, f) == g.e;
  std::fclose(f);
  if (!ok) err = "truncated graph";
  return ok;
}

// groups.txt: one group per line, "name<TAB>i,j,k,..." (neuron indices)
bool load_groups(const std::string& path, uint32_t n, std::vector<Group>& groups, std::string& err) {
  std::ifstream in(path);
  if (!in) { err = "cannot open " + path; return false; }
  std::string line;
  while (std::getline(in, line)) {
    if (line.empty() || line[0] == '#') continue;
    auto tab = line.find('\t');
    if (tab == std::string::npos) continue;
    Group gr; gr.name = line.substr(0, tab);
    std::stringstream ss(line.substr(tab + 1));
    std::string tok;
    while (std::getline(ss, tok, ',')) {
      if (tok.empty()) continue;
      uint32_t i = (uint32_t)std::stoul(tok);
      if (i >= n) { err = "neuron index out of range in group " + gr.name; return false; }
      gr.neurons.push_back(i);
    }
    groups.push_back(std::move(gr));
  }
  return true;
}

namespace {

struct Rng {  // xorshift64*
  uint64_t s = 0x9E3779B97F4A7C15ull;
  inline uint32_t next() { s ^= s >> 12; s ^= s << 25; s ^= s >> 27; return (uint32_t)((s * 2685821657736338717ull) >> 32); }
  inline float uniform() { return (next() >> 8) * (1.0f / 16777216.0f); }
};

// Per-neuron state, packed so an update touches one cache line.
struct State {
  float u;   // membrane potential above rest (mV)
  float g;   // synaptic input (mV)
  float ad;  // adaptive threshold increment (mV)
  float rf;  // remaining refractory steps
};

// Event-driven: a neuron is simulated only while it is "awake" (has input, is charged, is
// refractory, or is being driven). Everything else costs nothing, so a quiet fly is free.
class CpuBackend : public Backend {
 public:
  CpuBackend(const Graph& g, const Params& p, const std::vector<Group>& groups) : g_(g), p_(p) {
    n_ = g.n;
    st_.assign(n_, State{0, 0, 0, 0});
    drive_.assign(n_, 0.f);
    pinned_.assign(n_, 0);
    is_active_.assign(n_, 0);
    asleep_at_.assign(n_, 0);
    wmv_.resize(g.e);
    for (uint64_t i = 0; i < g.e; i++) wmv_[i] = g.w[i] * p.w_syn;
    cut_.assign(n_, 0);
    prate_.assign(n_, 0.f);
    pgen_.assign(n_, 0);
    pring_.assign(kRing, {});
    set_params(p);
    // neuron -> group membership (CSR)
    std::vector<uint32_t> cnt(n_ + 1, 0);
    for (auto& gr : groups) for (uint32_t i : gr.neurons) cnt[i + 1]++;
    for (uint32_t i = 0; i < n_; i++) cnt[i + 1] += cnt[i];
    mem_ptr_ = cnt; mem_.resize(cnt[n_]);
    std::vector<uint32_t> fill(cnt.begin(), cnt.end() - 1);
    for (uint32_t gi = 0; gi < groups.size(); gi++) for (uint32_t i : groups[gi].neurons) mem_[fill[i]++] = gi;
    counts_.assign(groups.size(), 0);
  }
  const char* name() const override { return "cpu"; }

  void set_params(const Params& p) override {
    p_ = p;
    for (uint64_t i = 0; i < g_.e; i++) wmv_[i] = g_.w[i] * p.w_syn;
    apply_cuts();
    kg_ = std::exp(-p.dt / p.tau_syn);
    km_ = p.dt / p.tau_m;
    ka_ = std::exp(-p.dt / p.tau_adapt);
    delay_steps_ = std::max(1, (int)std::lround(p.delay / p.dt));
    refr_steps_ = std::max(1, (int)std::lround(p.refractory / p.dt));
    ring_.assign(delay_steps_, {});
    head_ = 0;
  }

  void set_drive(const std::vector<uint32_t>& ns, float v) override {
    for (uint32_t i : ns) {
      drive_[i] = v;
      pinned_[i] = (v != 0.f);
      if (pinned_[i]) wake(i);
    }
  }
  void set_poisson(const std::vector<uint32_t>& ns, float rate) override {
    for (uint32_t i : ns) {
      pgen_[i]++;  // invalidates events already scheduled for this neuron
      prate_[i] = rate;
      if (rate > 0) schedule(i);
    }
  }
  void clear_inputs() override {
    std::fill(drive_.begin(), drive_.end(), 0.f);
    std::fill(pinned_.begin(), pinned_.end(), 0);
    for (uint32_t i = 0; i < n_; i++) if (prate_[i] > 0) { pgen_[i]++; prate_[i] = 0; }
  }
  void cut_outputs(const std::vector<uint32_t>& ns) override { for (uint32_t i : ns) cut_[i] = 1; apply_cuts(); }
  void reset() override {
    std::fill(st_.begin(), st_.end(), State{0, 0, 0, 0});
    for (auto& r : ring_) r.clear();
    std::fill(counts_.begin(), counts_.end(), 0);
    for (uint32_t i : active_) is_active_[i] = 0;
    active_.clear();
    for (uint32_t i = 0; i < n_; i++) if (pinned_[i]) wake(i);
  }

  void advance(int steps) override {
    last_spikes_.clear();
    const float thr = p_.threshold, adapt = p_.adapt;
    const float kg = kg_, km = km_, dr = 1.f - kg_, ka = ka_;
    State* st = st_.data();
    for (int s = 0; s < steps; s++, step_++) {
      // 1. deliver spikes that were emitted `delay` steps ago; targets wake up if asleep
      auto& due = ring_[head_];
      for (uint32_t src : due) {
        for (uint64_t e = g_.row_ptr[src]; e < g_.row_ptr[src + 1]; e++) {
          const uint32_t post = g_.col[e];
          if (!is_active_[post]) wake(post);
          st[post].g += wmv_[e];
        }
      }
      due.clear();
      // 2. external Poisson input: each neuron has its next event scheduled on a time wheel
      {
        auto& slot = pring_[step_ % kRing];
        for (const PoissonEvent& ev : slot) {
          if (ev.gen != pgen_[ev.i] || prate_[ev.i] <= 0) continue;
          if (!is_active_[ev.i]) wake(ev.i);
          st[ev.i].g += p_.w_ext;
          schedule(ev.i);
        }
        slot.clear();
      }
      // 3. update the awake neurons
      auto& emit = ring_[head_];
      size_t keep = 0;
      for (size_t k = 0; k < active_.size(); k++) {
        const uint32_t i = active_[k];
        State& x = st[i];
        const bool refractory = x.rf > 0.f;
        float ui = refractory ? 0.f : x.u + km * (x.g - x.u);
        x.g = x.g * kg + drive_[i] * dr;
        x.rf = refractory ? x.rf - 1.f : 0.f;
        x.ad *= ka;
        bool spiked = false;
        if (ui >= thr + x.ad) {
          spiked = true;
          ui = 0.f; x.rf = (float)refr_steps_; x.ad += adapt;
          emit.push_back(i);
          total_++;
          for (uint32_t m = mem_ptr_[i]; m < mem_ptr_[i + 1]; m++) counts_[mem_[m]]++;
          if (last_spikes_.size() < 4096) last_spikes_.push_back(i);
        }
        x.u = ui;
        if (spiked || pinned_[i] || x.rf > 0.f || std::fabs(ui) + std::fabs(x.g) > 0.01f) {
          active_[keep++] = i;
        } else {  // quiet: go to sleep; the slow adaptation decay is caught up on wake-up
          x.u = 0.f; x.g = 0.f;
          is_active_[i] = 0;
          asleep_at_[i] = step_;
        }
      }
      active_.resize(keep);
      head_ = (head_ + 1) % delay_steps_;
    }
  }
  void take_counts(std::vector<uint32_t>& c) override { c = counts_; std::fill(counts_.begin(), counts_.end(), 0); }
  void take_spikes(std::vector<uint32_t>& ids) override { ids = last_spikes_; }
  double total_spikes() const override { return (double)total_; }

 private:
  void wake(uint32_t i) {
    if (is_active_[i]) return;
    is_active_[i] = 1;
    active_.push_back(i);
    st_[i].ad *= std::exp(-p_.dt * (float)(step_ - asleep_at_[i]) / p_.tau_adapt);
  }
  void apply_cuts() {
    for (uint32_t i = 0; i < n_; i++) if (cut_[i]) for (uint64_t e = g_.row_ptr[i]; e < g_.row_ptr[i + 1]; e++) wmv_[e] = 0.f;
  }
  struct PoissonEvent { uint32_t i; uint16_t gen; };
  static constexpr uint32_t kRing = 4096;
  void schedule(uint32_t i) {
    const float mean_steps = 1000.f / (prate_[i] * p_.dt);
    long steps = std::lround(-std::log(1.f - rng_.uniform()) * mean_steps);
    steps = std::min<long>(std::max<long>(steps, 1), kRing - 1);
    pring_[(step_ + steps) % kRing].push_back({i, pgen_[i]});
  }
  const Graph& g_;
  Params p_;
  uint32_t n_;
  uint64_t step_ = 0;
  std::vector<State> st_;
  std::vector<float> drive_, wmv_;
  std::vector<uint8_t> pinned_, is_active_, cut_;
  std::vector<uint64_t> asleep_at_;
  std::vector<uint32_t> active_;
  std::vector<std::vector<uint32_t>> ring_;
  int head_ = 0, delay_steps_ = 1, refr_steps_ = 1;
  float kg_ = 0, km_ = 0, ka_ = 0;
  std::vector<uint32_t> mem_ptr_, mem_, counts_, last_spikes_;
  std::vector<float> prate_;
  std::vector<uint16_t> pgen_;
  std::vector<std::vector<PoissonEvent>> pring_;
  Rng rng_;
  uint64_t total_ = 0;
};

}  // namespace

std::unique_ptr<Backend> make_cpu_backend(const Graph& g, const Params& p, const std::vector<Group>& groups) {
  return std::make_unique<CpuBackend>(g, p, groups);
}
