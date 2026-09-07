using Godot;
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json.Nodes;
using FileAccess = Godot.FileAccess;

namespace Village.Rendering;

/// <summary>Schema-v4 rendering using the original metre/tile model contract.</summary>
public partial class VillageScene : Node3D
{
    public JsonObject Map { get; private set; } = new();
    public Aabb MapBounds { get; private set; }
    public Aabb VillageBounds { get; private set; }
    public Vector3 SpawnPosition { get; private set; }
    public const float LevelHeight = .25f;
    public const int ChunkSize = 16;
    private int width, height;
    private readonly HashSet<int> roadCells = new();
    private readonly Dictionary<string, JsonNode> catalog = new();
    private readonly Dictionary<string, List<Transform3D>> batches = new();
    private readonly List<Aabb> obstacles = new();
    private readonly List<Vector3[]> surfaces = new();
    private Node3D world = null!;
    private MeshInstance3D? zones;
    private static readonly Dictionary<string,string> Colors = new() { ["grass"]="#819356",["forest"]="#647b48",["sand"]="#c7b783",["rock"]="#85857d",["dry-grass"]="#b4a06a",["scrub"]="#a18d56",["snow"]="#dce5e8",["pine-forest"]="#c2d3d5",["ice"]="#b0ccd4",["snow-rock"]="#9aaab0",["wet-grass"]="#74855d",["swamp-forest"]="#536d53",["marsh"]="#839273",["water"]="#657d78" };
    private static readonly Dictionary<string,string> ZoneColors = new() { ["residential"]="#70b4e5",["commercial"]="#efcc62",["craft"]="#dd9374",["agricultural"]="#a9ce73",["civic"]="#c0a3e2" };
    private static float Number(JsonNode n) => float.Parse(n.ToJsonString(),CultureInfo.InvariantCulture);
    private static float F(JsonNode? n, string key, float fallback=0) => n?[key] is JsonNode v ? Number(v) : fallback;
    private static string S(JsonNode? n,string key,string fallback="") => n?[key]?.GetValue<string>() ?? fallback;
    private static IEnumerable<JsonNode> Items(JsonNode? n) => n is JsonArray a ? a.OfType<JsonNode>() : Enumerable.Empty<JsonNode>();
    private float Level(int x,int z) => x<0||z<0||x>=width||z>=height ? -.6f : preparedGround.GetValueOrDefault(z*width+x,Number(Map["heightLevel"]![z*width+x]!)*LevelHeight);
    private string Terrain(int x,int z) => Map["terrain"]![z*width+x]!.GetValue<string>();
    private static Vector3 Vec(JsonNode n) => new(Number(n[0]!),Number(n[1]!),Number(n[2]!));
    private static float Angle(string direction) => direction switch { "east"=>Mathf.Pi/2,"north"=>Mathf.Pi,"west"=>-Mathf.Pi/2,_=>0 };
    private static Transform3D Pose(float x,float y,float z,float angle) => new(new Basis(Vector3.Up,angle),new Vector3(x,y,z));

    public void Build(JsonObject map)
    {
        if(F(map,"schemaVersion")!=4) throw new ArgumentException("VillageScene requires VillageMap schema 4.");
        SimulationClearBuildings();simulationObstacles.Clear();selectionOutline=null;
        if(world!=null) { RemoveChild(world); world.QueueFree(); }
        world=new Node3D { Name="GeneratedWorld" }; AddChild(world);
        Map=map; width=(int)F(map,"width"); height=(int)F(map,"height");
        roadCells.Clear(); batches.Clear(); obstacles.Clear(); surfaces.Clear(); surfaceIndex.Clear(); catalog.Clear();
        foreach(var asset in Items(JsonNode.Parse(FileAccess.GetFileAsString("res://assets/models/catalog.json")))) catalog[S(asset,"id")]=asset;
        foreach(var road in Items(Map["roads"])) if(road["bridge"]?.GetValue<bool>()!=true) roadCells.Add((int)F(road,"y")*width+(int)F(road,"x"));
        PrepareEntrances();BuildTerrain(); BuildPaths(); BuildModels(); FlushModels();BuildGrass();
        float terrainTop=Items(Map["heightLevel"]).Select(Number).DefaultIfEmpty(0).Max()*LevelHeight;
        MapBounds=new Aabb(new Vector3(0,-.6f,0),new Vector3(width,terrainTop+.6f,height)).Merge(VillageBounds);
        foreach(var batch in batches)foreach(var transform in batch.Value)
            MapBounds=MapBounds.Merge(AssetBounds(batch.Key,transform));
        SpawnPosition=FindSpawn();
        var border=new VillageBorder();world.AddChild(border);border.Build(map);
        world.AddChild(new ReflectionProbe{Name="CachedVillageReflection",Position=SpawnPosition+Vector3.Up*3,Size=new Vector3(width*2,40,height*2),MaxDistance=180,UpdateMode=ReflectionProbe.UpdateModeEnum.Once,EnableShadows=false,Intensity=.6f,AmbientMode=ReflectionProbe.AmbientModeEnum.Color,AmbientColor=new Color("#d8e3eb"),AmbientColorEnergy=.3f});
    }

