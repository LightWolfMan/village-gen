"""Village 4: exporta modelos originais GLB e catálogo medido, sem rasterização."""
from pathlib import Path
import sys
import json
import math
import argparse
import bpy
from mathutils import Vector, Matrix

sys.path.insert(0, str(Path(__file__).resolve().parent))
import architecture
import environment_models as environment
from building_contract import BuildingProfile

FAMILIES = ('cottage', 'townhouse', 'workshop', 'civic', 'farmstead', 'inn',
            'shop', 'merchant', 'artisan', 'smithy', 'market', 'mill', 'chapel', 'tower')
BIOMES = ('temperate', 'arid', 'snowy', 'wetland')


def reset():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)


def bridge(role, mats):
    architecture.box('BridgeDeck', (1, .88, .15), (0, 0, .075), mats['bridge'], 0)
    for x in (-.4, -.2, 0, .2, .4):
        architecture.box('Plank', (.185, .84, .035), (x, 0, .165), mats['bridge_light'], .005)
    for side in (-.42, .42):
        architecture.box('ContinuousRail', (1, .06, .08), (0, side, .66), mats['dark_wood'], 0)
        positions = ([-.46] if role == 'start' else [.46] if role == 'end' else
                     [-.46, .46] if role == 'single' else [0] if role == 'post' else [])
        for x in positions:
            architecture.box('RailPost', (.07, .07, .65), (x, side, .325), mats['dark_wood'], .005)
    for x in ([-.42] if role == 'start' else [.42] if role == 'end' else [-.42, .42] if role == 'single' else []):
        architecture.box('StoneAbutment', (.16, .96, .12), (x, 0, .06), mats['fieldstone'], .015)


def chapel(mats, variant):
    architecture.common_shell('Chapel', 3.2, 4.2, 1, mats['light_stone'], mats['slate'], mats, 1.65)
    architecture.box('BellTower', (1.1, 1.1, 3.9), (-.95, 1.25, 1.95), mats['warm_stone'])
    cap = mats.roof('BellRoof', 1.2, 1.2, 3.9, .9, mats['slate'])
    cap.location.x = -.95
    cap.location.y = 1.25
    architecture.box('CrossVertical', (.10, .10, .65), (-.95, 1.25, 5.05), mats['brass'])
    architecture.box('CrossArms', (.43, .10, .10), (-.95, 1.25, 5.12), mats['brass'])
    if variant:
        architecture.box('Vestry', (1.4, 2.2, 1.5), (1.65, -.3, .75), mats['light_stone'])
        roof = mats.roof('VestryRoof', 1.5, 2.3, 1.5, .7, mats['slate'])
        roof.location.x = 1.65
    return (4, 5), (.608, 2.1, 0)


def tower(mats, variant):
    architecture.common_shell('Tower', 2.5, 2.5, 3, mats['fieldstone'], mats['slate'], mats, 1.0)
    for x in (-1.25, 1.25):
        for y in (-1.25, 1.25):
            architecture.box('Buttress', (.38, .38, 2.2), (x, y, 1.1), mats['warm_stone'])
    if variant:
        architecture.box('WatchGallery', (3.25, 3.25, .22), (0, 0, 3.15), mats['wood'])
        for x in (-1.5, 1.5):
            architecture.box('WatchRail', (.10, 3.1, .1), (x, 0, 3.85), mats['dark_wood'])
            # O corrimao pairava 0,54 acima do piso da galeria, sem nada segurando.
            for y in (-1.35, 0, 1.35):
                architecture.box('WatchBaluster', (.08, .08, .64), (x, y, 3.58), mats['dark_wood'], .01)
    return (4, 4), (.475, 1.25, 0)


def palette(biome):
    mats = environment.extra_palette(architecture.palette())
    if biome == 'arid':
        for key in ('plaster', 'cream', 'fieldstone', 'wood', 'warm_stone'):
            mats[key] = architecture.material('Adobe ' + key, (.69, .43, .24, 1))
        mats['dark_wood'] = architecture.material('Palm beams', (.31, .21, .12, 1))
    if biome == 'wetland':
        mats['plaster'] = mats['wood']
        mats['cream'] = architecture.material('Weathered planks', (.39, .38, .25, 1))
    return architecture.BuildingContext(mats, BuildingProfile.for_biome(biome))


