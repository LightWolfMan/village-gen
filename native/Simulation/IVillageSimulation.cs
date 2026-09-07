using System.Text.Json.Nodes;
using Village.Rendering;

namespace Village.Simulation;

/// <summary>Boundary between the HUD (Codex) and simulation implementation (Claude).</summary>
public interface IVillageSimulation : IDisposable
{
    double Speed { get; set; } // 0 paused, 1 normal, 2 accelerated.
    bool PeopleEnabled { get; set; }
    bool VehiclesEnabled { get; set; }
    bool EcologyEnabled { get; set; }
    string StatusText { get; }
    bool IsRunning { get; }
    void Advance(double realDeltaSeconds);
    bool QueueGrowth(string zone); // residential, commercial, craft, agricultural.
    JsonObject CaptureState();
}

public static class SimulationHost
{
    // Null still means unavailable: a map without the fields the growth planner
    // needs gets no simulation at all instead of fake progress.
    public static IVillageSimulation? Create(VillageScene scene, JsonObject map)
    {
        if (map["roads"] is not JsonArray || map["lots"] is not JsonArray
            || map["buildings"] is not JsonArray || map["zoneMap"] is not JsonArray) return null;
        try { return new VillageSimulation(scene, map); }
        catch (Exception error)
        {
            Godot.GD.PushWarning($"Simulacao indisponivel: {error.Message}");
            return null;
        }
    }
}
