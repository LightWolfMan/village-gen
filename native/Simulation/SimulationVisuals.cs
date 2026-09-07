using Godot;

namespace Village.Simulation;

/// <summary>
/// Shared meshes and materials for everything the simulation draws. They are
/// created once and reused by every site, agent and sapling, so growth never
/// multiplies materials or forces the renderer to re-sort its static batches.
/// </summary>
internal sealed class SimulationVisuals
{
    public readonly StandardMaterial3D Stake = Flat("#6b573c");
    public readonly StandardMaterial3D Rope = Flat("#cbb488");
    public readonly StandardMaterial3D Stone = Flat("#8d8778");
    public readonly StandardMaterial3D Timber = Flat("#9a7346");
    public readonly StandardMaterial3D Scaffold = Flat("#b08b52");
    public readonly StandardMaterial3D Thatch = Flat("#a98545");
    public readonly StandardMaterial3D Cloth = Flat("#8d5f4a");
    public readonly StandardMaterial3D Skin = Flat("#c8a07c");
    public readonly StandardMaterial3D Bark = Flat("#5d4630");
    public readonly StandardMaterial3D Leaf = Flat("#4f7a44");
    public readonly StandardMaterial3D DeadWood = Flat("#7d7466");

    public readonly BoxMesh Box = new() { Size = Vector3.One };
    public readonly CylinderMesh Trunk = new() { TopRadius = .07f, BottomRadius = .1f, Height = 1, RadialSegments = 6 };
    public readonly SphereMesh Canopy = new() { Radius = .5f, Height = 1, RadialSegments = 8, Rings = 5 };
    public readonly CylinderMesh Cone = new() { TopRadius = .01f, BottomRadius = .5f, Height = 1, RadialSegments = 7 };
    public readonly BoxMesh Body = new() { Size = new Vector3(.22f,.30f,.14f) };
    public readonly SphereMesh Head = new() { Radius = .09f, Height = .18f, RadialSegments = 8, Rings = 4 };
    public readonly BoxMesh Arm = new() { Size = new Vector3(.07f,.26f,.07f) };
    public readonly BoxMesh Leg = new() { Size = new Vector3(.08f,.30f,.08f) };

    static StandardMaterial3D Flat(string hex) => new()
    {
        AlbedoColor = new Color(hex),
        Roughness = .95f,
        SpecularMode = BaseMaterial3D.SpecularModeEnum.Disabled
    };

    public MeshInstance3D Part(Mesh mesh, Material material, Vector3 position, Vector3 scale, float yaw = 0, bool rises = false)
    {
        var node = new MeshInstance3D
        {
            Mesh = mesh,
            MaterialOverride = material,
            CastShadow = GeometryInstance3D.ShadowCastingSetting.On,
            Transform = new Transform3D(new Basis(Vector3.Up, yaw).Scaled(scale), position)
        };
        // A piece that rises out of the ground keeps its finished size and base
        // so the site can interpolate towards it while the stage runs.
        if (rises)
        {
            node.SetMeta("simTargetScale", scale);
            node.SetMeta("simBaseY", position.Y - scale.Y / 2);
            node.SetMeta("simYaw", yaw);
        }
        return node;
    }
}