CONTATO = .02
# Apoio vertical: depois de erguer a casa ele tem de continuar chegando ao chao,
# senao vira exatamente o defeito relatado — madeira terminando no ar.
SWAMP_SUPPORTS = ('Post', 'Column', 'Leg', 'PorchBase', 'Buttress')


def _world_box(obj):
    pontos = [obj.matrix_world @ Vector(v) for v in obj.bound_box]
    return ([min(p[i] for p in pontos) for i in range(3)],
            [max(p[i] for p in pontos) for i in range(3)])


def _encostam(a, b, tolerancia=CONTATO):
    return all(min(a[1][i], b[1][i]) - max(a[0][i], b[0][i]) >= -tolerancia for i in range(3))


def raise_swamp(mats, door):
    """Ergue a construcao sobre palafitas sem deixar peca alguma no ar.

    Quem sobe e quem fica sai do proprio desenho, nao de uma lista de nomes:
    pecas que se tocam formam um conjunto; o conjunto da casa sobe, e um
    conjunto solto que ja vivia no chao — barril com seus arcos, bigorna com o
    tampo, banco com os pes — fica onde estava. Erguer so as pecas que tocavam
    o solo separava barril de arco e bigorna de tampo; erguer tudo deixava
    caixote boiando ao lado da palafita.
    """
    lift = mats.profile.floor_lift
    bpy.context.view_layer.update()
    objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    caixas = [_world_box(obj) for obj in objects]
    pai = list(range(len(objects)))

    def raiz(i):
        while pai[i] != i:
            pai[i] = pai[pai[i]]
            i = pai[i]
        return i

    for i in range(len(objects)):
        for j in range(i + 1, len(objects)):
            if _encostam(caixas[i], caixas[j]):
                pai[raiz(i)] = raiz(j)
    grupos = {}
    for i in range(len(objects)):
        grupos.setdefault(raiz(i), []).append(i)
    casa = next((raiz(i) for i, obj in enumerate(objects) if 'Foundation' in obj.name), None)
    if casa is None:
        casa = max(grupos, key=lambda g: sum((caixas[i][1][2] - caixas[i][0][2]) for i in grupos[g]))

    lo = [min(caixa[0][i] for caixa in caixas) for i in range(3)]
    hi = [max(caixa[1][i] for caixa in caixas) for i in range(3)]

    apoios = []
    for grupo, indices in grupos.items():
        base = min(caixas[i][0][2] for i in indices)
        if grupo != casa and base < .05:
            continue
        for i in indices:
            objects[i].location.z += lift
            if caixas[i][0][2] < .05 and any(k in objects[i].name for k in SWAMP_SUPPORTS):
                apoios.append(i)
    # Prolonga por baixo com uma peca propria em vez de reescalar a existente:
    # mexer na escala de um objeto ja aplicado desloca o arredondamento do modelo
    # inteiro, mudaria o hash do catalogo e recusaria os saves gravados.
    for i in apoios:
        largura = objects[i].dimensions.copy()
        centro = objects[i].matrix_world.translation.copy()
        material = objects[i].data.materials[0] if objects[i].data.materials else mats['dark_wood']
        altura = lift + .03
        if largura.x * largura.y > .25:
            # Plinto largo vira dois pilotis de madeira, nao um bloco macico: sob
            # palafita o vao aberto e o proprio desenho, e um paredao de pedra
            # embaixo da casa desfaz isso.
            eixo_x = largura.x >= largura.y
            recuo = (largura.x if eixo_x else largura.y) / 2 - .16
            for sinal in (-1, 1):
                architecture.box('StiltSupport', (.16, .16, altura),
                                 (centro.x + (recuo * sinal if eixo_x else 0),
                                  centro.y + (0 if eixo_x else recuo * sinal),
                                  altura / 2), mats['dark_wood'], .012)
        else:
            architecture.box('StiltSupport', (largura.x, largura.y, altura),
                             (centro.x, centro.y, altura / 2), material, .012)
    for x in (lo[0] + .3, hi[0] - .3):
        for y in (lo[1] + .3, hi[1] - .3):
            architecture.box('StiltSupport', (.18, .18, lift+.12), (x, y, (lift+.12)/2), mats['dark_wood'])
    # Front approach remains inside the measured footprint and leads to the raised floor.
    threshold = door[2] + lift
    for step in range(4):
        height = threshold * (step + 1) / 4
        architecture.box('EntranceStep', (.8, .23, height),
                         (door[0], door[1] + .92 - step * .23, height / 2), mats['wood'], .01)
    return (door[0], door[1], threshold)


