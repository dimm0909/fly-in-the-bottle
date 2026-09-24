#!/usr/bin/env bash
# Fetch the MaleCNS connectome (CC-BY, Janelia FlyEM) and build the brain sidecar.
# Downloads ~1.1 GB into data/malecns/ (git-ignored) and needs python3, g++ and curl.
set -euo pipefail
cd "$(dirname "$0")/.."
BASE=https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome
mkdir -p data/malecns data/brain
for f in body-annotations-male-cns-v1.0-minconf-0.5.feather body-neurotransmitters-male-cns-v1.0.feather connectome-weights-male-cns-v1.0-minconf-0.5.feather; do
  [ -s "data/malecns/$f" ] || curl -fL --progress-bar -o "data/malecns/$f" "$BASE/$f"
done
[ -d .venv ] || python3 -m venv --system-site-packages .venv
.venv/bin/pip install -q pyarrow pandas
.venv/bin/python tools/build_brain_graph.py
.venv/bin/python tools/build_groups.py
make -C brain
echo "brain ready: $(ls -la data/brain/brain | awk '{print $5}') bytes"
