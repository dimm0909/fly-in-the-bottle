// Leaky integrate-and-fire simulation of the MaleCNS connectome.
//
// Model (Shiu et al., Nature 2024, adapted to a fixed 0.5 ms step):
//   du/dt = (g - u) / tau_m          u: membrane potential above rest, mV
//   dg/dt = -g / tau_syn             g: synaptic input, mV
//   a spike arrives after `delay` ms and adds  w_syn * (signed synapse count)  to g
//   u >= threshold  ->  spike, u = 0, refractory for `refractory` ms
#pragma once
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

struct Params {
  float dt = 1.0f;           // ms (0.5 and 0.25 give the same responses)
  float tau_m = 20.0f;       // ms
  float tau_syn = 5.0f;      // ms
  float threshold = 7.0f;    // mV above rest (-52 -> -45)
  float w_syn = 0.15f;       // mV per synapse. Shiu et al. use 0.275; at that gain any strong input
                             // ignites the whole network, at ~0.15 responses are graded and specific
  float w_ext = 1.5f;        // mV per external Poisson event
  float delay = 2.0f;        // ms
  float refractory = 2.0f;   // ms
  float adapt = 0.20f;       // mV added to a neuron's threshold per spike (spike-frequency adaptation);
                             // without it recurrent loops in the VNC never switch off. 0.10 mV / 1.5 s stopped the
                             // flight muscles but left the rest of the network smouldering for minutes after a
                             // leg touch (tools/explore/explore15.py); 0.20 mV / 3 s lets it fall silent
  float tau_adapt = 3000.0f; // ms
};

struct Graph {  // CSR by presynaptic neuron
  uint32_t n = 0;
  uint64_t e = 0;
  std::vector<uint32_t> row_ptr, col;
  std::vector<float> w;  // signed synapse counts
};

struct Group {
  std::string name;
  std::vector<uint32_t> neurons;
};

bool load_graph(const std::string& path, Graph& g, std::string& err);
bool load_groups(const std::string& path, uint32_t n, std::vector<Group>& groups, std::string& err);

class Backend {
 public:
  virtual ~Backend() = default;
  virtual const char* name() const = 0;
  /// Tonic drive: the neuron's synaptic input relaxes towards `value` mV (0 clears).
  virtual void set_drive(const std::vector<uint32_t>& neurons, float value) = 0;
  /// Poisson input at `rate_hz` events per second, each adding w_ext mV (0 clears).
  virtual void set_poisson(const std::vector<uint32_t>& neurons, float rate_hz) = 0;
  virtual void clear_inputs() = 0;
  /// Remove all outgoing connections of these neurons (e.g. motor neurons, whose output is muscle).
  virtual void cut_outputs(const std::vector<uint32_t>& neurons) = 0;
  virtual void reset() = 0;
  /// Change model constants at runtime (rebuilds derived tables).
  virtual void set_params(const Params& p) = 0;
  /// Advance `steps` steps. Per-group spike counts accumulate until take_counts().
  virtual void advance(int steps) = 0;
  virtual void take_counts(std::vector<uint32_t>& counts) = 0;
  /// Neuron ids that spiked during the last advance() (capped).
  virtual void take_spikes(std::vector<uint32_t>& ids) = 0;
  virtual double total_spikes() const = 0;
};

std::unique_ptr<Backend> make_cpu_backend(const Graph& g, const Params& p, const std::vector<Group>& groups);
#ifdef WITH_CUDA
std::unique_ptr<Backend> make_cuda_backend(const Graph& g, const Params& p, const std::vector<Group>& groups);
#endif
