using System.Text.Json.Nodes;

namespace Village.Core.Simulation;

public sealed record GrowthLot(
    int X, int Y, int Width, int Height, int DoorX, int DoorY, string Orientation,
    string Zone, string AssetId, int Variant, int Level, string FrontageId, int RoadIndex,
    JsonObject Geometry, int[] Cells, JsonObject Model);

/// <summary>
/// Incremental counterpart of <see cref="UrbanPlanner"/>. It reuses the very
/// same frontage/footprint algorithm, one lot at a time, so a house that grows
/// during the simulation lands where the batch planner would have put it.
/// Nothing here moves or repaints existing work: a district with no free
/// frontage simply reports why.
/// </summary>
public sealed class GrowthPlanner
{
    readonly JsonObject map;
    readonly JsonArray models;
    readonly int mapWidth, mapHeight;
    readonly string biome, settlement;
    readonly List<UrbanPlanner.Slot> slots = new();
    readonly HashSet<string> staticReserved = new();
    readonly HashSet<string> usedDoors = new();
    readonly bool[] occupied;
    // Props e mudas ocupam volume mas podem sair; lotes sao permanentes.
    readonly HashSet<int> propCells = new();
    readonly Dictionary<int, int[]> treeCells = new();
    readonly List<JsonObject> buildings = new();
    readonly List<RoadClearance.Corridor> accessCorridors = new();
    readonly Dictionary<string, int> orientationCounts = new() { ["north"] = 0, ["east"] = 0, ["south"] = 0, ["west"] = 0 };

    public string LastReason { get; private set; } = "";
    public int SlotCount => slots.Count;
    /// <summary>How many buildings the planner has on its books, map plus grown.</summary>
    public int RegisteredBuildings => buildings.Count;
    /// <summary>Frontage balance the score uses; a double registration skews it.</summary>
    public int OrientationCount(string orientation) => orientationCounts.GetValueOrDefault(orientation);

    public GrowthPlanner(JsonObject map, JsonArray models)
    {
        this.map = map;
        this.models = models;
        mapWidth = J.I(map, "width");
        mapHeight = J.I(map, "height");
        biome = J.S(map["settings"], "biome");
        settlement = J.S(map["settings"], "settlement");
        occupied = new bool[mapWidth * mapHeight];

        var roads = map["roads"]!.AsArray();
        var at = roads.Select(r => r!.AsObject()).ToDictionary(r => UrbanPlanner.Key(J.I(r, "x"), J.I(r, "y")));
        foreach (var key in at.Keys) staticReserved.Add(key);
        var plaza = map["plaza"]!;
        for (int y = J.I(plaza, "y") - 1; y <= J.I(plaza, "y") + J.I(plaza, "height"); y++)
            for (int x = J.I(plaza, "x") - 1; x <= J.I(plaza, "x") + J.I(plaza, "width"); x++)
                staticReserved.Add(UrbanPlanner.Key(x, y));

        var segments = UrbanPlanner.Segments(map);
        var frontages = UrbanPlanner.Frontages(map, segments);
        var segmentById = segments.ToDictionary(s => J.S(s, "id"));
        foreach (var frontage in frontages)
        {
            var segment = segmentById[J.S(frontage, "segmentId")];
            foreach (int index in UrbanPlanner.Indexes(frontage))
            {
                var source = roads[index]!.AsObject();
                if (J.B(source, "bridge") || J.S(source, "kind") == "plaza") continue;
                if (UrbanPlanner.Mask(source, at) != (J.S(segment, "axis") == "ew" ? 10 : 5)) continue;
                // A door must not open onto a curve, a junction, a bridge or the plaza.
                if (UrbanPlanner.Directions.Any(d => at.TryGetValue(UrbanPlanner.Key(J.I(source, "x") + d.x, J.I(source, "y") + d.y), out var n)
                    && (J.B(n, "bridge") || J.S(n, "kind") == "plaza" || J.I(n, "connections") is not (5 or 10)))) continue;
                var road = (JsonObject)source.DeepClone();
                road["index"] = index;
                slots.Add(new UrbanPlanner.Slot(frontage, segment, road));
            }
        }

        foreach (var lot in map["lots"]!.AsArray()) Occupy(lot!["cells"]!.AsArray());
        foreach (var building in map["buildings"]!.AsArray()) Register(building!.AsObject());
        // Arvores, rochas, poco e carroca ja ocupam chao. O planejador em lote
        // nunca colide com eles porque coloca os props depois; crescendo em
        // etapas e preciso reserva-los explicitamente.
        foreach (var prop in map["props"]!.AsArray()) BlockProp(prop!.AsObject());
    }

