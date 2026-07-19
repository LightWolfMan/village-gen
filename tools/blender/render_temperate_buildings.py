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
    return (3, 2), (width * 0.19, depth / 2, 0)


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


def hanging_sign(name, x, y, z, mats, symbol=False):
    box(f"{name}Arm", (0.62, 0.08, 0.08), (x, y, z + 0.34), mats["dark_wood"], 0.018)
    box(f"{name}Chain", (0.035, 0.035, 0.38), (x + 0.24, y, z + 0.14), mats["iron"], 0.008)
    board = box(f"{name}Board", (0.5, 0.09, 0.42), (x + 0.24, y, z - 0.12), mats["sign"], 0.045)
    if symbol:
        south_detail(f"{name}Mark", x + 0.24, y + 0.052, z - 0.12, 0.22, 0.10, mats["brass"], 0.025)
    return board


def barrel(name, x, y, mats, scale=1.0):
    value = cylinder(name, 0.23 * scale, 0.52 * scale, (x, y, 0.30 * scale), mats["wood"], 16)
    cylinder(f"{name}BandA", 0.238 * scale, 0.035, (x, y, 0.14 * scale), mats["iron"], 16)
    cylinder(f"{name}BandB", 0.238 * scale, 0.035, (x, y, 0.44 * scale), mats["iron"], 16)
    return value


def crate(name, x, y, z, mats, scale=1.0):
    box(name, (0.55 * scale, 0.5 * scale, 0.45 * scale), (x, y, z + 0.225 * scale), mats["wood"], 0.025)
    box(f"{name}Band", (0.58 * scale, 0.08, 0.10), (x, y + 0.255 * scale, z + 0.23 * scale), mats["dark_wood"], 0.012)


def build_inn(mats):
    width, depth = 4.6, 3.4
    base, wall = common_shell("Inn", width, depth, 2, mats["cream"], mats["red_roof"], mats, 1.14)
    timber_frame(width, depth, base, wall, mats)
    annex = box("InnStable", (1.55, 2.45, 1.28), (-width / 2 - 0.62, -0.25, 0.28 + 0.64), mats["wood"], 0.04)
    annex_roof = roof("InnStableRoof", 1.75, 2.65, 1.56, 0.66, mats["brown_roof"], 0.12)
    annex_roof.location.x = -width / 2 - 0.62
    annex.location.x = -width / 2 - 0.62
    hanging_sign("InnSign", width * 0.36, depth / 2 + 0.14, base + 1.38, mats, True)
    barrel("InnBarrelA", -0.65, depth / 2 + 0.43, mats, 0.9)
    barrel("InnBarrelB", -0.18, depth / 2 + 0.48, mats, 0.72)
    return (5, 4), (width * 0.19, depth / 2, 0)


def striped_awning(name, width, y, z, mats):
    panels = 7
    panel_width = width / panels
    for index in range(panels):
        x = -width / 2 + panel_width * (index + 0.5)
        color = mats["cloth_red"] if index % 2 == 0 else mats["cloth_cream"]
        box(f"{name}Panel{index}", (panel_width + 0.02, 0.86, 0.075), (x, y, z), color, 0.015, (math.radians(13), 0, 0))


def build_shop(mats):
    width, depth = 3.7, 2.75
    base, wall = common_shell("Shop", width, depth, 2, mats["plaster"], mats["red_roof"], mats, 0.95)
    timber_frame(width, depth, base, wall, mats)
    south_detail("ShopWindowFrame", -0.72, depth / 2 + 0.08, base + 0.82, 1.15, 1.05, mats["dark_wood"], 0.12)
    south_detail("ShopDisplay", -0.72, depth / 2 + 0.15, base + 0.82, 0.94, 0.83, mats["glass"], 0.04)
    striped_awning("ShopAwning", 2.25, depth / 2 + 0.43, base + 1.52, mats)
    crate("ShopCrateA", -1.15, depth / 2 + 0.56, 0, mats, 0.75)
    crate("ShopCrateB", -0.62, depth / 2 + 0.62, 0, mats, 0.62)
    hanging_sign("ShopSign", width * 0.34, depth / 2 + 0.14, base + 1.3, mats, True)
    return (4, 3), (width * 0.19, depth / 2, 0)


