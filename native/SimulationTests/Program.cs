using System.Text.Json.Nodes;
using Village.Core;
using Village.Core.Simulation;

string root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../"));
string catalogJson = File.ReadAllText(Path.Combine(root, "native/assets/models/catalog.json"));
VillageGenerator.ConfigureCatalog(catalogJson);
var catalogNode = JsonNode.Parse(catalogJson)!;
JsonArray Models() => (JsonArray)(catalogNode is JsonArray array ? array : catalogNode["models"]!).DeepClone();

int passed = 0, failed = 0;
void Check(string name, Action body)
{
    try { body(); passed++; Console.WriteLine($"PASS {name}"); }
    catch (Exception error) { failed++; Console.WriteLine($"FAIL {name}: {error.Message}"); }
}
void Require(bool condition, string message) { if (!condition) throw new Exception(message); }

JsonObject Map(string seed, JsonObject? settings = null) => VillageGenerator.Generate(seed, settings);
VillageSimulationModel Sim(JsonObject map, string seed) => new(map, Models(), seed);

// ---------------------------------------------------------------- clock

Check("relogio converte delta variavel em passos fixos", () =>
{
    var clock = new SimulationClock();
    int steps = 0;
    foreach (double delta in new[] { .016, .033, .008, .05, .1, .004, .25 })
        steps += clock.Advance(delta);
    Require(steps == 4, $"esperado 4 passos, veio {steps}");
    Require(Math.Abs(clock.Elapsed - .4) < 1e-9, "tempo acumulado divergente");
});

Check("relogio pausado nao avanca e 2x dobra", () =>
{
    var paused = new SimulationClock { Speed = 0 };
    Require(paused.Advance(5) == 0, "pausado avancou");
    Require(!paused.IsRunning, "pausado ainda se declara rodando");
    var normal = new SimulationClock { Speed = 1 };
    var fast = new SimulationClock { Speed = 2 };
    int a = 0, b = 0;
    // 1/60 nao e exato em binario; com poucos quadros o arredondamento vale um
    // passo inteiro. Dez segundos deixam a proporcao clara sem mascarar erro.
    for (int i = 0; i < 600; i++) { a += normal.Advance(1.0 / 60); b += fast.Advance(1.0 / 60); }
    Require(Math.Abs(b - 2 * a) <= 2, $"2x deveria dobrar os passos: {a} contra {b}");
    Require(a >= 98 && a <= 100, $"1x deveria simular cerca de 10 s, veio {normal.Elapsed:F2}s");
});

Check("relogio descarta atraso de janela suspensa", () =>
{
    var clock = new SimulationClock();
    int steps = clock.Advance(30);
    Require(steps <= SimulationClock.MaxBacklog / SimulationClock.Step,
        $"simulou {steps} passos de uma janela suspensa");
    Require(steps == 5, $"esperado o teto de 5 passos, veio {steps}");
});

Check("mesma sequencia de passos produz o mesmo estado", () =>
{
    var map = Map("sim-determinismo");
    var a = Sim(map, "sim-determinismo");
    var b = Sim((JsonObject)map.DeepClone(), "sim-determinismo");
    Require(a.QueueGrowth("residential"), "primeira fila falhou");
    Require(b.QueueGrowth("residential"), "segunda fila falhou");
    // Deltas diferentes, mesmo numero de passos: o estado tem de bater.
    for (int i = 0; i < 200; i++) a.Advance(.1);
    for (int i = 0; i < 400; i++) b.Advance(.05);
    Require(a.Steps == b.Steps, $"passos diferentes: {a.Steps} e {b.Steps}");
    Require(a.Completed == b.Completed, "conclusoes divergentes");
    var pa = a.Agents.Select(x => (x.X, x.Y)).ToArray();
    var pb = b.Agents.Select(x => (x.X, x.Y)).ToArray();
    Require(pa.Length == pb.Length, "populacao divergente");
    for (int i = 0; i < pa.Length; i++)
        Require(Math.Abs(pa[i].X - pb[i].X) < 1e-9 && Math.Abs(pa[i].Y - pb[i].Y) < 1e-9, $"agente {i} divergiu");
    Require(a.Sites[0].Lot.X == b.Sites[0].Lot.X && a.Sites[0].Lot.Y == b.Sites[0].Lot.Y, "lote divergente");
});

