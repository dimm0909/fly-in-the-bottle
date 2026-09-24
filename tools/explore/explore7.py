import sys
sys.path.insert(0, 'tools')
from brain_client import Brain
light = {'pr_L': 9, 'pr_R': 9}
def experiment(label, w=0.15, cut=False, adapt=0.0, tau=1000.0, drive=12):
    b = Brain(); b.param('dt', 0.5); b.param('w_syn', w); b.param('adapt', adapt); b.param('tau_adapt', tau)
    if cut: b.cutout('mn_all')
    for g, v in light.items(): b.drive(g, v)
    b.advance(300)
    b.drive('looming_R', drive)
    burst = b.rates(200); b.drive('looming_R', 0)
    seq = []
    for _ in range(15):        # 15 x 200ms = 3 s after the stimulus
        r = b.rates(200); seq.append(r['mn_dlm_L'])
    print(f'{label:34s} during stim: dlm {burst["mn_dlm_L"]:3.0f} dvm {burst["mn_dvm_L"]:3.0f} legM {burst["mn_leg_m_L"]:3.0f} gf {burst["dn_gf_R"]:3.0f} | dlm after (per 200ms): ' + ' '.join(f'{x:3.0f}' for x in seq))
    b.close()
experiment('baseline w=.15')
experiment('cut MN outputs', cut=True)
experiment('adapt 0.05 tau1000', adapt=0.05)
experiment('adapt 0.15 tau1000', adapt=0.15)
experiment('adapt 0.3 tau1000', adapt=0.3)
experiment('adapt 0.15 tau400', adapt=0.15, tau=400)
experiment('cut + adapt 0.15', cut=True, adapt=0.15)
experiment('cut + adapt 0.3', cut=True, adapt=0.3)
