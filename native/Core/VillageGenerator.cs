using System.Text.Json.Nodes;
namespace Village.Core;

/// <summary>Native, engine-independent implementation of the schema-v4 procedural generator.</summary>
public static partial class VillageGenerator
{
    private static JsonArray catalog=new();
    public static void ConfigureCatalog(string json)
    {var node=JsonNode.Parse(json);catalog=(JsonArray)(node is JsonArray array?array:node?["models"]??node?["MODEL_CATALOG"]??throw new ArgumentException("Catalog must contain models"));}
    internal static readonly Dictionary<string,Biome> Biomes=new()
    {
        ["temperate"]=new("sand","grass","forest","oak",.67,["timber-frame","stone-cottage","wattle-cottage"],["farmstead","timber-longhouse"],["timber","plaster","fieldstone"],["thatch","clay-tile","wood-shingle"]),
        ["arid"]=new("sand","dry-grass","scrub","cactus",.78,["adobe-courtyard","sandstone-house","mudbrick-house"],["desert-farmstead","mudbrick-compound"],["adobe","sandstone","mudbrick"],["flat-earth","clay-tile","reed-mat"]),
        ["snowy"]=new("ice","snow","pine-forest","pine",.62,["alpine-chalet","stone-lodge","timber-cabin"],["snow-longhouse","mountain-farmstead"],["pine-timber","granite","lime-plaster"],["steep-slate","steep-wood","heavy-thatch"]),
        ["wetland"]=new("marsh","wet-grass","swamp-forest","willow",.55,["stilt-house","reed-cottage","raised-timber-house"],["marsh-farmstead","raised-longhouse"],["timber","wattle","riverstone"],["reed-thatch","wood-shingle","moss-thatch"])
    };
    internal static readonly Dictionary<string,(int Minimum,int Maximum,string[] Services)> Settlements=new()
    {
        ["hamlet"]=(10,18,["inn","shop"]),["village"]=(25,40,["inn","shop","smithy","hall"]),["town"]=(55,85,["inn","shop","smithy","hall","chapel","market","mill","tower"])
    };
    private static readonly Dictionary<string,string[]> ServiceArchitectures=new()
    {
        ["inn"]=["coaching-inn","gabled-tavern"],["shop"]=["merchant-house","arcaded-shop"],["smithy"]=["forge-workshop","stone-smithy"],["hall"]=["guildhall","manor-hall"],["chapel"]=["parish-chapel","stone-sanctuary"],["market"]=["covered-market","trading-hall"],["mill"]=["water-mill","post-mill"],["tower"]=["watchtower","gate-tower"]
    };
    internal static readonly Point[] Directions=[new(1,0),new(-1,0),new(0,1),new(0,-1)];
    internal static int Round(double d)=>(int)Math.Floor(d+.5);
    static double InputNumber(JsonNode? node)
    {
        if(node==null)return 0;
        if(node is JsonValue value)
        {
            if(value.TryGetValue<bool>(out bool boolean))return boolean?1:0;
            if(value.TryGetValue<string>(out string? text))
            {
                text=text.Trim();if(text.Length==0)return 0;
                if(text.StartsWith("0x",StringComparison.OrdinalIgnoreCase)&&long.TryParse(text[2..],System.Globalization.NumberStyles.HexNumber,System.Globalization.CultureInfo.InvariantCulture,out long hex))return hex;
                return double.TryParse(text,System.Globalization.NumberStyles.Float,System.Globalization.CultureInfo.InvariantCulture,out double parsed)?parsed:double.NaN;
            }
            return J.Number(node);
        }
        if(node is JsonArray array){if(array.Count==0)return 0;if(array.Count==1)return InputNumber(array[0]);}
        return double.NaN;
    }
    static string InputString(JsonNode? node)=>node is JsonValue value&&value.TryGetValue<string>(out string? text)?text:"";
    static Settings Normalize(JsonObject? input)
    {
        input??=new();double requestedSize=InputNumber(input["mapSize"]);int size=requestedSize==72?72:requestedSize==128?128:96;
        string biome=InputString(input["biome"]);if(!Biomes.ContainsKey(biome))biome="temperate";
        double water=input.ContainsKey("water")?InputNumber(input["water"]):.35;if(!double.IsFinite(water))water=.35;
        string settlement=InputString(input["settlement"]);if(!Settlements.ContainsKey(settlement))settlement="village";if(settlement=="town")size=128;
        bool rivers=input["rivers"] is JsonValue riverValue&&riverValue.TryGetValue<bool>(out bool riverFlag)&&riverFlag;
        return new(size,biome,Math.Clamp(water,0,1),rivers,InputString(input["layout"])=="grid"?"grid":"organic",settlement);
    }
    public static JsonObject Generate(string seed,JsonObject? settings=null)
    {
        if(catalog.Count==0)throw new InvalidOperationException("ConfigureCatalog must be called before generation.");
        var normalized=Normalize(settings);Exception? last=null;
        for(int choice=0;choice<4;choice++)try{return Build(seed??"",normalized,choice);}catch(Exception error)when(error.Message.StartsWith("Parcelamento insuficiente",StringComparison.Ordinal)){last=error;}
        throw last!;
    }
    static JsonObject Build(string seed,Settings settings,int choice)
    {
        uint numericSeed=RandomSource.HashString(seed);var random=new RandomSource(seed+":v4");var m=new MapData(seed,settings,Biomes[settings.Biome]);
        CreateTerrain(m,numericSeed);if(settings.Rivers)CarveRiver(m,numericSeed,random.Fork("river"));
        ChoosePlaza(m,random.Fork("plaza"),choice);ReserveCampus(m);
        for(int y=J.I(m.Plaza,"y");y<J.I(m.Plaza,"y")+J.I(m.Plaza,"height");y++)RoadTopology.AddPath(m,Enumerable.Range(J.I(m.Plaza,"x"),J.I(m.Plaza,"width")).Select(x=>new Point(x,y)).ToList(),"plaza");
        for(int x=J.I(m.Plaza,"x");x<J.I(m.Plaza,"x")+J.I(m.Plaza,"width");x++)RoadTopology.AddPath(m,Enumerable.Range(J.I(m.Plaza,"y"),J.I(m.Plaza,"height")).Select(y=>new Point(x,y)).ToList(),"plaza");
        CreateCampusPerimeter(m);if(settings.Layout=="grid")CreateGridRoads(m,random.Fork("grid"));else CreateOrganicRoads(m,random.Fork("organic"));
        SmoothRoadHeights(m);RoadTopology.Finalize(m);CreateZones(m);RoadTopology.Finalize(m);
        JsonObject map=m.Json();var settlement=Settlements[settings.Settlement];
        var placement=UrbanPlanner.Create(map,random.Fork("urbanism"),random.Fork("population").Int(settlement.Minimum,settlement.Maximum),settlement.Services,catalog,
            (x,y,w,h,level,zone)=>{m.Flatten(x,y,w,h,level,m.Biome.Ground);for(int py=y;py<y+h;py++)for(int px=x;px<x+w;px++){int index=py*m.Width+px;map["terrain"]![index]=m.Terrain[index];map["heightLevel"]![index]=level;}},
            (type,zone,rng)=>BuildingStyle(m,type,zone,rng));
        map["roadSegments"]=placement.RoadSegments;map["frontages"]=placement.Frontages;map["lots"]=placement.Lots;map["buildings"]=placement.Buildings;
        // Parcel retries restore the JSON snapshots; synchronize before props and final zoning.
        m.Terrain=map["terrain"]!.AsArray().Select(n=>n!.GetValue<string>()).ToArray();
        m.Levels=map["heightLevel"]!.AsArray().Select(n=>(int)J.Number(n)).ToArray();
        FinalizeZones(m);map["zoneMap"]=J.A(m.ZoneMap);map["zones"]=m.Zones.DeepClone();
        map["props"]=PlaceProps(m,random.Fork("props"),placement.Reserved,placement.Buildings);
        map["stats"]=J.O("houses",placement.Buildings.Count(b=>J.S(b,"type")=="house"),"services",placement.Buildings.Count(b=>J.S(b,"type")!="house"),"bridges",m.BridgeSpans.Count,"terrainCounts",J.Node(m.Terrain.GroupBy(t=>t).ToDictionary(g=>g.Key,g=>g.Count())),"zoneCounts",J.Node(m.Zones.ToDictionary(z=>J.S(z,"type"),z=>J.I(z,"cellCount"))));
        if(settings.Settlement=="hamlet")
        {
            var compatible=new Dictionary<string,string[]>{["residential"]=["residential","commercial","civic"],["commercial"]=["residential","commercial","craft","civic"],["craft"]=["craft","commercial"],["civic"]=["civic","commercial","residential"]};
            var urban=placement.Buildings.Where(b=>J.S(b,"zone")!="agricultural").ToList();
            int clustered=urban.Count(b=>placement.Buildings.Any(o=>o!=b&&compatible[J.S(b,"zone")].Contains(J.S(o,"zone"))&&Math.Sqrt(Math.Pow(Math.Max(0,Math.Max(J.I(o,"x")-J.I(b,"x")-J.I(b,"width"),J.I(b,"x")-J.I(o,"x")-J.I(o,"width"))),2)+Math.Pow(Math.Max(0,Math.Max(J.I(o,"y")-J.I(b,"y")-J.I(b,"height"),J.I(b,"y")-J.I(o,"y")-J.I(o,"height"))),2))<=8));
            if((double)clustered/urban.Count<.9)throw new InvalidOperationException($"Parcelamento insuficiente para vizinhança funcional na seed {seed}");
        }
        map["validation"]=VillageValidation.Validate(map,catalog);
        if(!J.B(map["validation"],"valid"))throw new InvalidOperationException($"Mapa inválido para a seed {seed}: {map["validation"]!["errors"]}");
        return map;
    }
    static JsonObject BuildingStyle(MapData m,string type,string zone,RandomSource r)
    {
        var b=m.Biome;List<string> architectures;
        if(type=="house")
        {
            architectures=zone=="craft"?[..b.Residential,"artisan-house","workshop-dwelling"]:zone=="commercial"?[..b.Residential,"merchant-dwelling","shop-house"]:zone=="agricultural"?[..b.Agricultural]:[..b.Residential];
            if(m.Settings.Settlement=="town"&&zone=="residential")architectures.AddRange(["urban-townhouse","artisan-rowhouse"]);
            if(m.Settings.Settlement=="hamlet")architectures.Add(zone=="agricultural"?"croft-farm":"rural-cottage");
        }else architectures=[..ServiceArchitectures[type]];
        string[] materials=zone=="civic"?[b.Materials[1],b.Materials[1],b.Materials[2]]:zone=="craft"?[b.Materials[0],b.Materials[1]]:b.Materials;
        int max=m.Settings.Settlement=="town"?3:m.Settings.Settlement=="village"?2:1;
        int storeys=type=="tower"?3:type=="chapel"?2:r.Int(1,max);if(zone=="agricultural"&&type=="house")storeys=1;
        return J.O("architecture",r.Pick(architectures),"material",r.Pick(materials),"roof",r.Pick(b.Roofs),"storeys",storeys);
    }
}
