using System.Text.Json.Nodes;

namespace Village.Core.Simulation;

public enum SimulationEventKind { SiteStarted, SiteStageChanged, SiteCompleted, TreePlanted, TreeStageChanged, TreeRemoved }

public readonly record struct SimulationEvent(SimulationEventKind Kind, ConstructionSite? Site, SimTree? Tree);

/// <summary>
/// Engine-independent simulation state: the fixed clock, the queue of building
/// works, the agents and the tree cycle. Everything Godot needs is exposed as
/// data plus a list of events per call, so the renderer only touches what
/// actually changed instead of rebuilding the map.
/// </summary>
public sealed partial class VillageSimulationModel
{
    readonly SimulationClock clock = new();
    readonly GrowthPlanner planner;
    readonly RoadNetwork network;
    readonly AgentSystem agents;
    readonly Ecology ecology;
    readonly RandomSource random;
    readonly List<ConstructionSite> sites = new();
    readonly List<SimulationEvent> events = new();
    int completed;
    int plantTimer;
    int reasonSteps;

    public VillageSimulationModel(JsonObject map, JsonArray models, string seed)
    {
        random = new RandomSource($"{seed}:simulation");
        planner = new GrowthPlanner(map, models);
        network = new RoadNetwork(map);
        agents = new AgentSystem(map, network, random.Fork("agents"));
        ecology = new Ecology(map, planner, random.Fork("ecology"));
        int people = Math.Clamp(map["buildings"]!.AsArray().Count / 6, 3, 14);
        agents.Populate(people, Math.Clamp(people / 4, 1, 4));
    }

    public double Speed { get => clock.Speed; set => clock.Speed = value; }
    public bool PeopleEnabled { get; set; } = true;
    public bool VehiclesEnabled { get; set; } = true;
    public bool EcologyEnabled { get; set; } = true;
    public long Steps => clock.Steps;
    public IReadOnlyList<ConstructionSite> Sites => sites;
    public IReadOnlyList<Agent> Agents => agents.Agents;
    public IReadOnlyList<SimTree> Trees => ecology.Trees;
    public RoadNetwork Network => network;
    public int Completed => completed;
    public int ActiveWorks => sites.Count(s => !s.IsComplete);
    public string LastGrowthReason { get; private set; } = "";

    /// <summary>The viewport only needs to keep drawing while something moves.</summary>
    public bool IsRunning => clock.IsRunning && (ActiveWorks > 0
        || (PeopleEnabled && agents.PeopleCount > 0)
        || (VehiclesEnabled && agents.CartCount > 0)
        || (EcologyEnabled && ecology.Alive > 0));

    public string StatusText
    {
        get
        {
            // O HUD le StatusText logo apos um QueueGrowth falso, entao o motivo
            // vem na frente mesmo com obras abertas, e some sozinho depois.
            var parts = new List<string>();
            if (LastGrowthReason.Length > 0 && reasonSteps > 0) parts.Add(LastGrowthReason);
            parts.Add(ActiveWorks > 0
                ? $"{ActiveWorks} obra{(ActiveWorks > 1 ? "s" : "")} em andamento ({sites.First(s => !s.IsComplete).Describe()})"
                : "Nenhuma obra em andamento");
            if (completed > 0) parts.Add($"{completed} concluida{(completed > 1 ? "s" : "")}");
            if (PeopleEnabled && agents.PeopleCount > 0) parts.Add($"{agents.PeopleCount} moradores");
            if (VehiclesEnabled && agents.CartCount > 0) parts.Add($"{agents.CartCount} carrocas");
            if (EcologyEnabled && ecology.Alive > 0) parts.Add($"{ecology.Alive} mudas");
            parts.Add(clock.Speed == 0 ? "pausado" : $"{clock.Speed:0}x");
            return string.Join(" · ", parts);
        }
    }

    /// <summary>Reserves a lot and opens a building site in the district.</summary>
    public bool QueueGrowth(string zone)
    {
        Record(0,zone);
        var lot = planner.Propose(zone, random.Fork($"growth:{sites.Count}"));
        if (lot == null)
        {
            LastGrowthReason = planner.LastReason;
            reasonSteps = 50; // cinco segundos simulados
            return false;
        }
        // The lot is taken the moment the work opens, so a second request in the
        // same district cannot be handed the same ground. Registering it here and
        // again on completion used to count the same house twice and skew the
        // orientation balance the planner scores with.
        var reserved = planner.Commit(lot, sites.Count + 1);
        var site = new ConstructionSite(lot, sites.Count + 1, reserved);
        sites.Add(site);
        ecology.BlockBuilding(lot);
        LastGrowthReason = "";
        reasonSteps = 0;
        events.Add(new SimulationEvent(SimulationEventKind.SiteStarted, site, null));
        return true;
    }

    /// <summary>
    /// Converts a real frame delta into whole steps and drains what changed.
    /// Events queued outside a step — opening a work site, for one — survive
    /// until they are delivered, so a site started while paused still shows its
    /// marking instead of appearing only at the next stage change.
    /// </summary>
    public IReadOnlyList<SimulationEvent> Advance(double realDeltaSeconds)
    {
        int steps = clock.Advance(realDeltaSeconds);
        if(steps>0)Record(steps,null);
        for (int i = 0; i < steps; i++) Step();
        var drained = events.ToArray();
        events.Clear();
        return drained;
    }

    void Step()
    {
        if (reasonSteps > 0) reasonSteps--;
        foreach (var site in sites)
        {
            if (site.IsComplete) continue;
            if (!site.Step()) continue;
            if (site.IsComplete)
            {
                completed++;
                site.Finish(site.Reserved);
                agents.AddHome(site.Lot.DoorX, site.Lot.DoorY);
                events.Add(new SimulationEvent(SimulationEventKind.SiteCompleted, site, null));
            }
            else events.Add(new SimulationEvent(SimulationEventKind.SiteStageChanged, site, null));
        }
        agents.Step(SimulationClock.Step, PeopleEnabled, VehiclesEnabled);
        if (!EcologyEnabled) return;
        var (changed, removed) = ecology.Step();
        foreach (var tree in changed) events.Add(new SimulationEvent(SimulationEventKind.TreeStageChanged, null, tree));
        foreach (var tree in removed) events.Add(new SimulationEvent(SimulationEventKind.TreeRemoved, null, tree));
        if (++plantTimer < 260) return;
        plantTimer = 0;
        var planted = ecology.Plant();
        if (planted != null) events.Add(new SimulationEvent(SimulationEventKind.TreePlanted, null, planted));
    }

    public string TreeSpecies => ecology.Species;

    /// <summary>Whether a cell is reserved against new construction.</summary>
    public bool IsGroundReserved(int x, int y) => planner.IsOccupied(x, y);

    public int RegisteredBuildings => planner.RegisteredBuildings;
    public int OrientationCount(string orientation) => planner.OrientationCount(orientation);
}