def threshold(mats, door):
    # Top meets the door leaf exactly. This stays under the existing roof overhang.
    architecture.box('AccessibleThreshold', (.70, .22, .08),
                     (door[0], door[1] + .11, door[2] - .04), mats['light_stone'], .008)
    return (door[0], door[1] + .18, door[2])


# Peca que nao encosta no chao nem repousa sobre outra fica suspensa. O defeito
# relatado — madeira e apoios no ar — so e visivel objeto a objeto, e depois da
# juncao por material a informacao some. Por isso a verificacao mora aqui.
SUSPENSO_TOLERANCIA = .02


def audit_supports(asset_id):
    bpy.context.view_layer.update()
    caixas = []
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH':
            continue
        pontos = [obj.matrix_world @ Vector(v) for v in obj.bound_box]
        caixas.append((obj.name,
                       [min(p[i] for p in pontos) for i in range(3)],
                       [max(p[i] for p in pontos) for i in range(3)]))
    suspensos = []
    for nome, lo, hi in caixas:
        if lo[2] <= SUSPENSO_TOLERANCIA:
            continue
        apoiado = False
        for outro, olo, ohi in caixas:
            if outro == nome and olo == lo and ohi == hi:
                continue
            # Contato em 3D, nao so empilhamento: um caixilho encostado na parede
            # esta presa nela, ainda que nada esteja embaixo. Suspenso mesmo e o
            # que nao toca em nada.
            if all(min(hi[i], ohi[i]) - max(lo[i], olo[i]) >= -SUSPENSO_TOLERANCIA for i in range(3)):
                apoiado = True
                break
        if not apoiado:
            suspensos.append((nome, round(lo[2], 3)))
    if suspensos:
        print(f'SUSPENSO {asset_id}: ' + ', '.join(f'{n}@{z}' for n, z in sorted(set(suspensos))))
    return suspensos


