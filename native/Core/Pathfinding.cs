namespace Village.Core;

public readonly record struct Point(int X, int Y);

/// <summary>Stable binary heap matching the original JavaScript's tie ordering.</summary>
internal sealed class StableMinHeap<T>(Func<T, double> score)
{
    private readonly List<T> items = [];
    public int Count => items.Count;
    public void Push(T item)
    {
        items.Add(item); int index = items.Count - 1;
        while (index > 0) { int parent = (index - 1) >> 1; if (score(items[parent]) <= score(item)) break; items[index] = items[parent]; index = parent; }
        items[index] = item;
    }
    public T Pop()
    {
        T first = items[0], last = items[^1]; items.RemoveAt(items.Count - 1);
        if (items.Count > 0)
        {
            int index = 0;
            while (true)
            {
                int left = index * 2 + 1, right = left + 1; if (left >= items.Count) break;
                int child = right < items.Count && score(items[right]) < score(items[left]) ? right : left;
                if (score(items[child]) >= score(last)) break; items[index] = items[child]; index = child;
            }
            items[index] = last;
        }
        return first;
    }
}

public static class Pathfinding
{
    private record State(int Index, int Direction, int WaterRun, int Key, double Cost, double Score);
    public static List<Point> FindPath(int width, int height, Point start, Point goal,
        Func<int,int,int,int,double> costAt, Func<int,int,bool>? isWater = null,
        Func<int,int,string?>? bridgeAxisAt = null, int maxWaterRun = 0, double turnPenalty = 0, double heuristicWeight = 1)
    {
        int startIndex = start.Y * width + start.X, goalIndex = goal.Y * width + goal.X, startKey = startIndex * 5;
        int[] cameFrom = new int[width * height * 5]; Array.Fill(cameFrom, -1);
        double[] scores = new double[cameFrom.Length]; Array.Fill(scores, double.PositiveInfinity); scores[startKey] = 0;
        var heap = new StableMinHeap<State>(s => s.Score);
        heap.Push(new(startIndex,-1,0,startKey,0,(Math.Abs(goal.X-start.X)+Math.Abs(goal.Y-start.Y))*heuristicWeight));
        Point[] directions = [new(1,0),new(0,1),new(-1,0),new(0,-1)];
        int? goalKey = startIndex == goalIndex ? startKey : null;
        while (heap.Count > 0)
        {
            var current = heap.Pop(); if(current.Cost != scores[current.Key]) continue;
            if(current.Index == goalIndex) { goalKey = current.Key; break; }
            int x = current.Index % width, y = current.Index / width; bool currentWater = isWater?.Invoke(x,y) ?? false;
            for(int direction=0;direction<4;direction++)
            {
                int nx=x+directions[direction].X,ny=y+directions[direction].Y;
                if(nx<0||ny<0||nx>=width||ny>=height) continue;
                bool nextWater=isWater?.Invoke(nx,ny)??false;
                if(currentWater&&current.Direction>=0&&direction!=current.Direction)continue;
                string axis=direction%2==0?"ew":"ns"; string? existing=bridgeAxisAt?.Invoke(nx,ny);
                if(nextWater&&existing!=null&&existing!=axis)continue;
                int waterRun=nextWater?(currentWater?current.WaterRun+1:1):0;
                if(nextWater&&maxWaterRun>0&&waterRun>maxWaterRun)continue;
                int next=ny*width+nx,key=next*5+direction+1;
                double candidate=scores[current.Key]+costAt(nx,ny,x,y)+(current.Direction>=0&&current.Direction!=direction?turnPenalty:0);
                if(candidate>=scores[key])continue;
                scores[key]=candidate;cameFrom[key]=current.Key;
                heap.Push(new(next,direction,waterRun,key,candidate,candidate+(Math.Abs(goal.X-nx)+Math.Abs(goal.Y-ny))*heuristicWeight));
            }
        }
        if(goalKey==null)return [];
        var path=new List<Point>();int cursor=goalKey.Value;
        while(cursor>=0){int cell=cursor/5;path.Add(new(cell%width,cell/width));if(cursor==startKey)break;cursor=cameFrom[cursor];}
        path.Reverse();return path;
    }
}
