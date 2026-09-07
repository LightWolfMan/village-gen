using Godot;
using System;
using System.Collections.Generic;
using System.Linq;

namespace Village.Rendering;

public partial class VillageScene
{
    public int AdaptedRoadRuns { get; private set; }
    private readonly Dictionary<int,List<Vector3[]>> surfaceIndex=new();

    private void RegisterSurface(Vector3[] vertices)
    {
        surfaces.Add(vertices);
        int x0=Math.Max(0,(int)MathF.Floor(vertices.Min(v=>v.X)-.00001f));
        int z0=Math.Max(0,(int)MathF.Floor(vertices.Min(v=>v.Z)-.00001f));
        int x1=Math.Min(width-1,(int)MathF.Floor(vertices.Max(v=>v.X)));
        int z1=Math.Min(height-1,(int)MathF.Floor(vertices.Max(v=>v.Z)));
        for(int z=z0;z<=z1;z++)for(int x=x0;x<=x1;x++)
        {
            int cell=z*width+x;
            if(!surfaceIndex.TryGetValue(cell,out var list))surfaceIndex[cell]=list=new();
            list.Add(vertices);
        }
    }

    // Clip upstream tessellation against the exact native tile triangles.
    // Rendering, physics and the walking height query then share these faces.
    private static List<Vector3> ClipRoad(List<Vector3> polygon,Func<Vector3,float> distance)
    {
        var output=new List<Vector3>();
        if(polygon.Count==0)return output;
        var previous=polygon[^1];float a=distance(previous);
        foreach(var current in polygon)
        {
            float b=distance(current);
            if((a>=0)!=(b>=0))output.Add(previous+(current-previous)*(a/(a-b)));
            if(b>=0)output.Add(current);
            previous=current;a=b;
        }
        return output;
    }