// ---------------------------------------------------------------- growth

Check("lote novo e seco, dentro do mapa e nao sobrepoe nada", () =>
{
    foreach (string seed in new[] { "sim-lote-1", "sim-lote-2", "sim-lote-3" })
    {
        var map = Map(seed);
        var sim = Sim(map, seed);
        int width = J.I(map, "width"), height = J.I(map, "height");
        var taken = new HashSet<int>();
        foreach (var lot in map["lots"]!.AsArray())
            foreach (var cell in lot!["cells"]!.AsArray())
                taken.Add(J.I(cell, "y") * width + J.I(cell, "x"));
        var roads = new HashSet<int>();
        foreach (var road in map["roads"]!.AsArray()) roads.Add(J.I(road, "y") * width + J.I(road, "x"));

        int grown = 0;
        foreach (string zone in new[] { "residential", "commercial", "craft", "agricultural" })
        {
            if (!sim.QueueGrowth(zone)) continue;
            grown++;
            var lot = sim.Sites[^1].Lot;
            // Clear() exige o lote inteiro dentro da zona pedida.
            for (int y = lot.Y; y < lot.Y + lot.Height; y++)
                for (int x = lot.X; x < lot.X + lot.Width; x++)
                {
                    int index = y * width + x;
                    Require(x >= 1 && y >= 1 && x < width - 1 && y < height - 1, $"{seed}: lote fora dos limites");
                    Require(map["terrain"]![index]!.GetValue<string>() != "water", $"{seed}: lote sobre agua");
                    Require(!roads.Contains(index), $"{seed}: lote sobre rua");
                    Require(taken.Add(index), $"{seed}: lote sobrepoe outro lote em {x},{y}");
                    Require(map["zoneMap"]![index]!.GetValue<string>() == zone, $"{seed}: lote fora da zona {zone}");
                }
            // Sem reaplainar o terreno, a pegada precisa ja estar nivelada.
            int baseLevel = (int)J.Number(map["heightLevel"]![lot.Y * width + lot.X]);
            for (int y = lot.Y; y < lot.Y + lot.Height; y++)
                for (int x = lot.X; x < lot.X + lot.Width; x++)
                    Require((int)J.Number(map["heightLevel"]![y * width + x]) == baseLevel,
                        $"{seed}: pegada em terreno desnivelado, casa flutuaria");
            Require(lot.Level == baseLevel, $"{seed}: nivel declarado difere do terreno");

            // A porta tem de ser uma via terrestre reta ja existente.
            int door = lot.DoorY * width + lot.DoorX;
            Require(roads.Contains(door), $"{seed}: porta fora da malha viaria");
            var doorRoad = map["roads"]!.AsArray().First(r => J.I(r, "x") == lot.DoorX && J.I(r, "y") == lot.DoorY)!;
            Require(!J.B(doorRoad, "bridge"), $"{seed}: porta sobre ponte");
            Require(J.I(doorRoad, "connections") is 5 or 10, $"{seed}: porta em curva ou cruzamento");
            Require(J.S(doorRoad, "kind") != "plaza", $"{seed}: porta na praca");
        }
        Require(grown > 0, $"{seed}: nenhum distrito aceitou crescimento");
    }
});

Check("crescimento repetido nunca reutiliza o mesmo lote", () =>
{
    var map = Map("sim-repeticao");
    var sim = Sim(map, "sim-repeticao");
    var seen = new HashSet<string>();
    int accepted = 0;
    for (int i = 0; i < 40; i++)
        foreach (string zone in new[] { "residential", "commercial", "craft", "agricultural" })
            if (sim.QueueGrowth(zone))
            {
                accepted++;
                var lot = sim.Sites[^1].Lot;
                Require(seen.Add($"{lot.X},{lot.Y}"), $"lote repetido em {lot.X},{lot.Y}");
                foreach (int cell in lot.Cells) { }
            }
    Require(accepted >= 4, $"apenas {accepted} obras aceitas");
});

