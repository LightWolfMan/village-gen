using Godot;
using System.Text.Json.Nodes;

namespace Village.Rendering;

/// <summary>Scenic enclosure outside the playable grid; does not change seeds or navigation.</summary>
public partial class VillageBorder : Node3D
{
    public void Build(JsonObject map)
    {
        int w=map["width"]!.GetValue<int>(),h=map["height"]!.GetValue<int>();
        string biome=map["settings"]!["biome"]!.GetValue<string>();
        var stone=new StandardMaterial3D{AlbedoColor=new Color("#777b78"),Roughness=1};
        var earth=new StandardMaterial3D{AlbedoColor=new Color(biome switch{"arid"=>"#b5a579","snowy"=>"#d1dbdc","wetland"=>"#596c4c",_=>"#71814f"}),Roughness=1};
        float top=map["heightLevel"]!.AsArray().Max(v=>float.Parse(v!.ToJsonString(),System.Globalization.CultureInfo.InvariantCulture))*.25f+2.8f;
        void Box(Vector3 center,Vector3 size,Material material,bool solid=false){
            AddChild(new MeshInstance3D{Position=center,Mesh=new BoxMesh{Size=size},MaterialOverride=material});
            if(solid){var body=new StaticBody3D{Position=center};body.AddChild(new CollisionShape3D{Shape=new BoxShape3D{Size=size}});AddChild(body);}
        }
        // Four ground strips extend forty tiles beyond every edge, including the corners.
        Box(new(w/2f,-1.3f,-20),new(w+80,.6f,40),earth);
        Box(new(w/2f,-1.3f,h+20),new(w+80,.6f,40),earth);
        Box(new(-20,-1.3f,h/2f),new(40,.6f,h),earth);
        Box(new(w+20,-1.3f,h/2f),new(40,.6f,h),earth);
        var merlons=new List<Transform3D>();
        void Wall(Vector3 center,Vector3 size,bool horizontal,float length){
            Box(center,size,stone,true);
            for(float t=-length/2;t<length/2;t+=2)merlons.Add(new Transform3D(Basis.Identity,center+new Vector3(horizontal?t:0,size.Y/2+.35f,horizontal?0:t)));
            for(float t=-length/2;t<length/2;t+=8)Box(center+new Vector3(horizontal?t:0,0,horizontal?0:t),new(1.35f,size.Y+1,1.35f),stone);
        }
        Wall(new(w/2f,(top-1)/2,-.65f),new(w+2,top+1,.8f),true,w+2);
        Wall(new(w/2f,(top-1)/2,h+.65f),new(w+2,top+1,.8f),true,w+2);
        Wall(new(-.65f,(top-1)/2,h/2f),new(.8f,top+1,h+2),false,h+2);
        Wall(new(w+.65f,(top-1)/2,h/2f),new(.8f,top+1,h+2),false,h+2);
        var mm=new MultiMesh{TransformFormat=MultiMesh.TransformFormatEnum.Transform3D,Mesh=new BoxMesh{Size=new Vector3(.85f,.7f,.85f)},InstanceCount=merlons.Count};
        for(int i=0;i<merlons.Count;i++)mm.SetInstanceTransform(i,merlons[i]);
        AddChild(new MultiMeshInstance3D{Multimesh=mm,MaterialOverride=stone});
        string id="prop:"+(biome=="snowy"?"pine":biome=="wetland"?"willow":"oak");
        var catalog=JsonNode.Parse(Godot.FileAccess.GetFileAsString("res://assets/models/catalog.json"))!.AsArray();
        var asset=catalog.First(a=>a!["id"]!.GetValue<string>()==id)!;
        var root=ResourceLoader.Load<PackedScene>("res://"+asset["src"]!.GetValue<string>().TrimStart('/')).Instantiate();
        int seed=17;foreach(char c in map["seed"]!.GetValue<string>())seed=unchecked(seed*31+c);
        var random=new Random(seed);var poses=new List<Transform3D>();
        for(float z=-24;z<h+24;z+=4.8f)for(float x=-24;x<w+24;x+=4.8f){
            if(x>-3&&x<w+3&&z>-3&&z<h+3)continue;
            if(biome=="arid"&&random.NextDouble()<.65)continue;
            float scale=1.2f+(float)random.NextDouble()*.9f;
            poses.Add(new Transform3D(new Basis(Vector3.Up,(float)random.NextDouble()*Mathf.Tau).Scaled(Vector3.One*scale),new Vector3(x+(float)random.NextDouble()*2-1,-1,z+(float)random.NextDouble()*2-1)));
        }
        var chunks=poses.GroupBy(p=>((int)Mathf.Floor(p.Origin.X/24),(int)Mathf.Floor(p.Origin.Z/24))).Select(g=>g.ToArray()).ToArray();
        void Visit(Node node,Transform3D parent){var t=node is Node3D n?parent*n.Transform:parent;
            if(node is MeshInstance3D mesh&&mesh.Mesh!=null)foreach(var chunk in chunks){var instances=new MultiMesh{TransformFormat=MultiMesh.TransformFormatEnum.Transform3D,Mesh=mesh.Mesh,InstanceCount=chunk.Length};
                for(int i=0;i<chunk.Length;i++)instances.SetInstanceTransform(i,chunk[i]*t);
                AddChild(new MultiMeshInstance3D{Multimesh=instances,MaterialOverride=mesh.MaterialOverride,CastShadow=GeometryInstance3D.ShadowCastingSetting.Off});}
            foreach(var child in node.GetChildren())Visit(child,t);
        }
        Visit(root,Transform3D.Identity);root.Free();
    }
}
