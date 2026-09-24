// Sidecar: loads the connectome graph and named neuron groups, then serves a line protocol on stdin/stdout.
//
//   groups                       -> "G <n> <name> <size> ..."
//   drive <group> <mV>           tonic drive (0 clears)
//   poisson <group> <rate_hz>    Poisson input (0 clears)
//   cutout <group>               remove the outgoing connections of a group's neurons
//   clear                        remove all inputs
//   advance <ms>                 -> "R <ms> <c0> <c1> ..."  spike counts per group, in `groups` order
//   spikes                       -> "S <n> <id> ..."       neurons that fired in the last advance (capped)
//   param <w_syn|w_ext|threshold|tau_m|tau_syn|delay|refractory> <value>
//   reset | bench <ms> | quit
#include <chrono>
#include <cmath>
#include <cstdio>
#include <iostream>
#include <map>
#include <sstream>

#include "brain.h"

int main(int argc, char** argv) {
  std::string graph_path = "data/brain/graph.bin", groups_path = "data/brain/groups.txt", backend_name = "cpu";
  for (int i = 1; i < argc; i++) {
    std::string a = argv[i];
    if (a == "--graph" && i + 1 < argc) graph_path = argv[++i];
    else if (a == "--groups" && i + 1 < argc) groups_path = argv[++i];
    else if (a == "--backend" && i + 1 < argc) backend_name = argv[++i];
  }
  Graph g; std::string err;
  if (!load_graph(graph_path, g, err)) { std::fprintf(stderr, "error: %s\n", err.c_str()); return 1; }
  std::vector<Group> groups;
  if (!load_groups(groups_path, g.n, groups, err)) { std::fprintf(stderr, "error: %s\n", err.c_str()); return 1; }
  Params p;
  std::unique_ptr<Backend> be;
#ifdef WITH_CUDA
  if (backend_name == "cuda") be = make_cuda_backend(g, p, groups);
#endif
  if (!be) be = make_cpu_backend(g, p, groups);
  std::map<std::string, size_t> index;
  for (size_t i = 0; i < groups.size(); i++) index[groups[i].name] = i;
  // Motor neurons drive muscle, not other neurons: cut their (spurious) central outputs.
  if (index.count("mn_all")) be->cut_outputs(groups[index["mn_all"]].neurons);
  std::printf("READY %s %u %llu %zu\n", be->name(), g.n, (unsigned long long)g.e, groups.size());
  std::fflush(stdout);

  std::string line;
  std::vector<uint32_t> counts, spikes;
  while (std::getline(std::cin, line)) {
    std::istringstream in(line);
    std::string cmd; in >> cmd;
    if (cmd == "groups") {
      std::printf("G %zu", groups.size());
      for (auto& gr : groups) std::printf(" %s %zu", gr.name.c_str(), gr.neurons.size());
      std::printf("\n");
    } else if (cmd == "drive" || cmd == "poisson") {
      std::string name; float v; in >> name >> v;
      auto it = index.find(name);
      if (it == index.end()) { std::printf("E unknown group %s\n", name.c_str()); }
      else { if (cmd == "drive") be->set_drive(groups[it->second].neurons, v); else be->set_poisson(groups[it->second].neurons, v); std::printf("OK\n"); }
    } else if (cmd == "param") {
      std::string k; float v; in >> k >> v;
      if (k == "dt") p.dt = v; else if (k == "w_syn") p.w_syn = v; else if (k == "w_ext") p.w_ext = v; else if (k == "threshold") p.threshold = v;
      else if (k == "tau_m") p.tau_m = v; else if (k == "tau_syn") p.tau_syn = v; else if (k == "delay") p.delay = v;
      else if (k == "refractory") p.refractory = v; else if (k == "adapt") p.adapt = v; else if (k == "tau_adapt") p.tau_adapt = v;
      else { std::printf("E unknown param %s\n", k.c_str()); std::fflush(stdout); continue; }
      be->set_params(p); std::printf("OK\n");
    } else if (cmd == "cutout") {
      std::string name; in >> name;
      auto it = index.find(name);
      if (it == index.end()) std::printf("E unknown group %s\n", name.c_str()); else { be->cut_outputs(groups[it->second].neurons); std::printf("OK\n"); }
    } else if (cmd == "clear") { be->clear_inputs(); std::printf("OK\n");
    } else if (cmd == "reset") { be->reset(); std::printf("OK\n");
    } else if (cmd == "advance") {
      float ms; in >> ms;
      be->advance((int)std::lround(ms / p.dt));
      be->take_counts(counts);
      std::printf("R %g", ms);
      for (uint32_t c : counts) std::printf(" %u", c);
      std::printf("\n");
    } else if (cmd == "spikes") {
      be->take_spikes(spikes);
      std::printf("S %zu", spikes.size());
      for (uint32_t i : spikes) std::printf(" %u", i);
      std::printf("\n");
    } else if (cmd == "bench") {
      float ms; in >> ms;
      auto t0 = std::chrono::steady_clock::now();
      be->advance((int)std::lround(ms / p.dt));
      double sec = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
      std::printf("B %g ms simulated in %.3f s wall (x%.2f real time)\n", ms, sec, ms / 1000.0 / sec);
    } else if (cmd == "stats") {
      std::printf("T %.0f\n", be->total_spikes());
    } else if (cmd == "quit") { break;
    } else if (!cmd.empty()) { std::printf("E unknown command %s\n", cmd.c_str()); }
    std::fflush(stdout);
  }
  return 0;
}
