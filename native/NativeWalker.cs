using Godot;
using System.Text.Json.Nodes;

namespace Village;

public partial class NativeWalker : CharacterBody3D
{
    public Camera3D View { get; private set; } = null!;
    public bool Active { get; set; }
    private JsonObject _map = null!;
    private readonly HashSet<int> _bridgeCells = new();
    private float _pitch;
    private bool _jump;
    public const float StepHeight = .26f;
    private float _stepOffset;
    // Sweep the whole capsule, including head clearance, rather than a foot ray.
    public bool TryStep(Vector3 motion)
    {
        if(motion.LengthSquared()<.000001f||!SafeHorizontal(GlobalPosition+motion))return false;
        var start=GlobalTransform;
        var hit=new KinematicCollision3D();
        if(!TestMove(start,motion,hit)||hit.GetNormal().Y>.7f)return false;
        var up=Vector3.Up*(StepHeight+.015f);
        if(TestMove(start,up))return false;
        var raised=start;raised.Origin+=up;
        if(TestMove(raised,motion))return false;
        raised.Origin+=motion;
        // Probe beyond the rounded toe: a downward capsule cast at the current
        // position only sees the vertical riser and never discovers its top.
        var probe=GlobalPosition+motion.Normalized()*(.18f+motion.Length()+.025f);
        if(!SafeHorizontal(probe))return false;
        var query=PhysicsRayQueryParameters3D.Create(probe+up,probe+Vector3.Down*.01f,1);
        var landing=GetWorld3D().DirectSpaceState.IntersectRay(query);
        if(landing.Count==0||landing["normal"].AsVector3().Y<Mathf.Cos(FloorMaxAngle))return false;
        float rise=landing["position"].AsVector3().Y-GlobalPosition.Y;
        if(rise<.005f||rise>StepHeight+.002f)return false;
        raised.Origin=start.Origin+Vector3.Up*(rise+.002f);
        if(TestMove(raised,motion))return false;
        GlobalPosition+=Vector3.Up*rise;
        _stepOffset-=rise;
        return true;
    }
    public void Configure(JsonObject map)
    {
        _map = map;
        foreach (var road in map["roads"]!.AsArray())
            if (road?["bridge"]?.GetValue<bool>() == true)
                _bridgeCells.Add(road["y"]!.GetValue<int>() * map["width"]!.GetValue<int>() + road["x"]!.GetValue<int>());
        CollisionLayer = 2; CollisionMask = 1;
        FloorSnapLength = .28f; FloorMaxAngle = Mathf.Pi / 4;
        AddChild(new CollisionShape3D { Shape = new CapsuleShape3D { Radius = .18f, Height = 1.2f }, Position = new Vector3(0,.6f,0) });
        View = new Camera3D { Fov = 65, Near = .05f, Far = 1600, Position = new Vector3(0,1.08f,0) };
        AddChild(View);
    }
    public void Look(Vector2 relative)
    {
        if (!Active) return;
        Rotation = new Vector3(0, Rotation.Y-relative.X*.002f,0);
        _pitch = Mathf.Clamp(_pitch-relative.Y*.002f, Mathf.DegToRad(-85),Mathf.DegToRad(85));
        View.Rotation = new Vector3(_pitch,0,0);
    }
    public void Jump() { if (Active && IsOnFloor()) _jump = true; }
    public void Pause() { Active = false; _jump = false; Velocity = Vector3.Zero; }
    private bool SafeHorizontal(Vector3 p)
    {
        var width = _map["width"]!.GetValue<int>(); var height = _map["height"]!.GetValue<int>();
        foreach (var offset in new[] { new Vector2(-.18f,0),new Vector2(.18f,0),new Vector2(0,-.18f),new Vector2(0,.18f) })
        {
            int x=(int)MathF.Floor(p.X+offset.X),z=(int)MathF.Floor(p.Z+offset.Y);
            if(x<0||z<0||x>=width||z>=height)return false;
            if(_map["terrain"]![z*width+x]!.GetValue<string>()=="water"&&!_bridgeCells.Contains(z*width+x))return false;
        }
        return true;
    }
    public override void _PhysicsProcess(double delta)
    {
        if (!Active) return;
        var input=new Vector2((Input.IsPhysicalKeyPressed(Key.D)?1:0)-(Input.IsPhysicalKeyPressed(Key.A)?1:0),
            (Input.IsPhysicalKeyPressed(Key.S)?1:0)-(Input.IsPhysicalKeyPressed(Key.W)?1:0));
        Simulate(input,Input.IsPhysicalKeyPressed(Key.Shift),delta);
    }
    public void Simulate(Vector2 input,bool running,double delta)
    {
        float dt=(float)Math.Min(delta,.1);
        if(input.Length()>1)input=input.Normalized();
        var direction=GlobalBasis*new Vector3(input.X,0,input.Y);
        float speed=running?4:2.5f;
        var v=Velocity;v.X=direction.X*speed;v.Z=direction.Z*speed;
        if(!IsOnFloor())v.Y-=10*dt;else if(_jump)v.Y=4.2f;else v.Y=-.1f;
        _jump=false;
        if(!SafeHorizontal(GlobalPosition+new Vector3(v.X*dt,0,0)))v.X=0;
        if(!SafeHorizontal(GlobalPosition+new Vector3(0,0,v.Z*dt)))v.Z=0;
        if(IsOnFloor()&&v.Y<=0)TryStep(new Vector3(v.X*dt,0,v.Z*dt));
        Velocity=v;MoveAndSlide();
        _stepOffset=Mathf.MoveToward(_stepOffset,0,dt*1.6f);
        View.Position=new Vector3(0,1.08f+_stepOffset,0);
    }
}