Check("falha limpa e explicada quando o distrito lota", () =>
{
    var map = Map("sim-saturacao");
    var sim = Sim(map, "sim-saturacao");
    int accepted = 0;
    while (sim.QueueGrowth("craft") && accepted < 400) accepted++;
    Require(!sim.QueueGrowth("craft"), "distrito saturado ainda aceitou");
    Require(sim.LastGrowthReason.Length > 0, "falha sem motivo declarado");
    Require(sim.StatusText.Contains(sim.LastGrowthReason) || sim.ActiveWorks > 0, "motivo nao chega ao StatusText");
    Require(!sim.QueueGrowth("zona-inexistente"), "aceitou distrito invalido");
    Require(sim.LastGrowthReason.Contains("Distrito"), "motivo de distrito invalido ausente");
});

Check("obra percorre as quatro etapas e conclui com predio real", () =>
{
    var map = Map("sim-obra");
    var sim = Sim(map, "sim-obra");
    Require(sim.QueueGrowth("residential"), "nao abriu obra");
    var site = sim.Sites[0];
    Require(site.Stage == BuildStage.Marking, "obra nao comeca na marcacao");
    var seenStages = new List<BuildStage> { site.Stage };
    for (int i = 0; i < 4000 && !site.IsComplete; i++)
    {
        sim.Advance(.1);
        if (seenStages[^1] != site.Stage) seenStages.Add(site.Stage);
    }
    Require(site.IsComplete, "obra nao concluiu");
    Require(seenStages.SequenceEqual(new[] { BuildStage.Marking, BuildStage.Foundation, BuildStage.Structure, BuildStage.Roofing, BuildStage.Complete }),
        "etapas fora de ordem: " + string.Join(",", seenStages));
    Require(site.Building != null, "conclusao sem predio");
    Require(J.S(site.Building!, "assetId").Length > 0, "predio sem modelo do catalogo");
    Require(J.B(site.Building!, "grownBySimulation"), "predio nao marcado como da simulacao");
    Require(sim.Completed == 1, "contador de conclusoes errado");
});

Check("progresso avanca de forma monotonica", () =>
{
    var map = Map("sim-progresso");
    var sim = Sim(map, "sim-progresso");
    Require(sim.QueueGrowth("agricultural") || sim.QueueGrowth("residential"), "nao abriu obra");
    var site = sim.Sites[0];
    double previous = -1;
    for (int i = 0; i < 3000 && !site.IsComplete; i++)
    {
        sim.Advance(.1);
        Require(site.Progress >= previous - 1e-9, "progresso regrediu");
        previous = site.Progress;
    }
    Require(Math.Abs(site.Progress - 1) < 1e-9, "progresso final diferente de 1");
});

// ---------------------------------------------------------------- agents

Check("rotas dos agentes ficam na malha cardinal conectada", () =>
{
    foreach (string seed in new[] { "sim-rotas-1", "sim-rotas-2" })
    {
        var map = Map(seed, new JsonObject { ["rivers"] = true });
        var sim = Sim(map, seed);
        var network = sim.Network;
        Require(sim.Agents.Count > 0, $"{seed}: nenhum agente criado");
        int width = J.I(map, "width");
        var roadCells = new HashSet<int>();
        foreach (var road in map["roads"]!.AsArray()) roadCells.Add(J.I(road, "y") * width + J.I(road, "x"));
        for (int i = 0; i < 1200; i++) sim.Advance(.1);
        foreach (var agent in sim.Agents)
        {
            int cell = (int)Math.Floor(agent.Y) * width + (int)Math.Floor(agent.X);
            Require(roadCells.Contains(cell), $"{seed}: agente fora da malha em {agent.X:F2},{agent.Y:F2}");
            for (int leg = 0; leg + 1 < agent.Route.Length; leg++)
            {
                int a = agent.Route[leg], b = agent.Route[leg + 1];
                Require(network.Neighbours(a).Contains(b), $"{seed}: salto invalido na rota");
                Require(Math.Abs(network.X(a) - network.X(b)) + Math.Abs(network.Y(a) - network.Y(b)) == 1,
                    $"{seed}: passo nao cardinal na rota");
            }
        }
    }
});

