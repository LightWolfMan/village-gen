using Godot;
using System.Text.Json.Nodes;
using Village.Core.Simulation;
using Village.Rendering;

namespace Village.Simulation;

/// <summary>
/// Godot side of the growth simulation. It owns every node it creates under
/// <c>Sim_Root</c>, updates only what changed on each step and never rebuilds
/// the static world. All state is in memory: regenerating the map or closing
/// the application discards the progress.
/// </summary>
public sealed class VillageSimulation : IVillageSimulation
{
    readonly VillageScene scene;
    readonly VillageSimulationModel model;
    readonly SimulationVisuals visuals = new();
    readonly Node3D root;
    readonly Node3D sites;
    readonly Node3D flora;
    readonly Dictionary<int, Node3D> siteNodes = new();
    readonly Dictionary<int, BuildStage> siteStages = new();
    readonly Dictionary<int, Node3D> treeNodes = new();
    readonly MultiMeshInstance3D people;
    readonly MultiMeshInstance3D[] personParts;
    readonly MultiMeshInstance3D carts;
    readonly MultiMeshInstance3D wheels;
    bool disposed;

    public VillageSimulation(VillageScene scene, JsonObject map, VillageSimulationModel? restored=null)
    {
        this.scene = scene;
        model = restored??new VillageSimulationModel(map, scene.SimulationCatalog(), map["seed"]?.GetValue<string>() ?? "");
        root = scene.EnsureSimulationRoot();
        sites = new Node3D { Name = "Sim_Sites" };
        flora = new Node3D { Name = "Sim_Flora" };
        root.AddChild(sites);
        root.AddChild(flora);
        people = Crowd("Sim_People", visuals.Body, visuals.Cloth, model.Agents.Count(a => a.Kind == AgentKind.Person));
        int population=model.Agents.Count(a=>a.Kind==AgentKind.Person);
        personParts=new[]{people,Crowd("Sim_Heads",visuals.Head,visuals.Skin,population),
            Crowd("Sim_LeftArms",visuals.Arm,visuals.Cloth,population),Crowd("Sim_RightArms",visuals.Arm,visuals.Cloth,population),
            Crowd("Sim_LeftLegs",visuals.Leg,visuals.Bark,population),Crowd("Sim_RightLegs",visuals.Leg,visuals.Bark,population)};
        carts = Crowd("Sim_Carts", visuals.Box, visuals.Timber, model.Agents.Count(a => a.Kind == AgentKind.Cart));
        wheels = Crowd("Sim_CartWheels", visuals.Trunk, visuals.Bark, model.Agents.Count(a => a.Kind == AgentKind.Cart) * 2);
        SyncAgents();
        if(restored!=null){
            foreach(var site in model.Sites){if(site.IsComplete)CompleteSite(site);else {DrawSite(site);GrowSite(site);}}
            foreach(var tree in model.Trees)DrawTree(tree);
            PeopleEnabled=model.PeopleEnabled;VehiclesEnabled=model.VehiclesEnabled;
        }
    }

    MultiMeshInstance3D Crowd(string name, Mesh mesh, Material material, int count)
    {
        var instance = new MultiMeshInstance3D
        {
            Name = name,
            MaterialOverride = material,
            CastShadow = GeometryInstance3D.ShadowCastingSetting.On,
            Multimesh = new MultiMesh
            {
                TransformFormat = MultiMesh.TransformFormatEnum.Transform3D,
                Mesh = mesh,
                InstanceCount = Math.Max(count, 1)
            }
        };
        instance.Multimesh.VisibleInstanceCount = count;
        root.AddChild(instance);
        return instance;
    }

    public double Speed { get => model.Speed; set => model.Speed = value; }
    public bool PeopleEnabled { get => model.PeopleEnabled; set { model.PeopleEnabled = value; foreach(var part in personParts)part.Visible=value; } }
    public bool VehiclesEnabled { get => model.VehiclesEnabled; set { model.VehiclesEnabled = value; carts.Visible = value; wheels.Visible = value; } }
    public bool EcologyEnabled { get => model.EcologyEnabled; set => model.EcologyEnabled = value; }
    public string StatusText => model.StatusText;
    public JsonObject CaptureState()=>model.CaptureState();
    public bool IsRunning => !disposed && model.IsRunning;

    public bool QueueGrowth(string zone) => !disposed && model.QueueGrowth(zone);

