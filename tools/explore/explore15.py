"""Adaptation: does the network fall silent after a touch, and do the evoked responses survive? (~2 minutes)

  python tools/explore/explore15.py

For each (adapt, tau_adapt) on the resting network (w_syn 0.15, dt 1 ms):

  tail    mean total rate (spikes/s summed over the neck, flight, abdomen and leg motor pools and the descending
          neurons) 5-30 s after a 0.2 s, 9 mV touch on one leg (middle L / front R / hind L legs), Hz. A network
          that has fallen silent gives ~0. With 0.10 mV / 1.5 s it never does (~58): recurrent loops keep the
          fly twitching and bolting every few seconds for minutes.
  loom    the looming pulse (12 mV on looming_R, first 150 ms): DLM, DVM (Hz) and the giant fibre DNp01 (Hz)
  poke    what a click on the fly gives: a 12 mV touch fading over 0.25 s plus haltere drive from the spin (10 mV
          decaying over 0.4 s), read out as wing power like BrainFly.read(); "take-off" is the time power stays
          above 0.28. Head, thorax and middle leg
  object  DNa02 on the object's side / DNp09 / strongest flight muscle for the object drive of BrainFly.sense()
          at strength 0.8 (LC10d_R 9.4 mV, LC9 8.1 mV)

The shipped values are 0.20 mV / 3 s (brain/brain.h): the smallest change that leaves the network silent.
"""
import math
import sys

sys.path.insert(0, 'tools')
from brain_client import Brain

REST = {'pr_L': 8, 'pr_R': 8} | {f'{k}_{l}_{s}': v for k, v in (('prop_leg', 7), ('touch_leg', 5)) for l in 'fmh' for s in 'LR'}
CONFIGS = [(0.10, 1500), (0.10, 3000), (0.15, 3000), (0.20, 3000), (0.25, 3000), (0.30, 3000), (0.30, 1500)]
clamp = lambda x, a, b: min(max(x, a), b)
damp = lambda rate, dt: 1 - math.exp(-rate * dt)

b = Brain()
b.param('dt', 1.0); b.param('w_syn', 0.15); b.cutout('mn_all')


def fresh():
    b.clear(); b.reset()
    for g, v in REST.items():
        b.drive(g, v)
    b.advance(2500); b.advance(500)


def activity(r):
    pools = [f'{k}_{s}' for k in ('mn_neck', 'mn_dlm', 'mn_dvm', 'mn_abd', 'dn') for s in 'LR']
    return sum(r[p] for p in pools) + sum(r[f'mn_leg_{l}_{s}'] for l in 'fmh' for s in 'LR')


def poke(groups):
    fresh()
    power = peak = flight = 0.0
    for i in range(60):
        t = i * 0.05
        for g in groups:
            b.drive(g, max(REST.get(g, 0), 12 * (1 - t / 0.25)) if t < 0.25 else REST.get(g, 0))
        for g in ('haltere_L', 'haltere_R'):
            b.drive(g, 10 * math.exp(-t / 0.4) if t < 1.0 else 0)
        r = b.rates(50)
        want = clamp((r['mn_dlm_L'] + r['mn_dlm_R'] + r['mn_dvm_L'] + r['mn_dvm_R']) / 4 / 140, 0, 1.6)
        power += (want - power) * damp(14 if want > power else 0.9, 0.05)
        peak = max(peak, power)
        flight += 0.05 if power > 0.28 else 0
    return peak, flight


print('adapt  tau |   tail (5-30 s) m/f/h |  loom dlm dvm gf | poke head       thorax     leg (peak, take-off s) | object a02 p09 flight')
for adapt, tau in CONFIGS:
    b.param('adapt', adapt); b.param('tau_adapt', tau)
    tails = []
    for g in ('touch_leg_m_L', 'touch_leg_f_R', 'touch_leg_h_L'):
        fresh(); b.drive(g, 9); b.advance(200); b.drive(g, 5)
        series = [activity(b.rates(1000)) for _ in range(30)]
        tails.append(sum(series[5:]) / 25)
    fresh(); b.drive('looming_R', 12); r = b.rates(150)
    loom = (r['mn_dlm_L'], r['mn_dvm_L'], r['dn_gf_R'])
    head, thorax, leg = poke(['bm_L']), poke(['touch_notum_L']), poke(['touch_leg_m_R'])
    fresh(); b.drive('lc10d_R', 9.4); b.drive('lc9_L', 8.1); b.drive('lc9_R', 8.1); r = b.rates(1000)
    print(f'{adapt:.2f} {tau:5d} | {tails[0]:6.1f} {tails[1]:5.1f} {tails[2]:5.1f} |   {loom[0]:4.0f} {loom[1]:3.0f} {loom[2]:3.0f} |'
          f'       {head[0]:.2f} {head[1]:.2f}   {thorax[0]:.2f} {thorax[1]:.2f}   {leg[0]:.2f} {leg[1]:.2f} |'
          f'        {r["dn_DNa02_R"]:3.0f} {(r["dn_DNp09_L"] + r["dn_DNp09_R"]) / 2:3.0f} {max(r[f"mn_{m}_{s}"] for m in ("dlm", "dvm") for s in "LR"):4.0f}')
b.close()