Check("rede atravessa pontes nos dois eixos sem sair delas", () =>
{
    bool sawEw = false, sawNs = false;
    foreach (string seed in new[] { "sim-ponte-1", "sim-ponte-2", "sim-ponte-3", "sim-ponte-4" })
    {
        var map = Map(seed, new JsonObject { ["rivers"] = true });
        var network = new RoadNetwork(map);
        foreach (var span in map["bridgeSpans"]!.AsArray())
        {
            string axis = J.S(span, "axis");
            var entry = span!["entry"]!;
            var exit = span["exit"]!;
            int from = network.NodeAt(J.I(entry, "x"), J.I(entry, "y"));
            int to = network.NodeAt(J.I(exit, "x"), J.I(exit, "y"));
            if (from < 0 || to < 0) continue;
            var route = network.Route(from, to);
            Require(route != null, $"{seed}: ponte {axis} sem rota entre as margens");
            foreach (int node in route!)
            {
                int x = network.X(node), y = network.Y(node);
                Require(map["terrain"]![y * J.I(map, "width") + x]!.GetValue<string>() != "water" || network.IsBridge(node),
                    $"{seed}: rota entrou na agua fora da ponte");
            }
            if (axis == "ew") sawEw = true; else sawNs = true;
        }
    }
    Require(sawEw && sawNs, $"faltou cobrir os dois eixos: ew={sawEw} ns={sawNs}");
});

Check("desligar pessoas e carrocas congela os agentes", () =>
{
    var map = Map("sim-toggles");
    var sim = Sim(map, "sim-toggles");
    for (int i = 0; i < 100; i++) sim.Advance(.1);
    sim.PeopleEnabled = false;
    sim.VehiclesEnabled = false;
    var before = sim.Agents.Select(a => (a.X, a.Y)).ToArray();
    for (int i = 0; i < 200; i++) sim.Advance(.1);
    var after = sim.Agents.Select(a => (a.X, a.Y)).ToArray();
    for (int i = 0; i < before.Length; i++)
        Require(before[i] == after[i], "agente desligado continuou andando");
    Require(sim.Agents.All(a => !a.Active), "agente desligado segue ativo");
});

// ---------------------------------------------------------------- ecology

Check("mudas nunca nascem sobre rua, acesso, lote ou agua", () =>
{
    var map = Map("sim-ecologia");
    var sim = Sim(map, "sim-ecologia");
    int width = J.I(map, "width");
    var roads = new HashSet<int>();
    foreach (var road in map["roads"]!.AsArray())
        for (int dy = -1; dy <= 1; dy++)
            for (int dx = -1; dx <= 1; dx++)
                roads.Add((J.I(road, "y") + dy) * width + J.I(road, "x") + dx);
    var lots = new HashSet<int>();
    foreach (var lot in map["lots"]!.AsArray())
        foreach (var cell in lot!["cells"]!.AsArray())
            lots.Add(J.I(cell, "y") * width + J.I(cell, "x"));
    for (int i = 0; i < 6000; i++) sim.Advance(.1);
    Require(sim.Trees.Count > 0, "nenhuma muda plantada em 600 s");
    foreach (var tree in sim.Trees)
    {
        int cell = tree.Y * width + tree.X;
        Require(!roads.Contains(cell), $"muda no corredor viario em {tree.X},{tree.Y}");
        Require(!lots.Contains(cell), $"muda sobre lote em {tree.X},{tree.Y}");
        Require(map["terrain"]![cell]!.GetValue<string>() != "water", "muda sobre agua");
    }
});

Check("arvore percorre jovem, adulta, morta e some da lista", () =>
{
    var map = Map("sim-ciclo");
    var sim = Sim(map, "sim-ciclo");
    var stages = new HashSet<TreeStage>();
    bool sawRemoval = false;
    int ids = 0;
    for (int i = 0; i < 40000; i++)
    {
        foreach (var e in sim.Advance(.1))
        {
            if (e.Kind == SimulationEventKind.TreePlanted) { stages.Add(TreeStage.Sapling); ids++; }
            if (e.Kind == SimulationEventKind.TreeStageChanged) stages.Add(e.Tree!.Stage);
            if (e.Kind == SimulationEventKind.TreeRemoved) sawRemoval = true;
        }
        if (sawRemoval && stages.Count >= 3) break;
    }
    Require(ids > 0, "nenhuma muda plantada");
    Require(stages.Contains(TreeStage.Adult), "nenhuma arvore chegou a adulta");
    Require(stages.Contains(TreeStage.Dead), "nenhuma arvore morreu");
    Require(sawRemoval, "arvore morta nunca foi removida");
    Require(sim.Trees.All(t => !t.Removed), "arvore removida continua na lista");
});

