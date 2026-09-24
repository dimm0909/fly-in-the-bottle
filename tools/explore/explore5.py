import sys
sys.path.insert(0, 'tools')
from brain_client import Brain
b = Brain()
b.param('w_syn', 0.15)
light = {'pr_L': 9, 'pr_R': 9}
def setup():
    b.clear(); b.reset()
    for g, v in light.items(): b.drive(g, v)
    b.advance(300)
def trace(label, bins, ms=100):
    out = []
    for _ in range(bins):
        r = b.rates(ms); out.append((r['mn_dlm_L'], r['mn_dvm_L'], r['mn_wing_L'], r['mn_leg_m_L'], r['dn_L']))
    print(f'{label:28s} dlm ' + ' '.join(f'{o[0]:3.0f}' for o in out) + '\n' + ' '*28 + ' dvm ' + ' '.join(f'{o[1]:3.0f}' for o in out) + '\n' + ' '*28 + ' dn  ' + ' '.join(f'{o[4]:3.0f}' for o in out))

print('persistence after a 200 ms looming pulse (100ms bins):')
setup(); b.drive('looming_R', 12); b.advance(200); b.drive('looming_R', 0)
trace('after pulse', 30)

for name, drv in [('leg contact: prop_leg all 9', {f'prop_leg_{l}_{s}': 9 for l in 'fmh' for s in 'LR'}),
                  ('leg contact: touch_leg all 9', {f'touch_leg_{l}_{s}': 9 for l in 'fmh' for s in 'LR'}),
                  ('leg contact both 9', {f'{k}_{l}_{s}': 9 for k in ('prop_leg', 'touch_leg') for l in 'fmh' for s in 'LR'}),
                  ('haltere 9', {f'haltere_{s}': 9 for s in 'LR'}),
                  ('wing touch 9', {f'touch_wing_{s}': 9 for s in 'LR'}),
                  ('abdomen touch 9', {f'touch_abdomen_{s}': 9 for s in 'LR'}),
                  ('wind JO-CEF 12', {f'jo_cef_{s}': 12 for s in 'LR'}),
                  ('darkness (pr off)', {'pr_L': 0, 'pr_R': 0})]:
    setup(); b.drive('looming_R', 12); b.advance(200); b.drive('looming_R', 0); b.advance(300)
    for g, v in drv.items(): b.drive(g, v)
    trace(f'+ {name}', 12)
b.close()
