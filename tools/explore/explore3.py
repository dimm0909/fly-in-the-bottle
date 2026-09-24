import sys
sys.path.insert(0, 'tools')
from brain_client import Brain
b = Brain()
def run(drives, settle=250, measure=400):
    b.clear(); b.reset()
    for g, v in drives.items(): b.drive(g, v)
    b.advance(settle)
    return b.rates(measure)
def line(r):
    f = lambda k: (r.get(f'{k}_L', 0) + r.get(f'{k}_R', 0)) / 2
    return (f"dlm {f('mn_dlm'):4.0f} dvm {f('mn_dvm'):4.0f} wsteer {f('mn_wsteer'):3.0f} halt {f('mn_haltere'):3.0f} neck {f('mn_neck'):3.0f} abd {f('mn_abd'):3.0f} prob {f('mn_prob'):3.0f} "
            f"legF {f('mn_leg_f'):3.0f} legM {f('mn_leg_m'):3.0f} legH {f('mn_leg_h'):3.0f} | dn {f('dn'):4.1f}")
light = {'pr_L': 9, 'pr_R': 9}
print('w_syn sweep. columns = mean of L/R rates (Hz)')
for w in (0.275, 0.2, 0.15, 0.1, 0.07):
    b.param('w_syn', w)
    print(f'--- w_syn = {w}')
    print('  looming R 12     ', line(run({'looming_R': 12} | light)))
    print('  touch abdomen 12 ', line(run({'touch_abdomen_L': 12, 'touch_abdomen_R': 12} | light)))
    print('  touch head BM 12 ', line(run({'bm_L': 12, 'bm_R': 12} | light)))
    print('  wind JO-CEF 12   ', line(run({'jo_cef_L': 12, 'jo_cef_R': 12} | light)))
    print('  touch front leg L', line(run({'touch_leg_f_L': 12} | light)))
b.close()
