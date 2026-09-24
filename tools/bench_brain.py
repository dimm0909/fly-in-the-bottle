import sys
sys.path.insert(0, 'tools')
from brain_client import Brain
def cfg(dt=1.0):
    b = Brain(); b.param('dt', dt); b.param('w_syn', 0.15); b.param('adapt', 0.1); b.param('tau_adapt', 1500); b.cutout('mn_all'); return b
b = cfg()
print('idle (no input)        ', b.bench(1000))
b.drive('looming_R', 12); b.advance(60)
print('looming (active)       ', b.bench(500))
b.drive('looming_R', 0); b.advance(500)
print('after (decaying)       ', b.bench(1000))
b.clear(); b.reset()
for s in 'LR': b.drive(f'pr_{s}', 9)
b.advance(200)
print('ambient light on       ', b.bench(1000))
b.clear(); b.reset()
print('--- equivalence with the earlier run (dt=1.0): expected pulse dlm~152 dvm~79 gf~233 wsteerL~35 R~21')
b.drive('looming_R', 12); r = b.rates(150)
print('   pulse:', {k: round(r[k]) for k in ('mn_dlm_L','mn_dvm_L','dn_gf_R','mn_wsteer_L','mn_wsteer_R','mn_neck_L')})
b.close()