    public void Advance(double realDeltaSeconds)
    {
        if (disposed) return;
        foreach (var change in model.Advance(realDeltaSeconds))
        {
            switch (change.Kind)
            {
                case SimulationEventKind.SiteStarted:
                case SimulationEventKind.SiteStageChanged:
                    DrawSite(change.Site!);
                    break;
                case SimulationEventKind.SiteCompleted:
                    CompleteSite(change.Site!);
                    break;
                case SimulationEventKind.TreePlanted:
                case SimulationEventKind.TreeStageChanged:
                    DrawTree(change.Tree!);
                    break;
                case SimulationEventKind.TreeRemoved:
                    RemoveTree(change.Tree!);
                    break;
            }
        }
        // The current stage keeps growing between stage changes, so the work
        // reads as continuous progress instead of four sudden jumps.
        foreach (var site in model.Sites)
            if (!site.IsComplete && siteStages.TryGetValue(site.Number, out var drawn) && drawn == site.Stage)
                GrowSite(site);
        SyncAgents();
    }

    float Ground(float x, float z, int level) => scene.SurfaceHeight(x, z) ?? level * VillageScene.LevelHeight;

    Node3D SiteNode(ConstructionSite site)
    {
        if (siteNodes.TryGetValue(site.Number, out var existing)) return existing;
        var lot = site.Lot;
        var node = new Node3D
        {
            Name = $"Sim_Site_{site.Number}",
            Position = new Vector3(lot.X + lot.Width / 2f, lot.Level * VillageScene.LevelHeight, lot.Y + lot.Height / 2f)
        };
        sites.AddChild(node);
        siteNodes[site.Number] = node;
        return node;
    }

    static void Clear(Node3D node)
    {
        foreach (var child in node.GetChildren()) { node.RemoveChild(child); child.QueueFree(); }
    }

    void DrawSite(ConstructionSite site)
    {
        var node = SiteNode(site);
        Clear(node);
        siteStages[site.Number] = site.Stage;
        var lot = site.Lot;
        float w = lot.Width, d = lot.Height;

        if (site.Stage >= BuildStage.Marking)
        {
            // Marcacao: estacas nos cantos e corda entre elas.
            foreach (int sx in new[] { -1, 1 })
                foreach (int sz in new[] { -1, 1 })
                    node.AddChild(visuals.Part(visuals.Box, visuals.Stake,
                        new Vector3(sx * (w / 2 - .12f), .25f, sz * (d / 2 - .12f)), new Vector3(.07f, .5f, .07f),
                        rises: site.Stage == BuildStage.Marking));
            foreach (var (px, pz, sw, sd) in new[]
            {
                (0f, -(d / 2 - .12f), w - .24f, .03f), (0f, d / 2 - .12f, w - .24f, .03f),
                (-(w / 2 - .12f), 0f, .03f, d - .24f), (w / 2 - .12f, 0f, .03f, d - .24f)
            })
                node.AddChild(visuals.Part(visuals.Box, visuals.Rope, new Vector3(px, .42f, pz), new Vector3(sw, .02f, sd)));
        }
        if (site.Stage >= BuildStage.Foundation)
            node.AddChild(visuals.Part(visuals.Box, visuals.Stone, new Vector3(0, .09f, 0), new Vector3(w - .2f, .18f, d - .2f),
                rises: site.Stage == BuildStage.Foundation));
        if (site.Stage >= BuildStage.Structure)
        {
            foreach (int sx in new[] { -1, 1 })
                foreach (int sz in new[] { -1, 1 })
                    node.AddChild(visuals.Part(visuals.Box, visuals.Timber,
                        new Vector3(sx * (w / 2 - .25f), 1f, sz * (d / 2 - .25f)), new Vector3(.14f, 1.7f, .14f),
                        rises: site.Stage == BuildStage.Structure));
            node.AddChild(visuals.Part(visuals.Box, visuals.Timber, new Vector3(0, 1.82f, 0), new Vector3(w - .4f, .12f, .12f)));
            node.AddChild(visuals.Part(visuals.Box, visuals.Timber, new Vector3(0, 1.82f, 0), new Vector3(.12f, .12f, d - .4f)));
            // Andaime encostado numa das faces longas.
            for (int i = 0; i < 2; i++)
                node.AddChild(visuals.Part(visuals.Box, visuals.Scaffold,
                    new Vector3(-(w / 2 + .12f), .55f + i * .75f, 0), new Vector3(.06f, .06f, d - .5f)));
            foreach (int sz in new[] { -1, 1 })
                node.AddChild(visuals.Part(visuals.Box, visuals.Scaffold,
                    new Vector3(-(w / 2 + .12f), .8f, sz * (d / 2 - .35f)), new Vector3(.06f, 1.6f, .06f),
                    rises: site.Stage == BuildStage.Structure));
        }
        SiteObstacle(site, node);
        if (site.Stage >= BuildStage.Roofing)
        {
            foreach (int sx in new[] { -1, 1 })
            {
                var basis = new Basis(Vector3.Forward, sx * .62f).Scaled(new Vector3(w * .58f, .09f, d - .3f));
                node.AddChild(new MeshInstance3D
                {
                    Mesh = visuals.Box,
                    MaterialOverride = visuals.Thatch,
                    Transform = new Transform3D(basis, new Vector3(sx * w * .26f, 2.16f, 0))
                });
            }
        }
        GrowSite(site);
    }

