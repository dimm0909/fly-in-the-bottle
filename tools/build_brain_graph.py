#!/usr/bin/env python3
"""Build the simulation graph from the MaleCNS v1.0 flat-connectome downloads.

Inputs  (data/malecns/):  connectome-weights, body-annotations, body-neurotransmitters
Outputs (data/brain/):
  graph.bin       CSR by presynaptic neuron: header, row_ptr u32[N+1], col u32[E], w f32[E]
                  w = signed synapse count (sign from the predicted neurotransmitter)
  neurons.feather one row per neuron, in graph order (index, bodyId, superclass, type, ...)

Neurons are traced segments with a superclass annotation (orphans, glia and fragments are
dropped). Connections below --min-syn synapses are dropped, as in the FlyWire whole-brain
model (Shiu et al., Nature 2024).
"""
import argparse
import pathlib
import struct

import numpy as np
import pandas as pd
import pyarrow.feather as pf

root = pathlib.Path(__file__).resolve().parent.parent
src = root / 'data/malecns'
out = root / 'data/brain'

# neurotransmitter -> sign of the postsynaptic effect. Acetylcholine excites; GABA, glutamate
# (GluCl in the central nervous system) and histamine (photoreceptors, HisCl) inhibit.
# Modulators and 'unclear' are treated as weakly excitatory.
SIGN = {'acetylcholine': 1.0, 'gaba': -1.0, 'glutamate': -1.0, 'histamine': -1.0,
        'dopamine': 1.0, 'octopamine': 1.0, 'serotonin': 1.0, 'unclear': 1.0}

ap = argparse.ArgumentParser()
ap.add_argument('--min-syn', type=int, default=5)
args = ap.parse_args()

ann = pd.read_feather(src / 'body-annotations-male-cns-v1.0-minconf-0.5.feather')
keep = (ann.status == 'Traced') & ann.superclass.notna()
neurons = ann[keep].sort_values('bodyId').reset_index(drop=True)
nt = pd.read_feather(src / 'body-neurotransmitters-male-cns-v1.0.feather', columns=['body', 'consensus_nt']).drop_duplicates('body')
neurons = neurons.merge(nt, left_on='bodyId', right_on='body', how='left').drop(columns='body')
neurons['nt'] = neurons.consensus_nt.fillna('unclear')
neurons['sign'] = neurons.nt.map(SIGN).fillna(1.0).astype(np.float32)
ids = neurons.bodyId.to_numpy()
N = len(ids)
print(f'{N:,} neurons')

w = pf.read_table(src / 'connectome-weights-male-cns-v1.0-minconf-0.5.feather')
pre_id = w['body_pre'].to_numpy()
post_id = w['body_post'].to_numpy()
count = w['weight'].to_numpy()

def index_of(x):
    i = np.searchsorted(ids, x)
    i[i == N] = 0
    return np.where(ids[i] == x, i, -1)

pre = index_of(pre_id)
post = index_of(post_id)
mask = (pre >= 0) & (post >= 0) & (count >= args.min_syn)
pre, post, count = pre[mask].astype(np.uint32), post[mask].astype(np.uint32), count[mask].astype(np.float32)
del w, pre_id, post_id
weight = count * neurons.sign.to_numpy()[pre]
order = np.lexsort((post, pre))
pre, post, weight = pre[order], post[order], weight[order].astype(np.float32)
E = len(pre)
row_ptr = np.zeros(N + 1, dtype=np.uint32)
np.add.at(row_ptr, pre.astype(np.int64) + 1, 1)
row_ptr = np.cumsum(row_ptr, dtype=np.uint32)

out.mkdir(parents=True, exist_ok=True)
with open(out / 'graph.bin', 'wb') as f:
    f.write(struct.pack('<4sIIQ', b'FBRN', 1, N, E))
    f.write(row_ptr.tobytes())
    f.write(post.astype('<u4').tobytes())
    f.write(weight.astype('<f4').tobytes())
neurons[['bodyId', 'superclass', 'class', 'subclass', 'type', 'instance', 'somaSide', 'nt', 'sign', 'entryNerve', 'exitNerve', 'flywireType', 'receptorType']].to_feather(out / 'neurons.feather')
exc = (weight > 0).sum()
print(f'{E:,} connections (min {args.min_syn} synapses), {exc / E:.1%} excitatory; mean out-degree {E / N:.1f}')
print(f'wrote {(out / "graph.bin").stat().st_size / 1e6:.1f} MB graph.bin')