Check("ecologia desligada nao planta nem envelhece", () =>
{
    var map = Map("sim-ecologia-off");
    var sim = Sim(map, "sim-ecologia-off");
    sim.EcologyEnabled = false;
    for (int i = 0; i < 6000; i++) sim.Advance(.1);
    Require(sim.Trees.Count == 0, "plantou com a ecologia desligada");
});

// ------------------------------------------------- regressoes da revisao

Check("obra nunca ocupa o volume de um prop existente", () =>
{
    foreach (string seed in new[] { "sim-prop-1", "sim-prop-2", "sim-prop-3" })
    {
        var map = Map(seed);
        var sim = Sim(map, seed);
        int width = J.I(map, "width");
        var catalogModels = Models();
        // Pegada girada de cada prop, do mesmo jeito que CoreTests verifica.
        var propCells = new HashSet<int>();
        foreach (var prop in map["props"]!.AsArray())
        {
            string type = J.S(prop, "type");
            string asset = type == "oak" ? new[] { "oak", "birch", "elm" }[J.I(prop, "variant") % 3] : type;
            var model = catalogModels.Select(m => m!.AsObject()).First(m => J.S(m, "id") == "prop:" + asset);
            var bounds = model["bounds"]!;
            double angle = J.D(prop, "variant") * Math.PI / 3, cos = Math.Cos(angle), sin = Math.Sin(angle);
            double cx = J.I(prop, "x") + .5, cy = J.I(prop, "y") + .5;
            double minX = double.PositiveInfinity, minY = minX, maxX = double.NegativeInfinity, maxY = maxX;
            foreach (double bx in new[] { J.Number(bounds["min"]![0]!), J.Number(bounds["max"]![0]!) })
                foreach (double bz in new[] { J.Number(bounds["min"]![2]!), J.Number(bounds["max"]![2]!) })
                {
                    double px = cx + bx * cos + bz * sin, py = cy - bx * sin + bz * cos;
                    minX = Math.Min(minX, px); maxX = Math.Max(maxX, px);
                    minY = Math.Min(minY, py); maxY = Math.Max(maxY, py);
                }
            for (int y = (int)Math.Floor(minY); y <= (int)Math.Ceiling(maxY) - 1; y++)
                for (int x = (int)Math.Floor(minX); x <= (int)Math.Ceiling(maxX) - 1; x++)
                    propCells.Add(y * width + x);
        }
        int accepted = 0;
        for (int i = 0; i < 30; i++)
            foreach (string zone in new[] { "residential", "commercial", "craft", "agricultural" })
                if (sim.QueueGrowth(zone))
                {
                    accepted++;
                    var lot = sim.Sites[^1].Lot;
                    foreach (int cell in lot.Cells)
                        Require(!propCells.Contains(cell),
                            $"{seed}: lote invade prop em {cell % width},{cell / width}");
                }
        Require(accepted > 0, $"{seed}: nenhuma obra aceita");
    }
});

Check("obra nunca ocupa o chao de uma muda plantada", () =>
{
    var map = Map("sim-muda-lote");
    var sim = Sim(map, "sim-muda-lote");
    int width = J.I(map, "width");
    for (int i = 0; i < 4000; i++) sim.Advance(.1);
    Require(sim.Trees.Count > 0, "nenhuma muda plantada");
    var occupiedByTrees = sim.Trees.Select(t => t.Y * width + t.X).ToHashSet();
    int accepted = 0;
    for (int i = 0; i < 30; i++)
        foreach (string zone in new[] { "residential", "commercial", "craft", "agricultural" })
            if (sim.QueueGrowth(zone))
            {
                accepted++;
                foreach (int cell in sim.Sites[^1].Lot.Cells)
                    Require(!occupiedByTrees.Contains(cell),
                        $"lote invade muda em {cell % width},{cell / width}");
            }
    Require(accepted > 0, "nenhuma obra aceita");
});

