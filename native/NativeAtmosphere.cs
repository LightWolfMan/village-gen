using Godot;

namespace Village;

/// <summary>Decorative horizon only; never enters village bounds or navigation.</summary>
public partial class NativeAtmosphere : Node3D
{
    private readonly List<MeshInstance3D> _layers=new();
    private MeshInstance3D _clouds=null!;
    private float _width=96,_depth=96;
    public override void _Ready()
    {
        for(int layer=0;layer<3;layer++) {
            var vertices=new List<Vector3>();
            Vector3 Point(int i,bool bottom){
                float a=(i%192)/192f*Mathf.Tau;
                float h=.055f+(2-layer)*.009f+.025f*Mathf.Sin(a*5+2-layer)+.018f*Mathf.Sin(a*11+(2-layer)*2)+.008f*Mathf.Cos(a*23);
                return new Vector3(Mathf.Cos(a),bottom?-2:h,Mathf.Sin(a));
            }
            for(int i=0;i<192;i++){var a=Point(i,false);var b=Point(i+1,false);var c=Point(i+1,true);var d=Point(i,true);vertices.AddRange(new[]{a,b,c,a,c,d});}
            _layers.Add(Mesh(vertices));
        }
        var clouds=new List<Vector3>();
        for(int i=0;i<14;i++) {
            float a=i*2.39996f,elevation=.22f+(i%4)*.085f;
            for(int lobe=0;lobe<3;lobe++){
                Vector3 Point(float t,bool center=false){float x=(lobe-1)*.036f+(center?0:Mathf.Cos(t)*.05f),y=elevation+(lobe==1?.014f:0)+(center?0:Mathf.Sin(t)*.022f);return new Vector3(Mathf.Cos(a)-Mathf.Sin(a)*x,y,Mathf.Sin(a)+Mathf.Cos(a)*x);}
                for(int s=0;s<16;s++)clouds.AddRange(new[]{Point(0,true),Point(s/16f*Mathf.Tau),Point((s+1)/16f*Mathf.Tau)});
            }
        }
        _clouds=Mesh(clouds);((StandardMaterial3D)_clouds.MaterialOverride).AlbedoColor=new Color("#f4f4e9");
        Configure(96,96,"temperate");
    }
    private MeshInstance3D Mesh(List<Vector3> points)
    {
        var arrays=new Godot.Collections.Array();arrays.Resize((int)Godot.Mesh.ArrayType.Max);
        arrays[(int)Godot.Mesh.ArrayType.Vertex]=points.ToArray();
        var mesh=new ArrayMesh();mesh.AddSurfaceFromArrays(Godot.Mesh.PrimitiveType.Triangles,arrays);
        var instance=new MeshInstance3D{Mesh=mesh,MaterialOverride=new StandardMaterial3D{ShadingMode=BaseMaterial3D.ShadingModeEnum.Unshaded,CullMode=BaseMaterial3D.CullModeEnum.Disabled},CastShadow=GeometryInstance3D.ShadowCastingSetting.Off};
        AddChild(instance);return instance;
    }
    public void Configure(float width,float depth,string biome)
    {
        _width=width;_depth=depth;
        var colors=biome switch{
            "arid"=>new[]{"#b9ab95","#b19c79","#94835b"},
            "snowy"=>new[]{"#b4c6d0","#9bafbb","#849ba7"},
            "wetland"=>new[]{"#8da6a0","#738f83","#5c7966"},
            _=>new[]{"#849fa0","#718d80","#637959"}};
        for(int i=0;i<_layers.Count;i++)((StandardMaterial3D)_layers[i].MaterialOverride).AlbedoColor=new Color(colors[i]);
    }
    public void Follow(Vector3 camera)
    {
        float radius=Mathf.Max(300,Mathf.Sqrt(_width*_width+_depth*_depth)*3);
        void Place(Node3D mesh,float follow,float scale){mesh.Position=new Vector3(_width/2+(camera.X-_width/2)*follow,camera.Y*.8f,_depth/2+(camera.Z-_depth/2)*follow);mesh.Scale=Vector3.One*radius*scale;}
        Place(_clouds,.97f,1.8f);
        for(int i=0;i<_layers.Count;i++)Place(_layers[i],.8f-i*.2f,1.5f-i*.25f);
    }
}
