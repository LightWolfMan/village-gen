namespace Village.Core;

/// <summary>Bit-exact port of src/core/random.js (UTF-16 FNV variant and Mulberry32).</summary>
public sealed class RandomSource
{
    private uint state;
    private readonly string seed;
    public RandomSource(string seed) { this.seed = seed; state = HashString(seed); if (state == 0) state = 0x6d2b79f5; }
    public static uint HashString(string value)
    {
        uint hash = 2166136261;
        unchecked { foreach (char c in value) { hash ^= c; hash *= 16777619; hash ^= hash >> 13; } }
        return hash;
    }
    public static uint CoordinateHash(uint seed, int x, int y, int salt = 0)
    {
        unchecked
        {
            uint value = seed ^ ((uint)x * 0x9e3779b1) ^ ((uint)y * 0x85ebca77) ^ ((uint)salt * 0xc2b2ae3d);
            value ^= value >> 16; value *= 0x7feb352d; value ^= value >> 15; value *= 0x846ca68b;
            return value ^ (value >> 16);
        }
    }
    public double Next()
    {
        unchecked
        {
            state += 0x6d2b79f5;
            uint value = state;
            value = (value ^ (value >> 15)) * (value | 1);
            value ^= value + ((value ^ (value >> 7)) * (value | 61));
            return (value ^ (value >> 14)) / 4294967296.0;
        }
    }
    public int Int(int minimum, int maximum) => (int)Math.Floor(Next() * (maximum - minimum + 1)) + minimum;
    public bool Bool(double chance = .5) => Next() < chance;
    public T Pick<T>(IReadOnlyList<T> items) => items[(int)Math.Floor(Next() * items.Count)];
    public List<T> Shuffle<T>(List<T> items) { for (int i = items.Count - 1; i > 0; i--) { int j = (int)Math.Floor(Next() * (i + 1)); (items[i], items[j]) = (items[j], items[i]); } return items; }
    public RandomSource Fork(string label) => new(seed + "\u241f" + label);
}
