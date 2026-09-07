"""Original Village vegetation and object geometry; no rendering side effects."""
from __future__ import annotations
import math
import bpy
from mathutils import Vector
import architecture as village

def extra_palette(mats):
    mats.update({
        "packed_earth": village.material("Packed road earth", (0.33, 0.22, 0.12, 1)),
        "earth_light": village.material("Dry earth", (0.42, 0.30, 0.17, 1)),
        "rut": village.material("Cart rut", (0.28, 0.19, 0.10, 1)),
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
    deciduous(mats, "Oak", .25, 3.7, 1.0)


def deciduous(mats, name, radius, height, spread):
    bark=mats["light_stone"] if name=="Birch" else mats["wood"]
    branch(name+"Trunk", (0,0,0), (.10,0,height*.77), radius, bark)
    for i in range(7):
        a=i*2.399; z=height*(.43+i*.057)
        end=(math.cos(a)*spread,math.sin(a)*spread,z+.48)
        branch(name+"Bough", (.06,0,z-.32), end, radius*.43, bark)
        for j in (-1,1):
            tip=(end[0]+math.cos(a+j*.65)*.36,end[1]+math.sin(a+j*.65)*.36,end[2]+.36)
            branch(name+"Twig", end, tip, radius*.16, bark)
            ico(name+"Leaves", (tip[0],tip[1],tip[2]+.18),(.49,.43,.34),mats["leaf_light" if i%3==0 else "leaf"],1)
    ico(name+"Leader",(.1,0,height),(.52,.48,.48),mats["leaf_light"],1)


def prop_birch(mats):
    deciduous(mats,"Birch",.14,4.1,.72)


def prop_elm(mats):
    deciduous(mats,"Elm",.24,3.15,1.13)


def prop_pine(mats):
    village.cylinder("PineTrunk", .18, 4.7, (0, 0, 2.35), mats["wood"], 12)
    for i in range(12):
        a=i*2.399;z=1.1+i*.23;r=1.05-i*.055
        branch("PineBough",(0,0,z),(math.cos(a)*r,math.sin(a)*r,z-.17),.05,mats["wood"])
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
    for i,(x,y,z) in enumerate(((-.32,0,.24),(.32,0,.24),(0,0,.70))):
        village.box("HayBale",(.60,.76,.44),(x,y,z),mats["thatch"],.055)
        for offset in (-.20,.20):
            village.box("BaleBinding",(.035,.78,.46),(x+offset,y,z),mats["dark_wood"],.004)


def prop_barrels(mats):
    for x,y in ((-.25,0),(.30,.12)):
        village.cylinder("Barrel",.24,.62,(x,y,.31),mats["wood"],12)
        for z in (.12,.49):
            village.cylinder("IronBand",.249,.035,(x,y,z),mats["iron"],12)


def prop_crates(mats):
    for x,z in ((-.28,.26),(.28,.26),(0,.78)):
        village.box("Crate",(.52,.56,.50),(x,0,z),mats["wood"],.025)
        for side in (-.25,.25):
            village.box("CrateBinding",(.055,.59,.52),(x+side,0,z),mats["dark_wood"],.006)


def prop_bench(mats):
    village.box("BenchSeat",(1.30,.42,.10),(0,0,.46),mats["wood"],.018)
    village.box("BenchBack",(1.30,.07,.34),(0,-.19,.73),mats["wood"],.018)
    # O encosto comeca em z=0,56 e o assento termina em 0,51: ficava flutuando
    # cinco centimetros acima do banco, e banco fica ao nivel dos olhos. Peca
    # propria em vez de reescalar o encosto — reescalar desloca o arredondamento
    # do modelo e mudaria o hash do catalogo, recusando os saves gravados.
    village.box("BenchBrace",(1.24,.07,.09),(0,-.19,.525),mats["wood"],.012)
    for x in (-.48,.48):
        village.box("BenchLeg",(.12,.34,.42),(x,0,.21),mats["dark_wood"],.012)
