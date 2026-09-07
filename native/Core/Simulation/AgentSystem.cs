using System.Text.Json.Nodes;

namespace Village.Core.Simulation;

public enum AgentKind { Person, Cart }

/// <summary>A villager or cart moving along the cardinal road graph.</summary>
public sealed class Agent
{
    public AgentKind Kind;
    public int Home, Destination;
    public int[] Route = [];
    public int Leg;
    public double LegProgress;
    public double Speed;
    public int WaitSteps;
    public double X, Y, Heading;
    public bool Active;
}

/// <summary>
/// Small population of people and carts walking home to work and back. Routes
/// come from <see cref="RoadNetwork"/>, so an agent only ever occupies road and
/// bridge cells and never crosses water or a building.
/// </summary>
public sealed class AgentSystem
{
    readonly RoadNetwork network;
    readonly List<Agent> agents = new();
    readonly List<int> homes = new();
    readonly List<int> destinations = new();
    readonly RandomSource random;

    public IReadOnlyList<Agent> Agents => agents;
    public int PeopleCount => agents.Count(a => a.Kind == AgentKind.Person);
    public int CartCount => agents.Count(a => a.Kind == AgentKind.Cart);

    public AgentSystem(JsonObject map, RoadNetwork network, RandomSource random)
    {
        this.network = network;
        this.random = random;
        // Doors are the anchor: every building already owns a straight, dry road
        // cell, which makes it a valid node without any extra search.
        foreach (var building in map["buildings"]!.AsArray())
        {
            var door = building!["door"]!;
            int node = network.NodeAt(J.I(door, "x"), J.I(door, "y"));
            if (node < 0 || network.IsBridge(node)) continue;
            if (J.S(building, "type") == "house") homes.Add(node);
            else destinations.Add(node);
        }
        // A village with no service still gives people somewhere to go: the plaza.
        if (destinations.Count == 0)
        {
            var plaza = map["plaza"]!;
            int node = network.NodeAt(J.I(plaza, "x") + J.I(plaza, "width") / 2, J.I(plaza, "y") + J.I(plaza, "height") / 2);
            if (node >= 0) destinations.Add(node);
        }
    }

    /// <summary>Registers a house that the simulation itself built.</summary>
    public void AddHome(int doorX, int doorY)
    {
        int node = network.NodeAt(doorX, doorY);
        if (node >= 0 && !network.IsBridge(node)) homes.Add(node);
    }

    /// <summary>Creates the population once the network is known to be connected.</summary>
    public void Populate(int people, int carts)
    {
        if (homes.Count == 0 || destinations.Count == 0) return;
        // Everyone must share one connected island, otherwise an agent would sit
        // still forever waiting for a route that cannot exist.
        var component = network.Component(homes[0]);
        var validHomes = homes.Where(component.Contains).ToList();
        var validDestinations = destinations.Where(component.Contains).ToList();
        if (validHomes.Count == 0 || validDestinations.Count == 0) return;
        for (int i = 0; i < people + carts; i++)
        {
            var agent = new Agent
            {
                Kind = i < people ? AgentKind.Person : AgentKind.Cart,
                Home = validHomes[random.Int(0, validHomes.Count - 1)],
                Destination = validDestinations[random.Int(0, validDestinations.Count - 1)],
                Speed = i < people ? 1.6 : 1.1,
                WaitSteps = random.Int(0, 40)
            };
            agent.X = network.X(agent.Home) + .5;
            agent.Y = network.Y(agent.Home) + .5;
            agents.Add(agent);
        }
    }

    /// <summary>One fixed step for every agent of an enabled kind.</summary>
    public void Step(double stepSeconds, bool people, bool vehicles)
    {
        foreach (var agent in agents)
        {
            bool enabled = agent.Kind == AgentKind.Person ? people : vehicles;
            agent.Active = enabled;
            if (!enabled) continue;
            if (agent.WaitSteps > 0) { agent.WaitSteps--; continue; }
            if (agent.Route.Length < 2)
            {
                int from = agent.Route.Length == 1 ? agent.Route[0] : agent.Home;
                int to = from == agent.Destination ? agent.Home : agent.Destination;
                var route = network.Route(from, to);
                if (route == null || route.Length < 2) { agent.WaitSteps = 30; agent.Route = [from]; continue; }
                agent.Route = route;
                agent.Leg = 0;
                agent.LegProgress = 0;
            }
            agent.LegProgress += agent.Speed * stepSeconds;
            while (agent.LegProgress >= 1 && agent.Leg < agent.Route.Length - 1)
            {
                agent.LegProgress -= 1;
                agent.Leg++;
            }
            if (agent.Leg >= agent.Route.Length - 1)
            {
                int arrival = agent.Route[^1];
                agent.X = network.X(arrival) + .5;
                agent.Y = network.Y(arrival) + .5;
                agent.Route = [arrival];
                agent.Leg = 0;
                agent.LegProgress = 0;
                agent.WaitSteps = random.Int(20, 80);
                continue;
            }
            int a = agent.Route[agent.Leg], b = agent.Route[agent.Leg + 1];
            double ax = network.X(a) + .5, ay = network.Y(a) + .5;
            double bx = network.X(b) + .5, by = network.Y(b) + .5;
            double t = Math.Clamp(agent.LegProgress, 0, 1);
            agent.X = ax + (bx - ax) * t;
            agent.Y = ay + (by - ay) * t;
            if (bx != ax || by != ay) agent.Heading = Math.Atan2(bx - ax, by - ay);
        }
    }

    public void Clear() => agents.Clear();
}
