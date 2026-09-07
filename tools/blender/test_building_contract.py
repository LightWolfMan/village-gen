"""Run with Blender --background --python-exit-code 1 --python this_file."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from building_contract import BuildingProfile


class ContractTests(unittest.TestCase):
    def test_each_profile_resolves_before_geometry(self):
        for biome in ('temperate', 'arid', 'snowy', 'wetland'):
            profile = BuildingProfile.for_biome(biome)
            roof = profile.roof(3.5, 2.65, 2.92, 1.05, .22)
            self.assertAlmostEqual(roof.surface(0), roof.apex)
            self.assertEqual(profile.floor_lift, .7 if biome == 'wetland' else 0)
            expected = roof.apex if biome == 'arid' else roof.wall_top
            self.assertAlmostEqual(roof.surface(roof.depth/2+roof.overhang), expected)

    def test_attachments_follow_actual_roof(self):
        for biome in ('temperate', 'arid', 'snowy', 'wetland'):
            profile = BuildingProfile.for_biome(biome)
            roof = profile.roof(3.5, 2.65, 2.92, 1.05, .22)
            support = roof.surface(2.65*.25+.19)-.03
            cap = profile.roof(.78, .54, support+.58, .35, .08)
            self.assertAlmostEqual(cap.wall_top, support+.58)
            self.assertGreater(cap.apex, cap.wall_top)
            if biome == 'arid': self.assertAlmostEqual(support, 3.11)

    def test_invalid_coverage_is_not_silently_clamped(self):
        with self.assertRaises(ValueError):
            BuildingProfile.for_biome('temperate').roof(3, 2, 1, 1, .2).surface(5)
        with self.assertRaises(KeyError): BuildingProfile.for_biome('unknown')
        with self.assertRaises(ValueError): BuildingProfile.for_biome('arid').roof(0, 2, 1, 1, .2)

    def test_export_blocks_unsupported_geometry(self):
        import export_models as exporter
        import architecture
        exporter.reset()
        mats = exporter.palette('temperate')
        architecture.box('DeliberatelyFloating', (1, 1, 1), (0, 0, 5), mats['wood'])
        with self.assertRaisesRegex(RuntimeError, 'Unsupported geometry'):
            exporter.export(Path(__file__).resolve().parent, 'test:floating', kind='building')


result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(ContractTests))
if not result.wasSuccessful(): raise RuntimeError('Building contract tests failed')
