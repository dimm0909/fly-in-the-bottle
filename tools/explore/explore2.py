import sys
sys.path.insert(0, 'tools')
from brain_client import Brain

b = Brain()
KEYS = ['mn_dlm', 'mn_dvm', 'mn_wsteer', 'mn_wing', 'mn_haltere', 'mn_neck', 'mn_abd', 'mn_prob',
        'mn_leg_f_sw', 'mn_leg_f_st', 'mn_leg_m_sw', 'mn_leg_m_st', 'mn_leg_h_sw', 'mn_leg_h_st']

def run(label, drives, settle=250, measure=400):
    b.clear(); b.reset()
    for g, v in drives.items(): b.drive(g, v)
    b.advance(settle)
    r = b.rates(measure)
    def LR(k):  # mean of L and R, plus asymmetry
        l, rr = r.get(f'{k}_L', 0), r.get(f'{k}_R', 0)
        return f'{k[3:]}:{l:5.0f}/{rr:<5.0f}'
    print(f'{label:34s}', ' '.join(LR(k) for k in KEYS), f"| dn {r.get('dn_L',0):4.1f}/{r.get('dn_R',0):<4.1f} gf {r.get('dn_gf_L',0):.0f}/{r.get('dn_gf_R',0):.0f} mdn {r.get('dn_mdn',0):.0f} pip1 {r.get('dn_pip1',0):.0f}")
    return r

both = lambda name, v: {f'{name}_L': v, f'{name}_R': v}
print(' '*34, 'rates in Hz (L/R). dlm dvm wsteer wing halt neck abd prob | legs f,m,h swing/stance')
run('rest (light only)', both('pr', 9))
run('wind/gravity JO-CEF 10', both('jo_cef', 10) | both('pr', 9))
run('wind JO-CEF 14', both('jo_cef', 14) | both('pr', 9))
run('vibration JO-AB 10', both('jo_ab', 10) | both('pr', 9))
run('vibration JO-AB 14', both('jo_ab', 14) | both('pr', 9))
run('touch head BM 10', both('bm', 10) | both('pr', 9))
run('touch head BM (left only) 12', {'bm_L': 12, 'pr_L': 9, 'pr_R': 9})
run('touch abdomen 10', both('touch_abdomen', 10) | both('pr', 9))
run('touch notum 10', both('touch_notum', 10) | both('pr', 9))
run('touch wing 10', both('touch_wing', 10) | both('pr', 9))
run('touch front legs 10', both('touch_leg_f', 10) | both('pr', 9))
run('touch hind legs 10', both('touch_leg_h', 10) | both('pr', 9))
run('haltere 10', both('haltere', 10) | both('pr', 9))
run('prop legs (standing) 8', both('prop_leg_f', 8) | both('prop_leg_m', 8) | both('prop_leg_h', 8) | both('pr', 9))
run('looming R 12 standing', {'looming_R': 12} | both('prop_leg_f', 8) | both('prop_leg_m', 8) | both('prop_leg_h', 8) | both('pr', 9))
run('looming R 12 airborne', {'looming_R': 12} | both('pr', 9) | both('jo_cef', 10))
run('looming R 9 (weaker)', {'looming_R': 9} | both('pr', 9))
run('looming R 10.5', {'looming_R': 10.5} | both('pr', 9))
b.close()