    /// <summary>
    /// Gives the work a solid volume from the foundation on. Without it the
    /// player walked straight through the slab and the frame until the house
    /// was finished, which is exactly the invisible-geometry problem we avoid
    /// everywhere else.
    /// </summary>
    void SiteObstacle(ConstructionSite site, Node3D node)
    {
        if (site.Stage < BuildStage.Foundation)
        {
            scene.SimulationRemoveObstacle(node);
            return;
        }
        var lot = site.Lot;
        float height = site.Stage switch
        {
            BuildStage.Foundation => .22f,
            BuildStage.Structure => 1.9f,
            _ => 2.3f
        };
        float baseY = lot.Level * VillageScene.LevelHeight;
        var box = new Aabb(new Vector3(lot.X + .1f, baseY, lot.Y + .1f),
            new Vector3(lot.Width - .2f, height, lot.Height - .2f));
        scene.SimulationAddObstacle(node, box, $"Sim_SiteCollision_{site.Number}");
    }

    /// <summary>
    /// Interpolates the pieces of the current stage towards their finished size,
    /// so the work reads as continuous progress. Only pieces marked as rising
    /// move; everything already finished in an earlier stage stays put.
    /// </summary>
    void GrowSite(ConstructionSite site)
    {
        if (!siteNodes.TryGetValue(site.Number, out var node)) return;
        float t = Mathf.Clamp((float)site.StageProgress, .06f, 1f);
        foreach (var child in node.GetChildren())
        {
            if (child is not MeshInstance3D mesh || !mesh.HasMeta("simTargetScale")) continue;
            var target = (Vector3)mesh.GetMeta("simTargetScale");
            float baseY = (float)mesh.GetMeta("simBaseY");
            float yaw = (float)mesh.GetMeta("simYaw");
            var scale = new Vector3(target.X, target.Y * t, target.Z);
            mesh.Transform = new Transform3D(new Basis(Vector3.Up, yaw).Scaled(scale),
                new Vector3(mesh.Position.X, baseY + scale.Y / 2, mesh.Position.Z));
        }
    }

    void CompleteSite(ConstructionSite site)
    {
        if (siteNodes.TryGetValue(site.Number, out var node))
        {
            // Drop the work volume before the node dies, so the building box is
            // the only obstacle left standing on that ground.
            scene.SimulationRemoveObstacle(node);
            sites.RemoveChild(node);
            node.QueueFree();
            siteNodes.Remove(site.Number);
        }
        siteStages.Remove(site.Number);
        var lot = site.Lot;
        var holder = new Node3D { Name = $"Sim_Building_{site.Number}" };
        sites.AddChild(holder);
        var pose = VillageScene.SimulationPose(lot.X + lot.Width / 2f, lot.Level * VillageScene.LevelHeight, lot.Y + lot.Height / 2f, lot.Orientation);
        var instance = scene.SimulationInstantiate(lot.AssetId, pose, holder, $"Sim_Model_{site.Number}");
        var bounds = scene.SimulationAssetBounds(lot.AssetId, pose);
        if (instance == null)
        {
            // Sem o GLB no catalogo a obra nao vira uma caixa falsa: fica a
            // fundacao concluida, e o motivo aparece no StatusText.
            holder.AddChild(visuals.Part(visuals.Box, visuals.Stone,
                new Vector3(lot.X + lot.Width / 2f, lot.Level * VillageScene.LevelHeight + .1f, lot.Y + lot.Height / 2f),
                new Vector3(lot.Width - .2f, .2f, lot.Height - .2f)));
            return;
        }
        if (bounds.Size.LengthSquared() > 0)
        {
            scene.SimulationAddObstacle(holder, bounds, $"Sim_BuildingCollision_{site.Number}");
            scene.SimulationMergeBounds(bounds);
        }
        scene.SimulationRegisterBuilding(site.Building??site.Reserved);
    }

