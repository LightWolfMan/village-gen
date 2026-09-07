using Godot;
using System.Text.Json.Nodes;
using Village.Core;
using Village.Rendering;
using GFile = Godot.FileAccess;

namespace Village.Simulation;

/// <summary>
/// Headless smoke for the simulation module only. It builds a real
/// <see cref="VillageScene"/>, drives the public contract and checks the nodes
/// that should exist, without touching the HUD or the published build.
/// Run: Godot --headless --path native res://Simulation/SimulationSmoke.tscn
/// </summary>
public partial class SimulationSmoke : Node3D
{
    int failures;

    void Check(string name, bool condition, string detail = "")
    {
        if (!condition) failures++;
        GD.Print($"{(condition ? "PASS" : "FAIL")} {name}{(detail.Length > 0 ? " · " + detail : "")}");
    }

    public override void _Ready()
    {
        try { Run(); }
        catch (Exception error) { failures++; GD.Print("FAIL excecao · " + error.Message); }
        GD.Print(failures == 0 ? "SIM_SMOKE_OK" : $"SIM_SMOKE_FAILED failures={failures}");
        GetTree().Quit(failures == 0 ? 0 : 1);
    }

    void Run()
    {
        VillageGenerator.ConfigureCatalog(GFile.GetFileAsString("res://assets/models/catalog.json"));
        var map = VillageGenerator.Generate("sim-smoke-1", new JsonObject { ["rivers"] = true, ["settlement"] = "village" });
        var scene = new VillageScene();
        AddChild(scene);
        scene.Build(map);
        string originalMap=map.ToJsonString();int initialHouses=scene.HouseCount,initialServices=scene.ServiceCount,changes=0;
        scene.BuildingsChanged+=()=>changes++;
        Check("cena estatica construida", scene.MapBounds.Size.LengthSquared() > 0);

        var walkBefore = scene.TryWalkStart(new Vector2(scene.SpawnPosition.X, scene.SpawnPosition.Z), out _);
        Check("passeio disponivel antes da simulacao", walkBefore);

        var simulation = SimulationHost.Create(scene, map);
        Check("fabrica devolve implementacao", simulation != null);
        if (simulation == null) return;

        Check("raiz Sim_Root criada", scene.GetNodeOrNull<Node3D>("GeneratedWorld/" + VillageScene.SimulationRootName) != null);
        Check("agentes instanciados", scene.GetNodeOrNull<MultiMeshInstance3D>($"GeneratedWorld/{VillageScene.SimulationRootName}/Sim_People") != null);
        var limbs=new[]{"Sim_People","Sim_Heads","Sim_LeftArms","Sim_RightArms","Sim_LeftLegs","Sim_RightLegs"}
            .Select(name=>scene.GetNodeOrNull<MultiMeshInstance3D>($"GeneratedWorld/{VillageScene.SimulationRootName}/{name}")).ToArray();
        Check("pessoas tem seis partes instanciadas",limbs.All(part=>part!=null)&&limbs.Select(part=>part!.Multimesh.VisibleInstanceCount).Distinct().Count()==1);

        int accepted = 0;
        foreach (string zone in new[] { "residential", "commercial", "craft", "agricultural" })
            if (simulation.QueueGrowth(zone)) accepted++;
        Check("crescimento aceito em pelo menos um distrito", accepted > 0, $"{accepted}/4 distritos");
        Check("StatusText descreve o estado", simulation.StatusText.Length > 0, simulation.StatusText);
        Check("IsRunning verdadeiro com obra aberta", simulation.IsRunning);

        simulation.Speed = 0;
        string paused = simulation.StatusText;
        for (int i = 0; i < 20; i++) simulation.Advance(.5);
        Check("pausado nao avanca", simulation.StatusText == paused);
        Check("IsRunning falso quando pausado", !simulation.IsRunning);

        simulation.Speed = 2;
        var sites = scene.GetNodeOrNull<Node3D>($"GeneratedWorld/{VillageScene.SimulationRootName}/Sim_Sites");
        Check("no de obras existe", sites != null);
        bool sawStage = sites != null && sites.GetChildCount() > 0;
        Check("obra visivel no mundo", sawStage, $"{sites?.GetChildCount()} nos");

        // A obra tem de ser solida durante a execucao, nao so no fim.
        StaticBody3D? siteBody = null;
        Node3D? siteNode = null;
        for (int i = 0; i < 200 && siteBody == null; i++)
        {
            simulation.Advance(.5);
            foreach (var child in sites!.GetChildren())
            {
                if (child is not Node3D candidate || !candidate.Name.ToString().StartsWith("Sim_Site_")) continue;
                foreach (var inner in candidate.GetChildren())
                    if (inner is StaticBody3D body) { siteBody = body; siteNode = candidate; }
            }
        }
        Check("canteiro ganha volume solido durante a obra", siteBody != null);
        if (siteBody != null && siteNode != null)
        {
            var delta = siteBody.GlobalPosition - siteNode.GlobalPosition;
            Check("colisao do canteiro fica sobre o proprio lote",
                Mathf.Abs(delta.X) < 1.5f && Mathf.Abs(delta.Z) < 1.5f,
                $"desvio {delta.X:0.00},{delta.Z:0.00}");
            var shape = siteBody.GetChild(0) as CollisionShape3D;
            Check("colisao do canteiro tem altura util",
                shape?.Shape is BoxShape3D box && box.Size.Y > .15f);
        }

        bool completed = false;
        for (int i = 0; i < 3000 && !completed; i++)
        {
            simulation.Advance(.5);
            if (sites == null) break;
            foreach (var child in sites.GetChildren())
                if (child is Node3D node && node.Name.ToString().StartsWith("Sim_Building_")) completed = true;
        }
        Check("obra chega a predio concluido", completed, simulation.StatusText);
        Check("casas concluidas atualizam contador",scene.HouseCount>initialHouses&&scene.ServiceCount==initialServices&&changes>0);
        var grown=sites?.GetChildren().OfType<Node3D>().FirstOrDefault(n=>n.Name.ToString().StartsWith("Sim_Building_"));
        var grownModel=grown?.GetChildren().OfType<Node3D>().FirstOrDefault(n=>n.Name.ToString().StartsWith("Sim_Model_"));
        Vector3 grownPoint=grownModel?.GlobalPosition??Vector3.Zero;
        Check("regioes seleciona casa nova",grownModel!=null&&scene.SelectElement(grownPoint,true,false,false).StartsWith("sim-building-"));
        Check("filtro de servicos exclui casa nova",scene.SelectElement(grownPoint,false,true,false)=="");
        Check("mapa procedural permanece intacto",map.ToJsonString()==originalMap);

        var walkAfter = scene.TryWalkStart(new Vector2(scene.SpawnPosition.X, scene.SpawnPosition.Z), out _);
        Check("passeio segue disponivel apos crescer", walkAfter);

        var flora = scene.GetNodeOrNull<Node3D>($"GeneratedWorld/{VillageScene.SimulationRootName}/Sim_Flora");
        Check("no de flora existe", flora != null);
        int planted = 0;
        for (int i = 0; i < 400 && planted == 0; i++)
        {
            simulation.Advance(.5);
            planted = flora?.GetChildCount() ?? 0;
        }
        Check("ecologia planta muda propria", planted > 0, $"{planted} mudas");
        bool sapling = false;
        if (flora != null)
            foreach (var child in flora.GetChildren())
                if (child is Node3D tree && tree.GetChildCount() > 0) sapling = true;
        Check("muda tem geometria propria", sapling);

        // O bug corrigido somava a posicao do no duas vezes: o tronco ficava sem
        // colisao e um obstaculo invisivel aparecia longe dali.
        StaticBody3D? treeBody = null;
        Node3D? treeNode = null;
        for (int i = 0; i < 3000 && treeBody == null; i++)
        {
            simulation.Advance(.5);
            if (flora == null) break;
            foreach (var child in flora.GetChildren())
            {
                if (child is not Node3D candidate) continue;
                foreach (var inner in candidate.GetChildren())
                    if (inner is StaticBody3D body) { treeBody = body; treeNode = candidate; }
            }
        }
        Check("arvore adulta ganha colisao", treeBody != null);
        if (treeBody != null && treeNode != null)
        {
            var delta = treeBody.GlobalPosition - treeNode.GlobalPosition;
            Check("colisao da arvore fica no proprio tronco",
                Mathf.Abs(delta.X) < .5f && Mathf.Abs(delta.Z) < .5f,
                $"desvio {delta.X:0.00},{delta.Z:0.00}");
        }

        simulation.PeopleEnabled = false;
        var crowd = scene.GetNodeOrNull<MultiMeshInstance3D>($"GeneratedWorld/{VillageScene.SimulationRootName}/Sim_People");
        Check("desligar pessoas esconde a multidao", crowd != null && !crowd.Visible);
        Check("desligar pessoas esconde todos os membros",limbs.All(part=>part!=null&&!part.Visible));
        simulation.PeopleEnabled = true;
        Check("religar pessoas mostra a multidao", crowd != null && crowd.Visible);
        Check("religar pessoas mostra todos os membros",limbs.All(part=>part!=null&&part.Visible));

        string catalog=GFile.GetFileAsString("res://assets/models/catalog.json");
        string savePath=ProjectSettings.GlobalizePath("res://../.cache/persistence-test/village.json");
        var state=simulation.CaptureState();
        VillageSaveFile.Write(savePath,map,state,catalog);
        VillageSaveFile.Write(savePath,map,state,catalog);
        Check("salvar preserva backup",System.IO.File.Exists(savePath+".bak"));
        var saved=VillageSaveFile.Read(savePath,catalog);
        var restoredModel=Village.Core.Simulation.VillageSimulationModel.Restore(saved.Map,scene.SimulationCatalog(),map["seed"]!.GetValue<string>(),saved.State);
        Check("historico restaurado identico",restoredModel.CaptureState().ToJsonString()==state.ToJsonString());
        var restoredScene=new VillageScene();AddChild(restoredScene);restoredScene.Build(saved.Map);
        using(var restored=new VillageSimulation(restoredScene,saved.Map,restoredModel)){
            Check("restauracao reconstroi casas e selecao",restoredScene.HouseCount==scene.HouseCount&&restoredScene.SelectElement(grownPoint,true,false,false).StartsWith("sim-building-"));
            Check("restauracao preserva estado descritivo",restored.StatusText==simulation.StatusText);
            for(int i=0;i<30;i++){simulation.Advance(.17);restored.Advance(.17);}
            Check("continuacao permanece deterministica",restored.CaptureState().ToJsonString()==simulation.CaptureState().ToJsonString()&&restored.StatusText==simulation.StatusText);
        }
        restoredScene.QueueFree();
        var corrupt=(JsonObject)state.DeepClone();corrupt["steps"]=-1;
        Check("historico invalido recusado",!Safe(()=>Village.Core.Simulation.VillageSimulationModel.Restore(map,scene.SimulationCatalog(),map["seed"]!.GetValue<string>(),corrupt)));
        Check("catalogo incompatível recusado",!Safe(()=>VillageSaveFile.Read(savePath,"different")));
        var partial=new Village.Core.Simulation.VillageSimulationModel(map,scene.SimulationCatalog(),map["seed"]!.GetValue<string>());
        partial.QueueGrowth("residential");partial.Advance(.37);partial.PeopleEnabled=false;partial.Advance(.24);
        var partialCopy=Village.Core.Simulation.VillageSimulationModel.Restore(map,scene.SimulationCatalog(),map["seed"]!.GetValue<string>(),partial.CaptureState());
        Check("obra em andamento restaura etapa e progresso",partial.Sites.Count>0&&partialCopy.Sites[0].Stage==partial.Sites[0].Stage&&partialCopy.Sites[0].StepsInStage==partial.Sites[0].StepsInStage);
        Check("moradores restauram posicao e opcoes",!partialCopy.PeopleEnabled&&partialCopy.Agents.Zip(partial.Agents).All(pair=>pair.First.X==pair.Second.X&&pair.First.Y==pair.Second.Y&&pair.First.LegProgress==pair.Second.LegProgress));
        partial.Advance(.07);partialCopy.Advance(.07);
        Check("fracao do relogio preservada",partial.Steps==partialCopy.Steps&&partial.Sites[0].StepsInStage==partialCopy.Sites[0].StepsInStage);

        simulation.Dispose();
        Check("dispose restaura contadores",scene.HouseCount==initialHouses&&scene.ServiceCount==initialServices);
        Check("dispose remove casa da selecao",scene.SelectElement(grownPoint,true,false,false)=="");
        Check("Dispose remove a raiz da simulacao",
            scene.GetNodeOrNull<Node3D>("GeneratedWorld/" + VillageScene.SimulationRootName) == null);
        Check("passeio continua valido apos Dispose",
            scene.TryWalkStart(new Vector2(scene.SpawnPosition.X, scene.SpawnPosition.Z), out _));
        Check("Dispose repetido e inofensivo", Safe(() => simulation.Dispose()));
        Check("Advance apos Dispose e inofensivo", Safe(() => simulation.Advance(.5)));
        Check("QueueGrowth apos Dispose devolve false", !simulation.QueueGrowth("residential"));
    }

    static bool Safe(Action action)
    {
        try { action(); return true; }
        catch { return false; }
    }
}
