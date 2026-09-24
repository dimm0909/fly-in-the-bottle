# Fly body: FlyBody

`rig.json` and `meshes.bin` are derived from **FlyBody** (https://github.com/TuragaLab/flybody), the
anatomically detailed MuJoCo fruit fly model of Vaxenburg et al., *Whole-body physics simulation of fruit
fly locomotion*, Nature 643, 1312-1320 (2025), by Google DeepMind and HHMI Janelia Research Campus.
The model is a female fly built from confocal microscopy, 67 manually segmented body components.
FlyBody is licensed under the Apache License 2.0 (`LICENSE-flybody.txt`).

Modifications, made by `tools/build_fly_flybody.py`:

- meshes and body poses are read from `flybody/fruitfly/assets/fruitfly.xml` and the `.obj` files;
- each mesh's geom pose is baked into the vertices of its body frame, vertices are welded and stored as
  binary (float32 positions, int8 normals, uint32 indices), no geometry is decimated;
- bodies are renamed to a short scheme (`c_thorax`, `l_wing`, `lf_tibia`, ...);
- collision geoms, joints, actuators and sensors are dropped: only the visual meshes and the rest pose
  are used.
