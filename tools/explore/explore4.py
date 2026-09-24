import sys
sys.path.insert(0, 'tools')
from brain_client import Brain
b = Brain()
b.param('dt', 0.5); b.param('adapt', 0)  # settings of the original experiment (w_syn is set below)
light = {'pr_L': 9, 'pr_R': 9}
def run(drives, settle=250, measure=400):
    b.clear(); b.reset()
    for g, v in drives.items(): b.drive(g, v)
    b.advance(settle); return b.rates(measure)
def p(r, keys, w=5):
    return ' '.join(f'{k[3:]}:{r.get(k+"_L",0):3.0f}/{r.get(k+"_R",0):<3.0f}' for k in keys)
KEYS = ['mn_dlm', 'mn_dvm', 'mn_wsteer', 'mn_haltere', 'mn_neck', 'mn_leg_m', 'mn_leg_h', 'mn_abd', 'dn']
print('=== dose response, looming R, L/R rates')
for w in (0.14, 0.15, 0.17):
    b.param('w_syn', w)
    for d in (8, 9, 10, 12, 14):
        print(f'w={w} looming_R={d:2d}', p(run({'looming_R': d} | light), KEYS), '| gf', run({'looming_R': d} | light).get('dn_gf_R', 0))
b.param('w_syn', 0.15)
print('\n=== laterality at w=0.15 (rates L/R)')
print('looming R 12   ', p(run({'looming_R': 12} | light), KEYS))
print('looming L 12   ', p(run({'looming_L': 12} | light), KEYS))
print('touch head R   ', p(run({'bm_R': 12} | light), KEYS))
print('touch head L   ', p(run({'bm_L': 12} | light), KEYS))
print('touch abd R    ', p(run({'touch_abdomen_R': 12} | light), KEYS))
print('touch wing L   ', p(run({'touch_wing_L': 12} | light), KEYS))
print('touch hind leg L', p(run({'touch_leg_h_L': 12} | light), KEYS))
print('touch mid leg R', p(run({'touch_leg_m_R': 12} | light), KEYS))
print('haltere both 12', p(run({'haltere_L': 12, 'haltere_R': 12} | light), KEYS))
print('JO-AB both 12  ', p(run({'jo_ab_L': 12, 'jo_ab_R': 12} | light), KEYS))

print('\n=== time course, looming R 12 (10 ms bins): onset at t=0 after 200ms of light; stimulus off at t=200')
b.clear(); b.reset()
for g, v in light.items(): b.drive(g, v)
b.advance(300)
b.drive('looming_R', 12)
row = []
for t in range(0, 400, 20):
    if t == 200: b.drive('looming_R', 0)
    r = b.rates(20); row.append((t, r.get('mn_dlm_R', 0), r.get('mn_dvm_R', 0), r.get('mn_leg_m_R', 0), r.get('dn_R', 0), r.get('mn_wsteer_R', 0)))
print('  t(ms)  dlm   dvm  legM  dn   wsteer')
for t, *v in row: print(f'  {t:4d} ', ' '.join(f'{x:5.0f}' for x in v))
b.close()
