"""Does the network steer away from a threat? Left-minus-right motor read-outs for a threat on either side.

  python tools/explore/explore19.py

Looming on the right, on the left and on both sides (12 and 10 mV) on a resting network; for four windows after the onset
the left-minus-right difference (Hz) of the steering muscles (mn_wsteer), the neck (mn_neck), the descending neurons (dn), the
power muscles (mn_dlm, mn_dvm), the haltere motor neurons (mn_haltere) and all wing motor neurons (mn_wing), and the steering
signal that BrainFly.read() makes of them. What it shows (src/brainfly.js, WSTEER_BIAS, HALTERE_STEER): the steering muscles
lean to the left for every stimulus, also a symmetric one (a bias of the network, about 8% of their total, that is subtracted); the haltere
motor neurons are the ones that change sign with the side of the threat (left more active for a threat on the right), so they
carry the direction. Positive steer is a turn to the left; away from a threat on the right is positive.
"""
import sys

sys.path.insert(0, 'tools')
from brain_client import Brain

WSTEER_BIAS, HALTERE_STEER, WSTEER_HZ = 0.08, 1.2, 40  # src/brainfly.js
KINDS = ['cs', 'co', 'hp', 'lg']
REST = {'pr_L': 8, 'pr_R': 8}
for leg in 'fmh':
    for side in 'LR':
        for k in KINDS:
            REST[f'{k}_leg_{leg}_{side}'] = 7
        REST[f'touch_leg_{leg}_{side}'] = 5
WINDOWS = ((0, 100), (100, 100), (200, 200), (400, 400))

b = Brain()
b.param('dt', 1.0); b.param('w_syn', 0.15); b.param('adapt', 0.20); b.param('tau_adapt', 3000)
b.cutout('mn_all')


def d(r, k):
    return r[f'{k}_L'] - r[f'{k}_R']


print(f'{"stimulus":16s} {"window":9s} steer(old) steer(new) | wsteer L-R (L+R)  neck  dn | dlm  dvm  haltere  wing')
for name, drives in (('looming R 12', {'looming_R': 12}), ('looming L 12', {'looming_L': 12}), ('looming both 12', {'looming_L': 12, 'looming_R': 12}),
                     ('looming R 10', {'looming_R': 10}), ('looming L 10', {'looming_L': 10}), ('looming both 10', {'looming_L': 10, 'looming_R': 10})):
    b.clear(); b.reset()
    for g, v in REST.items():
        b.drive(g, v)
    b.advance(2500); b.advance(500)
    for g, v in drives.items():
        b.drive(g, max(v, REST.get(g, 0)))
    t = 0
    for start, w in WINDOWS:
        if start > t:
            b.advance(start - t); t = start
        r = b.rates(w); t += w
        old = (d(r, 'mn_wsteer') + 0.6 * d(r, 'mn_neck') + 0.4 * d(r, 'dn')) / WSTEER_HZ
        new = (d(r, 'mn_wsteer') - WSTEER_BIAS * (r['mn_wsteer_L'] + r['mn_wsteer_R']) + HALTERE_STEER * d(r, 'mn_haltere') + 0.6 * d(r, 'mn_neck') + 0.4 * d(r, 'dn')) / WSTEER_HZ
        print(f'{name:16s} {start:3d}-{start + w:<4d} {old:+9.2f} {new:+10.2f} | {d(r, "mn_wsteer"):+6.1f} ({r["mn_wsteer_L"] + r["mn_wsteer_R"]:4.0f}) {d(r, "mn_neck"):+5.1f} {d(r, "dn"):+5.1f} | {d(r, "mn_dlm"):+5.1f} {d(r, "mn_dvm"):+5.1f} {d(r, "mn_haltere"):+6.1f} {d(r, "mn_wing"):+6.1f}')

print()
print('wing, steering-muscle, haltere and neck motor neurons, left / right, for other stimuli (50-200 ms, then 200-600 ms)')
for name, drives in (('looming R 12', {'looming_R': 12}), ('looming L 12', {'looming_L': 12}), ('haltere both 9', {'haltere_L': 9, 'haltere_R': 9}),
                     ('haltere L 12', {'haltere_L': 12}), ('wind both 8', {'jo_cef_L': 8, 'jo_cef_R': 8}), ('prop_wing L 12', {'prop_wing_L': 12}),
                     ('prop_wing R 12', {'prop_wing_R': 12}), ('object R', {'lc10d_R': 9.4, 'lc9_L': 8.1, 'lc9_R': 8.1})):
    b.clear(); b.reset()
    for g, v in REST.items():
        b.drive(g, v)
    b.advance(2500); b.advance(500)
    for g, v in drives.items():
        b.drive(g, max(v, REST.get(g, 0)))
    b.advance(50)
    for label, w in (('early', 150), ('late ', 400)):
        r = b.rates(w)
        print(f'{name:16s} {label}: ' + ' '.join(f'{k} {r[f"mn_{k}_L"]:3.0f}/{r[f"mn_{k}_R"]:3.0f}' for k in ('dlm', 'dvm', 'wsteer', 'haltere', 'wing', 'neck')))
b.close()