    public void SetShowZones(bool visible) { if(zones!=null) zones.Visible=visible; }

    private sealed class Geometry
    {
        public readonly List<Vector3> Vertices=new();
        public readonly List<Color> Colors=new();
        public void Quad(Vector3 a,Vector3 b,Vector3 c,Vector3 d,Color color)
        {
            // Godot's front-face winding is clockwise, the shared surface contract is CCW.
            foreach(var v in new[]{a,c,b,a,d,c}) { Vertices.Add(v); Colors.Add(color); }
        }
        public ArrayMesh Mesh()
        {
            var st=new SurfaceTool(); st.Begin(Godot.Mesh.PrimitiveType.Triangles);
            st.SetSmoothGroup(uint.MaxValue); // Keep terrace walls and flat ground normals separate.
            for(int i=0;i<Vertices.Count;i++) { st.SetColor(Colors[i]); st.AddVertex(Vertices[i]); }
            st.GenerateNormals(); return st.Commit();
        }
    }
    // Hex palette values are sRGB. Compatibility already renders in this encoding;
    // Forward+/Mobile need this flag to convert the authored values to linear.
    private static StandardMaterial3D Material() => new() { VertexColorUseAsAlbedo=true,VertexColorIsSrgb=true,Roughness=1,CullMode=BaseMaterial3D.CullModeEnum.Disabled };
    private MeshInstance3D? AddGeometry(string name,Geometry geometry,Material material,Geometry? collision=null)
    {
        if(geometry.Vertices.Count==0) return null;
        var mesh=new MeshInstance3D { Name=name,Mesh=geometry.Mesh(),MaterialOverride=material }; world.AddChild(mesh);
        if(collision?.Vertices.Count>0) GroundCollider(name+"Collision",collision.Vertices.ToArray());
        return mesh;
    }
    private void GroundCollider(string name,Vector3[] faces)
    {
        var body=new StaticBody3D { Name=name }; body.AddToGroup("walk_ground");
        body.AddChild(new CollisionShape3D { Shape=new ConcavePolygonShape3D { Data=faces,BackfaceCollision=true } }); world.AddChild(body);
    }
    private void BoxCollider(Aabb box)
    {
        obstacles.Add(box);
        var body=new StaticBody3D { Position=box.GetCenter() };
        body.AddChild(new CollisionShape3D { Shape=new BoxShape3D { Size=box.Size } }); world.AddChild(body);
    }
    private void BuildTerrain()
    {
        var ground=DetailMaterial(new Color(1,1,1),0); var water=new Geometry(); var overlay=new Geometry();
        for(int sz=0;sz<height;sz+=ChunkSize) for(int sx=0;sx<width;sx+=ChunkSize)
        {
            var g=new Geometry(); var solid=new Geometry();
            for(int z=sz;z<Math.Min(height,sz+ChunkSize);z++) for(int x=sx;x<Math.Min(width,sx+ChunkSize);x++)
            {
                string type=Terrain(x,z); bool wet=type=="water"; float y=wet?-.16f:Level(x,z);
                var color=new Color(Colors.GetValueOrDefault(type,"#819356"))*(.95f+((x*17+z*29)%11)/110f); color.A=1;
                var a=new Vector3(x,y,z); var b=new Vector3(x,y,z+1); var c=new Vector3(x+1,y,z+1); var d=new Vector3(x+1,y,z);
                if(!roadCells.Contains(z*width+x)) { g.Quad(a,b,c,d,color); if(!wet) solid.Quad(a,b,c,d,color); }
                foreach(var edge in new[]{(x-1,z,a,b),(x+1,z,c,d),(x,z-1,d,a),(x,z+1,b,c)})
                {
                    if(roadCells.Contains(z*width+x)&&edge.Item1>=0&&edge.Item2>=0&&edge.Item1<width&&edge.Item2<height&&roadCells.Contains(edge.Item2*width+edge.Item1)) continue;
                    float low=Level(edge.Item1,edge.Item2);
                    if(low<y) { var e=edge.Item3;var f=edge.Item4;var fl=new Vector3(f.X,low,f.Z);var el=new Vector3(e.X,low,e.Z);g.Quad(e,f,fl,el,color*.76f);if(!wet)solid.Quad(e,f,fl,el,color); }
                }
                if(wet) water.Quad(new(x,.015f,z),new(x,.015f,z+1),new(x+1,.015f,z+1),new(x+1,.015f,z),ColorsWhite);
                else if(ZoneColors.TryGetValue(Map["zoneMap"]?[z*width+x]?.GetValue<string>()??"",out var zone)) {float h=y+.08f;overlay.Quad(new(x,h,z),new(x,h,z+1),new(x+1,h,z+1),new(x+1,h,z),new Color(zone));}
            }
            AddGeometry($"Terrain_{sx}_{sz}",g,ground,solid);
        }
        var wetMaterial=Material();wetMaterial.AlbedoColor=new Color(S(Map["settings"],"biome")=="wetland"?"#587b6d":"#588e9c");wetMaterial.AlbedoColor=new Color(wetMaterial.AlbedoColor,.86f);wetMaterial.Transparency=BaseMaterial3D.TransparencyEnum.Alpha;wetMaterial.Roughness=.32f;wetMaterial.Metallic=.15f;
        AddGeometry("Water",water,wetMaterial);
        var zoneMaterial=Material();zoneMaterial.AlbedoColor=new Color(1,1,1,.28f);zoneMaterial.Transparency=BaseMaterial3D.TransparencyEnum.Alpha;zoneMaterial.ShadingMode=BaseMaterial3D.ShadingModeEnum.Unshaded;
        zones=AddGeometry("Zones",overlay,zoneMaterial);if(zones!=null)zones.Visible=false;
    }
    private static readonly Color ColorsWhite=Godot.Colors.White;
    private float Corner(int x,int z)
    {
        float sum=0;int count=0;
        for(int dz=-1;dz<=0;dz++)for(int dx=-1;dx<=0;dx++)if(x+dx>=0&&z+dz>=0&&x+dx<width&&z+dz<height&&roadCells.Contains((z+dz)*width+x+dx)){sum+=Level(x+dx,z+dz);count++;}
        return (count>0?sum/count:Level(x,z))+.045f;
    }
    private float PathHeight(float x,float z)
    {
        int tx=(int)Mathf.Floor(x),tz=(int)Mathf.Floor(z);
        if(!roadCells.Contains(tz*width+tx))return Level(tx,tz)+.045f;
        float u=x-tx,v=z-tz,a=Corner(tx,tz),b=Corner(tx,tz+1),c=Corner(tx+1,tz+1),d=Corner(tx+1,tz);
        return u<=v?a+v*(b-a)+u*(c-b):a+u*(d-a)+v*(c-d);
    }
    private void Surface(Geometry geometry,Vector3[] vertices,string color)
    { geometry.Quad(vertices[0],vertices[1],vertices[2],vertices[3],new Color(color));RegisterSurface(vertices); }
    private void BuildPaths()
    {
        var paths=new Geometry();var ramps=new Geometry();var decks=new Geometry();
        var adapted=BakeRoadRuns(paths);
        foreach(var road in Items(Map["roads"])) if(road["bridge"]?.GetValue<bool>()!=true)
        {
            int x=(int)F(road,"x"),z=(int)F(road,"y");
            if(adapted.Contains(z*width+x))continue;
            Surface(paths,new[]{new Vector3(x,Corner(x,z),z),new Vector3(x,Corner(x,z+1),z+1),new Vector3(x+1,Corner(x+1,z+1),z+1),new Vector3(x+1,Corner(x+1,z),z)},S(road,"kind") switch{"plaza"=>"#c2b9a3","main"=>"#a5a293",_=>"#ac9472"});
        }
        // Entrances stay on prepared ground. Only bridge banks need ramps.
        foreach(var span in Items(Map["bridgeSpans"]))
        {
            var entry=span["entry"]!;var exit=span["exit"]!;bool ew=S(span,"axis")=="ew";
            float deck=Math.Max(Level((int)F(entry,"x"),(int)F(entry,"y")),Level((int)F(exit,"x"),(int)F(exit,"y")))+.08f,h=deck+.1825f;
            var cells=Items(span["roadIndexes"]).Select(i=>Map["roads"]![(int)Number(i)]!).ToArray();if(cells.Length==0)continue;
            float x0=cells.Min(c=>F(c,"x"))+(ew?0:.08f),x1=cells.Max(c=>F(c,"x"))+1-(ew?0:.08f),z0=cells.Min(c=>F(c,"y"))+(ew?.08f:0),z1=cells.Max(c=>F(c,"y"))+1-(ew?.08f:0);
            Surface(decks,new[]{new Vector3(x0,h,z0),new Vector3(x0,h,z1),new Vector3(x1,h,z1),new Vector3(x1,h,z0)},"#aa9878");
            foreach(var cell in cells) Batch("bridge:"+S(cell,"bridgeRole"),Pose(F(cell,"x")+.5f,deck,F(cell,"y")+.5f,ew?0:-Mathf.Pi/2));
            foreach(int side in new[]{-1,1}) {float lateral=(ew?(z0+z1)/2:(x0+x1)/2)+side*.42f;BoxCollider(ew?new Aabb(new(x0,deck,lateral-.035f),new(x1-x0,.7f,.07f)):new Aabb(new(lateral-.035f,deck,z0),new(.07f,.7f,z1-z0)));}
            foreach(var bank in new[]{(entry,true),(exit,false)})
            {
                float x=F(bank.Item1,"x"),z=F(bank.Item1,"y");
                float a=Corner((int)x,(int)z),b=Corner((int)x,(int)z+1),c=Corner((int)x+1,(int)z+1),d=Corner((int)x+1,(int)z);
                // Match the actual road edge, including its lateral slope.
                // The opposite edge is level with the continuous bridge deck.
                Surface(ramps,ew?new[]{new Vector3(x,bank.Item2?Mathf.Lerp(a,b,.08f):h,z+.08f),new Vector3(x,bank.Item2?Mathf.Lerp(a,b,.92f):h,z+.92f),new Vector3(x+1,bank.Item2?h:Mathf.Lerp(d,c,.92f),z+.92f),new Vector3(x+1,bank.Item2?h:Mathf.Lerp(d,c,.08f),z+.08f)}:new[]{new Vector3(x+.08f,bank.Item2?Mathf.Lerp(a,d,.08f):h,z),new Vector3(x+.08f,bank.Item2?h:Mathf.Lerp(b,c,.08f),z+1),new Vector3(x+.92f,bank.Item2?h:Mathf.Lerp(b,c,.92f),z+1),new Vector3(x+.92f,bank.Item2?Mathf.Lerp(a,d,.92f):h,z)},"#aa9878");
            }
        }
        AddGeometry("Paths",paths,DetailMaterial(ColorsWhite,1),paths);AddGeometry("BridgeRamps",ramps,Material(),ramps);
        if(decks.Vertices.Count>0) GroundCollider("BridgeDecks",decks.Vertices.ToArray());
    }
    private void Batch(string id,Transform3D transform) {if(!catalog.ContainsKey(id))throw new InvalidOperationException("Missing catalog model: "+id);if(!batches.ContainsKey(id))batches[id]=new();batches[id].Add(transform);}
    private Aabb AssetBounds(string id,Transform3D transform)
    {var b=catalog[id]["bounds"]!;return transform*new Aabb(Vec(b["min"]!),Vec(b["max"]!)-Vec(b["min"]!));}
    private void BuildModels()
    {
        var lanterns=new List<Transform3D>();var brackets=new List<Transform3D>();
        bool first=true;
        // Varanda, galeria e alpendre saem do footprint declarado, e o solo so e
        // nivelado dentro dele mais o corredor de acesso. Medir quanto de modelo
        // fica sobre terreno nao preparado diz se um apoio corrigido no GLB ainda
        // pode aparecer solto na vila. E medida, nao assercao: o desnivel aqui e
        // do gerador, nao do modelo.
        int balancoCelulas=0,balancoPredios=0;float balancoMaximo=0;
        foreach(var b in Items(Map["buildings"]))
        {
            string id=S(b,"assetId");var t=Pose(F(b,"x")+F(b,"width")/2,F(b,"baseLevel")*LevelHeight,F(b,"y")+F(b,"height")/2,Angle(S(b,"orientation")));
            Batch(id,t);var bounds=AssetBounds(id,t);BuildingCollider(bounds,b);VillageBounds=first?bounds:VillageBounds.Merge(bounds);first=false;
            float alvo=F(b,"baseLevel")*LevelHeight;bool sobra=false;
            for(int cz=(int)Math.Floor(bounds.Position.Z);cz<(int)Math.Ceiling(bounds.End.Z);cz++)
            for(int cx=(int)Math.Floor(bounds.Position.X);cx<(int)Math.Ceiling(bounds.End.X);cx++)
            {
                if(cx<0||cz<0||cx>=width||cz>=height)continue;
                float desnivel=alvo-Level(cx,cz);
                if(desnivel<=.05f)continue;
                balancoCelulas++;sobra=true;balancoMaximo=Math.Max(balancoMaximo,desnivel);
            }
            if(sobra)balancoPredios++;
            if(b["entrance"] is JsonNode entry)
            {
                var side=t.Basis.X*.5f;var p=new Vector3(F(entry,"x"),F(entry,"level")*LevelHeight+.93f,F(entry,"y"))+side;
                if(bounds.Grow(.02f).HasPoint(p))
                {
                    lanterns.Add(new Transform3D(Basis.Identity.Scaled(new Vector3(.095f,.14f,.095f)),p));
                    foreach(int sign in new[]{-1,1})brackets.Add(new Transform3D(Basis.Identity.Scaled(new Vector3(.13f,.035f,.13f)),p+Vector3.Up*(sign*.083f)));
                }
            }
        }
        GD.Print($"BUILDING_OVERHANG_CHECK predios={balancoPredios} celulas={balancoCelulas} desnivel_max={balancoMaximo:0.00}");
        if(first)VillageBounds=new Aabb(Vector3.Zero,new Vector3(width,4,height));
        DetailBoxes("DoorLanternGlass",lanterns,new Color("#e7bd78"),true);DetailBoxes("DoorLanternFrames",brackets,new Color("#3e3931"));
        foreach(var p in Items(Map["props"]))
        {
            string type=S(p,"type"),id="prop:"+type;
            if(type=="oak")id="prop:"+new[]{"oak","birch","elm"}[(int)F(p,"variant")%3];
            var t=Pose(F(p,"x")+.5f,F(p,"level")*LevelHeight,F(p,"y")+.5f,F(p,"variant")*Mathf.Pi/3);Batch(id,t);
            if(type is "bush" or "reeds")continue;
            float radius=type switch{"oak"=>.27f,"pine"=>.18f,"willow"=>.30f,_=>0};
            if(radius==0)BoxCollider(AssetBounds(id,t));
            else {float h=F(catalog[id],"height");var body=new StaticBody3D{Position=t.Origin+Vector3.Up*h/2};body.AddChild(new CollisionShape3D{Shape=new CylinderShape3D{Radius=radius,Height=h}});world.AddChild(body);obstacles.Add(new Aabb(t.Origin-new Vector3(radius,0,radius),new Vector3(radius*2,h,radius*2)));}
        }
    }
    private void FlushModels()
    {
        foreach(var batch in batches)
        {
            string path="res://"+S(catalog[batch.Key],"src").TrimStart('/');
            var scene=ResourceLoader.Load<PackedScene>(path)??throw new InvalidOperationException("Cannot load "+path);var root=scene.Instantiate();
            void Visit(Node node,Transform3D parent)
            {
                var transform=node is Node3D n?parent*n.Transform:parent;
                if(node is MeshInstance3D part&&part.Mesh!=null)
                {
                    var mm=new MultiMesh{TransformFormat=MultiMesh.TransformFormatEnum.Transform3D,Mesh=part.Mesh,InstanceCount=batch.Value.Count};
                    for(int i=0;i<batch.Value.Count;i++)mm.SetInstanceTransform(i,batch.Value[i]*transform);
                    var authored=part.MaterialOverride??part.Mesh.SurfaceGetMaterial(0);
                    var instance=new MultiMeshInstance3D{Multimesh=mm,MaterialOverride=RefineMaterial(authored)};
                    instance.SetMeta("assetId",batch.Key);
                    if(authored!=null)instance.SetMeta("authoredMaterial",authored);
                    if(instance.MaterialOverride!=null)instance.SetMeta("detailMaterial",instance.MaterialOverride);
                    world.AddChild(instance);
                }
                foreach(var child in node.GetChildren())Visit(child,transform);
            }
            Visit(root,Transform3D.Identity);root.Free();
        }
    }
    public float? SurfaceHeight(float x,float z)
    {
        int tx=(int)Mathf.Floor(x),tz=(int)Mathf.Floor(z);if(tx<0||tz<0||tx>=width||tz>=height)return null;
        float? best=Terrain(tx,tz)!="water"&&!roadCells.Contains(tz*width+tx)?Level(tx,tz):null;
        if(!surfaceIndex.TryGetValue(tz*width+tx,out var candidates))return best;
        foreach(var v in candidates)foreach(var tri in new[]{(v[0],v[1],v[2]),(v[0],v[2],v[3])})
        {
            var u=tri.Item2-tri.Item1;var w=tri.Item3-tri.Item1;double det=(double)u.X*w.Z-(double)u.Z*w.X;if(Math.Abs(det)<1e-12)continue;
            double px=x-tri.Item1.X,pz=z-tri.Item1.Z,a=(px*w.Z-pz*w.X)/det,b=(u.X*pz-u.Z*px)/det;
            if(a<-.00001||b<-.00001||a+b>1.00001)continue;float h=(float)(tri.Item1.Y+a*u.Y+b*w.Y);if(best==null||h>best)best=h;
        }
        return best;
    }
    private Vector3 FindSpawn()
    {
        var plaza=Map["plaza"];float cx=plaza==null?width/2f:F(plaza,"x")+F(plaza,"width")/2,cz=plaza==null?height/2f:F(plaza,"y")+F(plaza,"height")/2;
        var candidates=new List<Vector2>{new(cx,cz)};for(int z=0;z<height;z++)for(int x=0;x<width;x++)candidates.Add(new(x+.5f,z+.5f));
        foreach(var p in candidates.OrderBy(p=>p.DistanceSquaredTo(new Vector2(cx,cz))))
        {
            var y=SurfaceHeight(p.X,p.Y);if(y==null)continue;
            if(obstacles.Any(b=>p.X>b.Position.X-.2f&&p.X<b.End.X+.2f&&p.Y>b.Position.Z-.2f&&p.Y<b.End.Z+.2f&&b.End.Y>y))continue;
            bool supported=true;for(int i=0;i<8;i++){float a=i*Mathf.Pi/4;var q=SurfaceHeight(p.X+Mathf.Cos(a)*.18f,p.Y+Mathf.Sin(a)*.18f);if(q==null||Math.Abs(q.Value-y.Value)>.26f){supported=false;break;}}
            if(supported)return new Vector3(p.X,y.Value,p.Y);
        }
        throw new InvalidOperationException("Map has no supported walking spawn.");
    }
}
