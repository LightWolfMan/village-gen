namespace Village.Core;
public static partial class VillageGenerator
{
    static Func<int,int,int,int,double> RoadCost(MapData m,uint seed)=>(x,y,px,py)=>
    {if(m.InCampus(x,y))return double.PositiveInfinity;int i=y*m.Width+x,p=py*m.Width+px;return 1+(m.Terrain[i]=="water"?4:0)+Math.Abs(m.Levels[i]-m.Levels[p])*1.6+RandomSource.CoordinateHash(seed,x,y,99)/4294967295.0*.6;};
    static Point NearestDry(MapData m,Point p)
    {
        if(m.Terrain[p.Y*m.Width+p.X]!="water"&&!m.InCampus(p.X,p.Y))return p;
        for(int radius=1;radius<Math.Max(m.Width,m.Height);radius++)for(int offset=-radius;offset<=radius;offset++)
        foreach(var c in new Point[]{new(p.X+offset,p.Y-radius),new(p.X+offset,p.Y+radius),new(p.X-radius,p.Y+offset),new(p.X+radius,p.Y+offset)})
        {if(c.X<1||c.Y<1||c.X>=m.Width-1||c.Y>=m.Height-1)continue;if(m.Terrain[c.Y*m.Width+c.X]!="water"&&!m.InCampus(c.X,c.Y))return c;}
        return p;
    }
    static void RouteRoad(MapData m,Point start,Point goal,Func<int,int,int,int,double> cost,string kind)
    {
        var path=Pathfinding.FindPath(m.Width,m.Height,NearestDry(m,start),NearestDry(m,goal),(x,y,px,py)=>cost(x,y,px,py)*(m.RoadMap.ContainsKey(new(x,y))?.72:1),
            (x,y)=>m.Terrain[y*m.Width+x]=="water",(x,y)=>m.RoadMap.GetValueOrDefault(new(x,y))?.BridgeAxis,kind=="main"?14:8,kind=="main"?1.1:1.6,kind=="main"?1.15:1.3);
        RoadTopology.AddPath(m,path,kind);
    }
    static void AddLine(MapData m,int x1,int y1,int x2,int y2,string kind)
    {
        bool vertical=x1==x2;uint seed=RandomSource.HashString($"{m.Seed}:line:{x1},{y1}:{x2},{y2}:{kind}");var cost=RoadCost(m,seed);
        RouteRoad(m,new(x1,y1),new(x2,y2),(x,y,px,py)=>cost(x,y,px,py)+(vertical?Math.Abs(x-x1):Math.Abs(y-y1))*1.25,kind);
    }
    static void CreateCampusPerimeter(MapData m)
    {
        var c=m.Campus;if(c==null)return;int left=J.I(c,"x")-1,right=J.I(c,"x")+J.I(c,"width"),top=J.I(c,"y")-1,bottom=J.I(c,"y")+J.I(c,"height");
        foreach(int y in new[]{top,bottom})RoadTopology.AddPath(m,Enumerable.Range(left,right-left+1).Select(x=>new Point(x,y)).ToList(),"street");
        foreach(int x in new[]{left,right})RoadTopology.AddPath(m,Enumerable.Range(top,bottom-top+1).Select(y=>new Point(x,y)).ToList(),"street");
        var center=m.Center;var corner=new Point(Math.Abs(center.X-left)<Math.Abs(center.X-right)?left:right,Math.Abs(center.Y-top)<Math.Abs(center.Y-bottom)?top:bottom);
        RouteRoad(m,center,corner,RoadCost(m,RandomSource.HashString(m.Seed+":campus")),"street");
    }
    static void CreateOrganicRoads(MapData m,RandomSource r)
    {
        var c=m.Center;Point[] endpoints=[new(1,Math.Clamp(c.Y+r.Int(-15,15),1,m.Height-2)),new(m.Width-2,Math.Clamp(c.Y+r.Int(-15,15),1,m.Height-2)),new(Math.Clamp(c.X+r.Int(-15,15),1,m.Width-2),1),new(Math.Clamp(c.X+r.Int(-15,15),1,m.Width-2),m.Height-2)];
        var cost=RoadCost(m,RandomSource.HashString(m.Seed+":roads"));foreach(var end in endpoints)RouteRoad(m,c,end,cost,"main");
        bool compact=m.Settings.Settlement=="village"&&m.Width==72;int reach=compact?33:m.Settings.Settlement=="hamlet"?25:m.Settings.Settlement=="town"?49:37;
        for(int offset=-reach+1;offset<reach;offset+=compact?16:12)
        {
            if(compact&&offset==0)continue;int jitter=r.Int(-1,1),x=Math.Clamp(c.X+offset+jitter,3,m.Width-4),y=Math.Clamp(c.Y+offset-jitter,3,m.Height-4);
            AddLine(m,x,Math.Clamp(c.Y-reach,2,m.Height-3),x,Math.Clamp(c.Y+reach,2,m.Height-3),"street");
            AddLine(m,Math.Clamp(c.X-reach,2,m.Width-3),y,Math.Clamp(c.X+reach,2,m.Width-3),y,"street");
        }
    }
    static void CreateGridRoads(MapData m,RandomSource r)
    {
        var c=m.Center;int spacing=m.Settings.Settlement=="village"&&m.Width==72?16:r.Int(12,14),radius=m.Settings.Settlement=="hamlet"?27:m.Settings.Settlement=="town"?50:38;
        m.GridSpec=J.O("centerX",c.X,"centerY",c.Y,"spacing",spacing,"radius",radius);
        AddLine(m,1,c.Y,m.Width-2,c.Y,"main");AddLine(m,c.X,1,c.X,m.Height-2,"main");
        for(int x=c.X-radius/spacing*spacing;x<=c.X+radius;x+=spacing)if(x>1&&x<m.Width-2)AddLine(m,x,Math.Clamp(c.Y-radius,2,m.Height-3),x,Math.Clamp(c.Y+radius,2,m.Height-3),"street");
        for(int y=c.Y-radius/spacing*spacing;y<=c.Y+radius;y+=spacing)if(y>1&&y<m.Height-2)AddLine(m,Math.Clamp(c.X-radius,2,m.Width-3),y,Math.Clamp(c.X+radius,2,m.Width-3),y,"street");
    }
    static void SmoothRoadHeights(MapData m)
    {
        for(int pass=0;pass<2;pass++)foreach(var p in m.RoadMap.Keys)
        {
            int i=p.Y*m.Width+p.X;if(m.Terrain[i]=="water")continue;var neighbors=Directions.Select(d=>(p.Y+d.Y)*m.Width+p.X+d.X).Where(index=>index>=0&&index<m.Levels.Length).Select(index=>m.Levels[index]).Where(level=>level>0).ToList();
            if(neighbors.Count==0)continue;int average=Round((double)neighbors.Sum()/neighbors.Count);m.Levels[i]=Math.Clamp(m.Levels[i],average-1,average+1);
        }
    }
    static Point NearestRoadAnchor(MapData m,Point target,HashSet<Point> used)
    {
        System.Text.Json.Nodes.JsonObject? best=m.Roads.FirstOrDefault();double bestDistance=double.PositiveInfinity;
        foreach(var road in m.Roads)
        {
            var p=J.Point(road);if(J.B(road,"bridge")||used.Contains(p))continue;int blocked=0;
            for(int dy=-8;dy<=8;dy+=2)for(int dx=-8;dx<=8;dx+=2){int x=p.X+dx,y=p.Y+dy;if(x<1||y<1||x>=m.Width-1||y>=m.Height-1||m.Terrain[y*m.Width+x]=="water")blocked++;}
            double distance=Math.Abs(p.X-target.X)+Math.Abs(p.Y-target.Y)+blocked*1.5;if(distance<bestDistance){best=road;bestDistance=distance;}
        }
        return best==null?target:J.Point(best);
    }
}
