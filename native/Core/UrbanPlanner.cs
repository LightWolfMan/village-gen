using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Village.Core;

public sealed record UrbanPlanResult(JsonArray RoadSegments, JsonArray Frontages, JsonArray Lots, JsonArray Buildings, HashSet<string> Reserved, Dictionary<string, int> HouseQuotas);
public sealed class UrbanPlacementException : Exception
{
    public bool ServiceFailure { get; }
    public UrbanPlacementException(string message, bool serviceFailure) : base(message) { ServiceFailure = serviceFailure; }
}

/// <summary>Native port of the district/frontage parcel packing algorithm in urbanism.js.</summary>
public static class UrbanPlanner
{
    static int I(JsonNode n, string k) => J.I(n,k);
    static double D(JsonNode n, string k) => J.D(n,k);
    static string S(JsonNode n, string k) => n[k]?.GetValue<string>() ?? "";
    static bool B(JsonNode n, string k) => n[k]?.GetValue<bool>() ?? false;
    internal static string Key(int x, int y) => $"{x},{y}";
    static JsonObject Point(double x, double y) => new() { ["x"] = x, ["y"] = y };
    static JsonArray Array(IEnumerable<JsonNode> items) => new(items.Select(x => x.DeepClone()).ToArray());
    static JsonArray Numbers(IEnumerable<int> items) => new(items.Select(x => (JsonNode)JsonValue.Create(x)!).ToArray());
    internal static int[] Indexes(JsonNode n) => n["roadIndexes"]!.AsArray().Select(x => x!.GetValue<int>()).ToArray();
    internal static readonly (int x, int y, int bit)[] Directions = [(0,-1,1),(1,0,2),(0,1,4),(-1,0,8)];
    internal static int Mask(JsonNode road, Dictionary<string, JsonObject> roads)
    {
        if (road["connections"] != null) return I(road, "connections");
        return Directions.Where(d => roads.ContainsKey(Key(I(road,"x")+d.x,I(road,"y")+d.y))).Aggregate(0,(v,d)=>v|d.bit);
    }
    internal static List<JsonObject> Segments(JsonObject map)
    {
        var roads = map["roads"]!.AsArray();
        var at = new Dictionary<string, JsonObject>();
        for(int i=0;i<roads.Count;i++) { var r=(JsonObject)roads[i]!.DeepClone(); r["index"]=i; at[Key(I(r,"x"),I(r,"y"))]=r; }
        var distance=new Dictionary<string,int>(); var queue=at.Values.Where(r=>S(r,"kind")=="plaza").ToList();
        foreach(var r in queue) distance[Key(I(r,"x"),I(r,"y"))]=0;
        for(int i=0;i<queue.Count;i++) foreach(var d in Directions)
        {
            var r=queue[i]; if((I(r,"connections")&d.bit)==0) continue;
            var key=Key(I(r,"x")+d.x,I(r,"y")+d.y);
            if(!at.TryGetValue(key,out var next)||distance.ContainsKey(key)) continue;
            distance[key]=distance[Key(I(r,"x"),I(r,"y"))]+1; queue.Add(next);
        }
        var eligible=new Dictionary<string,JsonObject>();
        foreach(var pair in at) { var r=pair.Value; if(B(r,"bridge")||S(r,"kind")=="plaza")continue; int mask=Mask(r,at); if(mask!=10&&mask!=5)continue; r["axis"]=mask==10?"ew":"ns"; eligible[pair.Key]=r; }
        var visited=new HashSet<string>(); var result=new List<JsonObject>(); var plaza=map["plaza"]!;
        double cx=D(plaza,"x")+(D(plaza,"width")-1)/2, cy=D(plaza,"y")+(D(plaza,"height")-1)/2;
        foreach(var pair in eligible)
        {
            if(visited.Contains(pair.Key))continue; var first=pair.Value; var axis=S(first,"axis"); int dx=axis=="ew"?1:0,dy=axis=="ns"?1:0; var start=first;
            while(eligible.TryGetValue(Key(I(start,"x")-dx,I(start,"y")-dy),out var previous)&&S(previous,"axis")==axis)start=previous;
            var cells=new List<JsonObject>(); JsonObject? cursor=start;
            while(cursor!=null&&S(cursor,"axis")==axis) { visited.Add(Key(I(cursor,"x"),I(cursor,"y"))); cells.Add(cursor); eligible.TryGetValue(Key(I(cursor,"x")+dx,I(cursor,"y")+dy),out cursor); }
            var id=$"road-segment-{result.Count+1}";
            result.Add(new JsonObject { ["id"]=id,["axis"]=axis,["kind"]=cells.Any(r=>S(r,"kind")=="main")?"main":"street",["roadIndexes"]=Numbers(cells.Select(r=>I(r,"index"))),["start"]=Point(I(cells[0],"x"),I(cells[0],"y")),["end"]=Point(I(cells[^1],"x"),I(cells[^1],"y")),["length"]=cells.Count,["distanceToPlaza"]=cells.Min(r=>distance.TryGetValue(Key(I(r,"x"),I(r,"y")),out int dist)?dist:Math.Abs(I(r,"x")-cx)+Math.Abs(I(r,"y")-cy)) });
            foreach(var cell in cells) {var road=roads[I(cell,"index")]!; if(road["segmentIds"] is not JsonArray)road["segmentIds"]=new JsonArray(); var ids=road["segmentIds"]!.AsArray(); if(!ids.Any(n=>n!.GetValue<string>()==id))ids.Add(id);}
        }
        return result;
    }
    internal static List<JsonObject> Frontages(JsonObject map,List<JsonObject> segments)
    {
        var result=new List<JsonObject>(); var roads=map["roads"]!.AsArray(); int width=I(map,"width"),height=I(map,"height");
        foreach(var segment in segments) foreach(var side in S(segment,"axis")=="ew"?new[]{"north","south"}:new[]{"west","east"})
        {
            var indexes=Indexes(segment); var run=new List<int>(); string runZone="none";
            void Flush() {if(run.Count>0&&runZone!="none")result.Add(new JsonObject{["id"]=$"frontage-{result.Count+1}",["segmentId"]=S(segment,"id"),["side"]=side,["zone"]=runZone,["roadIndexes"]=Numbers(run),["startOffset"]=System.Array.IndexOf(indexes,run[0]),["length"]=run.Count}); run.Clear();}
            foreach(int index in indexes) {var r=roads[index]!; int x=I(r,"x")+(side=="west"?-2:side=="east"?2:0),y=I(r,"y")+(side=="north"?-2:side=="south"?2:0); string zone=x<0||y<0||x>=width||y>=height?"none":map["zoneMap"]![y*width+x]!.GetValue<string>(); if(run.Count>0&&zone!=runZone)Flush(); runZone=zone;run.Add(index); } Flush();
        }
        return result;
    }
    static Dictionary<string,int> Quotas(int total,string settlement)
    {
        double[] ratios=settlement=="hamlet"?[.55,.35,.05,.05]:settlement=="town"?[.50,.12,.20,.18]:[.58,.17,.13,.12];
        string[] zones=["residential","agricultural","commercial","craft"];
        var entries=zones.Select((z,i)=>(zone:z,count:(int)Math.Floor(total*ratios[i]),remainder:total*ratios[i]-Math.Floor(total*ratios[i]))).OrderByDescending(x=>x.remainder).ThenBy(x=>x.zone,StringComparer.Ordinal).ToList();
        int missing=total-entries.Sum(x=>x.count);for(int i=0;i<missing;i++){int j=i%entries.Count;var e=entries[j];entries[j]=(e.zone,e.count+1,e.remainder);}return entries.ToDictionary(x=>x.zone,x=>x.count);
    }
    static string Family(string type,string zone,string settlement) => type=="house"?zone switch {"agricultural"=>"farmstead","commercial"=>"merchant","craft"=>"artisan",_=>settlement=="town"?"townhouse":"cottage"}:type switch {"hall"=>"civic","inn" or "shop" or "smithy" or "market" or "mill" or "chapel" or "tower"=>type,_=>"workshop"};
    internal sealed record Program(string Type,string Zone,List<JsonObject> Models);
    internal sealed record Slot(JsonObject Frontage,JsonObject Segment,JsonObject Road);
    internal sealed record Candidate(int X,int Y,int Width,int Height,int DoorX,int DoorY,string Orientation,JsonObject Geometry,int[] Cells,Slot Slot,double Score=0);
    internal static Candidate MakeCandidate(Slot slot,JsonObject model,string zone,int mapWidth)
    {
        string side=S(slot.Frontage,"side");bool rotated=side is "west" or "east";var fp=model["footprint"]!;int w=I(fp,rotated?"height":"width"),h=I(fp,rotated?"width":"height"),rx=I(slot.Road,"x"),ry=I(slot.Road,"y");
        int x=side=="west"?rx-w:side=="east"?rx+1:rx-w/2,y=side=="north"?ry-h:side=="south"?ry+1:ry-h/2;
        string orientation=side switch{"north"=>"south","south"=>"north","west"=>"east",_=>"west"};
        if(zone=="civic"){x+=side=="west"?-2:side=="east"?2:0;y+=side=="north"?-2:side=="south"?2:0;}
        int lateral=zone=="commercial"?0:zone=="civic"?2:1,rear=zone switch{"residential"=>1,"agricultural"=>3,"craft" or "civic"=>2,_=>0},leading=zone=="civic"?lateral:0;
        int bx=x,by=y,bw=w,bh=h;
        if(!rotated){bx-=leading;bw+=leading+lateral;bh+=rear;if(side=="north")by-=rear;}else{by-=leading;bh+=leading+lateral;bw+=rear;if(side=="west")bx-=rear;}
        if(zone=="civic"){if(!rotated){bh+=2;if(side=="south")by-=2;}else{bw+=2;if(side=="east")bx-=2;}}
        var cells=new List<int>();for(int py=by;py<by+bh;py++)for(int px=bx;px<bx+bw;px++)cells.Add(py*mapWidth+px);
        return new Candidate(x,y,w,h,rx,ry,orientation,new JsonObject{["bounds"]=new JsonObject{["x"]=bx,["y"]=by,["width"]=bw,["height"]=bh},["rearDepth"]=rear,["lateralGap"]=lateral},cells.ToArray(),slot);
    }
    internal static bool Clear(JsonObject map,HashSet<string> reserved,Candidate c,string zone)
    {
        var b=c.Geometry["bounds"]!;int x=I(b,"x"),y=I(b,"y"),w=I(b,"width"),h=I(b,"height"),mw=I(map,"width");if(x<1||y<1||x+w>=mw-1||y+h>=I(map,"height")-1)return false;
        int min=7,max=0;for(int py=y;py<y+h;py++)for(int px=x;px<x+w;px++){int i=py*mw+px,level=(int)J.Number(map["heightLevel"]![i]);if(reserved.Contains(Key(px,py))||map["terrain"]![i]!.GetValue<string>()=="water"||level<=0||map["zoneMap"]![i]!.GetValue<string>()!=zone)return false;min=Math.Min(min,level);max=Math.Max(max,level);}return max-min<=2;
    }
    internal static bool Touches(int ax,int ay,int aw,int ah,string zone,string orientation,int bx,int by,int bw,int bh) => zone=="residential"&&(orientation is "north" or "south"?ay<by+bh&&by<ay+ah&&(ax+aw==bx||bx+bw==ax):ax<bx+bw&&bx<ax+aw&&(ay+ah==by||by+bh==ay));
    internal static double Score(JsonObject map,Program program,Candidate c,List<JsonObject> buildings,Dictionary<string,int> counts)
    {
        var plaza=map["plaza"]!;double dx=c.X+c.Width/2.0-D(plaza,"x")-D(plaza,"width")/2,dy=c.Y+c.Height/2.0-D(plaza,"y")-D(plaza,"height")/2;double score=Math.Sqrt(dx*dx+dy*dy)*(program.Zone=="agricultural"?-.18:.12);
        if(program.Zone=="civic"&&map["civicCampus"] is JsonObject campus){var b=c.Geometry["bounds"]!;score+=(Math.Min(Math.Abs(D(b,"x")-D(campus,"x")),Math.Abs(D(b,"x")+D(b,"width")-D(campus,"x")-D(campus,"width")))+Math.Min(Math.Abs(D(b,"y")-D(campus,"y")),Math.Abs(D(b,"y")+D(b,"height")-D(campus,"y")-D(campus,"height"))))*16;}
        score+=program.Zone switch{"commercial"=>S(c.Slot.Segment,"kind")=="main"?-18:8,"residential"=>S(c.Slot.Segment,"kind")=="street"?-7:3,"craft"=>D(c.Slot.Segment,"distanceToPlaza")<8?12:0,"agricultural"=>D(c.Slot.Segment,"distanceToPlaza")<14?10:0,_=>0};
        string[] compatible=program.Zone switch{"residential"=>["residential","commercial","civic"],"commercial"=>["residential","commercial","craft","civic"],"craft"=>["craft","commercial"],"civic"=>["civic","commercial","residential"],_=>["agricultural"]};
        var distances=buildings.Where(b=>compatible.Contains(S(b,"zone"))).Select(b=>{double x=Math.Max(0,Math.Max(I(b,"x")-c.X-c.Width,c.X-I(b,"x")-I(b,"width"))),y=Math.Max(0,Math.Max(I(b,"y")-c.Y-c.Height,c.Y-I(b,"y")-I(b,"height")));return Math.Sqrt(x*x+y*y);}).ToArray();
        if(distances.Length>0){double nearest=distances.Min();score+=Math.Abs(nearest-(program.Zone=="agricultural"?4:1))*2;if(program.Zone!="agricultural")score+=Math.Max(0,nearest-8)*12;}
        return score+counts[c.Orientation]*1.4+I(c.Slot.Road,"index")*1e-5;
    }
    static void Restore(JsonArray target,JsonArray source){target.Clear();foreach(var n in source)target.Add(n?.DeepClone());}

