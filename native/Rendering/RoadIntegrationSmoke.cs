using Godot;
using System;
using System.Text.Json.Nodes;
using Village.Core;
using Village.Core.Simulation;

namespace Village.Rendering;

public partial class RoadIntegrationSmoke : Node3D
{
    public override async void _Ready()
    {
        try
        {
            VillageGenerator.ConfigureCatalog(Godot.FileAccess.GetFileAsString("res://assets/models/catalog.json"));
            int total=0;
            foreach(string biome in new[]{"temperate","arid","snowy","wetland"})
            foreach(string layout in new[]{"organic","grid"})
            {
                var map=VillageGenerator.Generate("road-integration-17",new JsonObject{["biome"]=biome,["layout"]=layout,["rivers"]=true,["water"]=.55,["mapSize"]=96,["settlement"]="village"});
                var scene=new VillageScene();AddChild(scene);scene.Build(map);
                await ToSignal(GetTree(),SceneTree.SignalName.PhysicsFrame);
                await ToSignal(GetTree(),SceneTree.SignalName.PhysicsFrame);
                scene.ValidateIntegratedRoads();
                var network=new RoadNetwork(map);
                int rays=0,bridges=0;
                for(int i=0;i<network.Count;i++)
                {
                    if(network.IsBridge(i))bridges++;
                    if(i%3!=0&&!network.IsBridge(i))continue;
                    float x=network.X(i)+.5f,z=network.Y(i)+.5f;
                    var height=scene.SurfaceHeight(x,z)??throw new Exception("Road without support");
                    var query=PhysicsRayQueryParameters3D.Create(new(x,height+2,z),new(x,height-2,z));
                    var hit=GetWorld3D().DirectSpaceState.IntersectRay(query);
                    if(hit.Count==0)throw new Exception("Road without collider");
                    if(hit["collider"].AsGodotObject() is Node node&&node.IsInGroup("walk_ground"))
                    {
                        if(Math.Abs(hit["position"].AsVector3().Y-height)>.002f)throw new Exception("Physics/render surface mismatch");
                        rays++;
                    }
                }
                if(scene.AdaptedRoadRuns==0||rays<100||bridges==0)throw new Exception("Insufficient integration coverage");
                GD.Print($"ROAD_BIOME_CHECK biome={biome} layout={layout} runs={scene.AdaptedRoadRuns} physics_rays={rays} bridge_cells={bridges}");
                total+=scene.AdaptedRoadRuns;scene.Free();
            }
            GD.Print($"ROAD_SMOKE_OK runs={total}");GetTree().Quit();
        }
        catch(Exception error){GD.PushError(error.ToString());GetTree().Quit(1);}
    }
}
