using Godot;
using System.Text.Json.Nodes;

namespace Village;

internal static class WalkRegression
{
    public static async Task Run(Node owner)
    {
        var viewport=new SubViewport{OwnWorld3D=true,RenderTargetUpdateMode=SubViewport.UpdateMode.Disabled};owner.AddChild(viewport);
        try
        {
            var ground=new JsonArray();for(int i=0;i<256;i++)ground.Add("grass");
            var map=new JsonObject{["width"]=16,["height"]=16,["terrain"]=ground,["roads"]=new JsonArray()};
            void Block(Vector3 position,Vector3 size){var body=new StaticBody3D{Position=position};body.AddChild(new CollisionShape3D{Shape=new BoxShape3D{Size=size}});viewport.AddChild(body);}
            Block(new Vector3(8,-.5f,8),new Vector3(16,1,16));
            Block(new Vector3(4,.125f,4),new Vector3(2,.25f,2));
            Block(new Vector3(6,.25f,4),new Vector3(2,.5f,2));
            Block(new Vector3(8,1,4),new Vector3(2,2,2));
            var walker=new NativeWalker();walker.Configure(map);viewport.AddChild(walker);walker.Position=new Vector3(2,.04f,4);
            async Task Advance(Vector2 input,int frames){for(int i=0;i<frames;i++){await owner.ToSignal(owner.GetTree(),SceneTree.SignalName.PhysicsFrame);walker.Simulate(input,false,1.0/60);}}
            await Advance(Vector2.Zero,30);await Advance(Vector2.Right,95);
            if(walker.Position.X<5.5f||Mathf.Abs(walker.Position.Y-.5f)>.04f)throw new InvalidOperationException($"Stairs failed: {walker.Position}");
            await Advance(Vector2.Right,90);
            if(walker.Position.X>6.85f)throw new InvalidOperationException("Walker climbed a wall");
            GD.Print($"STAIR_CHECK climbed=0.25 wallBlocked=True position={walker.Position}");
            map["terrain"]![8*16+3]="water";walker.Position=new Vector3(2,.04f,8);walker.Velocity=Vector3.Zero;
            await Advance(Vector2.Zero,30);await Advance(Vector2.Right,95);
            if(walker.Position.X>2.83f)throw new InvalidOperationException("Walker entered water");
            Block(new Vector3(4,.125f,10),new Vector3(2,.25f,2));
            Block(new Vector3(3.5f,1.4f,10),new Vector3(3,.2f,2));
            walker.Position=new Vector3(2,.04f,10);walker.Velocity=Vector3.Zero;
            await Advance(Vector2.Zero,30);await Advance(Vector2.Right,95);
            if(walker.Position.X>2.85f)throw new InvalidOperationException("Step ignored low ceiling");
            GD.Print("STAIR_SAFETY_CHECK waterBlocked=True lowCeilingBlocked=True");
        }
        finally{viewport.QueueFree();}
    }
}