    public static UrbanPlanResult Create(JsonObject map,RandomSource random,int houseTarget,IReadOnlyList<string> services,JsonArray models,Action<int,int,int,int,int,string>? flatten=null,Func<string,string,RandomSource,JsonObject>? style=null)
    {
        var terrain=(JsonArray)map["terrain"]!.DeepClone();var heights=(JsonArray)map["heightLevel"]!.DeepClone();var zones=(JsonArray)map["zoneMap"]!.DeepClone();var roads=map["roads"]!.AsArray();var ids=roads.Select(r=>r!["segmentIds"]?.DeepClone()??new JsonArray()).ToArray();
        int minimum=Math.Min(houseTarget,S(map["settings"]!,"settlement") switch{"hamlet"=>10,"town"=>55,_=>25});int run=0;UrbanPlacementException? last=null;var cache=new Dictionary<string,Candidate?>();
        foreach(int target in new[]{houseTarget,minimum}.Distinct())
        {
            if(run>0){Restore(map["terrain"]!.AsArray(),terrain);Restore(map["heightLevel"]!.AsArray(),heights);Restore(map["zoneMap"]!.AsArray(),zones);for(int i=0;i<roads.Count;i++)roads[i]!["segmentIds"]=ids[i].DeepClone();}run++;
            try{return Attempt(map,random.Fork($"parcel-target:{target}:attempt:0"),target,services,models,flatten,style,cache,target==minimum&&run>1);}catch(UrbanPlacementException error){last=error;if(error.ServiceFailure)throw;}
        }
        throw last!;
    }
    sealed record Checkpoint(int Index,int Count,HashSet<string> Reserved,HashSet<string> Doors,Dictionary<string,int> Counts,JsonArray Terrain,JsonArray Heights);
    static UrbanPlanResult Attempt(JsonObject map,RandomSource random,int target,IReadOnlyList<string> services,JsonArray models,Action<int,int,int,int,int,string>? flatten,Func<string,string,RandomSource,JsonObject>? style,Dictionary<string,Candidate?> cache,bool compact)
    {
        int mw=I(map,"width"),mh=I(map,"height");var segments=Segments(map);var frontages=Frontages(map,segments);var segmentById=segments.ToDictionary(s=>S(s,"id"));var roads=map["roads"]!.AsArray();var at=roads.Select(r=>r!.AsObject()).ToDictionary(r=>Key(I(r,"x"),I(r,"y")));var reserved=new HashSet<string>(at.Keys);var plaza=map["plaza"]!;
        for(int y=I(plaza,"y")-1;y<=I(plaza,"y")+I(plaza,"height");y++)for(int x=I(plaza,"x")-1;x<=I(plaza,"x")+I(plaza,"width");x++)reserved.Add(Key(x,y));
        var staticReserved=new HashSet<string>(reserved);var usedDoors=new HashSet<string>();var occupied=new bool[mw*mh];var buildings=new List<JsonObject>();string settlement=S(map["settings"]!,"settlement"),biome=S(map["settings"]!,"biome");var quotas=Quotas(target,settlement);
        var raw=services.Select(t=>(type:t,zone:t switch{"inn" or "shop" or "market"=>"commercial","smithy" or "mill"=>"craft",_=>"civic"})).ToList();foreach(string zone in new[]{"agricultural","commercial","craft","residential"})for(int i=0;i<quotas[zone];i++)raw.Add(("house",zone));
        var programs=new List<Program>();
        for(int i=0;i<raw.Count;i++)
        {
            var p=raw[i];string family=Family(p.type,p.zone,settlement);
            if(p.type=="house"&&p.zone=="residential"&&i%4==0)family=family=="cottage"?"townhouse":"cottage";
            var matching=models.Select(m=>m!.AsObject()).Where(m=>S(m,"biome")==biome&&S(m,"family")==family).ToList();
            if(matching.Count==0)throw new Exception($"Modelo ausente: {biome}/{family}");
            var selected=matching[random.Fork($"model:{i}").Int(0,matching.Count-1)];
            var ordered=new List<JsonObject>{selected};
            ordered.AddRange(matching.Where(m=>!ReferenceEquals(m,selected)).OrderBy(m=>I(m["footprint"]!,"width")*I(m["footprint"]!,"height")));
            programs.Add(new Program(p.type,p.zone,ordered));
        }
        programs=programs.OrderBy(p=>p.Type=="house"?1:0).ThenBy(p=>p.Type=="house"?p.Zone:"",StringComparer.Ordinal).ThenByDescending(p=>I(p.Models[0]["footprint"]!,"width")*I(p.Models[0]["footprint"]!,"height")).ToList();
        var counts=new Dictionary<string,int>{{"north",0},{"east",0},{"south",0},{"west",0}};var slots=new List<Slot>();
        foreach(var frontage in frontages){var segment=segmentById[S(frontage,"segmentId")];foreach(int index in Indexes(frontage)){var source=roads[index]!.AsObject();if(B(source,"bridge")||S(source,"kind")=="plaza"||Mask(source,at)!=(S(segment,"axis")=="ew"?10:5))continue;if(Directions.Any(d=>at.TryGetValue(Key(I(source,"x")+d.x,I(source,"y")+d.y),out var n)&&(B(n,"bridge")||S(n,"kind")=="plaza"||I(n,"connections") is not (5 or 10))))continue;var r=(JsonObject)source.DeepClone();r["index"]=index;slots.Add(new Slot(frontage,segment,r));}}
        var checkpoints=new Dictionary<string,Checkpoint>();var retries=new Dictionary<string,int>();
        for(int pi=0;pi<programs.Count;pi++)
        {
            var p=programs[pi];if(p.Type=="house"&&!checkpoints.ContainsKey(p.Zone))checkpoints[p.Zone]=new Checkpoint(pi,buildings.Count,new(reserved),new(usedDoors),new(counts),(JsonArray)map["terrain"]!.DeepClone(),(JsonArray)map["heightLevel"]!.DeepClone());bool placed=false;
            foreach(var model in p.Models)
            {
                var candidates=new List<Candidate>();foreach(var slot in slots)
                {
                    if(S(slot.Frontage,"zone")!=p.Zone)continue;string key=$"{S(model,"id")}:{S(slot.Frontage,"id")}:{I(slot.Road,"index")}";
                    if(!cache.TryGetValue(key,out var candidate)){candidate=MakeCandidate(slot,model,p.Zone,mw);if(!Clear(map,staticReserved,candidate,p.Zone))candidate=null;cache[key]=candidate;}
                    if(candidate==null)continue;var c=candidate with{Slot=slot};if(usedDoors.Contains($"{Key(c.DoorX,c.DoorY)}:{c.Orientation}")||c.Cells.Any(i=>occupied[i]))continue;
                    if(buildings.Any(b=>Touches(c.X,c.Y,c.Width,c.Height,p.Zone,c.Orientation,I(b,"x"),I(b,"y"),I(b,"width"),I(b,"height"))||Touches(I(b,"x"),I(b,"y"),I(b,"width"),I(b,"height"),S(b,"zone"),S(b,"orientation"),c.X,c.Y,c.Width,c.Height)))continue;
                    candidates.Add(c with{Score=Score(map,p,c,buildings,counts)});
                }
                candidates=candidates.OrderBy(c=>c.Score).ThenBy(c=>I(c.Slot.Road,"index")).ThenBy(c=>c.Orientation,StringComparer.Ordinal).ToList();if(candidates.Count==0)continue;
                int retry=retries.GetValueOrDefault(p.Zone);var chosen=candidates[random.Fork($"zone:{p.Zone}:retry:{retry}:program:{pi}").Int(0,Math.Min(3,candidates.Count-1))];var geometry=(JsonObject)chosen.Geometry.DeepClone();geometry["cells"]=Array(chosen.Cells.Select(i=>(JsonNode)Point(i%mw,i/mw)));
                var levels=new List<int>();for(int y=chosen.Y;y<chosen.Y+chosen.Height;y++)for(int x=chosen.X;x<chosen.X+chosen.Width;x++)levels.Add((int)J.Number(map["heightLevel"]![y*mw+x]));levels.Sort();int level=levels[levels.Count/2];flatten?.Invoke(chosen.X,chosen.Y,chosen.Width,chosen.Height,level,p.Zone);
                var appearance=style?.Invoke(p.Type,p.Zone,random.Fork($"style:{pi}"))??new JsonObject{["architecture"]=Family(p.Type,p.Zone,settlement),["material"]="timber",["roof"]="thatch",["storeys"]=1};
                var building=new JsonObject{["id"]=$"building-{buildings.Count+1}",["type"]=p.Type,["x"]=chosen.X,["y"]=chosen.Y,["width"]=chosen.Width,["height"]=chosen.Height,["door"]=Point(chosen.DoorX,chosen.DoorY),["orientation"]=chosen.Orientation,["entranceVisible"]=chosen.Orientation is "south" or "east",["baseLevel"]=level,["zone"]=p.Zone};foreach(var field in appearance)building[field.Key]=field.Value?.DeepClone();building["spriteFamily"]=Family(p.Type,p.Zone,settlement);building["variant"]=model["variant"]!.DeepClone();building["assetId"]=S(model,"id");building["lotId"]=null;building["frontageId"]=S(chosen.Slot.Frontage,"id");building["accessRoadIndex"]=I(chosen.Slot.Road,"index");
                var entrance=model["entrance"]!;double mx=entrance[0]!.GetValue<double>(),my=entrance[1]!.GetValue<double>(),mz=entrance[2]!.GetValue<double>(),angle=chosen.Orientation switch{"east"=>Math.PI/2,"north"=>Math.PI,"west"=>-Math.PI/2,_=>0};double ex=chosen.X+chosen.Width/2.0+mx*Math.Cos(angle)+mz*Math.Sin(angle),ey=chosen.Y+chosen.Height/2.0-mx*Math.Sin(angle)+mz*Math.Cos(angle);building["entrance"]=new JsonObject{["x"]=ex,["y"]=ey,["level"]=level+my/.25};building["accessPath"]=new JsonArray(Point(ex,ey),Point(chosen.DoorX+.5,chosen.DoorY+.5));building["lotGeometry"]=geometry;
                buildings.Add(building);counts[chosen.Orientation]++;usedDoors.Add($"{Key(chosen.DoorX,chosen.DoorY)}:{chosen.Orientation}");foreach(int cell in chosen.Cells){reserved.Add(Key(cell%mw,cell/mw));occupied[cell]=true;}placed=true;break;
            }
            if(!placed)
            {
                int retry=retries.GetValueOrDefault(p.Zone);if(p.Type=="house"&&checkpoints.TryGetValue(p.Zone,out var cp)&&retry<3){retries[p.Zone]=retry+1;buildings.RemoveRange(cp.Count,buildings.Count-cp.Count);reserved=new(cp.Reserved);System.Array.Clear(occupied);foreach(string key in reserved){var parts=key.Split(',');int x=int.Parse(parts[0]),y=int.Parse(parts[1]);if(x>=0&&y>=0&&x<mw&&y<mh)occupied[y*mw+x]=true;}usedDoors=new(cp.Doors);counts=new(cp.Counts);Restore(map["terrain"]!.AsArray(),cp.Terrain);Restore(map["heightLevel"]!.AsArray(),cp.Heights);pi=cp.Index-1;continue;}
                throw new UrbanPlacementException($"Parcelamento insuficiente para {p.Type}/{p.Zone} ({pi+1}/{programs.Count}) na seed {S(map,"seed")}",p.Type!="house");
            }
        }
        var frontageById=frontages.ToDictionary(f=>S(f,"id"));var lots=new JsonArray();for(int i=0;i<buildings.Count;i++){var b=buildings[i];var g=b["lotGeometry"]!;var f=frontageById[S(b,"frontageId")];var lot=new JsonObject{["id"]=$"lot-{i+1}",["frontageId"]=S(b,"frontageId"),["zone"]=S(b,"zone"),["cells"]=g["cells"]!.DeepClone(),["bounds"]=g["bounds"]!.DeepClone(),["rearDepth"]=g["rearDepth"]!.DeepClone(),["lateralGap"]=g["lateralGap"]!.DeepClone(),["side"]=S(f,"side"),["roadIndex"]=I(b,"accessRoadIndex"),["buildingId"]=S(b,"id")};b.Remove("lotGeometry");b["lotId"]=$"lot-{i+1}";lots.Add(lot);}
        return new UrbanPlanResult(Array(segments),Array(frontages),lots,Array(buildings),reserved,quotas);
    }
}
