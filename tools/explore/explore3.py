"""Sweep the global synaptic gain (w_syn) and see how specific the responses are.

  python tools/explore/explore3.py            # the original experiment: dt 0.5 ms, no adaptation
  python tools/explore/explore3.py --final    # shipped configuration: dt 1 ms, adaptation 0.20 mV / 3 s

Prints the raw rates and, at the end, two markdown tables of the DLM (flight muscle) rate per
stimulus and gain (250-650 ms after the onset, and the first 150 ms), which is what docs/brain_model.md quotes. Numbers near w_syn = 0.15 are
sensitive to small changes of the model (this is a near-critical regime), so quote a run, not a
memory.
"""
import sys

sys.path.insert(0, 'tools')
from brain_client import Brain

final = '--final' in sys.argv
b = Brain()
if final:
    b.param('dt', 1.0); b.param('adapt', 0.20); b.param('tau_adapt', 3000)
else:
    b.param('dt', 0.5); b.param('adapt', 0)

light = {'pr_L': 9, 'pr_R': 9}
GAINS = (0.275, 0.2, 0.15, 0.1, 0.07)
STIMULI = {
    'looming R 12': {'looming_R': 12},
    'touch abdomen 12': {'touch_abdomen_L': 12, 'touch_abdomen_R': 12},
    'touch head BM 12': {'bm_L': 12, 'bm_R': 12},
    'wind JO-CEF 12': {'jo_cef_L': 12, 'jo_cef_R': 12},
    'touch front leg L': {'touch_leg_f_L': 12},
}


def run(drives, settle=250, measure=400):
    b.clear(); b.reset()
    for g, v in (drives | light).items():
        b.drive(g, v)
    b.advance(settle)
    return b.rates(measure)


def mean(r, k):
    return (r.get(f'{k}_L', 0) + r.get(f'{k}_R', 0)) / 2


def line(r):
    return (f"dlm {mean(r, 'mn_dlm'):4.0f} dvm {mean(r, 'mn_dvm'):4.0f} wsteer {mean(r, 'mn_wsteer'):3.0f} halt {mean(r, 'mn_haltere'):3.0f} "
            f"neck {mean(r, 'mn_neck'):3.0f} abd {mean(r, 'mn_abd'):3.0f} prob {mean(r, 'mn_prob'):3.0f} "
            f"legF {mean(r, 'mn_leg_f'):3.0f} legM {mean(r, 'mn_leg_m'):3.0f} legH {mean(r, 'mn_leg_h'):3.0f} | dn {mean(r, 'dn'):4.1f}")


print(f'w_syn sweep ({"shipped configuration" if final else "original experiment"}); columns = mean of L/R rates (Hz)')
dlm, abd, burst = {}, {}, {}
for w in GAINS:
    b.param('w_syn', w)
    print(f'--- w_syn = {w}')
    for name, drives in STIMULI.items():
        r = run(drives)
        dlm[(name, w)], abd[(name, w)] = mean(r, 'mn_dlm'), mean(r, 'mn_abd')
        burst[(name, w)] = mean(run(drives, settle=0, measure=150), 'mn_dlm')  # the first 150 ms: the burst itself
        print(f'  {name:18s}', line(r))

print('\n| Стимул (12 мВ) | ' + ' | '.join(str(w).replace('.', ',') for w in GAINS) + ' |')
print('| --- |' + ' --- |' * len(GAINS))
for name in STIMULI:
    print(f'| {name} | ' + ' | '.join(f'{dlm[(name, w)]:.0f}' for w in GAINS) + ' |')
print('\nthe same in the first 150 ms after the onset (the burst)')
print('| Стимул (12 мВ) | ' + ' | '.join(str(w).replace('.', ',') for w in GAINS) + ' |')
print('| --- |' + ' --- |' * len(GAINS))
for name in STIMULI:
    print(f'| {name} | ' + ' | '.join(f'{burst[(name, w)]:.0f}' for w in GAINS) + ' |')
print('\nabdominal motor neurons for "touch abdomen 12":', ', '.join(f'{w}: {abd[("touch abdomen 12", w)]:.0f}' for w in GAINS))
b.close()
