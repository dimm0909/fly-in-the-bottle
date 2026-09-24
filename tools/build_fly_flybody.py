#!/usr/bin/env python3
"""Build the widget's fly body from FlyBody (TuragaLab/flybody, Apache-2.0).

FlyBody is the anatomically detailed MuJoCo fruit fly of Vaxenburg et al., Nature 2025 (Google
DeepMind and HHMI Janelia): a female fly modelled from confocal microscopy, 67 manually segmented
body components. Its MJCF describes 67 bodies and 85 meshes:
compound eyes with facets, ocelli, wing veins and membrane, abdominal segments with lower plates,
antennae, bristled proboscis parts, legs of coxa, femur, tibia, four tarsal segments and a claw.

  git clone --depth 1 https://github.com/TuragaLab/flybody.git data/flybody
  .venv/bin/python tools/build_fly_flybody.py

Outputs (committed, ~5 MB):
  assets/fly/flybody/rig.json     body tree (rest pose), mesh table, materials
  assets/fly/flybody/meshes.bin   welded vertices and indices, baked into each body's own frame

Units are millimetres, frame is x forward, y left, z up (the MJCF frame). Bodies keep FlyBody's
rest pose (joints at zero), which is a natural standing pose with spread wings. Every body is
renamed to the short scheme the rest of the widget uses (c_thorax, l_wing, lf_tibia, ...).
"""
import argparse
import json
import pathlib
import xml.etree.ElementTree as ET

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument('--src', default=str(ROOT / 'data/flybody/flybody/fruitfly/assets'))
ap.add_argument('--out', default=str(ROOT / 'assets/fly/flybody'))
args = ap.parse_args()
src, out = pathlib.Path(args.src), pathlib.Path(args.out)
if not (src / 'fruitfly.xml').exists():
    raise SystemExit(f'{src}/fruitfly.xml not found. Clone FlyBody first:\n'
                     '  git clone --depth 1 https://github.com/TuragaLab/flybody.git data/flybody')

SIDE = {'left': 'l', 'right': 'r'}
LEG = {'T1': 'f', 'T2': 'm', 'T3': 'h'}


def canonical(name):
    """FlyBody body name -> the widget's short scheme."""
    for full, s in SIDE.items():
        if name.endswith('_' + full):
            base = name[: -len(full) - 1]
            break
    else:
        s, base = 'c', name
    if base.startswith('abdomen'):
        return 'c_abdomen' + (base.split('_')[1] if '_' in base else '1')
    for kind in ('coxa', 'femur', 'tibia', 'claw'):
        if base.startswith(kind + '_T'):
            return f'{s}{LEG[base.split("_")[1]]}_{kind}'
    if base.startswith('tarsus'):
        # tarsus_T1 (first segment), tarsus2_T1, tarsus3_T1, tarsus4_T1
        head, leg = base.split('_')
        return f'{s}{LEG[leg]}_tarsus{head[len("tarsus"):] or "1"}'
    return f'{s}_{base}'


def vec(text, n=3):
    return [float(v) for v in text.split()] if text else [0.0] * n


def quat(text):
    return [float(v) for v in text.split()] if text else [1.0, 0.0, 0.0, 0.0]


def rot(q):  # wxyz -> 3x3
    w, x, y, z = np.array(q, dtype=np.float64) / np.linalg.norm(q)
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]).astype(np.float64)


def read_obj(path):
    """Unindexed triangle soup: positions and normals per corner, shape (F, 3, 3)."""
    v, vn, faces = [], [], []
    with open(path) as f:
        for line in f:
            if line.startswith('v '):
                v.append(line.split()[1:4])
            elif line.startswith('vn '):
                vn.append(line.split()[1:4])
            elif line.startswith('f '):
                faces.append([tuple(int(i) - 1 for i in c.split('/')[::2]) for c in line.split()[1:]])
    v, vn = np.array(v, dtype=np.float64), np.array(vn, dtype=np.float64)
    fv = np.array([[c[0] for c in fc] for fc in faces])
    fn = np.array([[c[1] for c in fc] for fc in faces])
    return v[fv], vn[fn]


