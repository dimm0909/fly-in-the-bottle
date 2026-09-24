"""Walking read-outs: what do LC9 and LC10d (a small moving object) do to the walking descending neurons?

  python tools/explore/explore12.py

For each group (lc9, lc10d), each side (L, R, both) and each drive level: a 1 s constant current on the
resting network, then 1 s of silence. Printed are the rates (Hz, L/R) of DNp09 (forward walking), DNa01 and DNa02
(steering), MDN (backward walking, one number), and the flight-muscle rate (max of DLM and DVM, both sides) as a
measure of unwanted take-off. These are the numbers behind the walking gains in BrainFly.read() (src/brainfly.js).
"""
import sys

sys.path.insert(0, 'tools')
from brain_client import Brain

REST = {'pr_L': 8, 'pr_R': 8} | {f'{k}_{l}_{s}': v for k, v in (('prop_leg', 7), ('touch_leg', 5)) for l in 'fmh' for s in 'LR'}

b = Brain()
b.param('dt', 1.0); b.param('w_syn', 0.15); b.param('adapt', 0.20); b.param('tau_adapt', 3000)  # the shipped configuration
b.cutout('mn_all')


def settle():
    b.clear(); b.reset()
    for g, v in REST.items():
        b.drive(g, v)
    b.advance(2500); b.advance(500)


def pair(r, k):
    return f'{r[k + "_L"]:3.0f}/{r[k + "_R"]:3.0f}'


def flight(r):
    return max(r[f'mn_{m}_{s}'] for m in ('dlm', 'dvm') for s in 'LR')


print('group  side  mV | during 1 s: p09  a01  a02  mdn  flight | after 1 s: p09  a02  mdn  flight')
for grp in ('lc9', 'lc10d'):
    for sides in ('L', 'R', 'LR'):
        for mv in (7, 8, 9, 10, 12):
            settle()
            for s in sides:
                b.drive(f'{grp}_{s}', mv)
            d = b.rates(1000)
            for s in sides:
                b.drive(f'{grp}_{s}', 0)
            a = b.rates(1000)
            print(f'{grp:6s} {sides:4s} {mv:2d} |  {pair(d, "dn_DNp09")} {pair(d, "dn_DNa01")} {pair(d, "dn_DNa02")} {d["dn_mdn"]:3.0f} {flight(d):5.0f} |'
                  f'  {pair(a, "dn_DNp09")} {pair(a, "dn_DNa02")} {a["dn_mdn"]:3.0f} {flight(a):5.0f}')
b.close()
