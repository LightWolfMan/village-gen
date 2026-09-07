using System.Text.Json.Nodes;

namespace Village.Core.Simulation;

public enum BuildStage { Marking, Foundation, Structure, Roofing, Complete }

/// <summary>
/// One building under construction. The stages are real states with their own
/// duration and their own volume on the ground; the finished model only appears
/// at <see cref="BuildStage.Complete"/>. Nothing is revealed from a village that
/// was already standing.
/// </summary>
public sealed class ConstructionSite
{
    /// <summary>Steps per stage at 0.1 s each: roughly 24 s of work at 1x.</summary>
    public static readonly int[] StageSteps = [40, 60, 80, 60];

    public GrowthLot Lot { get; }
    public BuildStage Stage { get; private set; } = BuildStage.Marking;
    public int StepsInStage { get; private set; }
    public JsonObject? Building { get; private set; }
    public int Number { get; }

    /// <summary>
    /// The building record created when the lot was reserved. The ground is
    /// taken from that moment, so it is registered once; only its visible model
    /// waits for <see cref="BuildStage.Complete"/>.
    /// </summary>
    public JsonObject Reserved { get; }

    public ConstructionSite(GrowthLot lot, int number, JsonObject reserved)
    {
        Lot = lot;
        Number = number;
        Reserved = reserved;
    }

    public bool IsComplete => Stage == BuildStage.Complete;

    /// <summary>Fraction of the current stage already done, 0..1.</summary>
    public double StageProgress => IsComplete ? 1 : Math.Min(1, (double)StepsInStage / StageSteps[(int)Stage]);

    /// <summary>Overall progress across every stage, 0..1.</summary>
    public double Progress
    {
        get
        {
            if (IsComplete) return 1;
            int total = StageSteps.Sum(), done = 0;
            for (int i = 0; i < (int)Stage; i++) done += StageSteps[i];
            return (done + Math.Min(StepsInStage, StageSteps[(int)Stage])) / (double)total;
        }
    }

    /// <summary>Advances one fixed step. Returns true when the stage changed.</summary>
    public bool Step()
    {
        if (IsComplete) return false;
        StepsInStage++;
        if (StepsInStage < StageSteps[(int)Stage]) return false;
        StepsInStage = 0;
        Stage = (BuildStage)((int)Stage + 1);
        return true;
    }

    public void Finish(JsonObject building) => Building = building;

    public string Describe() => Stage switch
    {
        BuildStage.Marking => "marcacao",
        BuildStage.Foundation => "fundacao",
        BuildStage.Structure => "estrutura",
        BuildStage.Roofing => "cobertura",
        _ => "concluida"
    };
}
