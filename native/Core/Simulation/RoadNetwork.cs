using System.Text.Json.Nodes;

namespace Village.Core.Simulation;

/// <summary>
/// The walkable graph the agents use: the cardinal road network already
/// produced by the generator, bridges included. Edges come from the reciprocal
/// connection bitmask, so an agent can never step off a bridge into the water
/// or cut a corner across a building.
/// </summary>
public sealed class RoadNetwork
{
    readonly Dictionary<int, int> indexByCell = new();
    readonly List<int> cells = new();
    readonly List<int[]> neighbours = new();
    readonly List<bool> bridge = new();
    readonly List<string> kind = new();
    public int Width { get; }
    public int Height { get; }
    public int Count => cells.Count;

    public int CellOf(int node) => cells[node];
    public int X(int node) => cells[node] % Width;
    public int Y(int node) => cells[node] / Width;
    public bool IsBridge(int node) => bridge[node];
    public string Kind(int node) => kind[node];
    public IReadOnlyList<int> Neighbours(int node) => neighbours[node];
    public int NodeAt(int x, int y) => indexByCell.TryGetValue(y * Width + x, out int node) ? node : -1;

    public RoadNetwork(JsonObject map)
    {
        Width = J.I(map, "width");
        Height = J.I(map, "height");
        var roads = map["roads"]!.AsArray();
        var masks = new List<int>();
        foreach (var road in roads)
        {
            int x = J.I(road, "x"), y = J.I(road, "y");
            indexByCell[y * Width + x] = cells.Count;
            cells.Add(y * Width + x);
            masks.Add(J.I(road, "connections"));
            bridge.Add(J.B(road, "bridge"));
            kind.Add(J.S(road, "kind"));
        }
        (int dx, int dy, int bit, int opposite)[] steps = [(0, -1, 1, 4), (1, 0, 2, 8), (0, 1, 4, 1), (-1, 0, 8, 2)];
        for (int node = 0; node < cells.Count; node++)
        {
            var list = new List<int>(4);
            int x = X(node), y = Y(node);
            foreach (var step in steps)
            {
                if ((masks[node] & step.bit) == 0) continue;
                int other = NodeAt(x + step.dx, y + step.dy);
                // Only reciprocal links count: a one-sided mask is not a passage.
                if (other >= 0 && (masks[other] & step.opposite) != 0) list.Add(other);
            }
            neighbours.Add(list.ToArray());
        }
    }

    /// <summary>Breadth-first route between two nodes, or null when disconnected.</summary>
    public int[]? Route(int from, int to)
    {
        if (from < 0 || to < 0 || from >= cells.Count || to >= cells.Count) return null;
        if (from == to) return [from];
        var previous = new int[cells.Count];
        Array.Fill(previous, -2);
        previous[from] = -1;
        var queue = new Queue<int>();
        queue.Enqueue(from);
        while (queue.Count > 0)
        {
            int node = queue.Dequeue();
            foreach (int next in neighbours[node])
            {
                if (previous[next] != -2) continue;
                previous[next] = node;
                if (next == to)
                {
                    var path = new List<int>();
                    for (int cursor = to; cursor >= 0; cursor = previous[cursor]) path.Add(cursor);
                    path.Reverse();
                    return path.ToArray();
                }
                queue.Enqueue(next);
            }
        }
        return null;
    }

    /// <summary>Nodes reachable from a seed, used to keep every agent on one island.</summary>
    public HashSet<int> Component(int seed)
    {
        var reached = new HashSet<int>();
        if (seed < 0) return reached;
        var queue = new Queue<int>();
        queue.Enqueue(seed);
        reached.Add(seed);
        while (queue.Count > 0)
            foreach (int next in neighbours[queue.Dequeue()])
                if (reached.Add(next)) queue.Enqueue(next);
        return reached;
    }
}
