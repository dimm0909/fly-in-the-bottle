"""Which sensory neuron types wake the walking descending neurons? (sweep over source types, ~2 minutes)

  python tools/explore/explore14.py

Every source group (a type of sensory or visual projection neuron, or a subclass of the VNC sensory and the
ascending sensory neurons; at least 4 neurons) is driven on its own, at 9 and 12 mV, on the resting network: 150 ms
to build up, 400 ms of read-out. Printed, for each target, the sources that excite it most among those that leave the
flight muscles (DLM below 15 Hz) and the giant fibre (below 30 Hz) quiet. The targets are DNp09, DNa01 + DNa02, MDN,
pIP1 and DNg62 + DNge078 (aDN1, aDN2); the winners (LC9 for DNp09, LC10 types for DNa02) are what BrainFly.seeObject() drives (src/brainfly.js).
The source groups exist only for this run: a temporary groups file is written next to the real one's contents.
"""
import pathlib
import sys
import tempfile

import pandas as pd

sys.path.insert(0, 'tools')
from brain_client import Brain

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
REST = {'pr_L': 8, 'pr_R': 8} | {f'{k}_{l}_{s}': v for k, v in (('prop_leg', 7), ('touch_leg', 5)) for l in 'fmh' for s in 'LR'}
TARGETS = ['dn_DNp09', 'dn_DNa01', 'dn_DNa02', 'dn_DNg100', 'dn_DNp10', 'dn_DNb01', 'dn_DNp06', 'dn_DNp07', 'dn_DNp03', 'dn_DNg62', 'dn_DNge078']

n = pd.read_feather(ROOT / 'data/brain/neurons.feather')
n['idx'] = range(len(n))
n['type'] = n.type.fillna('')
sources = {}
for superclass in ['cb_sensory', 'ol_sensory', 'visual_projection', 'vnc_sensory', 'sensory_ascending', 'visual_centrifugal']:
    d = n[n.superclass == superclass]
    key = 'subclass' if superclass in ('vnc_sensory', 'sensory_ascending') else 'type'
    for value, g in d.groupby(key):
        if len(g) >= 4 and value:
            sources[f'src_{superclass}_{value}'.replace(' ', '_').replace(',', '_')] = g.idx.tolist()

groups = pathlib.Path(tempfile.mkdtemp()) / 'groups.txt'
with open(groups, 'w', newline='\n') as f:
    f.write((ROOT / 'data/brain/groups.txt').read_text())
    for name, idx in sources.items():
        f.write(f'{name}\t{",".join(map(str, idx))}\n')

b = Brain(groups=groups)
b.param('dt', 1.0); b.param('w_syn', 0.15); b.param('adapt', 0.20); b.param('tau_adapt', 3000)  # the shipped configuration
b.cutout('mn_all')
print(f'{len(sources)} source groups')

rows = []
for name in sources:
    for mv in (9, 12):
        b.clear(); b.reset()
        for g, v in REST.items():
            b.drive(g, v)
        b.advance(1500); b.advance(300)
        b.drive(name, mv)
        b.advance(150)
        r = b.rates(400)
        target = {k: (r[k + '_L'] + r[k + '_R']) / 2 for k in TARGETS}
        target['mdn'] = r['dn_mdn']
        target['pip1'] = r['dn_pip1']
        rows.append((name, mv, target, max(r['mn_dlm_L'], r['mn_dlm_R']), r['dn_gf_L'] + r['dn_gf_R']))
b.close()


def top(title, score, count=6):
    print(f'\n{title}')
    quiet = [row for row in rows if row[3] < 15 and row[4] < 30 and score(row[2]) > 0]
    seen = set()
    for name, mv, target, dlm, gf in sorted(quiet, key=lambda row: -score(row[2])):
        if name in seen:
            continue
        seen.add(name)
        if len(seen) > count:
            break
        others = ' '.join(f'{k.replace("dn_", "")}={v:.0f}' for k, v in target.items() if v >= 2)
        print(f'  {name[4:56]:52s} {mv:2d} mV  dlm {dlm:3.0f} | {others}')


top('DNp09 (forward walking)', lambda t: t['dn_DNp09'])
top('DNa01 + DNa02 (steering)', lambda t: t['dn_DNa01'] + t['dn_DNa02'])
top('MDN (backward walking)', lambda t: t['mdn'])
top('pIP1', lambda t: t['pip1'])
top('DNg62 + DNge078 (aDN1, aDN2: antennal grooming)', lambda t: t['dn_DNg62'] + t['dn_DNge078'])
