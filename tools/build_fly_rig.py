#!/usr/bin/env python3
"""Turn NeuroMechFly's rigging.yaml (flat, parent-relative poses) into assets/fly/rig.json.

Source: NeLy-EPFL/flygym (Apache-2.0). Poses are millimetres in the MuJoCo frame
(x forward, y left, z up); mesh vertices are in metres in each body's own frame.
The right-hand side has no meshes of its own: it reuses the left mesh, mirrored.
"""
import json
import pathlib
import yaml

root = pathlib.Path(__file__).resolve().parent.parent
rig = yaml.safe_load((root / 'data/nmf/rigging.yaml').read_text())

parents = {
    'c_thorax': None,
    'c_head': 'c_thorax',
    'c_rostrum': 'c_head',
    'c_haustellum': 'c_rostrum',
    'c_abdomen12': 'c_thorax',
    'c_abdomen3': 'c_abdomen12',
    'c_abdomen4': 'c_abdomen3',
    'c_abdomen5': 'c_abdomen4',
    'c_abdomen6': 'c_abdomen5',
}
for side in 'lr':
    parents.update({
        f'{side}_eye': 'c_head',
        f'{side}_pedicel': 'c_head',
        f'{side}_funiculus': f'{side}_pedicel',
        f'{side}_arista': f'{side}_funiculus',
        f'{side}_haltere': 'c_thorax',
        f'{side}_wing': 'c_thorax',
    })
    for leg in 'fmh':
        chain = ['coxa', 'trochanterfemur', 'tibia', 'tarsus1', 'tarsus2', 'tarsus3', 'tarsus4', 'tarsus5']
        prev = 'c_thorax'
        for part in chain:
            name = f'{side}{leg}_{part}'
            parents[name] = prev
            prev = name

def mesh_of(name):
    # right side reuses the left mesh
    if name.startswith('r_'):
        return 'l_' + name[2:], True
    if len(name) > 2 and name[0] == 'r' and name[2] == '_':
        return 'l' + name[1:], True
    return name, False

missing = [n for n in parents if n not in rig]
assert not missing, missing
bodies = {}
for name, parent in parents.items():
    mesh, mirror = mesh_of(name)
    bodies[name] = {
        'parent': parent,
        'pos': rig[name]['pos'],
        'quat': rig[name]['quat'],  # w, x, y, z
        'mesh': mesh,
        'mirror': mirror,
    }

out = root / 'assets/fly/rig.json'
out.write_text(json.dumps({'units': 'mm', 'frame': 'x forward, y left, z up', 'bodies': bodies}, indent=1))
print(f'{len(bodies)} bodies -> {out.relative_to(root)}')
