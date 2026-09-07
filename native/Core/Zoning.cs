using System.Text.Json.Nodes;
namespace Village.Core;
public static partial class VillageGenerator
{
    static readonly string[] ZoneTypes=["civic","commercial","craft","agricultural","residential"];
    static readonly string[] Functional=["residential","agricultural","craft","commercial"];
    static readonly Dictionary<string,string> ZoneLabels=new(){["residential"]="Bairro residencial",["commercial"]="Bairro mercantil",["craft"]="Bairro dos oficios",["civic"]="Centro civico",["agricultural"]="Cintura agricola"};
    static readonly Dictionary<string,Dictionary<string,double>> HouseRatios=new()
    {
        ["hamlet"]=new(){["residential"]=.55,["agricultural"]=.35,["commercial"]=.05,["craft"]=.05},
        ["village"]=new(){["residential"]=.58,["agricultural"]=.17,["commercial"]=.13,["craft"]=.12},
        ["town"]=new(){["residential"]=.50,["agricultural"]=.12,["commercial"]=.20,["craft"]=.18}
    };
    sealed record ZoneCell(int Index,string Type,double Score);
    sealed class DistrictBlock(List<int> cells,string zone,Dictionary<string,double> distances)
    {public List<int> Cells=cells;public string Zone=zone;public Dictionary<string,double> Distances=distances;public Dictionary<string,int> Capacity=[];}
    static void CreateZones(MapData m)
    {
        Point center=m.Center;int radius=m.Settings.Settlement=="hamlet"?28:m.Settings.Settlement=="town"?56:44;double ar=Math.Min(radius,m.Width*.3);
        var targets=new Dictionary<string,Point>{["civic"]=center,["commercial"]=new(center.X+Round(ar*.66),center.Y-Round(ar*.08)),["craft"]=new(center.X-Round(ar*.68),center.Y+Round(ar*.12)),["agricultural"]=new(center.X,center.Y+Round(ar*.76)),["residential"]=new(center.X,center.Y-Round(ar*.75))};
        if(m.Settings.Settlement=="hamlet")targets["craft"]=new(targets["commercial"].X,targets["commercial"].Y+10);
        var used=new HashSet<Point>();var anchors=new Dictionary<string,Point>();
        foreach(string type in ZoneTypes){anchors[type]=NearestRoadAnchor(m,targets[type],used);used.Add(anchors[type]);}
        foreach(var a in anchors.Values){int index=a.Y*m.Width+a.X;if(m.Terrain[index]=="water"){m.Terrain[index]=m.Biome.Ground;m.Levels[index]=J.I(m.Plaza,"level");}}
        Array.Fill(m.ZoneMap,"none");var costs=ZoneTypes.ToDictionary(t=>t,t=>Enumerable.Repeat(double.PositiveInfinity,m.ZoneMap.Length).ToArray());var roadCells=m.Roads.Select(r=>J.I(r,"y")*m.Width+J.I(r,"x")).ToHashSet();
        var frontier=new StableMinHeap<ZoneCell>(c=>c.Score);
        foreach(string type in ZoneTypes){var a=anchors[type];int index=a.Y*m.Width+a.X;double initial=type=="civic"?-3:0;costs[type][index]=initial;frontier.Push(new(index,type,initial));}
        int minX=Math.Clamp(center.X-radius,1,m.Width-2),maxX=Math.Clamp(center.X+radius,1,m.Width-2),minY=Math.Clamp(center.Y-radius,1,m.Height-2),maxY=Math.Clamp(center.Y+radius,1,m.Height-2);
        var growth=new Dictionary<string,double>{["residential"]=.62,["agricultural"]=.78,["commercial"]=.95,["craft"]=.85,["civic"]=1.25};
        if(m.Settings.Settlement=="hamlet"){growth["agricultural"]=.65;growth["civic"]=2.5;growth["craft"]=1.4;}
        if(m.Settings.Settlement=="town"){growth["craft"]=.65;growth["commercial"]=.8;growth["residential"]=.7;}
        while(frontier.Count>0)
        {
            var cell=frontier.Pop();var field=costs[cell.Type];if(cell.Score!=field[cell.Index])continue;int cx=cell.Index%m.Width,cy=cell.Index/m.Width;
            foreach(var d in Directions){int x=cx+d.X,y=cy+d.Y;if(x<minX||x>maxX||y<minY||y>maxY)continue;int index=y*m.Width+x;if(m.Terrain[index]=="water"&&!roadCells.Contains(index))continue;double step=(roadCells.Contains(index)?.85:1.2)+Math.Abs(m.Levels[index]-m.Levels[cell.Index])*.25,score=cell.Score+step*growth[cell.Type];if(score>=field[index])continue;field[index]=score;frontier.Push(new(index,cell.Type,score));}
        }
        for(int index=0;index<m.ZoneMap.Length;index++){double best=double.PositiveInfinity;foreach(string type in ZoneTypes)if(costs[type][index]<best){best=costs[type][index];m.ZoneMap[index]=type;}}
        if(m.Campus!=null){var c=m.Campus;for(int y=J.I(c,"y")-1;y<=J.I(c,"y")+J.I(c,"height");y++)for(int x=J.I(c,"x")-1;x<=J.I(c,"x")+J.I(c,"width");x++)m.ZoneMap[y*m.Width+x]="civic";}
        var visited=new bool[m.ZoneMap.Length];var blocks=new List<DistrictBlock>();
        for(int y=minY;y<=maxY;y++)for(int x=minX;x<=maxX;x++)
        {
            int start=y*m.Width+x;if(visited[start]||roadCells.Contains(start)||m.Terrain[start]=="water")continue;
            var cells=new List<int>{start};var counts=ZoneTypes.ToDictionary(t=>t,t=>0);bool campus=false;visited[start]=true;
            for(int cursor=0;cursor<cells.Count;cursor++)
            {
                int index=cells[cursor],cx=index%m.Width,cy=index/m.Width;if(counts.ContainsKey(m.ZoneMap[index]))counts[m.ZoneMap[index]]++;if(m.InCampus(cx,cy))campus=true;
                foreach(var d in Directions){int nx=cx+d.X,ny=cy+d.Y,next=ny*m.Width+nx;if(nx<minX||nx>maxX||ny<minY||ny>maxY||visited[next]||roadCells.Contains(next)||m.Terrain[next]=="water")continue;visited[next]=true;cells.Add(next);}
            }
            if(cells.Count>350)continue;string winner=campus?"civic":ZoneTypes.Aggregate(ZoneTypes[0],(best,t)=>counts[t]>counts[best]?t:best);if(!campus&&counts[winner]==0)continue;
            foreach(int index in cells)m.ZoneMap[index]=winner;
            if(winner!="civic")blocks.Add(new(cells,winner,ZoneTypes.ToDictionary(t=>t,t=>cells.Sum(index=>costs[t][index])/cells.Count)));
        }
        var areas=Functional.ToDictionary(t=>t,t=>0.0);
        for(int i=0;i<m.ZoneMap.Length;i++)if(!roadCells.Contains(i)&&m.Terrain[i]!="water"&&areas.ContainsKey(m.ZoneMap[i]))areas[m.ZoneMap[i]]++;
        var settlement=Settlements[m.Settings.Settlement];double population=(settlement.Minimum+settlement.Maximum)/2.0;
        var lotAreas=new Dictionary<string,int>{["residential"]=m.Settings.Settlement=="town"?42:30,["agricultural"]=60,["craft"]=56,["commercial"]=25};
        var representative=new Dictionary<string,(int W,int H)>();
        foreach(string type in Functional)
        {
            string family=type=="residential"?(m.Settings.Settlement=="town"?"townhouse":"cottage"):type=="agricultural"?"farmstead":type=="craft"?"artisan":"merchant";
            var model=catalog.Where(model=>J.S(model,"biome")==m.Settings.Biome&&J.S(model,"family")==family).OrderBy(model=>J.I(model!["footprint"],"width")*J.I(model["footprint"],"height")).First()!;
            int lateral=type=="commercial"?0:1,rear=type=="residential"?1:type=="agricultural"?3:type=="craft"?2:0;
            representative[type]=(J.I(model["footprint"],"width")+lateral*2,J.I(model["footprint"],"height")+rear);
        }
        foreach(var block in blocks)
        {
            var cellSet=block.Cells.ToHashSet();var sorted=block.Cells.Order().ToList();
            foreach(string type in Functional)
            {
                var (w,h)=representative[type];int best=0;
                foreach(var (width,height) in new[]{(w,h),(h,w)})
                {
                    var occupied=new HashSet<int>();int count=0;
                    foreach(int start in sorted)
                    {
                        if(occupied.Contains(start))continue;int x=start%m.Width,y=start/m.Width;if(x+width>m.Width||y+height>m.Height)continue;bool clear=true;
                        for(int dy=0;clear&&dy<height;dy++)for(int dx=0;dx<width;dx++){int index=start+dy*m.Width+dx;if(!cellSet.Contains(index)||occupied.Contains(index)){clear=false;break;}}
                        if(!clear)continue;for(int dy=0;dy<height;dy++)for(int dx=0;dx<width;dx++)occupied.Add(start+dy*m.Width+dx);count++;
                    }
                    best=Math.Max(best,count);
                }
                block.Capacity[type]=best*w*h;
            }
            areas[block.Zone]+=block.Capacity[block.Zone]-block.Cells.Count;
        }
        var required=Functional.ToDictionary(t=>t,t=>population*HouseRatios[m.Settings.Settlement][t]*lotAreas[t]);
        foreach(string service in settlement.Services){if(service=="inn"||service=="shop"||service=="market")required["commercial"]+=service=="inn"?45:service=="market"?40:25;if(service=="smithy"||service=="mill")required["craft"]+=56;}
        double available=areas.Values.Sum(),demand=required.Values.Sum();var areaTargets=Functional.ToDictionary(t=>t,t=>available*required[t]/demand);
        for(int pass=0;pass<blocks.Count;pass++)
        {
            string receiver=Functional.OrderBy(t=>areas[t]/areaTargets[t]).First();if(areas[receiver]>=areaTargets[receiver]*.85)break;DistrictBlock? chosen=null;double bestScore=double.PositiveInfinity;
            foreach(var block in blocks)
            {
                string donor=block.Zone;int size=block.Capacity[donor],gain=block.Capacity[receiver];if(gain==0||donor==receiver||areas[donor]<=areaTargets[donor]*1.05||areas[donor]-size<areaTargets[donor]*.75)continue;
                double before=Math.Abs(areas[receiver]-areaTargets[receiver])+Math.Abs(areas[donor]-areaTargets[donor]),after=Math.Abs(areas[receiver]+gain-areaTargets[receiver])+Math.Abs(areas[donor]-size-areaTargets[donor]);if(after>=before)continue;
                double score=(block.Distances[receiver]-block.Distances[donor])/Math.Max(1,before-after);if(score<bestScore){bestScore=score;chosen=block;}
            }
            if(chosen==null)break;areas[chosen.Zone]-=chosen.Capacity[chosen.Zone];areas[receiver]+=chosen.Capacity[receiver];chosen.Zone=receiver;foreach(int index in chosen.Cells)m.ZoneMap[index]=receiver;
        }
        for(int y=J.I(m.Plaza,"y");y<J.I(m.Plaza,"y")+J.I(m.Plaza,"height");y++)for(int x=J.I(m.Plaza,"x");x<J.I(m.Plaza,"x")+J.I(m.Plaza,"width");x++)m.ZoneMap[y*m.Width+x]="civic";
        m.Zones=new();foreach(string type in ZoneTypes){var (bounds,count)=ZoneBounds(m,type);m.Zones.Add(J.O("id","zone-"+type,"type",type,"label",ZoneLabels[type],"anchor",J.P(anchors[type]),"cellCount",count,"bounds",bounds,"bridgeLinks",new JsonArray()));}
    }
    static (JsonObject Bounds,int Count) ZoneBounds(MapData m,string type)
    {
        int minX=m.Width,minY=m.Height,maxX=-1,maxY=-1,count=0;
        for(int i=0;i<m.ZoneMap.Length;i++){if(m.ZoneMap[i]!=type)continue;int x=i%m.Width,y=i/m.Width;minX=Math.Min(minX,x);minY=Math.Min(minY,y);maxX=Math.Max(maxX,x);maxY=Math.Max(maxY,y);count++;}
        return(J.O("x",minX,"y",minY,"width",maxX-minX+1,"height",maxY-minY+1),count);
    }
    static void FinalizeZones(MapData m)
    {
        var links=ZoneTypes.ToDictionary(t=>t,t=>new List<int>());
        foreach(var road in m.Roads){if(!J.B(road,"bridge"))continue;int i=J.I(road,"y")*m.Width+J.I(road,"x");if(links.TryGetValue(m.ZoneMap[i],out var list))list.Add(i);}
        for(int i=0;i<m.ZoneMap.Length;i++)if(m.Terrain[i]=="water")m.ZoneMap[i]="none";
        foreach(var zone in m.Zones)
        {
            string type=J.S(zone,"type");var anchor=J.Point(zone!["anchor"]);int start=anchor.Y*m.Width+anchor.X;var traversable=links[type].ToHashSet();foreach(var road in m.Roads)traversable.Add(J.I(road,"y")*m.Width+J.I(road,"x"));for(int i=0;i<m.ZoneMap.Length;i++)if(m.ZoneMap[i]==type)traversable.Add(i);
            if(!traversable.Contains(start))continue;var reached=new HashSet<int>{start};var queue=new List<int>{start};
            for(int cursor=0;cursor<queue.Count;cursor++){int index=queue[cursor],x=index%m.Width,y=index/m.Width;foreach(var d in Directions){int nx=x+d.X,ny=y+d.Y;if(nx<0||ny<0||nx>=m.Width||ny>=m.Height)continue;int next=ny*m.Width+nx;if(traversable.Contains(next)&&reached.Add(next))queue.Add(next);}}
            foreach(int index in traversable)if(!reached.Contains(index)&&m.ZoneMap[index]==type)m.ZoneMap[index]="none";links[type]=links[type].Where(reached.Contains).ToList();
        }
        foreach(var zone in m.Zones)
        {
            string type=J.S(zone,"type");var (bounds,count)=ZoneBounds(m,type);var anchor=J.Point(zone!["anchor"]);var road=m.Roads.Find(r=>J.Point(r)==anchor);
            if(m.ZoneMap[anchor.Y*m.Width+anchor.X]!=type||road==null||J.B(road,"bridge"))
            {
                var candidate=m.Roads.Where(r=>!J.B(r,"bridge")&&m.ZoneMap[J.I(r,"y")*m.Width+J.I(r,"x")]==type).OrderBy(r=>Math.Abs(J.I(r,"x")-anchor.X)+Math.Abs(J.I(r,"y")-anchor.Y)).ThenBy(r=>J.I(r,"y")).ThenBy(r=>J.I(r,"x")).FirstOrDefault();if(candidate!=null)anchor=J.Point(candidate);
            }
            zone["anchor"]=J.P(anchor);zone["cellCount"]=count;zone["bounds"]=bounds;zone["bridgeLinks"]=J.A(links[type]);
        }
    }
}
