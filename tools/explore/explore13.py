"""Rare random events on the resting fly: what does the brain do with them? (Monte Carlo, continuous run)

  python tools/explore/explore13.py [EVENTS] [SEED]          # Monte Carlo over the event mix
  python tools/explore/explore13.py levels TYPE [S ...]      # one event type at fixed strengths, both sides (3 legs), fresh network each

Mirrors BrainFly.ambient() (src/brainfly.js): every few seconds a random touch, gust, vibration, passing object or a
speck of dust on the head. The network is NOT reset between events (as in the widget). The body read-outs are reproduced
from BrainFly.read() with the same gains and time constants, without the physics feedback except for two things: a fly
standing on the floor lets go of it when the wings and the jump muscle push harder than the weight and the grip of the
feet (BrainFly.liftoff / pullOff), which is counted as a take-off, and the dust on the head is wiped off by grooming
(the event runs until it is gone). Each event is classified by what the body would do in the following seconds:

  flight  - the standing body takes off (wings + jump muscle beat weight + grip, see LIFTOFF below)
  groom   - the front legs rub (the grooming command is above 0.3 for at least 0.3 s)
  walk    - it walks (path > 0.08 units) or turns (> 0.35 rad)
  twitch  - the head, abdomen or a leg moves visibly (head > 0.1 rad, abdomen curl > 0.15, leg offset > 0.02)
  none    - nothing visible

STEP_MS=16 (environment) steps as a busy widget does, the default 50 ms is faster to run. Rates are low-passed with 30 ms
as in BrainLink. Keep EVENTS and the read-out constants in step with src/brainfly.js.
"""
import math
import os
import random
import sys
from collections import Counter, defaultdict

sys.path.insert(0, 'tools')
from brain_client import Brain

# ---- what happens (mirror of AMBIENT_EVENTS in src/brainfly.js) ----------------------------------------------------
# name: (weight, [(group, base mV, gain mV)], strength range, duration range in s, hold)
# group level = base + gain * strength; S = a random side, LEG = a random leg; hold = constant for the duration
# (a passing object), otherwise it fades out linearly (a touch).
EVENTS = {
    'leg':       (32, [('touch_leg_{LEG}_{S}', 0, 12)], (0.35, 0.9), (0.15, 0.3), False),
    'wing':      (8,  [('touch_wing_{S}', 0, 12)], (0.35, 0.9), (0.15, 0.3), False),
    'thorax':    (8,  [('touch_notum_{S}', 0, 12)], (0.35, 0.9), (0.15, 0.3), False),
    'abdomen':   (8,  [('touch_abdomen_{S}', 0, 12)], (0.35, 0.9), (0.15, 0.3), False),
    'dust':      (8,  [], (0.5, 1.0), (0, 0), False),  # sets the dust level; the drive on the bristles comes from step()
    'antenna':   (6,  [('jo_ab_{S}', 0, 12), ('jo_cef_{S}', 0, 12)], (0.35, 0.9), (0.15, 0.3), False),
    'gust':      (6,  [('jo_cef_{S}', 0, 12)], (0.4, 0.85), (0.4, 0.9), False),
    'vibration': (4,  [('jo_ab_L', 0, 12), ('jo_ab_R', 0, 12), ('haltere_L', 0, 12), ('haltere_R', 0, 12)], (0.3, 0.75), (0.1, 0.2), False),
    'object':    (20, [('lc10d_{S}', 7, 3), ('lc9_L', 6.5, 2), ('lc9_R', 6.5, 2)], (0.5, 1.0), (0.5, 1.5), True),
}
MIN_GAP, MEAN_EXTRA_GAP = 5.0, 10.0  # AMBIENT_GAP in src/brainfly.js

# ---- body read-outs (mirror of BrainFly.read()) -----------------------------------------------------------------------
POWER_HZ, TTM_HZ, GROOM_HZ = 140.0, 30.0, 40.0
GRAVITY, ADHESION, JUMP_ACCEL, LIFTOFF_GAP = 14.0, 5.0, 150.0, 0.02  # LIFTOFF: a = G (lift - 1) + JUMP_ACCEL jump^2 - ADHESION
DUST_BASE, DUST_GAIN, CLEAN_RATE = 8.0, 4.0, 0.3
WALK_MAX, WALK_HZ, BACK_HZ = 0.36, 15.0, 20.0
TURN_HZ, TURN_RATE = 30.0, 2.2
clamp = lambda x, a, b: min(max(x, a), b)
damp = lambda rate, dt: 1 - math.exp(-rate * dt)