    /// <summary>Reserves the rotated footprint a catalog prop really covers.</summary>
    void BlockProp(JsonObject prop)
    {
        string type = J.S(prop, "type");
        string asset = type == "oak" ? new[] { "oak", "birch", "elm" }[J.I(prop, "variant") % 3] : type;
        var model = models.Select(m => m!.AsObject()).FirstOrDefault(m => J.S(m, "id") == "prop:" + asset);
        double cx = J.I(prop, "x") + .5, cy = J.I(prop, "y") + .5;
        if (model?["bounds"] is not JsonNode bounds) { BlockCell(J.I(prop, "x"), J.I(prop, "y"), 0); return; }
        double angle = J.D(prop, "variant") * Math.PI / 3, cos = Math.Cos(angle), sin = Math.Sin(angle);
        double minX = double.PositiveInfinity, minY = minX, maxX = double.NegativeInfinity, maxY = maxX;
        foreach (double bx in new[] { J.Number(bounds["min"]![0]!), J.Number(bounds["max"]![0]!) })
            foreach (double bz in new[] { J.Number(bounds["min"]![2]!), J.Number(bounds["max"]![2]!) })
            {
                double x = cx + bx * cos + bz * sin, y = cy - bx * sin + bz * cos;
                minX = Math.Min(minX, x); maxX = Math.Max(maxX, x);
                minY = Math.Min(minY, y); maxY = Math.Max(maxY, y);
            }
        for (int y = (int)Math.Floor(minY); y <= (int)Math.Ceiling(maxY) - 1; y++)
            for (int x = (int)Math.Floor(minX); x <= (int)Math.Ceiling(maxX) - 1; x++)
                BlockCell(x, y, 0);
    }

    void BlockCell(int x, int y, int radius)
    {
        for (int dy = -radius; dy <= radius; dy++)
            for (int dx = -radius; dx <= radius; dx++)
            {
                int px = x + dx, py = y + dy;
                if (px >= 0 && py >= 0 && px < mapWidth && py < mapHeight) propCells.Add(py * mapWidth + px);
            }
    }

    /// <summary>
    /// Reserves the ground a sapling planted by the simulation stands on. The
    /// cells are tracked per tree, so releasing one never frees ground that a
    /// neighbouring prop also claims.
    /// </summary>
    public void BlockTree(int id, int x, int y)
    {
        var cells = new List<int>();
        for (int dy = -1; dy <= 1; dy++)
            for (int dx = -1; dx <= 1; dx++)
            {
                int px = x + dx, py = y + dy;
                if (px < 0 || py < 0 || px >= mapWidth || py >= mapHeight) continue;
                int index = py * mapWidth + px;
                if (propCells.Add(index)) cells.Add(index);
            }
        treeCells[id] = cells.ToArray();
    }

    /// <summary>Frees exactly the cells that this tree had added, and no others.</summary>
    public void ReleaseTree(int id)
    {
        if (!treeCells.TryGetValue(id, out var cells)) return;
        foreach (int index in cells) propCells.Remove(index);
        treeCells.Remove(id);
    }

    void Occupy(JsonArray cells)
    {
        foreach (var cell in cells)
        {
            int x = J.I(cell, "x"), y = J.I(cell, "y");
            if (x < 0 || y < 0 || x >= mapWidth || y >= mapHeight) continue;
            occupied[y * mapWidth + x] = true;
        }
    }

