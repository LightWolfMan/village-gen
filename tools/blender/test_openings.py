"""Checks authored door hardware and structural beams before material batching."""
import bpy
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import export_models as exporter
import architecture

count = 0
for family in exporter.FAMILIES:
    for variant in range(3 if family in ('cottage', 'townhouse', 'merchant', 'artisan') else 2):
        exporter.reset()
        mats = exporter.palette('temperate')
        if family in ('chapel', 'tower'):
            getattr(exporter, family)(mats, variant)
        else:
            footprint, _ = getattr(architecture, 'build_' + family)(mats)
            architecture.add_architectural_variant(family, variant, footprint, mats)
        architecture.finish_openings(mats)
        bpy.context.view_layer.update()
        objects = list(bpy.context.scene.objects)
        for knob in [o for o in objects if o.name.endswith('Knob')]:
            leaf = bpy.data.objects[knob.name[:-4] + 'Door']
            assert abs(knob.location.x - leaf.location.x) + .035 < leaf.dimensions.x / 2, family
            assert abs(knob.location.z - leaf.location.z) + .035 < leaf.dimensions.z / 2, family
        frames = [o for o in objects if 'DoorFrame' in o.name or 'WindowFrame' in o.name]
        for beam in [o for o in objects if o.name.startswith('OpeningSafeTimber')]:
            for frame in frames:
                overlap = all(abs(beam.location[i] - frame.location[i]) < (beam.dimensions[i] + frame.dimensions[i]) / 2 - .001 for i in range(3))
                assert not overlap, (family, beam.name, frame.name)
        count += 1
print(f'OPENINGS_OK: {count} family/variant combinations; knobs inside leaves, beams clear of frames')