REST = {'pr_L': 8, 'pr_R': 8} | {f'{k}_{l}_{s}': v for k, v in (('prop_leg', 7), ('touch_leg', 5)) for l in 'fmh' for s in 'LR'}
STEP_MS = int(os.environ.get('STEP_MS', 50))  # the widget steps by one frame: 16 ms while something happens, 50 ms when idle
SMOOTH_MS = 30.0  # BrainLink: read-outs are low-passed
smoothed = {}
LEVELS = len(sys.argv) > 2 and sys.argv[1] == 'levels'
N = 200 if LEVELS or len(sys.argv) < 2 else int(sys.argv[1])
rng = random.Random(int(sys.argv[2]) if len(sys.argv) > 2 and not LEVELS else 1)

b = Brain()
b.param('dt', 1.0); b.param('w_syn', 0.15)
b.param('adapt', float(os.environ.get('ADAPT', 0.20))); b.param('tau_adapt', float(os.environ.get('TAU', 3000)))  # the shipped configuration (ADAPT / TAU override)
b.cutout('mn_all')

body = dict(power=0.0, walk=0.0, turn=0.0, groom=0.0, dust=0.0, gap=0.0, gapV=0.0, took=False)
driven = set()  # event groups that are currently driven (they must be set back to their resting level afterwards)
sent = {}  # the last level sent for each group: unchanged levels are not sent again (a command is a round trip)


def fresh():
    b.clear(); b.reset()
    sent.clear()
    for g, v in REST.items():
        b.drive(g, v)
        sent[g] = v
    b.advance(2500); b.advance(500)
    driven.clear()
    smoothed.clear()
    body.update(power=0.0, walk=0.0, turn=0.0, groom=0.0, dust=0.0, gap=0.0, gapV=0.0, took=False)


def step(active):
    """Advance STEP_MS with the drives of the active event; update the body; return per-step read-outs."""
    drive = dict(REST)
    active = list(active)
    if body['dust'] > 0.02:  # BrainFly.sense(): dust keeps both sides of the head bristles under load
        active += [('bm_L', DUST_BASE + DUST_GAIN * body['dust']), ('bm_R', DUST_BASE + DUST_GAIN * body['dust'])]
    for g, v in active:
        drive[g] = max(drive.get(g, 0), v)
    now = {g for g, _ in active}
    for g in set(REST) | now | driven:
        v = drive.get(g, 0)
        if sent.get(g) != v:
            b.drive(g, v)
            sent[g] = v
    driven.clear(); driven.update(now)
    r = b.rates(STEP_MS)
    k = 1 - math.exp(-STEP_MS / SMOOTH_MS)  # BrainLink.ingest
    for name, hz in r.items():
        smoothed[name] = smoothed.get(name, 0.0) + (hz - smoothed.get(name, 0.0)) * k
    r = smoothed
    dt = STEP_MS / 1000
    want = clamp((r['mn_dlm_L'] + r['mn_dlm_R'] + r['mn_dvm_L'] + r['mn_dvm_R']) / 4 / POWER_HZ, 0, 1.6)
    body['power'] += (want - body['power']) * damp(14 if want > body['power'] else 0.9, dt)
    fwd = clamp((r['dn_DNp09_L'] + r['dn_DNp09_R']) / 2 / WALK_HZ, 0, 1) - clamp(r['dn_mdn'] / BACK_HZ, 0, 1)
    body['walk'] += (fwd - body['walk']) * damp(5, dt)
    turn = clamp((r['dn_DNa02_L'] - r['dn_DNa02_R'] + 0.5 * (r['dn_DNa01_L'] - r['dn_DNa01_R'])) / TURN_HZ, -1, 1)
    body['turn'] += (turn - body['turn']) * damp(8, dt)
    # grooming and dust (BrainFly.read)
    groom = clamp(r['dn_groom'] / GROOM_HZ, 0, 1)
    body['groom'] += (groom - body['groom']) * damp(8 if groom > body['groom'] else 1.2, dt)
    body['dust'] = max(0.0, body['dust'] - CLEAN_RATE * body['groom'] * dt)
    # taking off from the floor (BrainFly.pullOff): constant acceleration within the step
    jump = clamp((r['mn_ttm_L'] + r['mn_ttm_R']) / 2 / TTM_HZ, 0, 1)
    lift = clamp((body['power'] - 0.1) / 0.4, 0, 1.15)
    a = GRAVITY * (lift - 1) + JUMP_ACCEL * jump ** 2 - ADHESION
    if not body['took']:
        v = body['gapV'] + a * dt
        gap = body['gap'] + 0.5 * (body['gapV'] + v) * dt
        if gap > LIFTOFF_GAP:
            body['took'] = True
        elif gap < 0:
            body['gap'] = body['gapV'] = 0.0
        else:
            body['gap'], body['gapV'] = gap, v
    twitch = 0.0
    for leg in 'fmh':
        for s in 'LR':
            lift = clamp(r[f'mn_leg_{leg}_sw_{s}'] / 50, 0, 1)
            pull = clamp(r[f'mn_leg_{leg}_st_{s}'] / 50, 0, 1)
            twitch = max(twitch, math.hypot(0.04 * lift, 0.1 * lift - 0.04 * pull, 0.06 * (lift - pull)))
    head = abs(clamp(0.03 * (r['mn_neck_L'] - r['mn_neck_R']), -0.6, 0.6))
    abd = clamp((r['mn_abd_L'] + r['mn_abd_R']) / 2 / 60, 0, 1)
    return twitch, head, abd