    void Register(JsonObject building)
    {
        buildings.Add(building);
        if(building["accessPath"] is JsonArray path)for(int i=1;i<path.Count;i++)
            accessCorridors.Add(new(new(J.D(path[i-1],"x"),J.D(path[i-1],"y")),new(J.D(path[i],"x"),J.D(path[i],"y")),.22));
        usedDoors.Add($"{UrbanPlanner.Key(J.I(building["door"], "x"), J.I(building["door"], "y"))}:{J.S(building, "orientation")}");
        string orientation = J.S(building, "orientation");
        if (orientationCounts.ContainsKey(orientation)) orientationCounts[orientation]++;
    }

    static string FamilyFor(string zone, string settlement) => zone switch
    {
        "agricultural" => "farmstead",
        "commercial" => "merchant",
        "craft" => "artisan",
        _ => settlement == "town" ? "townhouse" : "cottage"
    };

    /// <summary>
    /// Finds a free lot for a new house in the district. Returns null and fills
    /// <see cref="LastReason"/> when the district cannot take another building.
    /// </summary>
    public GrowthLot? Propose(string zone, RandomSource random)
    {
        if (zone is not ("residential" or "commercial" or "craft" or "agricultural"))
        {
            LastReason = $"Distrito desconhecido: {zone}.";
            return null;
        }
        string family = FamilyFor(zone, settlement);
        var matching = models.Select(m => m!.AsObject())
            .Where(m => J.S(m, "biome") == biome && J.S(m, "family") == family)
            .ToList();
        if (matching.Count == 0)
        {
            LastReason = $"Sem modelo {family} para o bioma {biome}.";
            return null;
        }
        var zoneSlots = slots.Where(s => J.S(s.Frontage, "zone") == zone).ToList();
        if (zoneSlots.Count == 0)
        {
            LastReason = $"O bairro {Label(zone)} nao tem frente de rua reta disponivel.";
            return null;
        }

        var program = new UrbanPlanner.Program("house", zone, matching);
        // Largest footprint first, compact models as the fallback, mirroring the
        // order the batch planner uses when a district gets tight.
        foreach (var model in matching.OrderByDescending(m => J.I(m["footprint"]!, "width") * J.I(m["footprint"]!, "height")))
        {
            var candidates = new List<UrbanPlanner.Candidate>();
            foreach (var slot in zoneSlots)
            {
                var candidate = UrbanPlanner.MakeCandidate(slot, model, zone, mapWidth);
                if (!UrbanPlanner.Clear(map, staticReserved, candidate, zone)) continue;
                if (usedDoors.Contains($"{UrbanPlanner.Key(candidate.DoorX, candidate.DoorY)}:{candidate.Orientation}")) continue;
                if (candidate.Cells.Any(i => i < 0 || i >= occupied.Length || occupied[i] || propCells.Contains(i))) continue;
                // The batch planner flattens the ground before placing a model.
                // Growing in place cannot reshape the static terrain mesh, so it
                // only accepts a footprint that is already level: no floating
                // corner, and no artificial ramp to hide one.
                if (!IsFlat(candidate.X, candidate.Y, candidate.Width, candidate.Height)) continue;
                if(accessCorridors.Any(c=>RoadClearance.Intersects(c,candidate.X,candidate.Y,candidate.Width,candidate.Height)))continue;
                if (buildings.Any(b => UrbanPlanner.Touches(candidate.X, candidate.Y, candidate.Width, candidate.Height, zone, candidate.Orientation, J.I(b, "x"), J.I(b, "y"), J.I(b, "width"), J.I(b, "height"))
                    || UrbanPlanner.Touches(J.I(b, "x"), J.I(b, "y"), J.I(b, "width"), J.I(b, "height"), J.S(b, "zone"), J.S(b, "orientation"), candidate.X, candidate.Y, candidate.Width, candidate.Height))) continue;
                candidates.Add(candidate with { Score = UrbanPlanner.Score(map, program, candidate, buildings, orientationCounts) });
            }
            if (candidates.Count == 0) continue;
            candidates = candidates.OrderBy(c => c.Score).ThenBy(c => J.I(c.Slot.Road, "index")).ThenBy(c => c.Orientation, StringComparer.Ordinal).ToList();
            var chosen = candidates[random.Int(0, Math.Min(3, candidates.Count - 1))];
            var levels = new List<int>();
            for (int y = chosen.Y; y < chosen.Y + chosen.Height; y++)
                for (int x = chosen.X; x < chosen.X + chosen.Width; x++)
                    levels.Add((int)J.Number(map["heightLevel"]![y * mapWidth + x]));
            levels.Sort();
            LastReason = "";
            return new GrowthLot(chosen.X, chosen.Y, chosen.Width, chosen.Height, chosen.DoorX, chosen.DoorY, chosen.Orientation,
                zone, J.S(model, "id"), J.I(model, "variant"), levels[levels.Count / 2], J.S(chosen.Slot.Frontage, "id"),
                J.I(chosen.Slot.Road, "index"), (JsonObject)chosen.Geometry.DeepClone(), chosen.Cells, model);
        }
        LastReason = $"Sem lote livre junto as ruas do bairro {Label(zone)}.";
        return null;
    }