Check("cada construcao e registrada uma unica vez", () =>
{
    var map = Map("sim-registro");
    var sim = Sim(map, "sim-registro");
    int before = map["buildings"]!.AsArray().Count;
    int registeredBefore = sim.RegisteredBuildings;
    Require(sim.QueueGrowth("residential"), "nao abriu obra");
    var site = sim.Sites[0];
    string orientation = site.Lot.Orientation;
    int orientationAfterReserve = sim.OrientationCount(orientation);
    Require(sim.RegisteredBuildings == registeredBefore + 1,
        $"reserva registrou {sim.RegisteredBuildings - registeredBefore} predios");
    // O predio reservado e o mesmo objeto entregue na conclusao: registrar de
    // novo duplicaria contagem de orientacao e poluiria a pontuacao do planejador.
    for (int i = 0; i < 4000 && !site.IsComplete; i++) sim.Advance(.1);
    Require(site.IsComplete, "obra nao concluiu");
    Require(ReferenceEquals(site.Building, site.Reserved), "conclusao criou um segundo registro");
    Require(sim.RegisteredBuildings == registeredBefore + 1,
        $"conclusao registrou o predio de novo: {sim.RegisteredBuildings - registeredBefore} no total");
    Require(sim.OrientationCount(orientation) == orientationAfterReserve,
        "conclusao contou a orientacao duas vezes, distorcendo a pontuacao");
    Require(sim.Completed == 1, $"contador de conclusoes: {sim.Completed}");
    Require(map["buildings"]!.AsArray().Count == before, "mapa estatico foi alterado pela simulacao");
});

Check("liberar uma muda nao libera o chao de outra", () =>
{
    var map = Map("sim-liberacao");
    var sim = Sim(map, "sim-liberacao");
    int width = J.I(map, "width");
    for (int i = 0; i < 40000; i++)
    {
        bool removed = false;
        foreach (var e in sim.Advance(.1)) if (e.Kind == SimulationEventKind.TreeRemoved) removed = true;
        if (!removed || sim.Trees.Count == 0) continue;
        // Depois de uma morte, as mudas vivas continuam com o chao reservado.
        foreach (var tree in sim.Trees)
            Require(sim.IsGroundReserved(tree.X, tree.Y),
                $"muda viva perdeu a reserva em {tree.X},{tree.Y}");
        break;
    }
});

// ---------------------------------------------------------------- integration

Check("IsRunning acompanha pausa e conteudo vivo", () =>
{
    var map = Map("sim-running");
    var sim = Sim(map, "sim-running");
    Require(sim.IsRunning, "deveria estar rodando com agentes");
    sim.Speed = 0;
    Require(!sim.IsRunning, "pausado nao pode pedir redesenho");
    sim.Speed = 1;
    sim.PeopleEnabled = sim.VehiclesEnabled = sim.EcologyEnabled = false;
    Require(!sim.IsRunning, "sem obra nem agente nao ha o que desenhar");
    Require(sim.QueueGrowth("residential"), "nao abriu obra");
    Require(sim.IsRunning, "obra aberta precisa manter o desenho");
});

Check("mapa sem crescimento possivel nao quebra a simulacao", () =>
{
    var map = Map("sim-hamlet", new JsonObject { ["settlement"] = "hamlet", ["mapSize"] = 72 });
    var sim = Sim(map, "sim-hamlet");
    for (int i = 0; i < 50; i++) sim.QueueGrowth("commercial");
    for (int i = 0; i < 500; i++) sim.Advance(.1);
    Require(sim.StatusText.Length > 0, "status vazio");
});

Console.WriteLine();
Check("corredor analitico detecta cruzamento entre pontas livres",()=>{
    var road=new RoadClearance.Corridor(new(0,0),new(10,0),.5);
    Require(RoadClearance.Crosses(new(5,-2),new(5,2),road),"cruzamento perdido");
    Require(!RoadClearance.Crosses(new(1,.5),new(9,.5),road),"tangencia indevida");
    Require(!RoadClearance.Intersects(road,2,2,1,1),"lote distante bloqueado");
    Require(RoadClearance.Intersects(road,4,-1,2,2),"lote cruza corredor");
    Require(RoadClearance.Intersects(road,9.9,-.1,.2,.2),"cabeceira perdida");
});
Console.WriteLine($"Simulacao: {passed} passaram, {failed} falharam.");
return failed == 0 ? 0 : 1;
