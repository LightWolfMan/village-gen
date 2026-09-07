using Godot;
using System.Collections.Generic;
using System.Text.Json.Nodes;

namespace Village.Rendering;

/// <summary>
/// Incremental hooks for the simulation module. Everything it creates lives
/// under a single <c>Sim_Root</c> node and is instantiated on its own, so the
/// static MultiMesh batching built by <c>VillageScene.Build</c> is never
/// touched, re-sorted or rebuilt while the village grows.
/// </summary>
public partial class VillageScene
{
    public const string SimulationRootName = "Sim_Root";
    private readonly Dictionary<Node3D, Aabb> simulationObstacles = new();
    private readonly Dictionary<string, JsonObject> completedBuildings = new();
    public event Action? BuildingsChanged;
    private IEnumerable<JsonNode> CurrentBuildings => Items(Map["buildings"]).Concat(completedBuildings.Values);
    public int HouseCount => CurrentBuildings.Count(b=>S(b,"type")=="house");
    public int ServiceCount => CurrentBuildings.Count(b=>S(b,"type")!="house");

    // Runtime overlay, not a mutation of the deterministic generated map.
    public void SimulationRegisterBuilding(JsonObject building)
    {
        string id=S(building,"id");
        if(string.IsNullOrEmpty(id)||completedBuildings.ContainsKey(id)||Items(Map["buildings"]).Any(b=>S(b,"id")==id))return;
        completedBuildings.Add(id,(JsonObject)building.DeepClone());
        BuildingsChanged?.Invoke();
    }
    public void SimulationClearBuildings()
    {
        if(completedBuildings.Count==0)return;
        completedBuildings.Clear();selectionOutline?.Hide();BuildingsChanged?.Invoke();
    }

    /// <summary>The single parent for every node the simulation owns.</summary>
    public Node3D EnsureSimulationRoot()
    {
        var existing = world.GetNodeOrNull<Node3D>(SimulationRootName);
        if (existing != null) return existing;
        var root = new Node3D { Name = SimulationRootName };
        world.AddChild(root);
        return root;
    }

    /// <summary>Terrain height of a tile, already including prepared ground.</summary>
    public float SimulationLevel(int x, int z) => Level(x, z);

    public bool SimulationHasAsset(string assetId) => catalog.ContainsKey(assetId);

    /// <summary>Catalog entries the growth planner picks its models from.</summary>
    public JsonArray SimulationCatalog()
    {
        var models = new JsonArray();
        foreach (var asset in catalog.Values) models.Add(asset.DeepClone());
        return models;
    }

    public Aabb SimulationAssetBounds(string assetId, Transform3D transform) =>
        catalog.ContainsKey(assetId) ? AssetBounds(assetId, transform) : new Aabb();

    public static Transform3D SimulationPose(float x, float y, float z, string orientation) => Pose(x, y, z, Angle(orientation));

    /// <summary>
    /// Instantiates a catalog model as its own node. Used when a building site
    /// finishes: the finished house is the real GLB, not a scaled placeholder.
    /// </summary>
    public Node3D? SimulationInstantiate(string assetId, Transform3D transform, Node3D parent, string name)
    {
        if (!catalog.TryGetValue(assetId, out var asset)) return null;
        string path = "res://" + S(asset, "src").TrimStart('/');
        var scene = ResourceLoader.Load<PackedScene>(path);
        if (scene == null) return null;
        var node = scene.Instantiate<Node3D>();
        node.Name = name;
        node.Transform = transform;
        parent.AddChild(node);
        return node;
    }

    /// <summary>
    /// Registers a solid volume owned by the simulation. The body is parented to
    /// the simulation node so it disappears together with what it represents;
    /// leaving an invisible obstacle behind would break walking.
    /// </summary>
    public StaticBody3D SimulationAddObstacle(Node3D owner, Aabb box, string name)
    {
        // One volume per owner: a site that changes stage replaces its own box
        // instead of stacking a second one that nothing would ever remove.
        SimulationRemoveObstacle(owner);
        var previous = owner.GetNodeOrNull<StaticBody3D>(name);
        if (previous != null) { owner.RemoveChild(previous); previous.QueueFree(); }
        var body = new StaticBody3D { Name = name };
        body.AddChild(new CollisionShape3D { Shape = new BoxShape3D { Size = box.Size } });
        owner.AddChild(body);
        // The box is in world space and the body is a child of the owner, so the
        // owner transform is removed exactly once. Subtracting the global origin
        // and adding the local one back counted that offset twice, which left
        // the trunk without collision and an invisible wall somewhere else.
        body.Position = owner.ToLocal(box.GetCenter());
        obstacles.Add(box);
        simulationObstacles[owner] = box;
        return body;
    }

    /// <summary>Drops the walking obstacle a simulation node had registered.</summary>
    public void SimulationRemoveObstacle(Node3D owner)
    {
        if (!simulationObstacles.TryGetValue(owner, out var box)) return;
        obstacles.Remove(box);
        simulationObstacles.Remove(owner);
    }

    /// <summary>Clears every obstacle the simulation registered, before disposal.</summary>
    public void SimulationClearObstacles()
    {
        foreach (var box in simulationObstacles.Values) obstacles.Remove(box);
        simulationObstacles.Clear();
    }

    /// <summary>Grows the walkable bounds so a new house stays inside the map box.</summary>
    public void SimulationMergeBounds(Aabb box)
    {
        VillageBounds = VillageBounds.Merge(box);
        MapBounds = MapBounds.Merge(box);
    }
}