    void DrawTree(SimTree tree)
    {
        if (treeNodes.TryGetValue(tree.Id, out var previous))
        {
            scene.SimulationRemoveObstacle(previous);
            flora.RemoveChild(previous);
            previous.QueueFree();
            treeNodes.Remove(tree.Id);
        }
        float x = tree.X + .5f, z = tree.Y + .5f;
        var node = new Node3D { Name = $"Sim_Tree_{tree.Id}", Position = new Vector3(x, Ground(x, z, tree.Level), z) };
        flora.AddChild(node);
        treeNodes[tree.Id] = node;

        float height = tree.Stage switch { TreeStage.Sapling => .9f, TreeStage.Adult => 2.6f, _ => 1.9f };
        float radius = tree.Stage == TreeStage.Adult ? 1.05f : .5f;
        node.AddChild(visuals.Part(visuals.Trunk, tree.Stage == TreeStage.Dead ? visuals.DeadWood : visuals.Bark,
            new Vector3(0, height / 2, 0), new Vector3(1, height, 1)));
        if (tree.Stage != TreeStage.Dead)
        {
            bool conifer = model.TreeSpecies is "pine" or "cactus";
            var mesh = conifer ? (Mesh)visuals.Cone : visuals.Canopy;
            float canopy = tree.Stage == TreeStage.Sapling ? .7f : 1.7f;
            node.AddChild(visuals.Part(mesh, visuals.Leaf,
                new Vector3(0, height * (conifer ? .72f : .92f), 0),
                new Vector3(radius, canopy, radius), tree.Variant * .5f));
        }
        // Adult trees are real obstacles; the sapling and the dead trunk are
        // thin enough to walk past, so they do not claim a volume.
        if (tree.Stage == TreeStage.Adult)
            scene.SimulationAddObstacle(node,
                new Aabb(new Vector3(x - .22f, node.Position.Y, z - .22f), new Vector3(.44f, height, .44f)),
                $"Sim_TreeCollision_{tree.Id}");
    }

    void RemoveTree(SimTree tree)
    {
        if (!treeNodes.TryGetValue(tree.Id, out var node)) return;
        scene.SimulationRemoveObstacle(node);
        flora.RemoveChild(node);
        node.QueueFree();
        treeNodes.Remove(tree.Id);
    }

    void SyncAgents()
    {
        int person = 0, cart = 0;
        foreach (var agent in model.Agents)
        {
            float x = (float)agent.X, z = (float)agent.Y;
            float y = Ground(x, z, 1);
            if (agent.Kind == AgentKind.Person)
            {
                if (person >= people.Multimesh.InstanceCount) continue;
                var pose=new Transform3D(new Basis(Vector3.Up,(float)agent.Heading),new Vector3(x,y,z));
                float swing=agent.WaitSteps>0?0:Mathf.Sin((float)agent.LegProgress*Mathf.Tau);
                void Part(int part,Vector3 pivot,Vector3 offset,float angle=0){
                    var rotation=new Basis(Vector3.Right,angle);
                    personParts[part].Multimesh.SetInstanceTransform(person,pose*new Transform3D(rotation,pivot+rotation*offset));
                }
                Part(0,new Vector3(0,.45f,0),Vector3.Zero);
                Part(1,new Vector3(0,.70f,0),Vector3.Zero);
                Part(2,new Vector3(-.15f,.58f,0),new Vector3(0,-.13f,0),-swing*.35f);
                Part(3,new Vector3(.15f,.58f,0),new Vector3(0,-.13f,0),swing*.35f);
                Part(4,new Vector3(-.06f,.30f,0),new Vector3(0,-.15f,0),swing*.5f);
                Part(5,new Vector3(.06f,.30f,0),new Vector3(0,-.15f,0),-swing*.5f);
                person++;
            }
            else
            {
                if (cart >= carts.Multimesh.InstanceCount) continue;
                var basis = new Basis(Vector3.Up, (float)agent.Heading);
                carts.Multimesh.SetInstanceTransform(cart, new Transform3D(basis.Scaled(new Vector3(.46f, .34f, .78f)), new Vector3(x, y + .34f, z)));
                foreach (int side in new[] { -1, 1 })
                {
                    int index = cart * 2 + (side > 0 ? 1 : 0);
                    if (index >= wheels.Multimesh.InstanceCount) continue;
                    var offset = basis * new Vector3(side * .26f, 0, -.2f);
                    wheels.Multimesh.SetInstanceTransform(index, new Transform3D(
                        basis * new Basis(Vector3.Forward, Mathf.Pi / 2).Scaled(new Vector3(1.8f, .12f, 1.8f)),
                        new Vector3(x + offset.X, y + .18f, z + offset.Z)));
                }
                cart++;
            }
        }
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        scene.SimulationClearObstacles();
        scene.SimulationClearBuildings();
        siteNodes.Clear();
        siteStages.Clear();
        treeNodes.Clear();
        if (GodotObject.IsInstanceValid(root))
        {
            root.GetParent()?.RemoveChild(root);
            root.QueueFree();
        }
    }
}
