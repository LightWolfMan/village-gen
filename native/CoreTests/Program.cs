using System.Text.Json.Nodes;
using Village.Core;

string root=Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,"../../../../../"));
VillageGenerator.ConfigureCatalog(File.ReadAllText(Path.Combine(root,"native/assets/models/catalog.json")));
if(args.Length>0&&args[0]=="--export")
{
    var generated=VillageGenerator.Generate(args.Length>1?args[1]:"",args.Length>2?JsonNode.Parse(args[2])!.AsObject():null);
    Console.WriteLine(generated.ToJsonString());return;
}
bool matrix=args.Contains("--matrix");
int count=matrix?144:args.Length>0&&int.TryParse(args[0],out var parsed)?parsed:1;
var clock=System.Diagnostics.Stopwatch.StartNew();
for(int index=0;index<count;index++)
{
    string seed=$"native-{(matrix?"matrix":"regression")}-{index}";
    var settings=matrix
        ?new JsonObject{["biome"]=new[]{"temperate","arid","snowy","wetland"}[index%4],["layout"]=(index/4)%2==0?"organic":"grid",["settlement"]=new[]{"hamlet","village","town"}[(index/8)%3],["rivers"]=(index/24)%2==1,["water"]=(index/48)*.5,["mapSize"]=new[]{72,96,128}[(index/4)%3]}
        :new JsonObject{["biome"]=new[]{"temperate","arid","snowy","wetland"}[index%4],["layout"]=index%2==0?"organic":"grid",["settlement"]=new[]{"hamlet","village","town"}[index%3],["rivers"]=index%2==1,["water"]=(index%5)*.25,["mapSize"]=new[]{72,96,128}[index%3]};
    var map=VillageGenerator.Generate(seed,settings);
    if(map["validation"]!["valid"]!.GetValue<bool>()!=true)throw new Exception($"Validation failed {seed}");
    // Verify the entire rotated model footprint, not only its origin tile.
    var propCatalog=JsonNode.Parse(File.ReadAllText(Path.Combine(root,"native/assets/models/catalog.json")))!.AsArray();
    foreach(var prop in map["props"]!.AsArray())
    {
        string type=J.S(prop,"type"),asset=type=="oak"?new[]{"oak","birch","elm"}[J.I(prop,"variant")%3]:type;
        var model=propCatalog.First(n=>J.S(n,"id")=="prop:"+asset)!;
        var bounds=model["bounds"]!;double angle=J.D(prop,"variant")*Math.PI/3,c=Math.Cos(angle),s=Math.Sin(angle);
        double minX=double.PositiveInfinity,minY=minX,maxX=double.NegativeInfinity,maxY=maxX;
        foreach(var xx in new[]{J.Number(bounds["min"]![0]),J.Number(bounds["max"]![0])})foreach(var zz in new[]{J.Number(bounds["min"]![2]),J.Number(bounds["max"]![2])})
        {double x=J.D(prop,"x")+.5+xx*c+zz*s,y=J.D(prop,"y")+.5-xx*s+zz*c;minX=Math.Min(minX,x);maxX=Math.Max(maxX,x);minY=Math.Min(minY,y);maxY=Math.Max(maxY,y);}
        foreach(var road in map["roads"]!.AsArray())if(minX<J.D(road,"x")+1&&maxX>J.D(road,"x")&&minY<J.D(road,"y")+1&&maxY>J.D(road,"y"))throw new Exception($"Prop footprint overlaps road: {seed}/{prop!["id"]}");
    }
    if(index==0)
    {
        var copy=VillageGenerator.Generate(seed,map["settings"]!.AsObject());if(!JsonNode.DeepEquals(map,copy))throw new Exception("Non-deterministic output");
        var catalogRoot=JsonNode.Parse(File.ReadAllText(Path.Combine(root,"native/assets/models/catalog.json")))!;
        var models=catalogRoot is JsonArray modelArray?modelArray:catalogRoot["models"]!.AsArray();
        void Reject(Action<JsonObject> corrupt,string label){var bad=(JsonObject)map.DeepClone();corrupt(bad);if(VillageValidation.Validate(bad,models)["valid"]!.GetValue<bool>())throw new Exception("Validator accepted "+label);}
        Reject(bad=>bad["heightLevel"]![0]=99,"invalid elevation");
        Reject(bad=>bad["buildings"]![0]!["assetId"]="missing:model","missing model");
        Reject(bad=>{var cell=bad["lots"]![0]!["cells"]![0]!;bad["terrain"]![J.I(cell,"y")*J.I(bad,"width")+J.I(cell,"x")]="water";},"wet lot");
        Reject(bad=>bad["buildings"]![0]!["door"]!["x"]=-20,"disconnected door");
    }
    Console.WriteLine($"PASS {index+1}/{count} {seed} houses={map["stats"]!["houses"]} elapsed={clock.Elapsed.TotalSeconds:F1}s");
}
Console.WriteLine($"Passed {count} native seeds in {clock.Elapsed.TotalSeconds:F1}s.");
