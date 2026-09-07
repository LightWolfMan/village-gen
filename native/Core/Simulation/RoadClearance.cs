// Adapted from Selo Empire burgageFenceRoadClearance.ts, MIT.
// Copyright (c) 2026 Martin Erlic; ThirdParty/LICENSE-selo-empire.txt.
// Revision adebb282df90627f3ec63c8e89f076cf1cf14fe9.
namespace Village.Core.Simulation;

public static class RoadClearance
{
    public readonly record struct Point(double X,double Y);
    public readonly record struct Corridor(Point Start,Point End,double Radius);
    const double Epsilon=1e-8;
    public static bool Intersects(Corridor road,double x,double y,double width,double height)
    {
        bool Inside(Point p)=>p.X>=x&&p.X<=x+width&&p.Y>=y&&p.Y<=y+height;
        if(Inside(road.Start)||Inside(road.End))return true;
        var a=new Point(x,y);var b=new Point(x+width,y);var c=new Point(x+width,y+height);var d=new Point(x,y+height);
        return Crosses(a,b,road)||Crosses(b,c,road)||Crosses(c,d,road)||Crosses(d,a,road);
    }
    public static bool Crosses(Point start,Point end,Corridor road)
    {
        double dx=end.X-start.X,dy=end.Y-start.Y,lengthSq=dx*dx+dy*dy,r=Math.Max(0,road.Radius-Epsilon);
        if(lengthSq<=Epsilon)return false;
        bool Overlap(double lo,double hi)=>Math.Min(1,hi)>Math.Max(0,lo)+Epsilon;
        bool Circle(Point center){
            double ox=start.X-center.X,oy=start.Y-center.Y,t=-(ox*dx+oy*dy)/lengthSq;
            double cx=ox+dx*t,cy=oy+dy*t,remaining=r*r-cx*cx-cy*cy;
            if(remaining<=0)return false;
            double span=Math.Sqrt(remaining/lengthSq);return Overlap(t-span,t+span);
        }
        if(Circle(road.Start)||Circle(road.End))return true;
        double rx=road.End.X-road.Start.X,ry=road.End.Y-road.Start.Y,length=Math.Sqrt(rx*rx+ry*ry);
        if(length<=Epsilon)return false;
        double ux=rx/length,uy=ry/length,ox=start.X-road.Start.X,oy=start.Y-road.Start.Y;
        var along=Linear(ox*ux+oy*uy,dx*ux+dy*uy,0,length);
        var across=Linear(-ox*uy+oy*ux,-dx*uy+dy*ux,-r,r);
        return along.HasValue&&across.HasValue&&Overlap(Math.Max(along.Value.Min,across.Value.Min),Math.Min(along.Value.Max,across.Value.Max));
    }
    static (double Min,double Max)? Linear(double origin,double delta,double min,double max)
    {
        if(Math.Abs(delta)<=Epsilon)return origin>min&&origin<max?(0,1):null;
        double a=(min-origin)/delta,b=(max-origin)/delta;return (Math.Min(a,b),Math.Max(a,b));
    }
}