def build_merchant(mats):
    width, depth = 3.5, 2.55
    base, wall = common_shell("Merchant", width, depth, 2, mats["cream"], mats["slate"], mats, 0.95)
    timber_frame(width, depth, base, wall, mats)
    south_detail("MerchantStorefrontFrame", -0.68, depth / 2 + 0.08, base + 0.82, 1.2, 1.08, mats["dark_wood"], 0.12)
    south_detail("MerchantStorefront", -0.68, depth / 2 + 0.15, base + 0.82, 0.98, 0.86, mats["glass"], 0.04)
    box("MerchantBalcony", (2.35, 0.62, 0.13), (-0.15, depth / 2 + 0.30, base + 1.62), mats["wood"], 0.025)
    for x in (-1.1, -0.35, 0.4, 1.0):
        box("MerchantRail", (0.07, 0.07, 0.48), (x, depth / 2 + 0.57, base + 1.88), mats["dark_wood"], 0.012)
    box("MerchantTopRail", (2.35, 0.08, 0.08), (-0.15, depth / 2 + 0.57, base + 2.1), mats["dark_wood"], 0.012)
    hanging_sign("MerchantSign", width * 0.35, depth / 2 + 0.14, base + 1.25, mats, True)
    return (4, 3), (width * 0.19, depth / 2, 0)


def build_artisan(mats):
    width, depth = 3.9, 2.9
    base, wall = common_shell("Artisan", width, depth, 1, mats["fieldstone"], mats["brown_roof"], mats, 0.85)
    timber_frame(width, depth, base, wall, mats)
    box("ArtisanLeanTo", (2.1, 0.92, 0.12), (-0.55, depth / 2 + 0.45, base + 1.26), mats["brown_roof"], 0.02, (math.radians(14), 0, 0))
    box("ArtisanBench", (1.55, 0.45, 0.12), (-0.62, depth / 2 + 0.64, 0.66), mats["wood"], 0.02)
    for x in (-1.25, 0.0):
        box("ArtisanBenchLeg", (0.1, 0.1, 0.58), (x, depth / 2 + 0.64, 0.34), mats["dark_wood"], 0.012)
    crate("ArtisanCrate", -1.50, depth / 2 + 0.58, 0, mats, 0.78)
    barrel("ArtisanBarrel", 1.58, depth / 2 + 0.54, mats, 0.72)
    return (4, 3), (width * 0.19, depth / 2, 0)


def build_smithy(mats):
    width, depth = 4.25, 3.2
    base, wall = common_shell("Smithy", width, depth, 1, mats["dark_stone"], mats["brown_roof"], mats, 0.78)
    box("SmithyStack", (0.72, 0.76, 2.25), (-1.18, -0.35, base + wall + 0.55), mats["brick"], 0.045)
    box("SmithyCanopy", (2.45, 1.12, 0.13), (0.35, depth / 2 + 0.52, base + 1.42), mats["red_roof"], 0.025, (math.radians(12), 0, 0))
    for x in (-0.72, 1.42):
        box("SmithyPost", (0.11, 0.11, 1.36), (x, depth / 2 + 0.92, 0.72), mats["dark_wood"], 0.018)
    box("SmithyForge", (0.9, 0.64, 0.68), (-0.22, depth / 2 + 0.66, 0.39), mats["dark_stone"], 0.035)
    box("SmithyEmber", (0.65, 0.42, 0.08), (-0.22, depth / 2 + 0.67, 0.76), mats["ember"], 0.01)
    box("AnvilBase", (0.18, 0.18, 0.48), (-1.48, depth / 2 + 0.76, 0.28), mats["iron"], 0.018)
    box("AnvilTop", (0.65, 0.22, 0.18), (-1.48, depth / 2 + 0.76, 0.57), mats["iron"], 0.025)
    return (4, 3), (width * 0.19, depth / 2, 0)


