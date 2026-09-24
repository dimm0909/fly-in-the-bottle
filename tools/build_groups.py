#!/usr/bin/env python3
"""Named neuron groups for stimulation and read-out: data/brain/groups.txt (+ groups.json summary).

Sensors (what the body can drive):   pr*, jo_*, bm_*, touch_*, prop_*, haltere_*, looming_*
Read-outs (what the body reads):     mn_* (motor neurons), dn_* (descending neurons)
Everything is derived from the MaleCNS annotations only; see the comments for the biology used.
"""
import json
import pathlib
import re

import pandas as pd

root = pathlib.Path(__file__).resolve().parent.parent
n = pd.read_feather(root / 'data/brain/neurons.feather')
ann = pd.read_feather(root / 'data/malecns/body-annotations-male-cns-v1.0-minconf-0.5.feather', columns=['bodyId', 'rootSide'])
n = n.merge(ann.drop_duplicates('bodyId'), on='bodyId', how='left')
n['idx'] = range(len(n))
n['type'] = n.type.fillna('')
n['subclass'] = n.subclass.fillna('')
n['entryNerve'] = n.entryNerve.fillna('')

groups = {}

def add(name, mask):
    idx = n.idx[mask].tolist()
    if idx:
        groups[name] = idx

def sided(name, mask, side_col):
    for s in 'LR':
        add(f'{name}_{s}', mask & (n[side_col] == s))

# ---- sensors -----------------------------------------------------------------------------
pr = n.superclass == 'ol_sensory'
sided('pr', pr, 'rootSide')                                        # photoreceptors
sided('pr16', pr & (n.type == 'R1-R6'), 'rootSide')                # motion / luminance
sided('pr78', pr & n.type.str.match(r'^R[78]'), 'rootSide')        # colour / polarised light

cb = n.superclass == 'cb_sensory'
jo = cb & n.type.str.startswith('JO')
sided('jo_ab', jo & n.type.str.match(r'^JO-[AB]'), 'rootSide')     # Johnston's organ A/B: sound, near-field vibration
sided('jo_cef', jo & ~n.type.str.match(r'^JO-[AB]'), 'rootSide')   # C/E/F: wind, gravity, antennal position
sided('bm', cb & n.type.str.startswith('BM'), 'rootSide')          # head bristle mechanosensors

vs = n.superclass.isin(['vnc_sensory', 'sensory_ascending'])
bristle = n.subclass.isin(['leg bristle', 'mechanosensory bristle'])
leg_nerve = {'f': ['ProLN', 'ProAN', 'ProCN', 'VProN', 'DProN'], 'm': ['MesoLN', 'MesoAN'], 'h': ['MetaLN']}
proprio = n.subclass.isin(['chordotonal organ', 'campaniform sensilla', 'hair plate', 'leg'])
for leg, nerves in leg_nerve.items():
    sided(f'touch_leg_{leg}', vs & bristle & n.entryNerve.isin(nerves), 'rootSide')
    sided(f'prop_leg_{leg}', vs & proprio & n.entryNerve.isin(nerves), 'rootSide')
sided('touch_wing', vs & (n.subclass.isin(['wing bristle', 'wing']) | (bristle & (n.entryNerve == 'ADMN'))), 'rootSide')
sided('prop_wing', vs & (n.subclass == 'campaniform sensilla') & (n.entryNerve == 'ADMN'), 'rootSide')
sided('touch_notum', vs & ((n.subclass == 'notum') | (bristle & (n.entryNerve == 'PDMN'))), 'rootSide')
sided('touch_abdomen', vs & (n.subclass == 'abdomen'), 'rootSide')
sided('haltere', vs & ((n.subclass == 'haltere') | ((n.subclass == 'campaniform sensilla') & (n.entryNerve == 'DMetaN'))), 'rootSide')

vp = n.superclass == 'visual_projection'
sided('looming', vp & n.type.isin(['LPLC2', 'LC4', 'LC6', 'LC16', 'LPLC1']), 'somaSide')

# ---- motor read-outs ---------------------------------------------------------------------
mn = n.superclass.isin(['vnc_motor', 'cb_motor'])
FLEX = re.compile(r'flexor|depressor|remotor|adductor|reductor|posterior rotator', re.I)
EXT = re.compile(r'extensor|levator|promotor|abductor|anterior rotator', re.I)
for leg, sub in {'f': 'fl', 'm': 'ml', 'h': 'hl'}.items():
    m = (n.superclass == 'vnc_motor') & (n.subclass == sub)
    sided(f'mn_leg_{leg}', m, 'somaSide')
    sided(f'mn_leg_{leg}_st', m & n.type.str.contains(FLEX), 'somaSide')   # stance-like: flexors / depressors
    sided(f'mn_leg_{leg}_sw', m & n.type.str.contains(EXT), 'somaSide')    # swing-like: extensors / levators
wm = (n.superclass == 'vnc_motor') & (n.subclass == 'wm')
sided('mn_wing', wm, 'somaSide')
sided('mn_dlm', wm & n.type.str.startswith('DLMn'), 'somaSide')            # dorsal longitudinal: flight power
sided('mn_dvm', wm & n.type.str.startswith('DVMn'), 'somaSide')            # dorso-ventral: flight power
sided('mn_wsteer', wm & n.type.str.match(r'^(b\d|i\d|iii\d|hg\d|ps\d|tp\d|tpn)'), 'somaSide')  # steering muscles
sided('mn_haltere', (n.superclass == 'vnc_motor') & (n.subclass == 'hm'), 'somaSide')
sided('mn_neck', mn & (n.subclass == 'nm'), 'somaSide')
sided('mn_abd', (n.superclass == 'vnc_motor') & (n.subclass == 'ad'), 'somaSide')
sided('mn_prob', (n.superclass == 'cb_motor') & (n.subclass == 'pm'), 'somaSide')

add('mn_all', n.superclass.isin(['vnc_motor', 'cb_motor', 'vnc_efferent', 'cb_efferent', 'efferent_ascending', 'efferent_descending', 'cb_endocrine', 'vnc_endocrine', 'ENS']))

# ---- descending neurons ------------------------------------------------------------------
dn = n.superclass == 'descending_neuron'
sided('dn', dn, 'somaSide')
sided('dn_gf', dn & (n.type == 'DNp01'), 'somaSide')                       # giant fibres: escape take-off
for t in ['DNa01', 'DNa02', 'DNg100', 'DNp02', 'DNp03', 'DNp06', 'DNp07', 'DNp09', 'DNp10', 'DNp11', 'DNb01']:
    sided(f'dn_{t}', dn & (n.type == t), 'somaSide')
add('dn_mdn', dn & (n.type == 'MDN'))                                       # moonwalker: backward walking
add('dn_pip1', dn & (n.type == 'pIP1'))

out = root / 'data/brain'
with open(out / 'groups.txt', 'w') as f:
    for name, idx in groups.items():
        f.write(f'{name}\t{",".join(map(str, idx))}\n')
(out / 'groups.json').write_text(json.dumps({k: len(v) for k, v in groups.items()}, indent=1))
print(f'{len(groups)} groups')
for k, v in groups.items():
    print(f'  {k:18s}{len(v):6d}', end='\n' if (list(groups).index(k) % 4 == 3) else '')
print()
