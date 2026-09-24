#!/usr/bin/env python3
"""Sanity checks for the brain sidecar: run after (re)building it. Exits non-zero on failure.

  python tools/check_brain.py
"""
import sys
import time

sys.path.insert(0, 'tools')
from brain_client import Brain

failures = []

def check(name, ok, detail=''):
    print(f'{"ok  " if ok else "FAIL"} {name} {detail}')
    if not ok:
        failures.append(name)

b = Brain()
check('graph loaded', b.n == 164606 and b.e > 6_000_000, f'({b.n} neurons, {b.e} connections)')

# a quiet network is silent and costs nothing
t = time.time(); silent = b.advance(2000); dt = time.time() - t
check('idle network is silent', sum(silent.values()) == 0)
check('idle network is free', dt < 0.05, f'({dt * 1000:.1f} ms for 2 s)')

# looming from the right: flight power and the giant fibre fire, and it ends by itself (adaptation)
b.drive('looming_R', 12)
r = b.rates(150)
check('looming drives the flight muscles', r['mn_dlm_L'] > 60 and r['mn_dvm_L'] > 30, f"(dlm {r['mn_dlm_L']:.0f} dvm {r['mn_dvm_L']:.0f} Hz)")
check('looming fires the giant fibre', r['dn_gf_R'] > 100, f"({r['dn_gf_R']:.0f} Hz)")
check('looming fires the jump muscle (TTMn)', (r['mn_ttm_L'] + r['mn_ttm_R']) / 2 > 15, f"(TTMn L/R {r['mn_ttm_L']:.0f}/{r['mn_ttm_R']:.0f} Hz)")
b.drive('looming_R', 0)
b.advance(500)
after = b.rates(500)
check('the response ends without input', after['mn_dlm_L'] < 5, f"(dlm {after['mn_dlm_L']:.1f} Hz)")

# touch on the abdomen is a local reaction, not a take-off
b.clear(); b.reset()
b.drive('touch_abdomen_R', 12)
b.advance(100)
r = b.rates(200)
check('abdomen touch reaches abdominal motor neurons', r['mn_abd_R'] > 5, f"(abd {r['mn_abd_R']:.0f} Hz)")
check('abdomen touch is not a take-off', r['mn_dlm_L'] < 60 and r['mn_dvm_L'] < 30, f"(dlm {r['mn_dlm_L']:.0f} Hz)")
check('abdomen touch is not a jump', (r['mn_ttm_L'] + r['mn_ttm_R']) / 2 < 5, f"(TTMn {r['mn_ttm_L']:.0f}/{r['mn_ttm_R']:.0f} Hz)")

# more input never gives less flight power (graded response)
levels = []
for v in (7.5, 9, 12):
    b.clear(); b.reset(); b.drive('looming_R', v); b.advance(80)
    levels.append(b.rates(120)['mn_dvm_L'])
check('response grows with stimulus strength', levels[0] <= levels[1] + 5 <= levels[2] + 10, f'(dvm {levels[0]:.0f} < {levels[1]:.0f} < {levels[2]:.0f})')

# walking commands: a small object on the right steers to the right and walks the fly forward, without a take-off;
# the drive is what BrainFly.sense() gives an object of strength ~0.8 (OBJECT_STEER, OBJECT_WALK in src/brainfly.js)
REST = {'pr_L': 8, 'pr_R': 8} | {f'{k}_{l}_{s}': v for k, v in (('prop_leg', 7), ('touch_leg', 5)) for l in 'fmh' for s in 'LR'}
def settled():
    b.clear(); b.reset()
    for g, v in REST.items():
        b.drive(g, v)
    b.advance(3000)
settled()
b.drive('lc10d_R', 9.4); b.drive('lc9_L', 8.1); b.drive('lc9_R', 8.1)
r = b.rates(1000)
check('object on the right drives DNa02 on the right', r['dn_DNa02_R'] > 10 and r['dn_DNa02_R'] > r['dn_DNa02_L'] + 10, f"(DNa02 L/R {r['dn_DNa02_L']:.0f}/{r['dn_DNa02_R']:.0f} Hz)")
check('object drives forward walking (DNp09)', (r['dn_DNp09_L'] + r['dn_DNp09_R']) / 2 > 5, f"(DNp09 {r['dn_DNp09_L']:.0f}/{r['dn_DNp09_R']:.0f} Hz)")
check('object is not a take-off', max(r[f'mn_{m}_{s}'] for m in ('dlm', 'dvm') for s in 'LR') < 60, f"(dlm {r['mn_dlm_L']:.0f} dvm {r['mn_dvm_L']:.0f} Hz)")
settled()
b.drive('lc10d_L', 9.4); b.drive('lc9_L', 8.1); b.drive('lc9_R', 8.1)
r = b.rates(1000)
check('object on the left drives DNa02 on the left', r['dn_DNa02_L'] > 10 and r['dn_DNa02_L'] > r['dn_DNa02_R'] + 10, f"(DNa02 L/R {r['dn_DNa02_L']:.0f}/{r['dn_DNa02_R']:.0f} Hz)")

# a hard touch on the head bristles drives the moonwalker neurons (backward walking)
settled()
b.drive('bm_L', 12); b.drive('bm_R', 12)
r = b.rates(400)
check('head touch drives MDN (backward walking)', r['dn_mdn'] > 5, f"(MDN {r['dn_mdn']:.0f} Hz)")

# grooming: the descending neurons aDN1 / aDN2 (DNg62, DNge078) are silent in a resting fly and burst when both sides of the
# head bristles are under load (BrainFly's dust); the flight muscles stay out of it
settled()
r = b.rates(2000)
check('grooming neurons are silent at rest', r['dn_groom'] < 1, f"(aDN {r['dn_groom']:.1f} Hz)")
b.drive('bm_L', 12); b.drive('bm_R', 12)
r = b.rates(400)
check('head bristles on both sides drive grooming (aDN1, aDN2)', r['dn_groom'] > 20, f"(aDN {r['dn_groom']:.0f} Hz)")
check('grooming is not a take-off', max(r[f'mn_{m}_{s}'] for m in ('dlm', 'dvm') for s in 'LR') < 60, f"(dlm {r['mn_dlm_L']:.0f} dvm {r['mn_dvm_L']:.0f} Hz)")
b.close()
sys.exit(1 if failures else 0)