def run_event(name, strength=None, side=None, leg=None):
    weight, groups, srange, drange, hold = EVENTS[name]
    side, leg = side or rng.choice('LR'), leg or rng.choice('fmh')
    s = rng.uniform(*srange) if strength is None else strength
    length = rng.uniform(*drange) if strength is None else (drange[0] + drange[1]) / 2
    levels = [(g.format(S=side, LEG=leg), base + gain * s) for g, base, gain in groups]
    if name == 'dust':
        body['dust'] = max(body['dust'], s)
        length = 0.0
    body['took'], body['gap'], body['gapV'] = False, 0.0, 0.0
    steps_event, steps_after = int(length * 1000 / STEP_MS), int(6000 / STEP_MS)
    dt = STEP_MS / 1000
    path = signed = angle = peak = groom_time = 0.0
    tw = hd = ab = 0.0
    i = 0
    while i < steps_event + steps_after or (name == 'dust' and body['dust'] > 0.02 and i < 30000 / STEP_MS):  # dust: until it is wiped off
        t = i * dt
        fade = 1.0 if hold else 1 - t / max(length, 1e-6)
        active = [(g, v * fade) for g, v in levels] if t < length else []
        twitch, head, abd = step(active)
        path += abs(body['walk']) * WALK_MAX * dt
        signed += body['walk'] * WALK_MAX * dt
        angle += abs(body['turn']) * TURN_RATE * dt
        groom_time += dt if body['groom'] > 0.3 else 0
        peak = max(peak, body['power'])
        tw, hd, ab = max(tw, twitch), max(hd, head), max(ab, abd)
        i += 1
    if body['took']:
        kind = 'flight'
    elif groom_time >= 0.3:
        kind = 'groom'
    elif path > 0.08 or angle > 0.35:
        kind = 'walk'
    elif hd > 0.1 or ab > 0.15 or tw > 0.02:
        kind = 'twitch'
    else:
        kind = 'none'
    return kind, dict(side=side, s=s, path=path, signed=signed, angle=angle, peak=peak, twitch=tw, head=hd, abd=ab, groom=groom_time)


fresh()

if LEVELS:
    name = sys.argv[2]
    strengths = [float(x) for x in sys.argv[3:]] or [0.3, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
    print(f'{name}: side leg    s | class   peak-power  path  turn  twitch head  abd  groom(s)')
    for s in strengths:
        for side in 'LR':
            for leg in ('f', 'm', 'h') if name == 'leg' else ('-',):
                fresh()
                kind, i = run_event(name, s, side, leg)
                print(f'{name:9s}  {side}   {leg}  {s:4.2f} | {kind:7s}  {i["peak"]:5.2f}    {i["path"]:5.2f} {i["angle"]:5.2f}  {i["twitch"]:5.3f} {i["head"]:5.2f} {i["abd"]:5.2f} {i["groom"]:5.1f}')
    b.close()
    sys.exit(0)

names = list(EVENTS)
weights = [EVENTS[k][0] for k in names]
tally, by_type, walks = Counter(), defaultdict(Counter), []
for i in range(N):
    for _ in range(int((MIN_GAP + rng.expovariate(1 / MEAN_EXTRA_GAP)) * 1000 / STEP_MS)):
        step([])  # quiet gap between events (the 6 s tail of the previous event already counts as quiet)
    name = rng.choices(names, weights)[0]
    kind, info = run_event(name)
    tally[kind] += 1
    by_type[name][kind] += 1
    if kind == 'walk':
        walks.append((name, info))
b.close()

print(f'{N} events, mean gap {MIN_GAP + MEAN_EXTRA_GAP:.0f} s')
KINDS = ('none', 'twitch', 'groom', 'walk', 'flight')
print('overall :', '  '.join(f'{k} {100 * tally[k] / N:4.1f}%' for k in KINDS))
for name in names:
    n = sum(by_type[name].values())
    if n:
        print(f'{name:10s}', f'(n={n:3d})', '  '.join(f'{k} {100 * by_type[name][k] / n:3.0f}%' for k in KINDS))
if walks:
    print('walks: path %.2f  net %+.2f  turn %.2f rad (means)' % tuple(sum(w[1][k] for w in walks) / len(walks) for k in ('path', 'signed', 'angle')))