def build_market(mats):
    width, depth = 4.8, 3.7
    foundation_h = 0.18
    box("MarketFoundation", (width + 0.1, depth + 0.1, foundation_h), (0, 0, foundation_h / 2), mats["light_stone"], 0.035)
    eave = 2.15
    roof("MarketRoof", width, depth, eave, 1.05, mats["red_roof"], 0.28)
    for x in (-width / 2 + 0.26, 0, width / 2 - 0.26):
        box("MarketBackPost", (0.16, 0.16, eave), (x, -depth / 2 + 0.24, eave / 2), mats["dark_wood"], 0.02)
    for x in (-width / 2 + 0.26, width / 2 - 0.26):
        box("MarketFrontPost", (0.16, 0.16, eave), (x, depth / 2 - 0.24, eave / 2), mats["dark_wood"], 0.02)
    for x in (-1.35, 1.35):
        box("MarketCounter", (1.02, 0.58, 0.16), (x, depth / 2 + 0.05, 0.78), mats["wood"], 0.02)
        box("MarketCounterFront", (1.02, 0.12, 0.62), (x, depth / 2 + 0.30, 0.43), mats["cloth_red"] if x < 0 else mats["cloth_cream"], 0.018)
    crate("MarketCrateA", -1.55, depth / 2 + 0.64, 0, mats, 0.62)
    crate("MarketCrateB", 1.52, depth / 2 + 0.62, 0, mats, 0.68)
    return (5, 4), (0, depth / 2, 0)


def build_mill(mats):
    width, depth = 4.0, 3.1
    base, wall = common_shell("Mill", width, depth, 2, mats["fieldstone"], mats["brown_roof"], mats, 1.0)
    timber_frame(width, depth, base, wall, mats)
    hub = Vector((width / 2 + 0.36, -0.22, 1.25))
    wheel = cylinder("MillWheel", 1.05, 0.20, hub, mats["dark_wood"], 24)
    wheel.rotation_euler.y = math.pi / 2
    for angle in range(0, 360, 45):
        radians = math.radians(angle)
        center_y = hub.y + math.cos(radians) * 0.47
        center_z = hub.z + math.sin(radians) * 0.47
        spoke = box("MillSpoke", (0.24, 1.82, 0.10), (hub.x + 0.12, center_y, center_z), mats["wood"], 0.012)
        spoke.rotation_euler.x = radians
    cylinder("MillAxle", 0.16, 0.58, hub, mats["iron"], 16).rotation_euler.y = math.pi / 2
    hanging_sign("MillSign", width * 0.37, depth / 2 + 0.14, base + 1.30, mats, True)
    crate("MillGrainA", -1.48, depth / 2 + 0.52, 0, mats, 0.74)
    crate("MillGrainB", -0.98, depth / 2 + 0.58, 0, mats, 0.58)
    return (4, 4), (width * 0.19, depth / 2, 0)


