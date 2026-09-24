import sys, time
sys.path.insert(0, 'tools')
from brain_client import Brain
light = {'pr_L': 9, 'pr_R': 9}
def experiment(dt):
    b = Brain(); b.param('dt', dt); b.param('w_syn', 0.15); b.param('adapt', 0.1); b.param('tau_adapt', 1500)  # the configuration of that time (adaptation was raised later, see explore15.py)
    b.cutout('mn_all')
    for g, v in light.items(): b.drive(g, v)
    t = time.time(); b.advance(400); wall = time.time() - t
    out = {}
    b.drive('looming_R', 12); r = b.rates(150); out['pulse'] = (r['mn_dlm_L'], r['mn_dvm_L'], r['dn_gf_R'], r['mn_wsteer_L'], r['mn_wsteer_R'], r['mn_neck_L'], r['mn_neck_R'])
    b.drive('looming_R', 0)
    out['after'] = [b.rates(250)['mn_dlm_L'] for _ in range(4)]
    b.clear(); b.reset()
    for g, v in light.items(): b.drive(g, v)
    b.advance(300)
    b.drive('touch_abdomen_R', 12); r = b.rates(150)
    out['abd'] = (r['mn_abd_L'], r['mn_abd_R'], r['mn_leg_h_L'], r['mn_leg_h_R'], r['mn_dlm_L'])
    print(f'dt={dt}: {b.bench(1000)}')
    print('   looming pulse (dlm dvm gf wsteerL wsteerR neckL neckR):', ' '.join(f'{x:.0f}' for x in out['pulse']), '| dlm after:', ' '.join(f'{x:.0f}' for x in out['after']))
    print('   touch abdomen R (abdL abdR hindL hindR dlm):', ' '.join(f'{x:.0f}' for x in out['abd']))
    b.close()
for dt in (0.5, 1.0, 0.25):
    experiment(dt)
