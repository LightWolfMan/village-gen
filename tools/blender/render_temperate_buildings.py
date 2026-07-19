"""Gera o piloto de predios isometricos da Village com Blender 4.5+.

Uso:
  blender --background --factory-startup --python render_temperate_buildings.py -- --output <pasta>

Os modelos sao originais e construidos por primitivas para que o pipeline
continue reproduzivel mesmo sem manter um pacote 3D inteiro no repositorio.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector


SIZE = 256
ORIENTATIONS = {
    "south": 0.0,
    "east": -math.pi / 2,
    "north": math.pi,
    "west": math.pi / 2,
}


def arguments() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    return parser.parse_args(values)


def material(name: str, color: tuple[float, float, float, float], roughness: float = 0.72, metallic: float = 0.0):
    value = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    value.diffuse_color = color
    value.use_nodes = True
    shader = value.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    return value


def apply_material(obj, value):
    obj.data.materials.append(value)
    return obj


def box(name, size, location, value, bevel=0.035, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        modifier = obj.modifiers.new("Bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
    return apply_material(obj, value)


def roof(name, width, depth, eave_z, height, value, overhang=0.18):
    half_w = width / 2 + overhang
    half_d = depth / 2 + overhang
    vertices = [
        (-half_w, -half_d, eave_z), (half_w, -half_d, eave_z),
        (-half_w, half_d, eave_z), (half_w, half_d, eave_z),
        (-half_w, 0, eave_z + height), (half_w, 0, eave_z + height),
    ]
    faces = [(0, 1, 5, 4), (4, 5, 3, 2), (0, 4, 2), (1, 3, 5)]
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bevel = obj.modifiers.new("Roof edge", "BEVEL")
    bevel.width = 0.035
    bevel.segments = 2
    return apply_material(obj, value)


def cylinder(name, radius, depth, location, value, vertices=16):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    bevel = obj.modifiers.new("Soft edge", "BEVEL")
    bevel.width = 0.025
    bevel.segments = 2
    return apply_material(obj, value)


def south_detail(name, x, y, z, width, height, value, depth=0.08):
    return box(name, (width, depth, height), (x, y, z), value, 0.025)


def east_detail(name, x, y, z, width, height, value, depth=0.08):
    return box(name, (depth, width, height), (x, y, z), value, 0.025)


def windows(width, depth, base_z, stories, mats):
    glass, frame = mats["glass"], mats["dark_wood"]
    levels = [base_z + 1.02 + level * 1.18 for level in range(stories)]
    south_xs = [-width * 0.27, width * 0.27]
    east_ys = [-depth * 0.23, depth * 0.23]
    for level, z in enumerate(levels):
        for index, x in enumerate(south_xs):
            if level == 0 and index == 1:
                continue
            south_detail(f"SouthWindowFrame-{level}-{index}", x, depth / 2 + 0.055, z, 0.52, 0.7, frame, 0.1)
            south_detail(f"SouthWindow-{level}-{index}", x, depth / 2 + 0.112, z, 0.38, 0.54, glass, 0.04)
        for index, y in enumerate(east_ys):
            east_detail(f"EastWindowFrame-{level}-{index}", width / 2 + 0.055, y, z, 0.52, 0.7, frame, 0.1)
            east_detail(f"EastWindow-{level}-{index}", width / 2 + 0.112, y, z, 0.38, 0.54, glass, 0.04)


def timber_frame(width, depth, base_z, wall_height, mats):
    wood = mats["dark_wood"]
    for x in (-width / 2 + 0.12, 0, width / 2 - 0.12):
        south_detail("SouthBeam", x, depth / 2 + 0.065, base_z + wall_height / 2, 0.11, wall_height, wood, 0.1)
    for y in (-depth / 2 + 0.12, 0, depth / 2 - 0.12):
        east_detail("EastBeam", width / 2 + 0.065, y, base_z + wall_height / 2, 0.11, wall_height, wood, 0.1)
    south_detail("SouthBand", 0, depth / 2 + 0.07, base_z + wall_height * 0.57, width, 0.1, wood, 0.1)
    east_detail("EastBand", width / 2 + 0.07, 0, base_z + wall_height * 0.57, depth, 0.1, wood, 0.1)


def common_shell(name, width, depth, stories, wall_mat, roof_mat, mats, roof_height=0.92):
    foundation_h = 0.28
    wall_h = 1.32 * stories
    box(f"{name}Foundation", (width + 0.12, depth + 0.12, foundation_h), (0, 0, foundation_h / 2), mats["stone"], 0.06)
    box(f"{name}Walls", (width, depth, wall_h), (0, 0, foundation_h + wall_h / 2), wall_mat, 0.055)
    roof(f"{name}Roof", width, depth, foundation_h + wall_h, roof_height, roof_mat, 0.22)
    door_z = foundation_h + 0.68
    south_detail(f"{name}DoorFrame", width * 0.19, depth / 2 + 0.07, door_z, 0.7, 1.3, mats["dark_wood"], 0.11)
    south_detail(f"{name}Door", width * 0.19, depth / 2 + 0.135, door_z, 0.52, 1.15, mats["door"], 0.045)
    cylinder(f"{name}Knob", 0.035, 0.055, (width * 0.30, depth / 2 + 0.19, door_z), mats["brass"], 10).rotation_euler.x = math.pi / 2
    windows(width, depth, foundation_h, stories, mats)
    return foundation_h, wall_h


def build_cottage(mats):
    width, depth = 3.0, 2.2
    base, wall = common_shell("Cottage", width, depth, 1, mats["plaster"], mats["red_roof"], mats, 1.05)
    timber_frame(width, depth, base, wall, mats)
    box("CottageChimney", (0.36, 0.38, 1.4), (-0.82, -0.2, base + wall + 0.72), mats["brick"], 0.035)
    return (3, 2), (0, depth / 2, 0)


def build_townhouse(mats):
    width, depth = 3.5, 2.65
    base, wall = common_shell("Townhouse", width, depth, 2, mats["cream"], mats["red_roof"], mats, 1.05)
    timber_frame(width, depth, base, wall, mats)
    for x in (-0.82, 0.82):
        box("Dormer", (0.62, 0.38, 0.58), (x, depth * 0.25, base + wall + 0.34), mats["cream"], 0.035)
        roof("DormerRoof", 0.78, 0.54, base + wall + 0.63, 0.35, mats["red_roof"], 0.08).location.x = x
        south_detail("DormerGlass", x, depth * 0.45 + 0.17, base + wall + 0.37, 0.28, 0.34, mats["glass"], 0.04)
    return (4, 3), (width * 0.19, depth / 2, 0)


def build_workshop(mats):
    width, depth = 4.0, 3.0
    base, wall = common_shell("Workshop", width, depth, 1, mats["fieldstone"], mats["brown_roof"], mats, 0.82)
    box("ForgeChimney", (0.58, 0.62, 1.7), (-1.18, -0.42, base + wall + 0.72), mats["dark_stone"], 0.045)
    awning_z = base + 1.35
    box("Awning", (1.8, 0.82, 0.12), (0.45, depth / 2 + 0.38, awning_z), mats["red_roof"], 0.025, (math.radians(13), 0, 0))
    for x in (-0.36, 1.26):
        box("AwningPost", (0.09, 0.09, 1.35), (x, depth / 2 + 0.68, 0.68), mats["dark_wood"], 0.02)
    return (4, 3), (width * 0.19, depth / 2, 0)


def build_civic(mats):
    width, depth = 4.8, 3.7
    base, wall = common_shell("Civic", width, depth, 2, mats["warm_stone"], mats["slate"], mats, 1.18)
    for x in (-width / 2 + 0.25, width / 2 - 0.25):
        box("CivicQuoin", (0.22, 0.22, wall), (x, depth / 2 + 0.03, base + wall / 2), mats["light_stone"], 0.02)
    tower_base = base + wall + 0.62
    box("Cupola", (1.05, 1.05, 0.82), (0, 0, tower_base), mats["cream"], 0.04)
    roof("CupolaRoof", 1.18, 1.18, tower_base + 0.41, 0.72, mats["slate"], 0.1)
    cylinder("CivicFinial", 0.055, 0.7, (0, 0, tower_base + 1.43), mats["brass"], 12)
    return (5, 4), (width * 0.19, depth / 2, 0)


def build_farmstead(mats):
    width, depth = 4.0, 2.8
    base, wall = common_shell("Farmstead", width, depth, 1, mats["wood"], mats["thatch"], mats, 1.22)
    timber_frame(width, depth, base, wall, mats)
    porch_z = base + 1.25
    box("PorchRoof", (2.25, 0.88, 0.13), (0.45, depth / 2 + 0.4, porch_z), mats["thatch"], 0.03, (math.radians(12), 0, 0))
    box("PorchDeck", (2.4, 0.78, 0.13), (0.45, depth / 2 + 0.42, 0.23), mats["wood"], 0.025)
    for x in (-0.6, 1.5):
        box("PorchPost", (0.1, 0.1, 1.22), (x, depth / 2 + 0.72, 0.72), mats["dark_wood"], 0.02)
    return (4, 3), (width * 0.19, depth / 2, 0)


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def setup_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = SIZE
    scene.render.resolution_y = SIZE
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = True
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 55
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_percentage = 100
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    world = bpy.data.worlds.new("VillageWorld") if not bpy.data.worlds else bpy.data.worlds[0]
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.055, 0.075, 0.065, 1)
    background.inputs["Strength"].default_value = 0.65

    target = Vector((0, 0, 1.8))
    horizontal = math.sqrt(8 * 8 + 8 * 8)
    camera_data = bpy.data.cameras.new("VillageIsoCamera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 11.3137085
    camera = bpy.data.objects.new("VillageIsoCamera", camera_data)
    camera.location = (8, 8, 1.8 + math.tan(math.radians(30)) * horizontal)
    look_at(camera, target)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera

    area_data = bpy.data.lights.new("WarmKey", "AREA")
    area_data.energy = 900
    area_data.shape = "DISK"
    area_data.size = 5.5
    area_data.color = (1.0, 0.79, 0.58)
    area = bpy.data.objects.new("WarmKey", area_data)
    area.location = (-5.5, 3.5, 10.5)
    look_at(area, (0, 0, 1.2))
    bpy.context.collection.objects.link(area)

    fill_data = bpy.data.lights.new("CoolFill", "AREA")
    fill_data.energy = 330
    fill_data.size = 7
    fill_data.color = (0.55, 0.69, 0.9)
    fill = bpy.data.objects.new("CoolFill", fill_data)
    fill.location = (5, -5, 6)
    look_at(fill, (0, 0, 1.5))
    bpy.context.collection.objects.link(fill)
    return scene, camera


def palette():
    return {
        "plaster": material("Ivory plaster", (0.70, 0.60, 0.43, 1)),
        "cream": material("Warm lime", (0.80, 0.70, 0.53, 1)),
        "wood": material("Aged oak", (0.35, 0.20, 0.10, 1)),
        "dark_wood": material("Dark beams", (0.17, 0.085, 0.04, 1)),
        "door": material("Door oak", (0.27, 0.12, 0.045, 1)),
        "red_roof": material("Clay tiles", (0.43, 0.12, 0.075, 1)),
        "brown_roof": material("Wood shingles", (0.25, 0.12, 0.055, 1)),
        "thatch": material("Golden thatch", (0.53, 0.36, 0.12, 1)),
        "slate": material("Blue slate", (0.16, 0.23, 0.26, 1)),
        "stone": material("Foundation stone", (0.31, 0.32, 0.29, 1)),
        "fieldstone": material("Fieldstone", (0.42, 0.42, 0.36, 1)),
        "dark_stone": material("Soot stone", (0.22, 0.21, 0.19, 1)),
        "warm_stone": material("Warm civic stone", (0.52, 0.49, 0.40, 1)),
        "light_stone": material("Cut limestone", (0.66, 0.63, 0.53, 1)),
        "brick": material("Chimney brick", (0.40, 0.16, 0.10, 1)),
        "glass": material("Blue glass", (0.11, 0.31, 0.37, 1), 0.25, 0.05),
        "brass": material("Warm brass", (0.72, 0.49, 0.12, 1), 0.28, 0.65),
    }


def project(scene, camera, point):
    coordinate = world_to_camera_view(scene, camera, Vector(point))
    return [round(coordinate.x * SIZE, 3), round((1 - coordinate.y) * SIZE, 3)]


def clear_models():
    keep = {"VillageIsoCamera", "WarmKey", "CoolFill"}
    for obj in list(bpy.data.objects):
        if obj.name not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)


def main():
    args = arguments()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    scene, camera = setup_scene()
    mats = palette()
    builders = {
        "cottage": build_cottage,
        "townhouse": build_townhouse,
        "workshop": build_workshop,
        "civic": build_civic,
        "farmstead": build_farmstead,
    }
    entries = []
    for family, builder in builders.items():
        clear_models()
        footprint, door = builder(mats)
        objects = [obj for obj in bpy.data.objects if obj.name not in {"VillageIsoCamera", "WarmKey", "CoolFill"}]
        originals = {obj.name: obj.matrix_world.copy() for obj in objects}
        for orientation, angle in ORIENTATIONS.items():
            rotation = Matrix.Rotation(angle, 4, "Z")
            for obj in objects:
                obj.matrix_world = rotation @ originals[obj.name]
            rotated_door = rotation @ Vector(door)
            filename = f"{family}-{orientation}.png"
            scene.render.filepath = str(output / filename)
            bpy.ops.render.render(write_still=True)
            anchor_x, anchor_y = project(scene, camera, (0, 0, 0))
            door_x, door_y = project(scene, camera, rotated_door)
            entries.append({
                "key": f"temperate:{family}:{orientation}",
                "biome": "temperate",
                "family": family,
                "orientation": orientation,
                "src": f"/assets/buildings/temperate/{filename}",
                "width": SIZE,
                "height": SIZE,
                "anchorX": anchor_x,
                "anchorY": anchor_y,
                "doorX": door_x,
                "doorY": door_y,
                "footprint": list(footprint),
            })
    manifest = {
        "schemaVersion": 1,
        "generator": "Blender 4.5 Village procedural pilot",
        "baseTileWidth": 32,
        "baseTileHeight": 16,
        "entries": entries,
    }
    (output.parent / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Village: {len(entries)} sprites gerados em {output}")


if __name__ == "__main__":
    main()