def add_architectural_variant(family, variant, footprint, mats):
    """Adiciona volumes funcionais, nao apenas uma troca de paleta."""
    if variant == 0:
        return footprint

    if family == "cottage":
        box("CottageVariantAnnex", (1.45, 1.7, 1.3), (-1.75, -.18, .72), mats["wood"], .045)
        annex_roof = roof("CottageVariantAnnexRoof", 1.62, 1.88, 1.37, .62, mats["thatch"], .12)
        annex_roof.location.x = -1.75
        if variant == 2:
            box("CottageVariantPorch", (1.85, .72, .13), (.52, 1.42, .28), mats["wood"], .025)
            box("CottageVariantPorchRoof", (2.0, .82, .12), (.52, 1.42, 1.35), mats["red_roof"], .025, (math.radians(12), 0, 0))
        return (4, 3)
    if family == "townhouse":
        box("TownhouseVariantWing", (1.35, 2.05, 2.35), (-2.12, -.2, 1.35), mats["cream"], .045)
        wing_roof = roof("TownhouseVariantWingRoof", 1.5, 2.2, 2.52, .72, mats["slate"], .12)
        wing_roof.location.x = -2.12
        if variant == 2:
            box("TownhouseVariantGallery", (2.1, .68, .14), (.55, 1.68, 1.72), mats["wood"], .02)
            for x in (-.4, .35, 1.1):
                box("TownhouseGalleryPost", (.08, .08, 1.65), (x, 1.94, .88), mats["dark_wood"], .012)
        return (5, 4)
    if family == "merchant":
        box("MerchantVariantBay", (1.18, .58, 1.52), (-1.12, 1.55, 1.0), mats["cream"], .035)
        south_detail("MerchantVariantGlass", -1.12, 1.86, 1.0, .82, 1.08, mats["glass"], .04)
        if variant == 2:
            striped_awning("MerchantVariantAwning", 3.1, 1.62, 1.74, mats)
            box("MerchantVariantWarehouse", (1.25, 1.9, 1.48), (2.0, -.25, .86), mats["fieldstone"], .04)
        return (5, 4)
    if family == "artisan":
        box("ArtisanVariantShed", (1.65, 2.25, 1.45), (-2.18, -.28, .82), mats["wood"], .04)
        shed_roof = roof("ArtisanVariantShedRoof", 1.82, 2.42, 1.55, .55, mats["brown_roof"], .12)
        shed_roof.location.x = -2.18
        if variant == 2:
            cylinder("ArtisanVariantKiln", .58, 1.65, (1.55, -.65, .825), mats["brick"], 18)
            cylinder("ArtisanVariantKilnStack", .20, 1.5, (1.55, -.65, 2.18), mats["brick"], 16)
        return (5, 4)

    if family == "workshop":
        box("WorkshopVariantYardRoof", (2.25, 1.55, .13), (-.7, 2.0, 1.55), mats["brown_roof"], .025, (math.radians(10), 0, 0))
        for x in (-1.65, .25):
            box("WorkshopVariantPost", (.1, .1, 1.5), (x, 2.45, .78), mats["dark_wood"], .016)
        return (5, 5)
    if family == "civic":
        for x in (-1.65, 0, 1.65):
            cylinder("CivicVariantColumn", .14, 2.0, (x, 2.05, 1.05), mats["light_stone"], 16)
        box("CivicVariantPortico", (4.1, 1.15, .18), (0, 2.05, 2.1), mats["light_stone"], .025)
        return (5, 5)
    if family == "farmstead":
        box("FarmsteadVariantStable", (2.05, 2.55, 1.45), (-2.72, -.15, .84), mats["wood"], .045)
        stable_roof = roof("FarmsteadVariantStableRoof", 2.25, 2.78, 1.58, .68, mats["thatch"], .14)
        stable_roof.location.x = -2.72
        return (6, 4)
    if family == "inn":
        box("InnVariantCoachHouse", (2.2, 2.75, 1.65), (3.05, -.2, .96), mats["fieldstone"], .045)
        coach_roof = roof("InnVariantCoachRoof", 2.4, 2.95, 1.78, .72, mats["brown_roof"], .14)
        coach_roof.location.x = 3.05
        return (7, 5)
    if family == "shop":
        box("ShopVariantGallery", (3.15, .78, .13), (-.15, 1.82, 1.78), mats["wood"], .02)
        for x in (-1.55, -.15, 1.25):
            box("ShopVariantPost", (.08, .08, 1.72), (x, 2.12, .9), mats["dark_wood"], .012)
        return (4, 4)
    if family == "smithy":
        box("SmithyVariantCoalShed", (1.65, 2.2, 1.25), (2.55, -.25, .74), mats["dark_wood"], .04)
        shed_roof = roof("SmithyVariantCoalRoof", 1.82, 2.4, 1.38, .52, mats["brown_roof"], .12)
        shed_roof.location.x = 2.55
        return (6, 4)
    if family == "market":
        box("MarketVariantWingRoof", (2.15, 3.45, .16), (3.35, 0, 2.05), mats["red_roof"], .025, (0, math.radians(8), 0))
        for y in (-1.45, 0, 1.45):
            box("MarketVariantWingPost", (.13, .13, 2.0), (3.35, y, 1.0), mats["dark_wood"], .018)
        return (7, 5)
    if family == "mill":
        box("MillVariantGranary", (1.85, 2.35, 1.6), (-2.65, -.2, .92), mats["wood"], .04)
        granary_roof = roof("MillVariantGranaryRoof", 2.05, 2.55, 1.72, .62, mats["thatch"], .13)
        granary_roof.location.x = -2.65
        return (6, 4)
    return footprint


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
        "iron": material("Forged iron", (0.08, 0.09, 0.085, 1), 0.34, 0.72),
        "sign": material("Painted sign", (0.34, 0.12, 0.065, 1)),
        "cloth_red": material("Market red cloth", (0.52, 0.08, 0.055, 1)),
        "cloth_cream": material("Market cream cloth", (0.82, 0.66, 0.40, 1)),
        "ember": material("Forge ember", (1.0, 0.18, 0.025, 1), 0.42),
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
    for stale in output.glob("*.png"):
        stale.unlink()
    scene, camera = setup_scene()
    mats = palette()
    builders = {
        "cottage": build_cottage,
        "townhouse": build_townhouse,
        "workshop": build_workshop,
        "civic": build_civic,
        "farmstead": build_farmstead,
        "inn": build_inn,
        "shop": build_shop,
        "merchant": build_merchant,
        "artisan": build_artisan,
        "smithy": build_smithy,
        "market": build_market,
        "mill": build_mill,
    }
    variants = {family: (3 if family in {"cottage", "townhouse", "merchant", "artisan"} else 2)
                for family in builders}
    entries = []
    for family, builder in builders.items():
        for variant in range(variants[family]):
            clear_models()
            footprint, door = builder(mats)
            footprint = add_architectural_variant(family, variant, footprint, mats)
            objects = [obj for obj in bpy.data.objects if obj.name not in {"VillageIsoCamera", "WarmKey", "CoolFill"}]
            originals = {obj.name: obj.matrix_world.copy() for obj in objects}
            for orientation, angle in ORIENTATIONS.items():
                rotation = Matrix.Rotation(angle, 4, "Z")
                for obj in objects:
                    obj.matrix_world = rotation @ originals[obj.name]
                rotated_door = rotation @ Vector(door)
                filename = f"{family}-v{variant}-{orientation}.png"
                scene.render.filepath = str(output / filename)
                bpy.ops.render.render(write_still=True)
                anchor_x, anchor_y = project(scene, camera, (0, 0, 0))
                door_x, door_y = project(scene, camera, rotated_door)
                oriented_footprint = footprint[::-1] if orientation in {"east", "west"} else footprint
                entries.append({
                    "key": f"temperate:{family}:{variant}:{orientation}",
                    "biome": "temperate",
                    "family": family,
                    "variant": variant,
                    "orientation": orientation,
                    "src": f"/assets/buildings/temperate/{filename}",
                    "width": SIZE,
                    "height": SIZE,
                    "anchorX": anchor_x,
                    "anchorY": anchor_y,
                    "doorX": door_x,
                    "doorY": door_y,
                    "footprint": list(oriented_footprint),
                })
    manifest = {
        "schemaVersion": 2,
        "generator": "Blender 4.5 Village v3 procedural architecture",
        "baseTileWidth": 32,
        "baseTileHeight": 16,
        "entries": entries,
    }
    (output.parent / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Village: {len(entries)} sprites gerados em {output}")


if __name__ == "__main__":
    main()
