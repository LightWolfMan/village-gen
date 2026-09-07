using System.Text.Json.Nodes;
namespace Village.Core;
public static partial class VillageGenerator
{
    static JsonArray PlaceProps(MapData m,RandomSource random,HashSet<string> reserved,JsonArray buildings)
    {
        string Key(int x,int y)=>$"{x},{y}";
        var props=new JsonArray();var occupied=new HashSet<string>();var b=m.Biome;string[] choices=[b.Tree,b.Tree,b.Tree,"rock",m.Settings.Biome=="wetland"?"reeds":"bush"];int desired=m.Width*m.Height/95;var blocked=new HashSet<string>(reserved);
        foreach(var building in buildings)for(int y=J.I(building,"y")-1;y<=J.I(building,"y")+J.I(building,"height");y++)for(int x=J.I(building,"x")-1;x<=J.I(building,"x")+J.I(building,"width");x++)blocked.Add(Key(x,y));
        // Roads own their full corridor, not just the center of a prop's tile.
        foreach(var p in m.RoadMap.Keys)for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++)blocked.Add(Key(p.X+dx,p.Y+dy));
        foreach(var building in buildings)
        {
            var path=building?["accessPath"]?.AsArray();if(path==null)continue;
            for(int i=1;i<path.Count;i++)
            {
                double ax=J.D(path[i-1],"x"),ay=J.D(path[i-1],"y"),bx=J.D(path[i],"x"),by=J.D(path[i],"y");
                int steps=Math.Max(1,(int)Math.Ceiling(Math.Sqrt((bx-ax)*(bx-ax)+(by-ay)*(by-ay))*8));
                for(int j=0;j<=steps;j++)for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++)blocked.Add(Key((int)Math.Floor(ax+(bx-ax)*j/steps)+dx,(int)Math.Floor(ay+(by-ay)*j/steps)+dy));
            }
        }
        bool Fits(string type,int x,int y)
        {
            int radius=type=="cart"?3:type is "oak" or "pine" or "willow"?2:1;
            for(int dy=-radius;dy<=radius;dy++)for(int dx=-radius;dx<=radius;dx++)
            {
                int px=x+dx,py=y+dy;
                if(px<1||py<1||px>=m.Width-1||py>=m.Height-1||blocked.Contains(Key(px,py))||occupied.Contains(Key(px,py))||m.Terrain[py*m.Width+px]=="water"||m.Levels[py*m.Width+px]!=m.Levels[y*m.Width+x])return false;
            }
            return true;
        }
        for(int y=J.I(m.Plaza,"y");y<J.I(m.Plaza,"y")+J.I(m.Plaza,"height");y++)for(int x=J.I(m.Plaza,"x");x<J.I(m.Plaza,"x")+J.I(m.Plaza,"width");x++)blocked.Add(Key(x,y));
        void AddSpecial(string type,double ax,double ay)
        {
            (int X,int Y,int Index,double Score)? best=null;
            for(int y=2;y<m.Height-2;y++)for(int x=2;x<m.Width-2;x++)
            {
                string key=Key(x,y);int index=y*m.Width+x;if(!Fits(type,x,y))continue;
                double score=Math.Sqrt(Math.Pow(x-ax,2)+Math.Pow(y-ay,2))+random.Next()*.35;if(best==null||score<best.Value.Score)best=(x,y,index,score);
            }
            if(best==null)return;var chosen=best.Value;props.Add(J.O("id",$"prop-{props.Count+1}","type",type,"x",chosen.X,"y",chosen.Y,"level",m.Levels[chosen.Index],"variant",random.Int(0,5)));occupied.Add(Key(chosen.X,chosen.Y));
        }
        double cx=J.I(m.Plaza,"x")+J.I(m.Plaza,"width")/2.0,cy=J.I(m.Plaza,"y")+J.I(m.Plaza,"height")/2.0;
        var inn=buildings.FirstOrDefault(b=>J.S(b,"type")=="inn")??buildings.FirstOrDefault();var house=buildings.FirstOrDefault(b=>J.S(b,"type")=="house")??buildings.LastOrDefault();
        AddSpecial("well",cx,cy);if(m.Settings.Settlement!="hamlet")AddSpecial("cart",inn?["door"]!=null?J.D(inn["door"],"x"):cx,inn?["door"]!=null?J.D(inn["door"],"y"):cy);AddSpecial("haystack",house?["door"]!=null?J.D(house["door"],"x"):cx,house?["door"]!=null?J.D(house["door"],"y"):cy);
        foreach(var building in buildings.Where(n=>J.S(n,"zone") is "commercial" or "craft" or "civic").Take(8))
            AddSpecial(J.S(building,"zone") switch{"commercial"=>"barrels","craft"=>"crates",_=>"bench"},J.D(building,"x"),J.D(building,"y"));
        int attempts=0;while(props.Count<desired&&attempts<desired*30)
        {
            attempts++;int x=random.Int(2,m.Width-3),y=random.Int(2,m.Height-3),index=y*m.Width+x;string key=Key(x,y);if(blocked.Contains(key)||m.Terrain[index]=="water")continue;string type=random.Pick(choices);int radius=type=="oak"||type=="pine"||type=="willow"?1:0;bool collision=false;
            for(int py=y-radius;py<=y+radius&&!collision;py++)for(int px=x-radius;px<=x+radius;px++)if(occupied.Contains(Key(px,py))){collision=true;break;}
            if(collision||!Fits(type,x,y))continue;props.Add(J.O("id",$"prop-{props.Count+1}","type",type,"x",x,"y",y,"level",m.Levels[index],"variant",random.Int(0,5)));occupied.Add(key);
        }
        return props;
    }
}
