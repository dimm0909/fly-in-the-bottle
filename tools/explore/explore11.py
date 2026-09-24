"""How often does weak sensory noise make the resting fly twitch? (long runs, several seeds)

  python tools/explore/explore11.py RATE_HZ [SECONDS]

A "burst" is a second in which the summed rate of neck, leg, abdominal-flex and flight-muscle motor
neurons exceeds a threshold after at least 3 quiet seconds; a run that never calms down again is
reported as "restless". The noise groups are those of the former BrainFly.ambientNoise() (src/brainfly.js, removed: this experiment is why).
"""
import sys

sys.path.insert(0, 'tools')
from brain_client import Brain

rate = float(sys.argv[1])
secs = int(sys.argv[2]) if len(sys.argv) > 2 else 240
rest = {'pr_L': 8, 'pr_R': 8} | {f'{k}_{l}_{s}': v for k, v in (('prop_leg', 7), ('touch_leg', 5)) for l in 'fmh' for s in 'LR'}
noisy = ['bm', 'jo_ab', 'jo_cef', 'touch_notum', 'touch_wing', 'touch_abdomen', 'haltere', 'prop_wing', 'touch_leg_f', 'touch_leg_m', 'touch_leg_h']
b = Brain()
b.param('dt', 1.0); b.param('w_syn', 0.15); b.param('adapt', 0.10); b.param('tau_adapt', 1500)  # the configuration of that time (adaptation was raised later, see explore15.py)
for g, v in rest.items():
    b.drive(g, v)
b.advance(3000)
for g in noisy:
    for s in 'LR':
        b.poisson(f'{g}_{s}', rate)
act = []
for _ in range(secs):
    r = b.rates(1000)
    act.append(sum(r[f'{k}_{s}'] for k in ('mn_neck', 'mn_dlm', 'mn_dvm') for s in 'LR') + sum(r[f'mn_leg_{l}_{s}'] for l in 'fmh' for s in 'LR'))
b.close()
THR = 8
bursts, quiet = 0, 3
for a in act:
    if a > THR:
        bursts += quiet >= 3
        quiet = 0
    else:
        quiet += 1
active_frac = sum(a > THR for a in act) / len(act)
print(f'rate {rate:4.1f} Hz over {secs} s: bursts {bursts:3d}  (one per {secs / max(bursts, 1):5.0f} s)  active {100 * active_frac:4.0f}% of the time  '
      f'last 30 s active {100 * sum(a > THR for a in act[-30:]) / 30:3.0f}%')
