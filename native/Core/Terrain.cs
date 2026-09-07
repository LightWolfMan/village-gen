namespace Village.Core;
public static partial class VillageGenerator
{
    static double Smooth(double v)=>v*v*(3-2*v);
    static double ValueNoise(uint seed,double x,double y,double scale,int salt)
    {
        double fx=x/scale,fy=y/scale;int x0=(int)Math.Floor(fx),y0=(int)Math.Floor(fy);double tx=Smooth(fx-x0),ty=Smooth(fy-y0);
        double Sample(int sx,int sy)=>RandomSource.CoordinateHash(seed,sx,sy,salt)/4294967295.0;
        double a=Sample(x0,y0)*(1-tx)+Sample(x0+1,y0)*tx,b=Sample(x0,y0+1)*(1-tx)+Sample(x0+1,y0+1)*tx;
        return a*(1-ty)+b*ty;
    }
    static double FractalNoise(uint seed,double x,double y,int salt)=>ValueNoise(seed,x,y,36,salt)*.54+ValueNoise(seed,x,y,17,salt+1)*.29+ValueNoise(seed,x,y,7,salt+2)*.17;
    static void CreateTerrain(MapData m,uint seed)
    {
        int width=m.Width;var b=m.Biome;double waterLine=m.WaterLine=.28+m.Settings.Water*.24;
        for(int y=0;y<width;y++)for(int x=0;x<width;x++)
        {
            int index=y*width+x;double elevation=FractalNoise(seed,x,y,11),moisture=FractalNoise(seed,x,y,31);
            int edge=Math.Min(Math.Min(x,y),Math.Min(width-x-1,width-y-1));double edgeDrop=Math.Clamp(edge/9.0,.72,1);
            double radial=Math.Sqrt(Math.Pow(x-width/2.0,2)+Math.Pow(y-width/2.0,2))/(width*.5),adjusted=Math.Max(elevation*edgeDrop,waterLine+.13-radial*.14);
            if(adjusted<waterLine){m.Terrain[index]="water";m.Levels[index]=0;}
            else{m.Levels[index]=Math.Clamp(1+(int)Math.Floor((adjusted-waterLine)/Math.Max(.001,1-waterLine)*6),1,6);m.Terrain[index]=adjusted<waterLine+.035?b.Shore:moisture>b.Moisture&&adjusted<.82?b.Grove:adjusted>.83?(m.Settings.Biome=="snowy"?"snow-rock":"rock"):b.Ground;}
        }
        var orphan=new List<int>();
        for(int y=0;y<width;y++)for(int x=0;x<width;x++)
        {
            if(m.Terrain[y*width+x]!=b.Shore)continue;bool near=false;
            for(int dy=-2;dy<=2&&!near;dy++)for(int dx=-2;dx<=2;dx++){int nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=width||ny>=width)continue;if(m.Terrain[ny*width+nx]=="water"){near=true;break;}}
            if(!near)orphan.Add(y*width+x);
        }
        foreach(int index in orphan)m.Terrain[index]=b.Ground;
    }
    static void CarveRiver(MapData m,uint seed,RandomSource random)
    {
        bool horizontal=random.Bool();int breadth=random.Int(2,3);double phase=random.Next()*Math.PI*2,amplitude=Math.Max(4,Math.Floor(m.Width*.08));
        for(int step=0;step<m.Width;step++)
        {
            int basis=(int)Math.Floor(m.Width*.31+Math.Sin(step/11.0+phase)*amplitude+(ValueNoise(seed,step,0,13,77)-.5)*5);
            for(int offset=-breadth;offset<=breadth;offset++){int x=horizontal?step:basis+offset,y=horizontal?basis+offset:step;if(x<0||y<0||x>=m.Width||y>=m.Height)continue;m.Terrain[y*m.Width+x]="water";m.Levels[y*m.Width+x]=0;}
        }
    }
    static double DryShareAround(MapData m,int x,int y,int size)
    {int dry=0,total=0;for(int py=y-6;py<y+size+6;py++)for(int px=x-6;px<x+size+6;px++){if(px<1||py<1||px>=m.Width-1||py>=m.Height-1)continue;total++;if(m.Terrain[py*m.Width+px]!="water")dry++;}return total>0?(double)dry/total:0;}
    static void ChoosePlaza(MapData m,RandomSource r,int choice)
    {
        int size=m.Settings.Settlement=="town"?7:5,jitter=(int)Math.Floor(m.Width*.08*(1+choice*.7)),bx=(int)Math.Floor(m.Width/2.0-size/2.0),by=bx;
        var candidates=new List<(int X,int Y,double Score)>();
        for(int i=0;i<24;i++){int x=Math.Clamp(bx+r.Int(-jitter,jitter),6,m.Width-size-7),y=Math.Clamp(by+r.Int(-jitter,jitter),6,m.Height-size-7);candidates.Add((x,y,DryShareAround(m,x,y,size)));}
        var chosen=candidates.OrderByDescending(c=>c.Score).ElementAt(Math.Min(choice,candidates.Count-1));var samples=new List<int>();
        for(int y=chosen.Y-2;y<chosen.Y+size+2;y++)for(int x=chosen.X-2;x<chosen.X+size+2;x++)if(m.Levels[y*m.Width+x]>0)samples.Add(m.Levels[y*m.Width+x]);
        samples.Sort();int level=samples.Count>0?samples[samples.Count/2]:2;
        m.Flatten(chosen.X-2,chosen.Y-2,size+4,size+4,level,m.Biome.Ground);m.Plaza=J.O("x",chosen.X,"y",chosen.Y,"width",size,"height",size,"level",level);
    }
    static void ReserveCampus(MapData m)
    {
        if(m.Settings.Settlement=="hamlet")return;int size=m.Settings.Settlement=="town"?20:14;var candidates=new List<(int X,int Y,int Wet,int Slope)>();
        foreach(int sx in new[]{-1,1})foreach(int sy in new[]{-1,1})
        {
            int x=sx<0?J.I(m.Plaza,"x")-size-3:J.I(m.Plaza,"x")+J.I(m.Plaza,"width")+3,y=sy<0?J.I(m.Plaza,"y")-size-3:J.I(m.Plaza,"y")+J.I(m.Plaza,"height")+3;
            if(x<2||y<2||x+size>=m.Width-2||y+size>=m.Height-2)continue;int wet=0,min=7,max=0;
            for(int py=y-1;py<=y+size;py++)for(int px=x-1;px<=x+size;px++){int i=py*m.Width+px;if(m.Terrain[i]=="water")wet++;min=Math.Min(min,m.Levels[i]);max=Math.Max(max,m.Levels[i]);}
            candidates.Add((x,y,wet,max-min));
        }
        var sorted=candidates.OrderBy(c=>c.Wet).ThenBy(c=>c.Slope).ToList();if(sorted.Count==0||sorted[0].Wet>0)throw new InvalidOperationException($"Parcelamento insuficiente para campus cívico seco na seed {m.Seed}");var chosen=sorted[0];m.Campus=J.O("x",chosen.X,"y",chosen.Y,"width",size,"height",size);
    }
}
