"""Original Village geometry builders, shared by the GLB export pipeline."""
from __future__ import annotations
import math
import bpy
from mathutils import Vector
from building_contract import BuildingProfile


class BuildingContext(dict):
    """Palette plus an explicit immutable profile and named roof anchors."""
    def __init__(self, palette, profile):
        super().__init__(palette)
        self.profile = profile
        self.roofs = {}

    def roof(self, name, width, depth, eave_z, height, value, overhang=.18):
        plan = self.profile.roof(width, depth, eave_z, height, overhang)
        if plan.style == 'flat':
            obj = box(name, (width+2*plan.overhang, depth+2*plan.overhang, plan.rise),
                      (0, 0, eave_z+plan.rise/2), self['cream'], .035)
        else:
            material = self['snow'] if self.profile.biome == 'snowy' else self['thatch'] if self.profile.biome == 'wetland' else value
            obj = roof(name, width, depth, eave_z, plan.rise, material, plan.overhang)
        self.roofs[name] = plan
        bpy.context.view_layer.update()
        inverse = obj.matrix_world.inverted()
        obj['vg_wall_top'] = list(inverse @ Vector((0, 0, plan.wall_top)))
        obj['vg_apex'] = list(inverse @ Vector((0, 0, plan.apex)))
        obj['vg_roof_style'] = plan.style
        return obj

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
    faces = [(0, 1, 5, 4), (4, 5, 3, 2), (0, 4, 2), (1, 3, 5), (0, 2, 3, 1)]
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
    mats.roof(f"{name}Roof", width, depth, foundation_h + wall_h, roof_height, roof_mat, 0.22)
    door_z = foundation_h + 0.575
    south_detail(f"{name}DoorFrame", width * 0.19, depth / 2 + 0.07, door_z, 0.7, 1.3, mats["dark_wood"], 0.11)
    south_detail(f"{name}Door", width * 0.19, depth / 2 + 0.135, door_z, 0.52, 1.15, mats["door"], 0.045)
    cylinder(f"{name}Knob", 0.035, 0.055, (width * 0.19 + .17, depth / 2 + .18, door_z), mats["brass"], 10).rotation_euler.x = math.pi / 2
    windows(width, depth, foundation_h, stories, mats)
    return foundation_h, wall_h


def finish_openings(mats):
    """Resolve real openings before merging meshes by material in the exporter."""
    bpy.context.view_layer.update()
    frames = [o for o in bpy.context.scene.objects if 'DoorFrame' in o.name or 'WindowFrame' in o.name]
    for beam in list(bpy.context.scene.objects):
        if not any(beam.name.startswith(n) for n in ('SouthBeam', 'SouthBand', 'EastBeam', 'EastBand')):
            continue
        axis = max(range(3), key=lambda i: beam.dimensions[i])
        lo = beam.location - beam.dimensions / 2
        hi = beam.location + beam.dimensions / 2
        intervals = [(lo[axis], hi[axis])]
        for opening in frames:
            a = opening.location - opening.dimensions / 2
            b = opening.location + opening.dimensions / 2
            if any(hi[i] <= a[i] or lo[i] >= b[i] for i in range(3) if i != axis):
                continue
            cut_lo, cut_hi = a[axis] - .02, b[axis] + .02
            remaining = []
            for start, end in intervals:
                if cut_hi <= start or cut_lo >= end:
                    remaining.append((start, end))
                else:
                    if cut_lo > start: remaining.append((start, cut_lo))
                    if cut_hi < end: remaining.append((cut_hi, end))
            intervals = remaining
        for start, end in intervals:
            if end - start < .025: continue
            size, pos = beam.dimensions.copy(), beam.location.copy()
            size[axis], pos[axis] = end - start, (start + end) / 2
            box('OpeningSafeTimber', size, pos, mats['dark_wood'], .009)
        bpy.data.objects.remove(beam, do_unlink=True)
    # These must be made before export: GLBs merge all windows into one material mesh.
    for glass in list(bpy.context.scene.objects):
        if not (glass.name.startswith('SouthWindow-') or glass.name.startswith('EastWindow-')):
            continue
        thin = 1 if glass.name.startswith('South') else 0
        horizontal = 0 if thin == 1 else 1
        center, size = glass.location.copy(), glass.dimensions.copy()
        center[thin] += size[thin] / 2 + .008
        vertical = Vector((.024, .024, size.z))
        cross = Vector((.024, .024, .024)); cross[horizontal] = size[horizontal]
        box('WindowMullion', vertical, center, mats['dark_wood'], .003)
        box('WindowCrossbar', cross, center, mats['dark_wood'], .003)


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
        y = depth*.25
        support = mats.roofs['TownhouseRoof'].surface(y+.19)-.03
        box("Dormer", (.62, .38, .58), (x, y, support+.29), mats['cream'], .035)
        cap = mats.roof("DormerRoof", .78, .54, support+.58, .35, mats['red_roof'], .08)
        cap.location.x = x
        cap.location.y = y
        south_detail("DormerGlass", x, y+.205, support+.29, .28, .34, mats['glass'], .04)
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
    tower_base = mats.roofs['CivicRoof'].surface(.525) + .39
    box("Cupola", (1.05, 1.05, 0.82), (0, 0, tower_base), mats["cream"], 0.04)
    mats.roof("CupolaRoof", 1.18, 1.18, tower_base + 0.41, 0.72, mats["slate"], 0.1)
    cylinder("CivicFinial", 0.055, 0.7, (0, 0, mats.roofs['CupolaRoof'].apex+.33), mats["brass"], 12)
    return (5, 4), (width * 0.19, depth / 2, 0)