    private HashSet<int> BakeRoadRuns(Geometry paths)
    {
        AdaptedRoadRuns=0;
        var covered=new HashSet<int>();
        using var adapter=GD.Load<GDScript>("res://Rendering/RoadAdapter.gd").New().AsGodotObject();
        var input=Json.ParseString(Map.ToJsonString()).AsGodotDictionary();
        var runs=adapter.Call("bake",input,world).AsGodotArray();
        foreach(var item in runs)
        {
            var record=item.AsGodotDictionary();
            var indexes=record["cells"].AsGodotArray().Select(v=>v.AsInt32()).ToArray();
            var cells=indexes.Select(i=>Map["roads"]![i]!).ToArray();
            var expected=cells.Select(r=>(int)F(r,"y")*width+(int)F(r,"x")).ToHashSet();
            var faces=record["faces"].AsVector3Array();
            if(faces.Length==0||faces.Length%3!=0||faces.Any(v=>!v.IsFinite())||expected.Overlaps(covered))continue;
            var triangles=new List<(Vector3[] Points,int Cell)>();
            var areas=new Dictionary<int,float>();bool invalid=false;
            for(int i=0;i<faces.Length;i+=3)
            {
                var original=new List<Vector3>{faces[i],faces[i+1],faces[i+2]};
                int x0=(int)MathF.Floor(original.Min(v=>v.X)+.00001f),x1=(int)MathF.Floor(original.Max(v=>v.X)-.00001f);
                int z0=(int)MathF.Floor(original.Min(v=>v.Z)+.00001f),z1=(int)MathF.Floor(original.Max(v=>v.Z)-.00001f);
                for(int z=z0;z<=z1;z++)for(int x=x0;x<=x1;x++)
                {
                    int cell=z*width+x;
                    if(!expected.Contains(cell)){invalid=true;continue;}
                    var polygon=ClipRoad(original,p=>p.X-x);
                    polygon=ClipRoad(polygon,p=>x+1-p.X);
                    polygon=ClipRoad(polygon,p=>p.Z-z);
                    polygon=ClipRoad(polygon,p=>z+1-p.Z);
                    foreach(int sign in new[]{-1,1})
                    {
                        var half=ClipRoad(polygon,p=>sign*((p.X-x)-(p.Z-z)));
                        for(int j=1;j+1<half.Count;j++)
                        {
                            var triangle=new[]{half[0],half[j],half[j+1]};
                            float area=MathF.Abs((triangle[1]-triangle[0]).Cross(triangle[2]-triangle[0]).Y)*.5f;
                            if(area<.0000001f)continue;
                            float a=Corner(x,z),b=Corner(x,z+1),c=Corner(x+1,z+1),d=Corner(x+1,z);
                            for(int k=0;k<3;k++)
                            {
                                float u=triangle[k].X-x,v=triangle[k].Z-z;
                                triangle[k].Y=u<=v?a+v*(b-a)+u*(c-b):a+u*(d-a)+v*(c-d);
                            }
                            if((triangle[1]-triangle[0]).Cross(triangle[2]-triangle[0]).Y>0)
                                (triangle[1],triangle[2])=(triangle[2],triangle[1]);
                            triangles.Add((triangle,cell));areas[cell]=areas.GetValueOrDefault(cell)+area;
                        }
                    }
                }
            }
            // All or nothing per run: never leave holes after a failed bake.
            if(invalid||expected.Any(cell=>MathF.Abs(areas.GetValueOrDefault(cell)-1)>.001f))continue;
            bool Contains(Vector3[] t,float x,float z)
            {
                var a=t[1]-t[0];var b=t[2]-t[0];double det=(double)a.X*b.Z-(double)a.Z*b.X;
                if(Math.Abs(det)<1e-12)return false;
                double dx=x-t[0].X,dz=z-t[0].Z,u=(dx*b.Z-dz*b.X)/det,v=(a.X*dz-a.Z*dx)/det;
                return u>=-.00001&&v>=-.00001&&u+v<=1.00001;
            }
            var byCell=triangles.GroupBy(t=>t.Cell).ToDictionary(g=>g.Key,g=>g.Select(t=>t.Points).ToArray());
            foreach(int cell in expected)
            {
                foreach(float u in new[]{.01f,.25f,.5f,.75f,.99f})foreach(float v in new[]{.01f,.25f,.5f,.75f,.99f})
                    if(!byCell[cell].Any(t=>Contains(t,cell%width+u,cell/width+v)))invalid=true;
            }
            if(invalid)continue;
            var colors=cells.ToDictionary(r=>(int)F(r,"y")*width+(int)F(r,"x"),r=>new Color(S(r,"kind")=="main"?"#a5a293":"#ac9472"));
            foreach(var triangle in triangles)
            {
                paths.Vertices.AddRange(triangle.Points);
                paths.Colors.AddRange(Enumerable.Repeat(colors[triangle.Cell],3));
                RegisterSurface(new[]{triangle.Points[0],triangle.Points[1],triangle.Points[2],triangle.Points[2]});
            }
            covered.UnionWith(expected);AdaptedRoadRuns++;
        }
        GD.Print($"ROAD_INTEGRATION runs={AdaptedRoadRuns} cells={covered.Count} native_graph=True shared_collision=True");
        return covered;
    }

    public void ValidateIntegratedRoads()
    {
        var banks=new HashSet<int>();
        foreach(var span in Items(Map["bridgeSpans"]))foreach(string key in new[]{"entry","exit"})
            banks.Add((int)F(span[key],"y")*width+(int)F(span[key],"x"));
        int checkedPoints=0;
        foreach(int cell in roadCells)
        {
            if(banks.Contains(cell))continue;
            int x=cell%width,z=cell/width;
            foreach(float u in new[]{.01f,.25f,.5f,.75f,.99f})foreach(float v in new[]{.01f,.25f,.5f,.75f,.99f})
            {
                float expected=PathHeight(x+u,z+v);
                var actual=SurfaceHeight(x+u,z+v);
                if(actual is null||Math.Abs(expected-actual.Value)>.0001f)
                {
                    var nearby=surfaceIndex[cell].OrderBy(t=>((t[0]+t[1]+t[2])/3-new Vector3(x+u,expected,z+v)).LengthSquared()).Take(4);
                    throw new InvalidOperationException($"Road surface mismatch at {x+u},{z+v}: expected={expected} actual={actual} triangles={string.Join(";",nearby.Select(t=>string.Join("/",t)))}");
                }
                checkedPoints++;
            }
        }
        GD.Print($"ROAD_SURFACE_CHECK samples={checkedPoints} exact_native_triangles=True");
    }
}
