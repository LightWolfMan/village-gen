namespace Village.Core.Simulation;

/// <summary>
/// Fixed-step clock. The simulation only ever advances in whole steps, so the
/// result depends on how many steps ran and never on the frame rate.
/// Time lost while the window was suspended is discarded instead of being
/// replayed as a burst of catch-up steps.
/// </summary>
public sealed class SimulationClock
{
    public const double Step = .1;
    /// <summary>Longest backlog kept between calls. Anything older is dropped.</summary>
    public const double MaxBacklog = .5;

    double speed = 1;
    double backlog;

    /// <summary>0 paused, 1 normal, 2 accelerated. Other values are clamped.</summary>
    public double Speed
    {
        get => speed;
        set => speed = value <= 0 ? 0 : value >= 2 ? 2 : 1;
    }

    public long Steps { get; private set; }
    public double Elapsed => Steps * Step;
    public double Backlog => backlog;
    public bool IsRunning => speed > 0;

    /// <summary>Converts a real frame delta into whole simulation steps.</summary>
    public int Advance(double realDeltaSeconds)
    {
        if (speed <= 0) return 0;
        if (!double.IsFinite(realDeltaSeconds) || realDeltaSeconds <= 0) return 0;
        // A frame longer than the backlog window means the app was suspended or
        // stalled; simulating that gap would teleport every agent at once.
        backlog = Math.Min(backlog + realDeltaSeconds * speed, MaxBacklog);
        int steps = 0;
        while (backlog >= Step) { backlog -= Step; steps++; Steps++; }
        return steps;
    }

    public void Reset() { backlog = 0; Steps = 0; }
    internal void Restore(long steps,double remainder) { Steps=steps;backlog=remainder; }
}