def build_farmstead(mats):
    width, depth = 4.0, 2.8
    base, wall = common_shell("Farmstead", width, depth, 1, mats["wood"], mats["thatch"], mats, 1.22)
    timber_frame(width, depth, base, wall, mats)
    porch_z = base + 1.25
    box("PorchRoof", (2.25, 0.88, 0.13), (0.45, depth / 2 + 0.4, porch_z), mats["thatch"], 0.03, (math.radians(12), 0, 0))
    # A varanda estava suspensa: o tabuleiro comecava em z=0,165 e os pilares em
    # z=0,110, ambos sem tocar o chao, e o topo dos pilares parava em 1,33, abaixo
    # do beiral em ~1,40. Plinto de pedra ate o solo, na mesma pedra da fundacao e
    # no mesmo padrao ja usado pela variante do chale, e pilares do tabuleiro ao beiral.
    box("PorchBase", (2.4, 0.78, 0.165), (0.45, depth / 2 + 0.42, 0.0825), mats["stone"], 0.015)
    box("PorchDeck", (2.4, 0.78, 0.13), (0.45, depth / 2 + 0.42, 0.23), mats["wood"], 0.025)
    for x in (-0.6, 1.5):
        box("PorchPost", (0.1, 0.1, 1.15), (x, depth / 2 + 0.72, 0.85), mats["dark_wood"], 0.02)
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
    annex_roof = mats.roof("InnStableRoof", 1.75, 2.65, 1.56, 0.66, mats["brown_roof"], 0.12)
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
        box("ArtisanBenchLeg", (0.1, 0.1, 0.63), (x, depth / 2 + 0.64, 0.315), mats["dark_wood"], 0.012)
    crate("ArtisanCrate", -1.50, depth / 2 + 0.58, 0, mats, 0.78)
    barrel("ArtisanBarrel", 1.58, depth / 2 + 0.54, mats, 0.72)
    return (4, 3), (width * 0.19, depth / 2, 0)


