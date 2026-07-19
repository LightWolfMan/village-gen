"""Gera vias, pontes, plantas e props isometricos com Blender 4.5+."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import render_temperate_buildings as village


def arguments():
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--environment", required=True)
    parser.add_argument("--props", required=True)
    return parser.parse_args(values)


def set_camera(camera, target_z, ortho_scale):
    horizontal = math.sqrt(8 * 8 + 8 * 8)
    camera.data.ortho_scale = ortho_scale
    camera.location = (8, 8, target_z + math.tan(math.radians(30)) * horizontal)
    village.look_at(camera, (0, 0, target_z))


def project(scene, camera, point):
    coordinate = world_to_camera_view(scene, camera, Vector(point))
    return [
        round(coordinate.x * scene.render.resolution_x, 3),
        round((1 - coordinate.y) * scene.render.resolution_y, 3),
    ]


def extra_palette(mats):
    mats.update({
        "packed_earth": village.material("Packed road earth", (0.33, 0.22, 0.12, 1)),
        "road_edge": village.material("Road edge", (0.21, 0.15, 0.09, 1)),
        "cobble": village.material("Road cobble", (0.39, 0.37, 0.31, 1)),
        "cobble_light": village.material("Light cobble", (0.55, 0.51, 0.41, 1)),
        "plaza": village.material("Plaza limestone", (0.54, 0.48, 0.36, 1)),
        "bridge": village.material("Bridge oak", (0.39, 0.21, 0.095, 1)),
        "bridge_light": village.material("Bridge highlights", (0.56, 0.34, 0.15, 1)),
        "leaf_dark": village.material("Leaf dark", (0.08, 0.20, 0.08, 1)),
        "leaf": village.material("Leaf green", (0.16, 0.34, 0.12, 1)),
        "leaf_light": village.material("Leaf light", (0.31, 0.48, 0.16, 1)),
        "pine": village.material("Pine needles", (0.055, 0.20, 0.16, 1)),
        "snow": village.material("Snow", (0.77, 0.86, 0.88, 1)),
        "cactus": village.material("Cactus", (0.16, 0.39, 0.19, 1)),
        "willow": village.material("Willow leaves", (0.19, 0.35, 0.17, 1)),
        "reed": village.material("Reeds", (0.42, 0.48, 0.18, 1)),
        "reed_tip": village.material("Reed tips", (0.30, 0.18, 0.08, 1)),
    })
    return mats


def stone(name, x, y, z, scale, value, rotation=0):
    obj = village.box(name, (0.20 * scale, 0.13 * scale, 0.055 * scale), (x, y, z), value, 0.018)
    obj.rotation_euler.z = rotation
    return obj


def build_road(kind, mats):
    surface = mats["packed_earth"] if kind == "street" else mats["cobble"] if kind == "main" else mats["plaza"]
    village.box(f"Road-{kind}", (1.02, 1.02, 0.07), (0, 0, 0.035), surface, 0.055)
    if kind == "street":
        for x in (-0.22, 0.22):
            village.box("CartRut", (0.09, 1.0, 0.018), (x, 0, 0.079), mats["road_edge"], 0.01)
        for index, (x, y) in enumerate(((-.34, -.31), (.31, -.18), (-.12, .28), (.38, .36), (.04, -.42))):
            stone(f"StreetStone{index}", x, y, 0.087, 0.75, mats["cobble_light"], index * .37)
    else:
        positions = [(-.35,-.34),(-.08,-.36),(.23,-.34),(.40,-.12),(.12,-.10),(-.18,-.08),(-.42,.12),(-.12,.15),(.19,.17),(.40,.38),(.08,.40),(-.25,.38)]
        for index, (x, y) in enumerate(positions):
            value = mats["cobble_light"] if (index + (1 if kind == "plaza" else 0)) % 3 == 0 else mats["road_edge"]
            stone(f"Paver{index}", x, y, 0.087, 0.92 if kind == "plaza" else 0.78, value, index * .29)


def build_bridge(axis, role, mats):
    """Constroi uma peca reta sem fechamento transversal nas emendas."""
    rotation = 0 if axis == "ew" else math.pi / 2
    root = []
    root.append(village.box("BridgeDeck", (1.10, 0.82, 0.15), (0, 0, 0.16), mats["bridge"], 0.025))
    for x in (-.45, -.27, -.09, .09, .27, .45):
        root.append(village.box("BridgePlank", (0.15, 0.78, 0.055), (x, 0, 0.265), mats["bridge_light"], 0.014))
    post_x = []
    if role in {"single", "start"}:
        post_x.append(-.46)
    if role in {"single", "end"}:
        post_x.append(.46)
    if role == "post":
        post_x.append(0)
    for x in post_x:
        for y in (-.40, .40):
            root.append(village.box("BridgePost", (0.075, 0.075, 0.62), (x, y, 0.48), mats["dark_wood"], 0.012))
    for y in (-.40, .40):
        root.append(village.box("BridgeRail", (1.10, 0.07, 0.08), (0, y, 0.73), mats["dark_wood"], 0.012))
    for head_x in ((-.50,) if role == "start" else (.50,) if role == "end" else (-.50, .50) if role == "single" else ()):
        root.append(village.box("StoneAbutment", (.16, 1.02, .28), (head_x, 0, .10), mats["fieldstone"], .025))
    if rotation:
        transform = Matrix.Rotation(rotation, 4, "Z")
        for obj in root:
            obj.matrix_world = transform @ obj.matrix_world


def render_environment(scene, camera, output, mats):
    output.mkdir(parents=True, exist_ok=True)
    for stale in output.glob("bridge-*.png"):
        stale.unlink()
    scene.render.resolution_x = 128
    scene.render.resolution_y = 128
    set_camera(camera, 0.32, 2.828427)
    definitions = [
        ("road-street", lambda: build_road("street", mats)),
        ("road-main", lambda: build_road("main", mats)),
        ("road-plaza", lambda: build_road("plaza", mats)),
        *[(f"bridge-{axis}-{role}", lambda axis=axis, role=role: build_bridge(axis, role, mats))
          for axis in ("ew", "ns") for role in ("single", "start", "middle", "post", "end")],
    ]
    entries = []
    for key, builder in definitions:
        village.clear_models()
        builder()
        filename = f"{key}.png"
        scene.render.filepath = str(output / filename)
        bpy.ops.render.render(write_still=True)
        anchor_x, anchor_y = project(scene, camera, (0, 0, 0))
        entries.append({
            "key": key, "type": key, "src": f"/assets/environment/{filename}",
            "width": 128, "height": 128, "anchorX": anchor_x, "anchorY": anchor_y,
        })
    manifest = {"schemaVersion": 2, "baseTileWidth": 64, "entries": entries}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def ico(name, location, scale, value, subdivisions=2):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(value)
    bevel = obj.modifiers.new("Organic soft edge", "BEVEL")
    bevel.width = 0.025
    bevel.segments = 2
    return obj


def cone(name, radius1, radius2, depth, location, value, vertices=16):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius1, radius2=radius2, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(value)
    return obj


def branch(name, start, end, radius, value):
    start_v, end_v = Vector(start), Vector(end)
    direction = end_v - start_v
    obj = village.cylinder(name, radius, direction.length, (start_v + end_v) / 2, value, 12)
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    return obj


def prop_oak(mats):
    village.cylinder("OakTrunk", .27, 2.75, (0, 0, 1.38), mats["wood"], 14)
    branch("OakBranchA", (0,0,1.8), (.9,.15,3.0), .13, mats["wood"])
    branch("OakBranchB", (0,0,2.0), (-.8,.3,3.1), .12, mats["wood"])
    for index, (loc, scale, color) in enumerate([
        ((0,0,3.6),(1.35,1.10,1.15),"leaf_dark"), ((-.75,.18,3.55),(.9,.85,.9),"leaf"),
        ((.78,.08,3.55),(.92,.82,.88),"leaf"), ((0,-.52,4.18),(1.02,.88,.84),"leaf_light"),
        ((0,.50,4.1),(.88,.78,.75),"leaf")]):
        ico(f"OakCrown{index}", loc, scale, mats[color], 2)


def prop_pine(mats):
    village.cylinder("PineTrunk", .18, 4.7, (0, 0, 2.35), mats["wood"], 12)
    for index, (z, radius) in enumerate(((1.7,1.25),(2.5,1.08),(3.25,.88),(3.9,.66),(4.45,.42))):
        cone(f"PineLayer{index}", radius, .05, 1.45, (0,0,z), mats["pine"], 16)
        cone(f"SnowLayer{index}", radius*.72, .03, .42, (-.08,-.02,z+.58), mats["snow"], 16)


def prop_cactus(mats):
    village.cylinder("CactusBody", .30, 3.1, (0,0,1.55), mats["cactus"], 16)
    branch("CactusArmA", (0,0,1.55), (-.82,0,1.55), .20, mats["cactus"])
    village.cylinder("CactusArmATop", .20, 1.35, (-.82,0,2.05), mats["cactus"], 14)
    branch("CactusArmB", (0,0,2.05), (.72,0,2.05), .18, mats["cactus"])
    village.cylinder("CactusArmBTop", .18, .92, (.72,0,2.42), mats["cactus"], 14)


def prop_willow(mats):
    village.cylinder("WillowTrunk", .30, 2.8, (0,0,1.4), mats["wood"], 14)
    branch("WillowBranchA", (0,0,1.9), (1.0,.15,3.3), .13, mats["wood"])
    branch("WillowBranchB", (0,0,2.0), (-1.0,.3,3.25), .13, mats["wood"])
    for index, (x,y,z,sx,sy,sz) in enumerate(((-.9,.1,3.6,1.05,.72,.72),(.85,0,3.65,1.08,.74,.72),(0,-.5,4.0,1.35,.92,.78),(0,.45,3.95,1.15,.8,.7),(-.25,0,3.35,1.4,.85,.68))):
        ico(f"WillowCrown{index}", (x,y,z), (sx,sy,sz), mats["willow" if index%2 else "leaf"], 2)
    for x in (-1.15,-.75,.75,1.15):
        branch("WillowDroop", (x*.72,0,3.55), (x,.05,2.15), .045, mats["willow"])


def prop_rock(mats):
    rock = ico("Rock", (0,0,.48), (.85,.68,.52), mats["fieldstone"], 1)
    rock.rotation_euler.z = .34


def prop_bush(mats):
    for index, (x,y,z,s) in enumerate(((-.35,0,.48,.58),(.35,.03,.52,.62),(0,-.22,.7,.7),(0,.3,.52,.52))):
        ico(f"Bush{index}", (x,y,z), (s,s*.8,s*.75), mats["leaf" if index%2 else "leaf_light"], 2)


def prop_reeds(mats):
    for index, (x,y,h) in enumerate(((-.4,-.1,1.45),(-.22,.12,1.75),(0,-.12,1.55),(.18,.16,1.68),(.38,-.04,1.38),(.05,.28,1.35))):
        village.cylinder(f"Reed{index}", .026, h, (x,y,h/2), mats["reed"], 8)
        cone(f"ReedTip{index}", .07, .035, .28, (x,y,h+.08), mats["reed_tip"], 8)


def prop_well(mats):
    bpy.ops.mesh.primitive_torus_add(major_radius=.62, minor_radius=.18, major_segments=20, minor_segments=8, location=(0,0,.45))
    bpy.context.object.data.materials.append(mats["fieldstone"])
    for x in (-.72,.72):
        village.box("WellPost", (.12,.12,1.8), (x,0,1.15), mats["dark_wood"], .02)
    roof = village.roof("WellRoof", 1.75, 1.25, 1.88, .52, mats["red_roof"], .12)
    roof.rotation_euler.z = math.pi / 2
    village.cylinder("WellAxle", .07, 1.5, (0,0,1.25), mats["wood"], 12).rotation_euler.y = math.pi / 2


def prop_cart(mats):
    village.box("CartBed", (1.45,.78,.32), (0,0,.72), mats["wood"], .035)
    for y in (-.47,.47):
        bpy.ops.mesh.primitive_torus_add(major_radius=.42, minor_radius=.055, major_segments=20, minor_segments=8, location=(0,y,.48), rotation=(math.pi/2,0,0))
        bpy.context.object.data.materials.append(mats["dark_wood"])
        for angle in range(0,360,45):
            radians=math.radians(angle)
            branch("CartSpoke", (0,y,.48), (math.cos(radians)*.38,y,.48+math.sin(radians)*.38), .025, mats["dark_wood"])
    for x in (.95,1.55):
        village.box("CartShaft", (1.4,.08,.08), (x,0,.55), mats["wood"], .015)


def prop_haystack(mats):
    cone("Haystack", .82, .12, 1.85, (0,0,.925), mats["thatch"], 24)
    village.box("HayRope", (1.5,.07,.09), (0,.0,.78), mats["dark_wood"], .012)


def render_props(scene, camera, output, mats):
    output.mkdir(parents=True, exist_ok=True)
    definitions = [
        ("temperate-tree.png", 64, 96, 6.0, prop_oak),
        ("snowy-pine.png", 64, 96, 6.1, prop_pine),
        ("desert-cactus.png", 48, 64, 4.5, prop_cactus),
        ("swamp-willow.png", 80, 96, 6.0, prop_willow),
        ("rock.png", 48, 40, 2.3, prop_rock),
        ("bush.png", 48, 40, 2.3, prop_bush),
        ("reeds.png", 40, 56, 2.6, prop_reeds),
        ("well.png", 56, 64, 3.4, prop_well),
        ("cart.png", 72, 56, 3.5, prop_cart),
        ("haystack.png", 48, 56, 2.8, prop_haystack),
    ]
    for filename, width, height, ortho, builder in definitions:
        village.clear_models()
        scene.render.resolution_x = width
        scene.render.resolution_y = height
        target_z = (height / 2 - 8) * ortho / (math.cos(math.radians(30)) * height)
        set_camera(camera, target_z, ortho)
        builder(mats)
        scene.render.filepath = str(output / filename)
        bpy.ops.render.render(write_still=True)


def main():
    args = arguments()
    scene, camera = village.setup_scene()
    mats = extra_palette(village.palette())
    render_environment(scene, camera, Path(args.environment).resolve(), mats)
    render_props(scene, camera, Path(args.props).resolve(), mats)
    print("Village: vias, pontes e props Blender atualizados")


if __name__ == "__main__":
    main()
