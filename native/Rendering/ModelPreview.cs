using Godot;

namespace Village;

/// <summary>
/// Render controlado de um modelo isolado sobre plano, ao nivel dos olhos.
/// Existe para separar defeito de geometria de defeito de terreno: aqui o chao
/// e um plano exato em y=0, entao qualquer apoio que nao encoste esta suspenso
/// no proprio GLB, e nao por causa do relevo da vila.
///
/// Uso: $VillageGodot --headless --path native res://Rendering/ModelPreview.tscn
/// Variaveis: VILLAGE_PREVIEW_DIR (destino) e VILLAGE_PREVIEW_MODELS (lista
/// separada por virgula, sem extensao).
/// </summary>
public partial class ModelPreview : Node3D
{
    public override void _Ready() => _ = Run();

    private async System.Threading.Tasks.Task Run()
    {
        string folder=System.Environment.GetEnvironmentVariable("VILLAGE_PREVIEW_DIR")??"../.cache/model-preview";
        string list=System.Environment.GetEnvironmentVariable("VILLAGE_PREVIEW_MODELS")??"temperate-farmstead-0";
        System.IO.Directory.CreateDirectory(folder);

        var ground=new MeshInstance3D{Mesh=new PlaneMesh{Size=new Vector2(60,60)}};
        ground.MaterialOverride=new StandardMaterial3D{AlbedoColor=new Color("#7d9a52"),Roughness=1};
        AddChild(ground);
        var sun=new DirectionalLight3D{ShadowEnabled=true,LightEnergy=1.15f};
        AddChild(sun);sun.RotationDegrees=new Vector3(-42,-125,0);
        var sky=new WorldEnvironment{Environment=new Godot.Environment{
            BackgroundMode=Godot.Environment.BGMode.Color,BackgroundColor=new Color("#b9d4e6"),
            AmbientLightSource=Godot.Environment.AmbientSource.Color,AmbientLightColor=new Color("#9fb6c6"),AmbientLightEnergy=.65f}};
        AddChild(sky);
        var camera=new Camera3D{Fov=52};AddChild(camera);

        foreach(string name in list.Split(',',System.StringSplitOptions.RemoveEmptyEntries))
        {
            string id=name.Trim();
            var scene=GD.Load<PackedScene>($"res://assets/models/{id}.glb");
            if(scene==null){GD.Print($"MODEL_PREVIEW_MISS {id}");continue;}
            var model=scene.Instantiate<Node3D>();AddChild(model);
            var aabb=Bounds(model);
            GD.Print($"MODEL_PREVIEW_BOUNDS {id} min=({aabb.Position.X:0.000},{aabb.Position.Y:0.000},{aabb.Position.Z:0.000}) size=({aabb.Size.X:0.000},{aabb.Size.Y:0.000},{aabb.Size.Z:0.000})");
            // Apoio suspenso aparece como min.Y acima de zero; medido, nao estimado.
            if(aabb.Position.Y>.01f)GD.Print($"MODEL_PREVIEW_FLOATING {id} folga={aabb.Position.Y:0.000}");

            foreach(var shot in new (string Nome,Vector3 De)[]{
                ("frente",new Vector3(0,1.55f,aabb.Size.Z*.5f+4.4f)),
                ("lateral",new Vector3(aabb.Size.X*.5f+4.0f,1.6f,aabb.Size.Z*.5f+2.6f)),
                ("rasante",new Vector3(.8f,.42f,aabb.Size.Z*.5f+3.1f)),
                ("cobertura",new Vector3(aabb.Size.X*.5f+5,aabb.Size.Y+2,aabb.Size.Z*.5f+5))})
            {
                camera.Position=shot.De;
                camera.LookAt(new Vector3(0,shot.Nome=="rasante"?.35f:shot.Nome=="cobertura"?aabb.Size.Y*.6f:1.15f,0));
                await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame);
                await ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
                GetViewport().GetTexture().GetImage().SavePng(System.IO.Path.Combine(folder,$"{id}-{shot.Nome}.png"));
            }
            model.QueueFree();
            await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame);
        }
        GD.Print("MODEL_PREVIEW_OK");
        GetTree().Quit();
    }

    private static Aabb Bounds(Node node)
    {
        var total=new Aabb();bool first=true;
        foreach(var mesh in node.FindChildren("*","MeshInstance3D",true,false))
        {
            var m=(MeshInstance3D)mesh;
            var box=m.GlobalTransform*m.GetAabb();
            total=first?box:total.Merge(box);first=false;
        }
        return total;
    }
}
