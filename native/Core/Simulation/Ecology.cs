using System.Text.Json.Nodes;

namespace Village.Core.Simulation;

public enum TreeStage { Sapling, Adult, Dead }

public sealed class SimTree
{
    public int Id;
    public int X, Y, Level;
    public int Variant;
    public TreeStage Stage;
    public int StepsInStage;
    public bool Removed;
}

/// <summary>
/// Tree life cycle for the trees the simulation plants itself.
///
/// The trees baked into the generated map belong to the static batches and to
/// their own colliders in <c>VillageScene</c>; removing one of those would mean
/// touching the shared batching, so they are left untouched. Every tree handled
/// here is created by the simulation, owns its own mesh and collider, and is
/// destroyed with both when it dies. A sapling never lands on a road, a lot, an
/// access tile, water or an existing prop.
/// </summary>
public sealed class Ecology
{
    public static readonly int[] StageSteps = [420, 900];

    readonly JsonObject map;
    readonly GrowthPlanner planner;
    readonly RandomSource random;
    readonly int width, height;
    readonly HashSet<int> blocked = new();
    readonly List<SimTree> trees = new();
    readonly string species;
    int nextId = 1;

    public IReadOnlyList<SimTree> Trees => trees;
    public int Alive => trees.Count(t => !t.Removed);
    public int MaxTrees { get; set; } = 18;

    public Ecology(JsonObject map, GrowthPlanner planner, RandomSource random)
    {
        this.map = map;
        this.planner = planner;
        this.random = random;
        width = J.I(map, "width");
        height = J.I(map, "height");
        species = J.S(map["settings"], "biome") switch
        {
            "arid" => "cactus",
            "snowy" => "pine",
            "wetland" => "willow",
            _ => "oak"
        };

        // Roads own their whole corridor, exactly like the batch prop placement.
        foreach (var road in map["roads"]!.AsArray())
            Block(J.I(road, "x"), J.I(road, "y"), 1);
        var plaza = map["plaza"]!;
        for (int y = J.I(plaza, "y") - 1; y <= J.I(plaza, "y") + J.I(plaza, "height"); y++)
            for (int x = J.I(plaza, "x") - 1; x <= J.I(plaza, "x") + J.I(plaza, "width"); x++)
                Block(x, y, 0);
        foreach (var building in map["buildings"]!.AsArray())
        {
            for (int y = J.I(building, "y") - 1; y <= J.I(building, "y") + J.I(building, "height"); y++)
                for (int x = J.I(building, "x") - 1; x <= J.I(building, "x") + J.I(building, "width"); x++)
                    Block(x, y, 0);
            if (building!["entrance"] is JsonNode entrance)
                Block((int)Math.Floor(J.D(entrance, "x")), (int)Math.Floor(J.D(entrance, "y")), 1);
        }
        foreach (var prop in map["props"]!.AsArray())
            Block(J.I(prop, "x"), J.I(prop, "y"), 1);
    }

    void Block(int x, int y, int radius)
    {
        for (int dy = -radius; dy <= radius; dy++)
            for (int dx = -radius; dx <= radius; dx++)
            {
                int px = x + dx, py = y + dy;
                if (px >= 0 && py >= 0 && px < width && py < height) blocked.Add(py * width + px);
            }
    }

    /// <summary>Blocks the footprint of a house the simulation just finished.</summary>
    public void BlockBuilding(GrowthLot lot)
    {
        for (int y = lot.Y - 1; y <= lot.Y + lot.Height; y++)
            for (int x = lot.X - 1; x <= lot.X + lot.Width; x++)
                Block(x, y, 0);
    }

    public bool IsPlantable(int x, int y)
    {
        if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) return false;
        int level = (int)J.Number(map["heightLevel"]![y * width + x]);
        for (int dy = -1; dy <= 1; dy++)
            for (int dx = -1; dx <= 1; dx++)
            {
                int px = x + dx, py = y + dy, index = py * width + px;
                if (blocked.Contains(index)) return false;
                if (planner.IsOccupied(px, py)) return false;
                if (map["terrain"]![index]!.GetValue<string>() == "water") return false;
                if ((int)J.Number(map["heightLevel"]![index]) != level) return false;
            }
        return trees.All(t => t.Removed || Math.Max(Math.Abs(t.X - x), Math.Abs(t.Y - y)) > 2);
    }

    /// <summary>Plants a sapling on a safe cell. Returns null when none is free.</summary>
    public SimTree? Plant()
    {
        if (Alive >= MaxTrees) return null;
        for (int attempt = 0; attempt < 120; attempt++)
        {
            int x = random.Int(2, width - 3), y = random.Int(2, height - 3);
            if (!IsPlantable(x, y)) continue;
            var tree = new SimTree
            {
                Id = nextId++,
                X = x,
                Y = y,
                Level = (int)J.Number(map["heightLevel"]![y * width + x]),
                Variant = random.Int(0, 5),
                Stage = TreeStage.Sapling
            };
            trees.Add(tree);
            // A muda tambem e obstaculo: sem reservar o chao, uma obra futura
            // poderia nascer exatamente em cima dela.
            planner.BlockTree(tree.Id, x, y);
            return tree;
        }
        return null;
    }

    /// <summary>
    /// One fixed step. Returns the trees whose stage changed and the ones that
    /// must be destroyed, so the renderer can drop mesh and collider together.
    /// </summary>
    public (List<SimTree> Changed, List<SimTree> Removed) Step()
    {
        var changed = new List<SimTree>();
        var removed = new List<SimTree>();
        foreach (var tree in trees)
        {
            if (tree.Removed) continue;
            tree.StepsInStage++;
            if (tree.Stage == TreeStage.Dead)
            {
                if (tree.StepsInStage < StageSteps[1] / 3) continue;
                tree.Removed = true;
                planner.ReleaseTree(tree.Id);
                removed.Add(tree);
                continue;
            }
            if (tree.StepsInStage < StageSteps[(int)tree.Stage]) continue;
            tree.StepsInStage = 0;
            tree.Stage = (TreeStage)((int)tree.Stage + 1);
            changed.Add(tree);
        }
        trees.RemoveAll(t => t.Removed);
        return (changed, removed);
    }

    public string Species => species;
}
