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

# more input never gives less flight power (graded response)
levels = []
for v in (7.5, 9, 12):
    b.clear(); b.reset(); b.drive('looming_R', v); b.advance(80)
    levels.append(b.rates(120)['mn_dvm_L'])
check('response grows with stimulus strength', levels[0] <= levels[1] + 5 <= levels[2] + 10, f'(dvm {levels[0]:.0f} < {levels[1]:.0f} < {levels[2]:.0f})')
b.close()
sys.exit(1 if failures else 0)
