using Godot;
using System.Text.Json.Nodes;

namespace Village.Rendering;

public partial class VillageScene
{
    private void DetailBoxes(string name,List<Transform3D> poses,Color color,bool glow=false)
    {
        if(poses.Count==0)return;
        var mm=new MultiMesh{TransformFormat=MultiMesh.TransformFormatEnum.Transform3D,Mesh=new BoxMesh{Size=Vector3.One},InstanceCount=poses.Count};
        for(int i=0;i<poses.Count;i++)mm.SetInstanceTransform(i,poses[i]);
        world.AddChild(new MultiMeshInstance3D{Name=name,Multimesh=mm,MaterialOverride=new StandardMaterial3D{AlbedoColor=color,Roughness=.9f,EmissionEnabled=glow,Emission=color,EmissionEnergyMultiplier=.35f},CastShadow=GeometryInstance3D.ShadowCastingSetting.Off});
    }
    private static List<Vector2> AccessPoints(JsonNode building)
    {
        var points=Items(building["accessPath"]).Select(p=>new Vector2(F(p,"x"),F(p,"y"))).ToList();
        if(points.Count<2)return points;
        var forward=S(building,"orientation") switch{"east"=>Vector2.Right,"west"=>Vector2.Left,"north"=>Vector2.Up,_=>Vector2.Down};
        float reach=(points[1]-points[0]).Dot(forward);
        if(reach>.12f)points.Insert(1,points[0]+forward*Math.Min(.24f,reach*.4f));
        return points;
    }
    private readonly Dictionary<int,float> preparedGround=new();
    private readonly Dictionary<string,Material> detailedMaterials=new();
    private readonly HashSet<int> approachCells=new();

    private void PrepareEntrances()
    {
        preparedGround.Clear();approachCells.Clear();detailedMaterials.Clear();
        foreach(var b in Items(Map["buildings"]))
        {
            int x0=(int)F(b,"x"),z0=(int)F(b,"y");
            for(int z=z0;z<z0+(int)F(b,"height");z++)for(int x=x0;x<x0+(int)F(b,"width");x++)
                if(!roadCells.Contains(z*width+x)&&Terrain(x,z)!="water")preparedGround[z*width+x]=F(b,"baseLevel")*LevelHeight;
            var path=AccessPoints(b);
            for(int i=1;i<path.Count;i++)
            {
                var a=path[i-1];var end=path[i];
                int count=Math.Max(1,(int)Math.Ceiling(a.DistanceTo(end)*8));
                for(int j=0;j<=count;j++)
                {
                    var p=a.Lerp(end,j/(float)count);
                    for(int dz=-1;dz<=1;dz++)for(int dx=-1;dx<=1;dx++)
                    {
                        int x=(int)Math.Floor(p.X+dx*.36f),z=(int)Math.Floor(p.Y+dz*.36f);
                        if(x<0||z<0||x>=width||z>=height||Terrain(x,z)=="water")continue;
                        int cell=z*width+x;approachCells.Add(cell);
                        // Ground-level forecourt: never place a raised access slab.
                        if(!roadCells.Contains(cell))preparedGround[cell]=F(b,"baseLevel")*LevelHeight;
                    }
                }
            }
        }
    }

    private void BuildingCollider(Aabb box,JsonNode building)
    {
        var entrance=building["entrance"];if(entrance==null){BoxCollider(box);return;}
        float x=F(entrance,"x"),z=F(entrance,"y");string facing=S(building,"orientation");
        var min=box.Position;var max=box.End;
        void Solid(Vector3 a,Vector3 b){var size=b-a;if(size.X>.005f&&size.Y>.005f&&size.Z>.005f)BoxCollider(new Aabb(a,size));}
        // Keep the building solid behind the actual door; roof overhang is not a wall.
        if(facing is "east" or "west")
        {
            float cut=Mathf.Clamp(x,min.X,max.X),a=facing=="east"?cut:min.X,b=facing=="east"?max.X:cut;
            Solid(new Vector3(facing=="east"?min.X:cut,min.Y,min.Z),new Vector3(facing=="east"?cut:max.X,max.Y,max.Z));
            Solid(new Vector3(a,min.Y,min.Z),new Vector3(b,max.Y,Mathf.Clamp(z-.48f,min.Z,max.Z)));
            Solid(new Vector3(a,min.Y,Mathf.Clamp(z+.48f,min.Z,max.Z)),new Vector3(b,max.Y,max.Z));
        }
        else
        {
            float cut=Mathf.Clamp(z,min.Z,max.Z),a=facing=="south"?cut:min.Z,b=facing=="south"?max.Z:cut;
            Solid(new Vector3(min.X,min.Y,facing=="south"?min.Z:cut),new Vector3(max.X,max.Y,facing=="south"?cut:max.Z));
            Solid(new Vector3(min.X,min.Y,a),new Vector3(Mathf.Clamp(x-.48f,min.X,max.X),max.Y,b));
            Solid(new Vector3(Mathf.Clamp(x+.48f,min.X,max.X),min.Y,a),new Vector3(max.X,max.Y,b));
        }
    }

