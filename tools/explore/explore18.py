"""Can the network step when the legs are in its loop? (closed loop: leg position and load -> proprioceptors -> network -> leg)

  python tools/explore/explore18.py

Each of the six legs is a foot on an axis (x = -1 ... +1, forward positive). In stance it slides back at the walking speed,
in swing it runs forward; a leg swings while the swing-type pool of the network (extensor, levator, promotor, ...) is
more active than the stance-type pool of the same leg by more than a margin, and stands otherwise (this is the decision that the
body's own stepping code, poseLegs in src/fly.js, makes today). The legs feed back through the proprioceptors:

    cs (load)       CS_STANCE mV while the leg carries weight, CS_SWING mV while it swings
    co (position)   7 + CO_GAIN * x mV
    hp (range ends) 7 + HP_GAIN * smoothstep(0.7, 1.0, |x|) mV
    lg              7 mV

on top of the walking drive. Printed for each configuration: the number of completed swing cycles per leg over 8 s, the
step frequency, and how the legs shared the time (fraction of the time in swing). A rhythm generator would give several
steps per second per leg, regular ones, with the two tripods (L1 R2 L3 against R1 L2 R3) in antiphase. To tell that from
spike noise flipping the decision, the script also prints: cv, the coefficient of variation of the intervals between the
swing onsets of a leg (a clock: below 0.3; a Poisson process: about 1), peak, the share of the variance of the swing
timeline that sits in its strongest component between 1 and 15 Hz (a clock: above 0.5; noise: 0.05-0.15), and alt, the mean
correlation of the swing timelines of legs in the same tripod minus that of legs in opposite tripods (a walking gait:
strongly positive, near 1; nothing: near 0).
"""
import sys

import numpy as np

sys.path.insert(0, 'tools')
from brain_client import Brain

STEP = 10  # ms
SECONDS = 8
KINDS = ['cs', 'co', 'hp', 'lg']
REST = {'pr_L': 8, 'pr_R': 8}
for leg in 'fmh':
    for side in 'LR':
        for k in KINDS:
            REST[f'{k}_leg_{leg}_{side}'] = 7
        REST[f'touch_leg_{leg}_{side}'] = 5
WALK = {
    'object': {'lc9_L': 9, 'lc9_R': 9, 'lc10d_L': 8.5, 'lc10d_R': 8.5},
    'all DN 10 mV': {'dn_L': 10, 'dn_R': 10},
}
smooth = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(min(max((x - a) / (b - a), 0), 1))
# (walking drive, CS_STANCE, CS_SWING, CO_GAIN, HP_GAIN, margin Hz)
CONFIGS = [
    ('object', 7, 7, 0, 0, 0.5),
    ('object', 7, 0, 0, 0, 0.5),
    ('object', 14, 0, 0, 0, 0.5),
    ('object', 7, 7, 5, 0, 0.5),
    ('object', 7, 7, -5, 0, 0.5),
    ('object', 7, 7, 0, 8, 0.5),
    ('object', 7, 7, 0, 20, 0.5),
    ('object', 14, 0, 5, 8, 0.5),
    ('object', 14, 0, -5, 20, 0.5),
    ('all DN 10 mV', 7, 7, 0, 0, 0.5),
    ('all DN 10 mV', 14, 0, 5, 20, 0.5),
    ('all DN 10 mV', 14, 0, -5, 20, 0.5),
    ('all DN 10 mV', 30, 0, -10, 30, 0.5),
]

b = Brain()
b.param('dt', 1.0); b.param('w_syn', 0.15); b.param('adapt', 0.20); b.param('tau_adapt', 3000)
b.cutout('mn_all')
LEGS = [(l, s) for l in 'fmh' for s in 'LR']
V_ST, V_SW = 4.0, 8.0  # x per second: stance slides back, swing runs forward (a step of 2 units takes 0.5 s in stance)

