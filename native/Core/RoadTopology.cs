using System.Text.Json.Nodes;
namespace Village.Core;
internal static class RoadTopology
{
    internal static readonly (int Bit,int Dx,int Dy,int Opposite,string Axis)[] Steps=[(1,0,-1,4,"ns"),(2,1,0,8,"ew"),(4,0,1,1,"ns"),(8,-1,0,2,"ew")];
    static int Priority(string kind)=>kind=="plaza"?2:kind=="main"?1:0;
    static RoadRecord Ensure(MapData m,Point p,string kind)
    {if(!m.RoadMap.TryGetValue(p,out var r))m.RoadMap[p]=r=new(kind);else if(Priority(kind)>Priority(r.Kind))r.Kind=kind;return r;}
    public static bool AddPath(MapData m,List<Point> path,string kind)
    {
        if(path.Count==0)return false;foreach(var p in path)Ensure(m,p,kind);
        for(int i=1;i<path.Count;i++)
        {
            var a=path[i-1];var b=path[i];var step=Steps.Single(s=>s.Dx==b.X-a.X&&s.Dy==b.Y-a.Y);
            var ar=Ensure(m,a,kind);var br=Ensure(m,b,kind);bool aw=m.Terrain[a.Y*m.Width+a.X]=="water",bw=m.Terrain[b.Y*m.Width+b.X]=="water";
            if(aw||bw){if((aw&&ar.BridgeAxis!=null&&ar.BridgeAxis!=step.Axis)||(bw&&br.BridgeAxis!=null&&br.BridgeAxis!=step.Axis))return false;if(aw)ar.BridgeAxis=step.Axis;if(bw)br.BridgeAxis=step.Axis;}
            ar.Connections|=step.Bit;br.Connections|=step.Opposite;
        }
        return true;
    }
    static string? Axis(int c) => (c&10)!=0&&(c&5)==0?"ew":(c&5)!=0&&(c&10)==0?"ns":null;
    public static void Finalize(MapData m)
    {
        var all=m.RoadMap.Select(pair=>J.O("x",pair.Key.X,"y",pair.Key.Y,"kind",pair.Value.Kind,"bridge",m.Terrain[pair.Key.Y*m.Width+pair.Key.X]=="water","orientation",m.Terrain[pair.Key.Y*m.Width+pair.Key.X]=="water"?Axis(pair.Value.Connections):null,"connections",pair.Value.Connections,"segmentIds",new JsonArray(),"bridgeSpanId",null,"bridgeRole",null,"bridgeIndex",null)).OrderBy(r=>J.I(r,"y")).ThenBy(r=>J.I(r,"x")).ToList();
        var by=all.ToDictionary(r=>J.Point(r));var reached=new HashSet<Point>();var queue=new List<JsonObject>();
        if(all.Count>0){queue.Add(by.GetValueOrDefault(m.Center)??all.FirstOrDefault(r=>J.S(r,"kind")=="plaza")??all[0]);reached.Add(J.Point(queue[0]));}
        for(int cursor=0;cursor<queue.Count;cursor++)foreach(var step in Steps)
        {var r=queue[cursor];if((J.I(r,"connections")&step.Bit)==0)continue;var p=new Point(J.I(r,"x")+step.Dx,J.I(r,"y")+step.Dy);if(by.TryGetValue(p,out var next)&&reached.Add(p))queue.Add(next);}
        m.Roads=all.Where(r=>reached.Contains(J.Point(r))).ToList();by=m.Roads.ToDictionary(r=>J.Point(r));
        var indexes=m.Roads.Select((r,i)=>(p:J.Point(r),i)).ToDictionary(t=>t.p,t=>t.i);var seen=new HashSet<Point>();var spans=new JsonArray();
        foreach(var road in m.Roads)
        {
            string axis=J.S(road,"orientation");if(!J.B(road,"bridge")||axis==""||seen.Contains(J.Point(road)))continue;
            int dx=axis=="ew"?1:0,dy=axis=="ns"?1:0;var first=road;
            while(by.TryGetValue(new(J.I(first,"x")-dx,J.I(first,"y")-dy),out var prev)&&J.B(prev,"bridge")&&J.S(prev,"orientation")==axis)first=prev;
            var group=new List<JsonObject>();JsonObject? current=first;
            while(current!=null&&J.B(current,"bridge")&&J.S(current,"orientation")==axis){group.Add(current);seen.Add(J.Point(current));current=by.GetValueOrDefault(new(J.I(current,"x")+dx,J.I(current,"y")+dy));}
            string id=$"bridge-{spans.Count}";var last=group[^1];
            for(int i=0;i<group.Count;i++){group[i]["bridgeSpanId"]=id;group[i]["bridgeIndex"]=i;group[i]["bridgeRole"]=group.Count==1?"single":i==0?"start":i==group.Count-1?"end":i%3==0?"post":"middle";}
            spans.Add(J.O("id",id,"axis",axis,"roadIndexes",J.A(group.Select(r=>indexes[J.Point(r)])),"entry",J.O("x",J.I(first,"x")-dx,"y",J.I(first,"y")-dy),"exit",J.O("x",J.I(last,"x")+dx,"y",J.I(last,"y")+dy),"length",group.Count));
        }
        m.BridgeSpans=spans;
    }
}