    private static readonly Shader DetailShader=new(){Code="""
shader_type spatial;
render_mode cull_disabled;
uniform vec4 tint : source_color = vec4(1.0);
uniform int kind = 0;
varying vec3 local_position;
varying vec3 local_normal;
void vertex(){ local_position=VERTEX; local_normal=NORMAL; COLOR.rgb=mix(COLOR.rgb/12.92,pow((COLOR.rgb+vec3(.055))/1.055,vec3(2.4)),step(vec3(.04045),COLOR.rgb)); }
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void fragment(){
 vec2 p=abs(local_normal.y)>.6?local_position.xz:(abs(local_normal.x)>.6?local_position.zy:local_position.xy);
 float noise=hash(floor(p*90.0)); float shade=.97+noise*.06;
 float relief=0.0; float cavity=1.0;
 if(kind==1||kind==3||kind==4){
   vec2 scale=kind==1?vec2(3.3,5.0):(kind==4?vec2(4.0,6.0):vec2(2.7,5.0));
   vec2 cell=p*scale;cell.x+=mod(floor(cell.y),2.0)*.5;
   vec2 f=fract(cell);vec2 edge=min(f,1.0-f);vec2 aa=max(fwidth(cell),vec2(.001));
   float joint=min(smoothstep(.02,.02+aa.x,edge.x),smoothstep(.025,.025+aa.y,edge.y));
   shade*=mix(.64,.92+hash(floor(cell))*.16,joint);
   cavity=joint;
   relief=joint*(kind==4?.012:.008);
   if(kind==4)relief+=joint*.012*f.y;
 }else if(kind==2){
   float board=p.x*7.5;float edge=min(fract(board),1.0-fract(board));
   shade*=mix(.78,1.0,smoothstep(.012,.012+max(fwidth(board),.002),edge));
   shade*=.98+.02*sin(p.x*130.0)*clamp(1.0-fwidth(p.x)*35.0,0.0,1.0);
   cavity=smoothstep(.012,.012+max(fwidth(board),.002),edge);
   relief=.004*cavity+.0006*sin(p.x*130.0+p.y*2.0)*clamp(1.0-fwidth(p.x)*35.0,0.0,1.0);
 }
 // Surface-gradient bump: derivatives and NORMAL are all in view space.
 // No UVs/tangents required; fade subpixel relief to avoid distant sparkle.
 vec3 dx=dFdx(VERTEX),dy=dFdy(VERTEX),n=normalize(NORMAL);
 vec3 rx=cross(dy,n),ry=cross(n,dx);
 float determinant=dot(dx,rx);
 float fade=1.0-smoothstep(.05,.22,max(length(dFdx(p)),length(dFdy(p))));
 vec3 gradient=(rx*dFdx(relief)+ry*dFdy(relief))*sign(determinant)/max(abs(determinant),.000001);
 NORMAL=normalize(n-clamp(gradient,vec3(-.6),vec3(.6))*fade);
 ALBEDO=tint.rgb*COLOR.rgb*shade;
 ROUGHNESS=clamp((kind==2?.76:.90)+(1.0-cavity)*.07+(noise-.5)*.035,.55,1.0);
}
"""};
    private static ShaderMaterial DetailMaterial(Color tint,int kind)
    {var m=new ShaderMaterial{Shader=DetailShader};m.SetShaderParameter("tint",tint);m.SetShaderParameter("kind",kind);return m;}
    private Material? RefineMaterial(Material? original)
    {
        if(original is not StandardMaterial3D authored)return original;
        string name=authored.ResourceName.ToLowerInvariant(),key=name+authored.AlbedoColor.ToHtml();
        if(detailedMaterials.TryGetValue(key,out var cached))return cached;
        Material result=authored;
        if(name.Contains("glass"))
        {
            var glass=(StandardMaterial3D)authored.Duplicate();glass.Roughness=.12f;glass.Metallic=.38f;
            glass.ClearcoatEnabled=true;glass.Clearcoat=.65f;glass.ClearcoatRoughness=.12f;result=glass;
        }
        else if(name.Contains("oak")||name.Contains("beams")||name.Contains("shingles"))result=DetailMaterial(authored.AlbedoColor,2);
        else if(name.Contains("stone")||name.Contains("brick"))result=DetailMaterial(authored.AlbedoColor,3);
        else if(name.Contains("tiles")||name.Contains("slate"))result=DetailMaterial(authored.AlbedoColor,4);
        else if(name.Contains("plaster")||name.Contains("lime"))result=DetailMaterial(authored.AlbedoColor,0);
        detailedMaterials[key]=result;return result;
    }

