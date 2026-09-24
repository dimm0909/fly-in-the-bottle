"""Which kind of leg proprioceptor drives which leg motor pools? (feedback for the walking loop)

  python tools/explore/explore16.py

A resting fly (light 8 mV, every kind of leg proprioceptor 7 mV, leg bristles 5 mV) is disturbed on one leg at a time: one
kind of proprioceptor of one left leg is silenced ('off', a leg that has come off the glass) or raised to 12 mV
('on', a leg that is loaded or moved). Printed: the change in the swing-type (extensor, levator, promotor, ...) and
stance-type (flexor, depressor, remotor, ...) pools of that leg and of the other five legs, and in a few other
read-outs (flight muscles, backward and forward walking, grooming). Rates in Hz, mean over 400 ms after 150 ms.
The kinds: cs campaniform sensilla (2 neurons per leg: load), co chordotonal organs (joint position and speed), hp hair
plates (ends of the joint range), lg the rest of the leg proprioceptors, touch leg bristles.

Then the same at higher levels (15, 20, 30 mV on one kind of one leg), on all four kinds of one leg together, and on all legs at
once (raised to 9 / 12 / 15 mV, or lowered to 0 / 3 / 5 mV as on a fly held off the glass).
"""
import sys

sys.path.insert(0, 'tools')
from brain_client import Brain

KINDS = ['cs', 'co', 'hp', 'lg']
REST = {'pr_L': 8, 'pr_R': 8}
for leg in 'fmh':
    for side in 'LR':
        for k in KINDS:
            REST[f'{k}_leg_{leg}_{side}'] = 7
        REST[f'touch_leg_{leg}_{side}'] = 5

b = Brain()
b.param('dt', 1.0); b.param('w_syn', 0.15); b.param('adapt', 0.20); b.param('tau_adapt', 3000)
b.cutout('mn_all')


def settle():
    b.clear(); b.reset()
    for g, v in REST.items():
        b.drive(g, v)
    b.advance(2500); b.advance(500)


def read(r):
    out = {}
    for l in 'fmh':
        for s in 'LR':
            out[f'sw_{l}{s}'] = r[f'mn_leg_{l}_sw_{s}']
            out[f'st_{l}{s}'] = r[f'mn_leg_{l}_st_{s}']
    out['dlm'] = (r['mn_dlm_L'] + r['mn_dlm_R']) / 2
    out['mdn'] = r['dn_mdn']
    out['p09'] = (r['dn_DNp09_L'] + r['dn_DNp09_R']) / 2
    out['groom'] = r['dn_groom']
    return out


settle()
base = read(b.rates(1000))
print('baseline (resting):', ' '.join(f'{k} {v:.1f}' for k, v in base.items() if v >= 0.5) or 'all pools silent')
print(f'{"leg kind":12s} {"change":8s} | this leg sw / st | other legs sw / st (mean) | dlm mdn DNp09 groom | busiest other pool')
for leg in 'fmh':
    for kind in KINDS + ['touch']:
        for mode, level in (('off', 0), ('on', 12)):
            settle()
            group = f'touch_leg_{leg}_L' if kind == 'touch' else f'{kind}_leg_{leg}_L'
            b.drive(group, level)
            b.advance(150)
            r = read(b.rates(400))
            mine = (r[f'sw_{leg}L'] - base[f'sw_{leg}L'], r[f'st_{leg}L'] - base[f'st_{leg}L'])
            others = [(k, r[k] - base[k]) for k in r if k[:2] in ('sw', 'st') and k != f'sw_{leg}L' and k != f'st_{leg}L']
            osw = sum(v for k, v in others if k.startswith('sw')) / 5
            ost = sum(v for k, v in others if k.startswith('st')) / 5
            top = max(others, key=lambda kv: abs(kv[1]))
            print(f'{leg} {kind:9s} {mode:8s} | {mine[0]:6.1f} / {mine[1]:6.1f}   | {osw:6.1f} / {ost:6.1f}          | {r["dlm"]:3.0f} {r["mdn"]:3.0f} {r["p09"]:4.0f} {r["groom"]:4.0f} | {top[0]} {top[1]:+.0f}')


def summary(r, leg):
    sw = {f'{l}{s}': r[f'sw_{l}{s}'] for l in 'fmh' for s in 'LR'}
    st = {f'{l}{s}': r[f'st_{l}{s}'] for l in 'fmh' for s in 'LR'}
    others = [k for k in sw if k != f'{leg}L']
    return (f'this leg sw {sw[leg + "L"]:5.1f} st {st[leg + "L"]:5.1f} | others sw {sum(sw[k] for k in others) / 5:5.1f} st {sum(st[k] for k in others) / 5:5.1f}'
            f' | dlm {r["dlm"]:3.0f} mdn {r["mdn"]:3.0f} groom {r["groom"]:3.0f}')


print('one kind of one left leg at higher levels (rest 7 mV)')
for leg in 'fm':
    for kind in KINDS:
        for level in (15, 20, 30):
            settle(); b.drive(f'{kind}_leg_{leg}_L', level); b.advance(150)
            print(f'{leg} {kind} {level:2d}:', summary(read(b.rates(400)), leg))
print('all four kinds of one left leg together')
for leg in 'fmh':
    for level in (10, 12, 15, 20):
        settle()
        for k in KINDS:
            b.drive(f'{k}_leg_{leg}_L', level)
        b.advance(150)
        print(f'{leg} all {level:2d}:', summary(read(b.rates(400)), leg))
print('all legs, all kinds: raised, and lowered (a fly held off the glass)')
for level in (9, 12, 15, 0, 3, 5):
    settle()
    for leg in 'fmh':
        for side in 'LR':
            for k in KINDS:
                b.drive(f'{k}_leg_{leg}_{side}', level)
    b.advance(150)
    print(f'all legs {level:2d}:', summary(read(b.rates(400)), 'f'))
b.close()
