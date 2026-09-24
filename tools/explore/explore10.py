import sys
sys.path.insert(0, 'tools')
from brain_client import Brain
b = Brain()
b.param('dt', 1.0); b.param('w_syn', 0.15); b.param('adapt', 0.10); b.param('tau_adapt', 1500)  # the shipped configuration, stated explicitly
rest = {'pr_L': 9, 'pr_R': 9} | {f'{k}_{l}_{s}': v for k, v in (('prop_leg', 8), ('touch_leg', 6)) for l in 'fmh' for s in 'LR'}
noisy = ['bm', 'jo_ab', 'jo_cef', 'touch_notum', 'touch_wing', 'touch_abdomen', 'haltere', 'prop_wing'] + [f'touch_leg_{l}' for l in 'fmh']
def run(rate, secs=24):
    b.clear(); b.reset()
    for g, v in rest.items(): b.drive(g, v)
    b.advance(2500)
    if rate:
        for g in noisy:
            for s in 'LR': b.poisson(f'{g}_{s}', rate)
    rows = []
    for sec in range(secs):
        r = b.rates(1000)
        rows.append((r['mn_dlm_L'] + r['mn_dlm_R'], r['mn_neck_L'] + r['mn_neck_R'], r['mn_abd_L'] + r['mn_abd_R'], r['mn_prob_L'] + r['mn_prob_R'],
                     sum(r[f'mn_leg_{l}_{s}'] for l in 'fmh' for s in 'LR')))
    return rows
for rate in (0, 2, 5, 10, 20):
    rows = run(rate)
    print(f'--- poisson {rate} Hz per neuron on sensory groups: per-second (dlm neck abd prob legs) totals')
    print('  dlm ', ' '.join(f'{r[0]:4.0f}' for r in rows))
    print('  neck', ' '.join(f'{r[1]:4.0f}' for r in rows))
    print('  abd ', ' '.join(f'{r[2]:4.0f}' for r in rows))
    print('  legs', ' '.join(f'{r[4]:4.0f}' for r in rows))
b.close()