    private void BuildGrass()
    {
        var random=new Random(72413); // Render-only variation, independent of the procedural PRNG.
        var blade=new SurfaceTool();blade.Begin(Mesh.PrimitiveType.Triangles);
        for(int i=0;i<5;i++)
        {
            float a=i*Mathf.Pi/5;var side=new Vector3(Mathf.Cos(a),0,Mathf.Sin(a))*.025f;
            blade.SetNormal(Vector3.Up);blade.AddVertex(-side);blade.AddVertex(new Vector3(Mathf.Sin(a)*.045f,.13f+i*.012f,Mathf.Cos(a)*.045f));blade.AddVertex(side);
        }
        var mesh=blade.Commit();var material=new StandardMaterial3D{VertexColorUseAsAlbedo=true,VertexColorIsSrgb=true,CullMode=BaseMaterial3D.CullModeEnum.Disabled,Roughness=1};
        var excluded=new HashSet<int>(approachCells);excluded.UnionWith(roadCells);
        foreach(var b in Items(Map["buildings"]))for(int z=(int)F(b,"y");z<F(b,"y")+F(b,"height");z++)for(int x=(int)F(b,"x");x<F(b,"x")+F(b,"width");x++)excluded.Add(z*width+x);
        foreach(var p in Items(Map["props"]))excluded.Add((int)F(p,"y")*width+(int)F(p,"x"));
        for(int cz=0;cz<height;cz+=8)for(int cx=0;cx<width;cx+=8)
        {
            var poses=new List<Transform3D>();var colors=new List<Color>();
            for(int z=cz;z<Math.Min(cz+8,height);z++)for(int x=cx;x<Math.Min(cx+8,width);x++)
            {
                string type=Terrain(x,z);if(excluded.Contains(z*width+x)||!(type.Contains("grass")||type is "forest" or "swamp-forest" or "scrub" or "marsh"))continue;
                bool dry=type is "dry-grass" or "scrub";int count=dry?8:22;
                for(int i=0;i<count;i++)
                {
                    var p=new Vector3(x+(float)random.NextDouble(),Level(x,z),z+(float)random.NextDouble());
                    float s=.65f+(float)random.NextDouble()*.8f;
                    poses.Add(new Transform3D(new Basis(Vector3.Up,(float)random.NextDouble()*Mathf.Tau).Scaled(Vector3.One*s),p));
                    colors.Add(new Color(dry?"#a29a61":"#7a914a")*(.72f+(float)random.NextDouble()*.4f));
                }
            }
            if(poses.Count==0)continue;
            var mm=new MultiMesh{TransformFormat=MultiMesh.TransformFormatEnum.Transform3D,UseColors=true,Mesh=mesh,InstanceCount=poses.Count};
            for(int i=0;i<poses.Count;i++){mm.SetInstanceTransform(i,poses[i]);mm.SetInstanceColor(i,colors[i]);}
            world.AddChild(new MultiMeshInstance3D{Name=$"Grass_{cx}_{cz}",Multimesh=mm,MaterialOverride=material,CastShadow=GeometryInstance3D.ShadowCastingSetting.Off,VisibilityRangeEnd=42});
            int farCount=(poses.Count+7)/8;
            var far=new MultiMesh{TransformFormat=MultiMesh.TransformFormatEnum.Transform3D,UseColors=true,Mesh=mesh,InstanceCount=farCount};
            for(int i=0;i<farCount;i++){far.SetInstanceTransform(i,poses[i*8]);far.SetInstanceColor(i,colors[i*8]);}
            world.AddChild(new MultiMeshInstance3D{Name=$"GrassDistant_{cx}_{cz}",Multimesh=far,MaterialOverride=material,CastShadow=GeometryInstance3D.ShadowCastingSetting.Off,VisibilityRangeBegin=42,VisibilityRangeEnd=500});
        }
    }
}
