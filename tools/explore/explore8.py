import sys
sys.path.insert(0, 'tools')
from brain_client import Brain
light = {'pr_L': 9, 'pr_R': 9}
both = lambda k, v: {f'{k}_L': v, f'{k}_R': v}
legs = lambda k, v: {f'{k}_{l}_{s}': v for l in 'fmh' for s in 'LR'}
standing = light | legs('prop_leg', 8) | legs('touch_leg', 6)
airborne = light | both('jo_cef', 10) | both('haltere', 9)
airborne2 = light | both('jo_cef', 12) | both('haltere', 11) | both('prop_wing', 9)
def experiment(label, adapt, tau, ctx_before, ctx_after, pulse=12):
    b = Brain(); b.param('dt', 0.5); b.param('w_syn', 0.15); b.param('adapt', adapt); b.param('tau_adapt', tau)
    for g, v in ctx_before.items(): b.drive(g, v)
    b.advance(400)
    b.drive('looming_R', pulse); r1 = b.rates(150); b.drive('looming_R', 0)
    b.clear()
    for g, v in ctx_after.items(): b.drive(g, v)
    seq = [b.rates(250) for _ in range(12)]
    print(f'{label:34s} pulse: dlm {r1["mn_dlm_L"]:3.0f} dvm {r1["mn_dvm_L"]:3.0f} | after: dlm ' + ' '.join(f'{r["mn_dlm_L"]:3.0f}' for r in seq) + ' | dvm ' + ' '.join(f'{r["mn_dvm_L"]:3.0f}' for r in seq[:6]))
    b.close()
for adapt, tau in ((0.05, 1000), (0.1, 1000), (0.1, 2000)):
    print(f'--- adapt={adapt} tau={tau} (dlm rate L, 250 ms bins after the pulse)')
    experiment('standing -> standing', adapt, tau, standing, standing)
    experiment('standing -> airborne feedback', adapt, tau, standing, airborne)
    experiment('standing -> airborne2', adapt, tau, standing, airborne2)
    experiment('airborne -> airborne (weak pulse 9)', adapt, tau, airborne, airborne, 9)