def export(output, asset_id, door=(0, 0, 0), **metadata):
    bpy.context.view_layer.update()
    suspended = audit_supports(asset_id)
    unexpected = [(name, z) for name, z in suspended
                  if not (asset_id == 'bridge:middle' and name.startswith('ContinuousRail'))]
    if unexpected:
        raise RuntimeError(f'Unsupported geometry in {asset_id}: {unexpected}')
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    # Bake modifiers once, then join by material so repeated instances have few draw calls.
    for obj in meshes:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        for mod in list(obj.modifiers):
            bpy.ops.object.modifier_apply(modifier=mod.name)
        obj.select_set(False)
    coords = [obj.matrix_world @ v.co for obj in meshes for v in obj.data.vertices]
    low = [min(v[i] for v in coords) for i in range(3)]
    high = [max(v[i] for v in coords) for i in range(3)]
    center = Vector(((low[0] + high[0]) / 2, (low[1] + high[1]) / 2, low[2]))
    angle = 0 if metadata.get('kind') == 'bridge' else math.pi
    transform = Matrix.Rotation(angle, 4, 'Z') @ Matrix.Translation(-center)
    for obj in meshes:
        obj.matrix_world = transform @ obj.matrix_world
    door = transform @ Vector(door)
    roof_anchors = []
    for obj in meshes:
        if 'vg_apex' not in obj:
            continue
        def anchor(key):
            p = obj.matrix_world @ Vector(obj[key])
            return [p.x, p.z, -p.y]
        roof_anchors.append(dict(name=obj.name, style=obj['vg_roof_style'],
                                 wallTop=anchor('vg_wall_top'), apex=anchor('vg_apex')))
    if metadata.get('kind') == 'building':
        metadata['anchors'] = dict(ground=[0, 0, 0], floor=door.z, roofs=roof_anchors)
    groups = {}
    for obj in meshes:
        key = obj.data.materials[0].name if obj.data.materials else 'default'
        groups.setdefault(key, []).append(obj)
    for key, objects in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        if len(objects) > 1:
            bpy.ops.object.join()
        objects[0].name = key
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.select_all(action='SELECT')
    filename = asset_id.replace(':', '-') + '.glb'
    bpy.ops.export_scene.gltf(filepath=str(output / filename), export_format='GLB',
                              use_selection=True, export_animations=False, export_cameras=False,
                              export_lights=False, export_apply=True, export_yup=True)
    width, depth, height = high[0] - low[0], high[1] - low[1], high[2] - low[2]
    return dict(id=asset_id, src='/assets/models/' + filename,
                footprint=dict(width=math.ceil(width - 1e-6), height=math.ceil(depth - 1e-6)),
                bounds=dict(min=[-width / 2, 0, -depth / 2], max=[width / 2, height, depth / 2]),
                height=height, entrance=[door.x, door.z, -door.y],
                rotations=[0, 90, 180, 270], **metadata)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default=str(Path(__file__).resolve().parents[2] / 'assets/models'))
    parser.add_argument('--bridges-only', action='store_true')
    parser.add_argument('--props-only', action='store_true')
    parser.add_argument('--sample', help='Export one biome:family:variant for validation, without modifying catalog')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    entries, props, bridges = [], [], []
    if args.bridges_only or args.props_only:
        previous = json.loads((output / 'catalog.json').read_text(encoding='utf-8'))
        entries, props = previous['entries'], [] if args.props_only else previous['props']
    for biome in (() if args.bridges_only or args.props_only else BIOMES):
        for family in FAMILIES:
            for variant in range(6 if family=='cottage' else 4 if family in ('townhouse', 'merchant', 'artisan', 'farmstead') else 2):
                if args.sample and args.sample != f'{biome}:{family}:{variant}':
                    continue
                reset()
                mats = palette(biome)
                if family in ('chapel', 'tower'):
                    footprint, door = globals()[family](mats, variant)
                else:
                    footprint, door = getattr(architecture, 'build_' + family)(mats)
                    architecture.add_architectural_variant(family, variant, footprint, mats)
                architecture.finish_openings(mats)
                door = (door[0], door[1], .18 if family == 'market' else .28)
                if mats.profile.floor_lift:
                    door = raise_swamp(mats, door)
                door = threshold(mats, door)
                entries.append(export(output, f'{biome}:{family}:{variant}', door,
                                      kind='building', biome=biome, family=family, variant=variant,
                                      construction=dict(version=1, roofStyle=mats.profile.roof_style,
                                                        floorLift=mats.profile.floor_lift)))
    if args.sample:
        print(json.dumps(entries, indent=2))
        return
    for name in (() if args.bridges_only else ('oak', 'birch', 'elm', 'pine', 'cactus', 'willow', 'rock', 'bush', 'reeds', 'well', 'cart', 'haystack', 'barrels', 'crates', 'bench')):
        reset()
        getattr(environment, 'prop_' + name)(palette('temperate'))
        props.append(export(output, 'prop:' + name, kind='prop', type=name))
    for role in ('single', 'start', 'middle', 'post', 'end'):
        reset()
        bridge(role, palette('temperate'))
        bridges.append(export(output, 'bridge:' + role, kind='bridge', role=role, axis='x'))
    catalog = dict(schemaVersion=1, unitsPerTile=1, entries=entries, props=props, bridges=bridges)
    (output / 'catalog.json').write_text(json.dumps(catalog, indent=2) + '\n', encoding='utf-8')
    js = '// Generated by tools/blender/export_models.py. Geometry dimensions in tile units.\n'
    for name, values in [('MODEL_CATALOG', entries), ('PROP_CATALOG', props), ('BRIDGE_CATALOG', bridges)]:
        js += f'export const {name} = ' + json.dumps(values, separators=(',', ':')) + ';\n'
    js += 'export const MODEL_BY_ID = Object.fromEntries([...MODEL_CATALOG, ...PROP_CATALOG, ...BRIDGE_CATALOG].map(entry => [entry.id, entry]));\n'
    (output / 'catalog.js').write_text(js, encoding='utf-8')
    print(f'Village 4: {len(entries)} buildings, {len(props)} props, {len(bridges)} bridge modules exported.')


if __name__ == '__main__':
    main()
