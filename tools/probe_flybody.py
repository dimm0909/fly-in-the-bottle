"""Assemble the FlyBody rest pose in world space and plot three orthographic views (sanity check)."""
import sys, pathlib
import numpy as np
import xml.etree.ElementTree as ET
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = pathlib.Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'data/flybody/flybody/fruitfly/assets'

def qmat(q):  # wxyz -> 3x3
    w, x, y, z = np.array(q) / np.linalg.norm(q)
    return np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
                     [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
                     [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])

def vec(s, n=3, default=0.0):
    return np.array([float(v) for v in s.split()]) if s else np.full(n, default)

def load_obj_vertices(path):
    vs = []
    with open(path) as f:
        for line in f:
            if line.startswith('v '):
                vs.append(line.split()[1:4])
    return np.array(vs, dtype=np.float64)

root = ET.parse(ASSETS / 'fruitfly.xml').getroot()
mesh_file = {m.get('name'): m.get('file') for m in root.find('asset').findall('mesh')}
pts = {}   # material -> list of world points (cm)
def walk(b, parent_R, parent_p):
    pos = vec(b.get('pos')) if b.get('pos') else np.zeros(3)
    q = vec(b.get('quat'), 4) if b.get('quat') else np.array([1, 0, 0, 0.])
    R = parent_R @ qmat(q); p = parent_p + parent_R @ pos
    for g in b.findall('geom'):
        m = g.get('mesh')
        if not m: continue
        gp = vec(g.get('pos')) if g.get('pos') else np.zeros(3)
        gq = vec(g.get('quat'), 4) if g.get('quat') else np.array([1, 0, 0, 0.])
        v = load_obj_vertices(ASSETS / mesh_file[m]) * 0.1          # mm -> cm (MJCF default mesh scale)
        v = (qmat(gq) @ v.T).T + gp                                   # geom pose in body frame
        v = (R @ v.T).T + p                                           # body to world
        pts.setdefault(g.get('material') or 'body', []).append((b.get('name'), v))
    for c in b.findall('body'):
        walk(c, R, p)
walk(root.find('worldbody').find('body'), np.eye(3), np.zeros(3))
allv = np.vstack([v for lst in pts.values() for _, v in lst]) * 10   # cm -> mm
print('world bbox (mm): min', allv.min(0).round(2), 'max', allv.max(0).round(2), ' extent', (allv.max(0) - allv.min(0)).round(2))
colors = {'body': '#a8672a', 'red': '#cc1a00', 'black': '#111111', 'lower': '#cc9c63', 'brown': '#5c2a10', 'membrane': '#7aaaf0', 'ocelli': '#331100', 'bristle-brown': '#000000'}
fig, ax = plt.subplots(1, 3, figsize=(21, 7))
views = [('side (x fwd, z up)', 0, 2), ('top (x fwd, y left)', 0, 1), ('front (y left, z up)', 1, 2)]
for a, (title, i, j) in zip(ax, views):
    for mat, lst in pts.items():
        for name, v in lst:
            vv = v * 10
            step = max(1, len(vv) // 4000)
            a.scatter(vv[::step, i], vv[::step, j], s=0.4, c=colors.get(mat, '#888'), linewidths=0)
    a.set_aspect('equal'); a.set_title(title)
plt.tight_layout(); plt.savefig(ROOT / 'shots/flybody_probe.png', dpi=80)
print('saved shots/flybody_probe.png')