print(f'{"walk":13s} cs st/sw  co   hp  | steps per leg in {SECONDS} s: fL fR mL mR hL hR | Hz | swing share, cv, peak, alt | leg pool rates sw/st')
for walk, cs_st, cs_sw, co, hp, margin in CONFIGS:
    b.clear(); b.reset()
    for g, v in REST.items():
        b.drive(g, v)
    b.advance(2500); b.advance(500)
    sent = dict(REST)
    for g, v in WALK[walk].items():
        b.drive(g, max(v, REST.get(g, 0))); sent[g] = max(v, REST.get(g, 0))
    b.advance(300)
    x = {leg: 0.0 for leg in LEGS}
    swing = {leg: False for leg in LEGS}
    steps = {leg: 0 for leg in LEGS}
    swing_time = {leg: 0.0 for leg in LEGS}
    timeline = {leg: [] for leg in LEGS}
    onsets = {leg: [] for leg in LEGS}
    rates_sw = {leg: 0.0 for leg in LEGS}; rates_st = {leg: 0.0 for leg in LEGS}
    for i in range(SECONDS * 1000 // STEP):
        for (l, s) in LEGS:
            xl = x[(l, s)]
            level = {
                'cs': cs_sw if swing[(l, s)] else cs_st,
                'co': 7 + co * xl,
                'hp': 7 + hp * smooth(0.7, 1.0, abs(xl)),
                'lg': 7,
            }
            for k, v in level.items():
                v = max(v, 0)
                g = f'{k}_leg_{l}_{s}'
                if abs(sent.get(g, -1) - v) > 0.05:
                    b.drive(g, v); sent[g] = v
        c = b.advance(STEP)
        for (l, s) in LEGS:
            sw = c[f'mn_leg_{l}_sw_{s}'] / b.sizes[f'mn_leg_{l}_sw_{s}'] / (STEP / 1000)
            st = c[f'mn_leg_{l}_st_{s}'] / b.sizes[f'mn_leg_{l}_st_{s}'] / (STEP / 1000)
            k = 1 - np.exp(-STEP / 30)
            rates_sw[(l, s)] += (sw - rates_sw[(l, s)]) * k
            rates_st[(l, s)] += (st - rates_st[(l, s)]) * k
            was = swing[(l, s)]
            swing[(l, s)] = rates_sw[(l, s)] > rates_st[(l, s)] + margin
            timeline[(l, s)].append(1.0 if swing[(l, s)] else 0.0)
            if swing[(l, s)] and not was:
                onsets[(l, s)].append(i * STEP / 1000)
            if was and not swing[(l, s)]:
                steps[(l, s)] += 1
            x[(l, s)] = min(max(x[(l, s)] + (V_SW if swing[(l, s)] else -V_ST) * STEP / 1000, -1), 1)
            swing_time[(l, s)] += STEP / 1000 if swing[(l, s)] else 0
    n = [steps[leg] for leg in LEGS]
    share = np.mean([swing_time[leg] / SECONDS for leg in LEGS])
    cvs, peaks = [], []
    for leg in LEGS:
        d = np.diff(onsets[leg])
        if len(d) >= 3:
            cvs.append(d.std() / d.mean())
        y = np.array(timeline[leg]); y = y - y.mean()
        if y.std() > 0:
            f = np.fft.rfftfreq(len(y), STEP / 1000); pw = np.abs(np.fft.rfft(y * np.hanning(len(y)))) ** 2
            band = (f >= 1) & (f <= 15); i = int(np.argmax(np.where(band, pw, 0)))
            peaks.append(pw[max(i - 1, 0):i + 2].sum() / pw[1:].sum())
    group = {leg: (('fmh'.index(leg[0]) + (0 if leg[1] == 'L' else 1)) % 2) for leg in LEGS}
    same, other = [], []
    for a in range(6):
        for c in range(a + 1, 6):
            ya, yc = np.array(timeline[LEGS[a]]), np.array(timeline[LEGS[c]])
            if ya.std() > 0 and yc.std() > 0:
                (same if group[LEGS[a]] == group[LEGS[c]] else other).append(np.corrcoef(ya, yc)[0, 1])
    alt = (np.mean(same) - np.mean(other)) if same and other else float('nan')
    print(f'{walk:13s} {cs_st:2d}/{cs_sw:<2d} {co:+3d} {hp:4d}  |                               ' + ' '.join(f'{v:2d}' for v in n) +
          f' | {np.mean(n) / SECONDS:4.2f} | {share:4.2f}  cv {np.mean(cvs) if cvs else float("nan"):4.2f} peak {np.mean(peaks) if peaks else float("nan"):4.2f} alt {alt:+.2f} | ' +
          ' '.join(f'{rates_sw[leg]:.0f}/{rates_st[leg]:.0f}' for leg in LEGS))
b.close()
