using System.Text.Json.Nodes;

namespace Village.Core.Simulation;

public sealed partial class VillageSimulationModel
{
    readonly JsonArray history=new();
    bool replaying;
    int Flags => (PeopleEnabled?1:0)|(VehiclesEnabled?2:0)|(EcologyEnabled?4:0);
    void SetFlags(int flags){PeopleEnabled=(flags&1)!=0;VehiclesEnabled=(flags&2)!=0;EcologyEnabled=(flags&4)!=0;}
    void Record(int steps,string? zone)
    {
        if(replaying)return;
        if(zone==null&&history.LastOrDefault() is JsonObject last&&last["zone"]==null&&last["flags"]!.GetValue<int>()==Flags){
            last["steps"]=last["steps"]!.GetValue<long>()+steps;return;
        }
        history.Add(new JsonObject{["steps"]=(long)steps,["flags"]=Flags,["zone"]=zone});
    }
    public JsonObject CaptureState()=>new(){["version"]=2,["history"]=history.DeepClone(),["flags"]=Flags,
        ["steps"]=Steps,["backlog"]=clock.Backlog,["speed"]=Speed};

    // Replays core steps only, never intermediate meshes. Bound work for malformed files.
    public static VillageSimulationModel Restore(JsonObject map,JsonArray catalog,string seed,JsonObject state)
    {
        if(state["version"]?.GetValue<int>()!=2)throw new InvalidDataException("Versão de simulação incompatível.");
        var rows=state["history"] as JsonArray??throw new InvalidDataException("Histórico ausente.");
        long expected=state["steps"]!.GetValue<long>();double backlog=state["backlog"]!.GetValue<double>();
        int flags=state["flags"]!.GetValue<int>();double speed=state["speed"]!.GetValue<double>();
        if(rows.Count>100000||expected<0||expected>1000000||!double.IsFinite(backlog)||backlog<0||backlog>=SimulationClock.Step||flags<0||flags>7||speed is not (0 or 1 or 2))
            throw new InvalidDataException("Estado de simulação fora dos limites suportados.");
        long total=0;
        foreach(var row in rows){
            long steps=row!["steps"]!.GetValue<long>();int mask=row["flags"]!.GetValue<int>();string? zone=row["zone"]?.GetValue<string>();
            if(steps<0||steps>1000000||mask<0||mask>7||(zone!=null&&(steps!=0||zone is not ("residential" or "commercial" or "craft" or "agricultural"))))throw new InvalidDataException("Comando de simulação inválido.");
            total+=steps;if(total>1000000)throw new InvalidDataException("Histórico longo demais.");
        }
        if(total!=expected)throw new InvalidDataException("Histórico incompleto.");
        var result=new VillageSimulationModel(map,catalog,seed){replaying=true};
        foreach(var row in rows){
            result.SetFlags(row!["flags"]!.GetValue<int>());
            if(row["zone"] is JsonNode zone)result.QueueGrowth(zone.GetValue<string>());
            for(long i=0;i<row["steps"]!.GetValue<long>();i++){result.Step();result.events.Clear();}
            result.events.Clear();
        }
        result.replaying=false;foreach(var row in rows)result.history.Add(row!.DeepClone());
        result.SetFlags(flags);result.clock.Restore(expected,backlog);result.Speed=speed;return result;
    }
}
