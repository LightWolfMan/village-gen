using Godot;
using System.Text.Json.Nodes;

namespace Village.Rendering;

/// <summary>Presentation and picking only. Does not change procedural/simulation state.</summary>
public partial class VillageScene
{
    private MeshInstance3D? selectionOutline;
    public void ApplyPresentation(float grassDensity,float foliageDensity,bool reflections,bool details)
    {
        foreach(var node in world.GetChildren())
        {
            if(node is ReflectionProbe probe)probe.Visible=reflections;
            if(node is not MultiMeshInstance3D instance)continue;
            string name=instance.Name.ToString();
            if(name.StartsWith("Grass"))instance.Multimesh.VisibleInstanceCount=(int)(instance.Multimesh.InstanceCount*grassDensity);
            if(name.StartsWith("DoorLantern"))instance.Visible=details;
            if(!instance.HasMeta("authoredMaterial"))continue;
            var authored=instance.GetMeta("authoredMaterial").AsGodotObject() as Material;
            string material=authored?.ResourceName.ToLowerInvariant()??"";
            string asset=instance.GetMeta("assetId").AsString();
            // Keep trunks/collisions visible. This slider adjusts foliage, not solid trees.
            if(asset.StartsWith("prop:")&&(material.Contains("leaf")||material.Contains("needles")||material.Contains("willow leaves")))
                instance.Multimesh.VisibleInstanceCount=(int)(instance.Multimesh.InstanceCount*foliageDensity);
            instance.MaterialOverride=details&&instance.HasMeta("detailMaterial")?instance.GetMeta("detailMaterial").AsGodotObject() as Material:authored;
        }
    }
    public bool TryWalkStart(Vector2 p,out Vector3 position)
    {
        var candidates=new List<Vector2>{p};
        for(int y=-6;y<=6;y++)for(int x=-6;x<=6;x++)candidates.Add(new Vector2(Mathf.Floor(p.X)+x+.5f,Mathf.Floor(p.Y)+y+.5f));
        foreach(var q in candidates.OrderBy(q=>q.DistanceSquaredTo(p)))
        {
            var h=SurfaceHeight(q.X,q.Y);if(h==null)continue;
            if(obstacles.Any(b=>q.X>b.Position.X-.2f&&q.X<b.End.X+.2f&&q.Y>b.Position.Z-.2f&&q.Y<b.End.Z+.2f&&b.End.Y>h))continue;
            bool safe=true;
            for(int i=0;i<8;i++){float a=i*Mathf.Pi/4;var edge=SurfaceHeight(q.X+Mathf.Cos(a)*.18f,q.Y+Mathf.Sin(a)*.18f);if(edge==null||Mathf.Abs(edge.Value-h.Value)>.26f){safe=false;break;}}
            if(safe){position=new Vector3(q.X,h.Value,q.Y);return true;}
        }
        position=default;return false;
    }
    public void SetRegionFilter(string filter)
    {
        if(zones==null)return;var overlay=new Geometry();
        for(int z=0;z<height;z++)for(int x=0;x<width;x++)
        {
            string zone=Map["zoneMap"]![z*width+x]!.GetValue<string>();
            if(Terrain(x,z)=="water"||filter!="all"&&zone!=filter||!ZoneColors.TryGetValue(zone,out var color))continue;
            float h=Level(x,z)+.08f;
            overlay.Quad(new(x,h,z),new(x,h,z+1),new(x+1,h,z+1),new(x+1,h,z),new Color(color));
        }
        zones.Mesh=overlay.Vertices.Count>0?overlay.Mesh():null;
    }
    public string SelectElement(Vector3 point,bool houses,bool services,bool props)
    {
        foreach(var b in CurrentBuildings)
        {
            if(S(b,"type")=="house"?!houses:!services)continue;
            var box=AssetBounds(S(b,"assetId"),Pose(F(b,"x")+F(b,"width")/2,F(b,"baseLevel")*LevelHeight,F(b,"y")+F(b,"height")/2,Angle(S(b,"orientation"))));
            if(point.X<box.Position.X||point.X>box.End.X||point.Z<box.Position.Z||point.Z>box.End.Z)continue;
            Highlight(box);return $"{S(b,"id")} · {S(b,"assetId")} · {S(b,"zone")}";
        }
        if(props)foreach(var p in Items(Map["props"]))
        {
            string type=S(p,"type"),id=type=="oak"?new[]{"oak","birch","elm"}[(int)F(p,"variant")%3]:type;
            var box=AssetBounds("prop:"+id,Pose(F(p,"x")+.5f,F(p,"level")*LevelHeight,F(p,"y")+.5f,F(p,"variant")*Mathf.Pi/3));
            if(point.X<box.Position.X||point.X>box.End.X||point.Z<box.Position.Z||point.Z>box.End.Z)continue;
            Highlight(box);return $"{S(p,"id")} · {type}";
        }
        if(selectionOutline!=null)selectionOutline.Hide();return "";
    }
    private void Highlight(Aabb box)
    {
        if(selectionOutline==null){selectionOutline=new MeshInstance3D{Name="Selection",CastShadow=GeometryInstance3D.ShadowCastingSetting.Off,MaterialOverride=new StandardMaterial3D{AlbedoColor=new Color(.95f,.65f,.18f,.2f),Transparency=BaseMaterial3D.TransparencyEnum.Alpha,ShadingMode=BaseMaterial3D.ShadingModeEnum.Unshaded}};world.AddChild(selectionOutline);}
        selectionOutline.Mesh=new BoxMesh{Size=box.Size+Vector3.One*.05f};selectionOutline.Position=box.GetCenter();selectionOutline.Show();
    }
}