def weld(pos, nor):
    """(F,3,3) corners -> unique vertices + triangle indices."""
    p = pos.reshape(-1, 3)
    n = nor.reshape(-1, 3)
    n = n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    key = np.hstack([np.round(p * 1e4), np.round(n * 100)]).astype(np.int32)
    _, first, inverse = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inverse = inverse.reshape(-1)
    return p[first].astype(np.float32), n[first], inverse.reshape(-1, 3).astype(np.uint32)


root = ET.parse(src / 'fruitfly.xml').getroot()
mesh_file = {m.get('name'): m.get('file') for m in root.find('asset').findall('mesh')}
materials = {m.get('name'): {'rgba': vec(m.get('rgba'), 4), 'shininess': float(m.get('shininess', 0.5)),
                             **({'specular': float(m.get('specular'))} if m.get('specular') else {})}
             for m in root.find('asset').findall('material')}

bodies, meshes = [], []
blob = bytearray()


def align4():
    while len(blob) % 4:
        blob.append(0)


def add_geom(body_index, g):
    name = g.get('mesh')
    material = g.get('material') or 'body'
    gp = np.array(vec(g.get('pos'))) * 10.0           # cm -> mm
    gR = rot(quat(g.get('quat')))
    pos, nor = read_obj(src / mesh_file[name])        # raw OBJ units are mm (the MJCF scales them by 0.1 into cm)
    pos = pos @ gR.T + gp
    nor = nor @ gR.T
    p, n, idx = weld(pos, nor)
    entry = {'name': name, 'material': material, 'body': body_index, 'vertexCount': len(p), 'indexCount': int(idx.size)}
    align4(); entry['pos'] = len(blob); blob.extend(p.astype('<f4').tobytes())
    align4(); entry['nor'] = len(blob); blob.extend(np.round(np.clip(n, -1, 1) * 127).astype(np.int8).tobytes())
    align4(); entry['idx'] = len(blob); blob.extend(idx.astype('<u4').tobytes())
    meshes.append(entry)
    return len(meshes) - 1


def walk(b, parent):
    index = len(bodies)
    body = {'name': canonical(b.get('name')), 'src': b.get('name'), 'parent': parent,
            'pos': [round(c * 10.0, 5) for c in vec(b.get('pos'))],         # cm -> mm
            'quat': [round(c, 6) for c in quat(b.get('quat'))], 'meshes': []}
    bodies.append(body)
    for g in b.findall('geom'):
        if g.get('mesh'):
            body['meshes'].append(add_geom(index, g))
    for c in b.findall('body'):
        walk(c, index)


walk(root.find('worldbody').find('body'), -1)

# rest-pose world transforms, to record where the feet stand
world = [None] * len(bodies)
for i, b in enumerate(bodies):
    R, p = rot(b['quat']), np.array(b['pos'])
    if b['parent'] >= 0:
        PR, Pp = world[b['parent']]
        R, p = PR @ R, Pp + PR @ p
    world[i] = (R, p)
feet = []
for m in meshes:
    b = bodies[m['body']]
    if b['name'].endswith('_claw'):
        pts = np.frombuffer(blob, dtype='<f4', count=m['vertexCount'] * 3, offset=m['pos']).reshape(-1, 3).astype(np.float64)
        R, p = world[m['body']]
        feet.append((pts @ R.T + p)[:, 2].min())
ground = float(min(feet))

out.mkdir(parents=True, exist_ok=True)
(out / 'meshes.bin').write_bytes(bytes(blob))
(out / 'rig.json').write_text(json.dumps({
    'source': 'TuragaLab/flybody (Apache-2.0), Vaxenburg et al., Nature 2025',
    'units': 'mm', 'frame': 'x forward, y left, z up',
    'constants': {'groundMM': round(-ground, 4)},   # feet stand this far below the thorax origin
    'materials': materials, 'bodies': bodies, 'meshes': meshes}, indent=1))
tri = sum(m['indexCount'] for m in meshes) // 3
print(f'{len(bodies)} bodies, {len(meshes)} meshes, {sum(m["vertexCount"] for m in meshes):,} vertices, {tri:,} triangles')
print(f'ground {-ground:.3f} mm below the thorax origin; meshes.bin {len(blob) / 1e6:.1f} MB')
