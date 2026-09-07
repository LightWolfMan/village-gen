"""Pure building design contract, resolved before any Blender geometry exists."""
from dataclasses import dataclass


@dataclass(frozen=True)
class BuildingProfile:
    biome: str
    roof_style: str
    roof_scale: float
    minimum_overhang: float
    floor_lift: float

    @classmethod
    def for_biome(cls, biome):
        return {
            'temperate': cls('temperate', 'gable', 1, 0, 0),
            'arid': cls('arid', 'flat', 1, 0, 0),
            'snowy': cls('snowy', 'gable', 1.38, 0, 0),
            'wetland': cls('wetland', 'gable', 1.15, .30, .7),
        }[biome]

    def roof(self, width, depth, wall_top, rise, overhang):
        if min(width, depth, rise) <= 0:
            raise ValueError('Roof dimensions must be positive')
        return RoofPlan(self.roof_style, width, depth, wall_top,
                        .22 if self.roof_style == 'flat' else rise*self.roof_scale,
                        max(overhang, self.minimum_overhang))


@dataclass(frozen=True)
class RoofPlan:
    style: str
    width: float
    depth: float
    wall_top: float
    rise: float
    overhang: float

    @property
    def apex(self):
        return self.wall_top+self.rise

    def surface(self, y):
        """Authored roof surface at local Y; Blender uses Z as vertical."""
        if abs(y) > self.depth/2+self.overhang+1e-8:
            raise ValueError('Attachment outside roof coverage')
        if self.style == 'flat':
            return self.apex
        return self.wall_top+self.rise*(1-abs(y)/(self.depth/2+self.overhang))
