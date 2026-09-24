"""Is there a rhythm in the leg motor pools when the fly walks? (the network only, no body in the loop)

  python tools/explore/explore17.py

Drives that make the fly walk (an object in view: LC9 + LC10d; or the descending walking neurons directly; or a broad drive
on all descending neurons) act for 4 s on a resting network with the leg proprioceptors held constant. The spike counts of the
swing-type and stance-type pools of every leg are taken in 10 ms bins; for each pool the script prints the mean rate and
the strongest periodic component between 1.5 and 25 Hz: its frequency and how much of the variance (of the rate after
removing the mean) it carries (1.0: a pure sine; noise gives 0.05-0.15), plus the correlation of the swing and stance pools
of the same leg (negative: they alternate).
"""
import math
import sys

import numpy as np

sys.path.insert(0, 'tools')
from brain_client import Brain

KINDS = ['cs', 'co', 'hp', 'lg']
REST = {'pr_L': 8, 'pr_R': 8}
for leg in 'fmh':
    for side in 'LR':
        for k in KINDS:
            REST[f'{k}_leg_{leg}_{side}'] = 7
        REST[f'touch_leg_{leg}_{side}'] = 5
DRIVES = {
    'object (LC9 + LC10d)': {'lc9_L': 9, 'lc9_R': 9, 'lc10d_L': 8.5, 'lc10d_R': 8.5},
    'LC9 strong': {'lc9_L': 12, 'lc9_R': 12},
    'DNp09 directly, 10 mV': {'dn_DNp09_L': 10, 'dn_DNp09_R': 10},
    'DNp09 + DNa02 directly, 15 mV': {'dn_DNp09_L': 15, 'dn_DNp09_R': 15, 'dn_DNa02_L': 15, 'dn_DNa02_R': 15},
    'all descending neurons, 8 mV': {'dn_L': 8, 'dn_R': 8},
    'all descending neurons, 10 mV': {'dn_L': 10, 'dn_R': 10},
    'all descending neurons, 12 mV': {'dn_L': 12, 'dn_R': 12},
}
BIN, SECONDS = 10, 4

b = Brain()
b.param('dt', 1.0); b.param('w_syn', 0.15); b.param('adapt', 0.20); b.param('tau_adapt', 3000)
b.cutout('mn_all')


def spectrum(x):
    x = np.asarray(x, float)
    x = x - x.mean()
    if x.std() < 1e-9:
        return 0.0, 0.0
    w = np.hanning(len(x))
    f = np.fft.rfftfreq(len(x), BIN / 1000)
    p = np.abs(np.fft.rfft(x * w)) ** 2
    band = (f >= 1.5) & (f <= 25)
    i = np.argmax(np.where(band, p, 0))
    # the share of the variance in the peak (+- 1 bin)
    share = p[max(i - 1, 0):i + 2].sum() / p[1:].sum()
    return f[i], share


for name, drives in DRIVES.items():
    b.clear(); b.reset()
    for g, v in REST.items():
        b.drive(g, v)
    b.advance(2500); b.advance(500)
    for g, v in drives.items():
        b.drive(g, max(v, REST.get(g, 0)))
    b.advance(500)
    series = {}
    for _ in range(SECONDS * 1000 // BIN):
        c = b.advance(BIN)
        for l in 'fmh':
            for s in 'LR':
                for t in ('sw', 'st'):
                    key = f'mn_leg_{l}_{t}_{s}'
                    series.setdefault(f'{t}_{l}{s}', []).append(c[key] / b.sizes[key] / (BIN / 1000))
        series.setdefault('p09', []).append((c['dn_DNp09_L'] + c['dn_DNp09_R']) / 2 / 1 / (BIN / 1000))
    print(f'--- {name}: DNp09 {np.mean(series["p09"]):.0f} Hz')
    print('  pool   mean Hz  peak Hz  share | swing-stance correlation')
    for l in 'fmh':
        for s in 'LR':
            sw, st = np.array(series[f'sw_{l}{s}']), np.array(series[f'st_{l}{s}'])
            # smooth over 30 ms so that single spikes do not decide
            k = np.ones(3) / 3
            sws, sts = np.convolve(sw, k, 'same'), np.convolve(st, k, 'same')
            fq, sh = spectrum(sws)
            fq2, sh2 = spectrum(sts)
            corr = np.corrcoef(sws, sts)[0, 1] if sws.std() > 0 and sts.std() > 0 else float('nan')
            print(f'  sw {l}{s}  {sw.mean():6.1f}  {fq:6.1f}  {sh:5.2f} |   st {sts.mean():6.1f} {fq2:5.1f} {sh2:5.2f}   corr {corr:+.2f}')
b.close()