def build_smithy(mats):
    width, depth = 4.25, 3.2
    base, wall = common_shell("Smithy", width, depth, 1, mats["dark_stone"], mats["brown_roof"], mats, 0.78)
    box("SmithyStack", (0.72, 0.76, 2.25), (-1.18, -0.35, base + wall + 0.55), mats["brick"], 0.045)
    box("SmithyCanopy", (2.45, 1.12, 0.13), (0.35, depth / 2 + 0.52, base + 1.42), mats["red_roof"], 0.025, (math.radians(12), 0, 0))
    for x in (-0.72, 1.42):
        box("SmithyPost", (0.11, 0.11, 1.56), (x, depth / 2 + 0.92, 0.78), mats["dark_wood"], 0.018)
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
    mats.roof("MarketRoof", width, depth, eave, 1.05, mats["red_roof"], 0.28)
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

    if variant >= 3:
        # New silhouettes: rear workroom, cross gable, and stone porch.
        width,depth=footprint
        if variant in (3,5):
            box("RearWorkroom",(1.55,1.7,1.35),(-.55,-depth*.38,.79),mats["fieldstone"],.035)
            cover=mats.roof("RearCrossGable",1.75,1.9,1.46,.8,mats["slate"])
            cover.location.x=-.55;cover.location.y=-depth*.38
            cylinder("RearChimney",.20,1.35,(-.85,-depth*.35,2.15),mats["brick"],8)
        if variant in (4,5):
            side_x=-width*.5-.25
            box("StoneSideRoom",(1.25,1.6,1.2),(side_x,-.15,.70),mats["fieldstone"],.03)
            cover=mats.roof("SideRoomGable",1.45,1.8,1.32,.62,mats["slate"])
            cover.location.x=side_x;cover.location.y=-.15
            south_detail("SideRoomWindow",side_x,.70,.93,.46,.42,mats["glass"],.04)
        # Visible shutter and storage detail remains behind the building line.
        for x in (-.65,.1):
            box("RearStorageCrate",(.48,.44,.42),(x,-depth*.48,.21),mats["wood"],.02)
        return footprint

    if family == "cottage":
        box("CottageVariantAnnex", (1.45, 1.7, 1.3), (-1.75, -.18, .72), mats["wood"], .045)
        annex_roof = mats.roof("CottageVariantAnnexRoof", 1.62, 1.88, 1.37, .62, mats["thatch"], .12)
        annex_roof.location.x = -1.75
        if variant == 2:
            box("CottageVariantPorchBase", (1.85, .72, .15), (.52, 1.42, .075), mats["stone"], .01)
            box("CottageVariantPorch", (1.85, .72, .13), (.52, 1.42, .215), mats["wood"], .012)
            box("CottageVariantPorchRoof", (2.0, .82, .12), (.52, 1.42, 1.8), mats["red_roof"], .012, (math.radians(12), 0, 0))
            for x in (-.32, 1.36):
                box("CottagePorchPost", (.10, .10, 1.47), (x, 1.7, 1.015), mats["dark_wood"], .008)
        return (4, 3)
    if family == "townhouse":
        box("TownhouseVariantWing", (1.35, 2.05, 2.35), (-2.12, -.2, 1.35), mats["cream"], .045)
        wing_roof = mats.roof("TownhouseVariantWingRoof", 1.5, 2.2, 2.52, .72, mats["slate"], .12)
        wing_roof.location.x = -2.12
        if variant == 2:
            box("TownhouseVariantGallery", (2.1, .68, .14), (.55, 1.68, 1.72), mats["wood"], .02)
            for x in (-.4, .35, 1.1):
                box("TownhouseGalleryPost", (.08, .08, 1.71), (x, 1.94, .855), mats["dark_wood"], .012)
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
        shed_roof = mats.roof("ArtisanVariantShedRoof", 1.82, 2.42, 1.55, .55, mats["brown_roof"], .12)
        shed_roof.location.x = -2.18
        if variant == 2:
            cylinder("ArtisanVariantKiln", .58, 1.65, (1.55, -.65, .825), mats["brick"], 18)
            cylinder("ArtisanVariantKilnStack", .20, 1.5, (1.55, -.65, 2.18), mats["brick"], 16)
        return (5, 4)

    if family == "workshop":
        box("WorkshopVariantYardRoof", (2.25, 1.55, .13), (-.7, 2.0, 1.55), mats["brown_roof"], .025, (math.radians(10), 0, 0))
        for x in (-1.65, .25):
            box("WorkshopVariantPost", (.1, .1, 1.55), (x, 2.45, .775), mats["dark_wood"], .016)
        return (5, 5)
    if family == "civic":
        for x in (-1.65, 0, 1.65):
            cylinder("CivicVariantColumn", .14, 2.05, (x, 2.05, 1.025), mats["light_stone"], 16)
        box("CivicVariantPortico", (4.1, 1.15, .18), (0, 2.05, 2.1), mats["light_stone"], .025)
        return (5, 5)
    if family == "farmstead":
        box("FarmsteadVariantStable", (2.05, 2.55, 1.45), (-2.72, -.15, .84), mats["wood"], .045)
        stable_roof = mats.roof("FarmsteadVariantStableRoof", 2.25, 2.78, 1.58, .68, mats["thatch"], .14)
        stable_roof.location.x = -2.72
        return (6, 4)
    if family == "inn":
        box("InnVariantCoachHouse", (2.2, 2.75, 1.65), (3.05, -.2, .96), mats["fieldstone"], .045)
        coach_roof = mats.roof("InnVariantCoachRoof", 2.4, 2.95, 1.78, .72, mats["brown_roof"], .14)
        coach_roof.location.x = 3.05
        return (7, 5)
    if family == "shop":
        box("ShopVariantGallery", (3.15, .78, .13), (-.15, 1.82, 1.78), mats["wood"], .02)
        for x in (-1.55, -.15, 1.25):
            box("ShopVariantPost", (.08, .08, 1.78), (x, 2.12, .89), mats["dark_wood"], .012)
        return (4, 4)
    if family == "smithy":
        box("SmithyVariantCoalShed", (1.65, 2.2, 1.25), (2.55, -.25, .74), mats["dark_wood"], .04)
        shed_roof = mats.roof("SmithyVariantCoalRoof", 1.82, 2.4, 1.38, .52, mats["brown_roof"], .12)
        shed_roof.location.x = 2.55
        return (6, 4)
    if family == "market":
        box("MarketVariantWingRoof", (2.15, 3.45, .16), (3.35, 0, 2.05), mats["red_roof"], .025, (0, math.radians(8), 0))
        for y in (-1.45, 0, 1.45):
            box("MarketVariantWingPost", (.13, .13, 2.0), (3.35, y, 1.0), mats["dark_wood"], .018)
        return (7, 5)
    if family == "mill":
        box("MillVariantGranary", (1.85, 2.35, 1.6), (-2.65, -.2, .92), mats["wood"], .04)
        granary_roof = mats.roof("MillVariantGranaryRoof", 2.05, 2.55, 1.72, .62, mats["thatch"], .13)
        granary_roof.location.x = -2.65
        return (6, 4)
    return footprint


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
