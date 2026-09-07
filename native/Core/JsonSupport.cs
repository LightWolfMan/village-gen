using System.Text.Json;
using System.Text.Json.Nodes;
namespace Village.Core;

internal static class J
{
    public static int I(JsonNode? n,string key) => (int)D(n,key);
    public static double D(JsonNode? n,string key) => Number(n?[key]);
    public static double Number(JsonNode? node) { if(node is not JsonValue v)return 0;if(v.TryGetValue<double>(out var d))return d;if(v.TryGetValue<int>(out var i))return i;if(v.TryGetValue<long>(out var l))return l;return double.Parse(v.ToJsonString(),System.Globalization.CultureInfo.InvariantCulture); }
    public static string S(JsonNode? n,string key) => n?[key]?.GetValue<string>() ?? "";
    public static bool B(JsonNode? n,string key) => n?[key]?.GetValue<bool>() ?? false;
    public static JsonObject O(params object?[] pairs)
    {
        var result=new JsonObject();
        for(int i=0;i<pairs.Length;i+=2) result[(string)pairs[i]!] = Node(pairs[i+1]);
        return result;
    }
    public static JsonNode? Node(object? value) => value is JsonNode node ? node.DeepClone() : JsonSerializer.SerializeToNode(value);
    public static JsonArray A<T>(IEnumerable<T> values) { var result=new JsonArray();foreach(var value in values)result.Add(Node(value));return result; }
    public static JsonObject P(Point point) => O("x",point.X,"y",point.Y);
    public static Point Point(JsonNode? point) => new(I(point,"x"),I(point,"y"));
}

internal sealed record Biome(string Shore,string Ground,string Grove,string Tree,double Moisture,string[] Residential,string[] Agricultural,string[] Materials,string[] Roofs);
internal sealed record Settings(int MapSize,string Biome,double Water,bool Rivers,string Layout,string Settlement)
{
    public JsonObject Json => J.O("mapSize",MapSize,"biome",Biome,"water",Water,"rivers",Rivers,"layout",Layout,"settlement",Settlement);
}
internal sealed class MapData(string seed,Settings settings,Biome biome)
{
    public string Seed=seed;
    public Settings Settings=settings;
    public Biome Biome=biome;
    public int Width=>Settings.MapSize;
    public int Height=>Width;
    public string[] Terrain=new string[settings.MapSize*settings.MapSize];
    public int[] Levels=new int[settings.MapSize*settings.MapSize];
    public string[] ZoneMap=new string[settings.MapSize*settings.MapSize];
    public double WaterLine;
    public JsonObject Plaza=new(),GridSpec=new();
    public JsonObject? Campus;
    public JsonArray Zones=new(),BridgeSpans=new();
    public List<JsonObject> Roads=[];
    public Dictionary<Point,RoadRecord> RoadMap=[];
    public Point Center=>new(J.I(Plaza,"x")+J.I(Plaza,"width")/2,J.I(Plaza,"y")+J.I(Plaza,"height")/2);
    public bool InCampus(int x,int y)=>Campus!=null&&x>=J.I(Campus,"x")&&y>=J.I(Campus,"y")&&x<J.I(Campus,"x")+J.I(Campus,"width")&&y<J.I(Campus,"y")+J.I(Campus,"height");
    public void Flatten(int x,int y,int width,int height,int level,string? terrain=null)
    {for(int py=y;py<y+height;py++)for(int px=x;px<x+width;px++){int i=py*Width+px;Levels[i]=level;if(Terrain[i]=="water"||terrain!=null)Terrain[i]=terrain??Biome.Ground;}}
    public JsonObject Json()=>J.O("schemaVersion",4,"seed",Seed,"settings",Settings.Json,"width",Width,"height",Height,"waterLine",WaterLine,"terrain",J.A(Terrain),"heightLevel",J.A(Levels),"roadTopology",Settings.Layout=="grid"?"orthogonal-cardinal":"organic-cardinal","gridSpec",Settings.Layout=="grid"?GridSpec:null,"plaza",Plaza,"civicCampus",Campus,"roads",J.A(Roads),"bridgeSpans",BridgeSpans,"zoneMap",J.A(ZoneMap),"zones",Zones);
}
internal sealed class RoadRecord(string kind)
{ public string Kind=kind; public int Connections; public string? BridgeAxis; }