    /// <summary>Marks a finished lot as taken so the next proposal avoids it.</summary>
    public JsonObject Commit(GrowthLot lot, int number)
    {
        foreach (int cell in lot.Cells)
            if (cell >= 0 && cell < occupied.Length) occupied[cell] = true;
        var entrance = lot.Model["entrance"]!;
        double mx = J.Number(entrance[0]!), my = J.Number(entrance[1]!), mz = J.Number(entrance[2]!);
        double angle = lot.Orientation switch { "east" => Math.PI / 2, "north" => Math.PI, "west" => -Math.PI / 2, _ => 0 };
        double ex = lot.X + lot.Width / 2.0 + mx * Math.Cos(angle) + mz * Math.Sin(angle);
        double ey = lot.Y + lot.Height / 2.0 - mx * Math.Sin(angle) + mz * Math.Cos(angle);
        var building = new JsonObject
        {
            ["id"] = $"sim-building-{number}",
            ["type"] = "house",
            ["x"] = lot.X,
            ["y"] = lot.Y,
            ["width"] = lot.Width,
            ["height"] = lot.Height,
            ["door"] = new JsonObject { ["x"] = lot.DoorX, ["y"] = lot.DoorY },
            ["orientation"] = lot.Orientation,
            ["entranceVisible"] = lot.Orientation is "south" or "east",
            ["baseLevel"] = lot.Level,
            ["zone"] = lot.Zone,
            ["spriteFamily"] = FamilyFor(lot.Zone, settlement),
            ["variant"] = lot.Variant,
            ["assetId"] = lot.AssetId,
            ["frontageId"] = lot.FrontageId,
            ["accessRoadIndex"] = lot.RoadIndex,
            ["entrance"] = new JsonObject { ["x"] = ex, ["y"] = ey, ["level"] = lot.Level + my / .25 },
            ["grownBySimulation"] = true
        };
        Register(building);
        return building;
    }

    bool IsFlat(int x, int y, int width, int height)
    {
        int level = (int)J.Number(map["heightLevel"]![y * mapWidth + x]);
        for (int py = y; py < y + height; py++)
            for (int px = x; px < x + width; px++)
                if ((int)J.Number(map["heightLevel"]![py * mapWidth + px]) != level) return false;
        return true;
    }

    /// <summary>Cells a lot occupies, used by ecology to keep saplings out.</summary>
    public bool IsOccupied(int x, int y) =>
        x < 0 || y < 0 || x >= mapWidth || y >= mapHeight
        || occupied[y * mapWidth + x] || propCells.Contains(y * mapWidth + x);

    static string Label(string zone) => zone switch
    {
        "residential" => "residencial",
        "commercial" => "mercantil",
        "craft" => "de oficinas",
        _ => "agricola"
    };
}
