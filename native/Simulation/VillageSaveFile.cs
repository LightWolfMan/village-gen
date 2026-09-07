using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace Village.Simulation;

public static class VillageSaveFile
{
    public static string CatalogHash(string catalog)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(catalog)));
    public static void Write(string path,JsonObject map,JsonObject simulation,string catalog)
    {
        if(simulation["steps"]!.GetValue<long>()>1000000||simulation["history"]!.AsArray().Count>100000)throw new InvalidDataException("Limite do histórico atingido; salvamento anterior preservado.");
        var document=new JsonObject{["saveVersion"]=1,["catalogHash"]=CatalogHash(catalog),["map"]=map.DeepClone(),["simulation"]=simulation.DeepClone()};
        string text=document.ToJsonString();
        if(Encoding.UTF8.GetByteCount(text)>32*1024*1024)throw new InvalidDataException("Salvamento excede 32 MB.");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        string temporary=path+".tmp";
        try{
            using(var stream=new FileStream(temporary,FileMode.Create,FileAccess.Write,FileShare.None)){
                var bytes=Encoding.UTF8.GetBytes(text);stream.Write(bytes);stream.Flush(true);
            }
            if(File.Exists(path))File.Replace(temporary,path,path+".bak");else File.Move(temporary,path);
        }finally{if(File.Exists(temporary))File.Delete(temporary);}
    }
    public static (JsonObject Map,JsonObject State) Read(string path,string catalog)
    {
        if(new FileInfo(path).Length>32*1024*1024)throw new InvalidDataException("Salvamento excede 32 MB.");
        var root=JsonNode.Parse(File.ReadAllText(path))?.AsObject()??throw new InvalidDataException("Arquivo vazio.");
        if(root["saveVersion"]?.GetValue<int>()!=1||root["catalogHash"]?.GetValue<string>()!=CatalogHash(catalog))throw new InvalidDataException("Salvamento incompatível com esta versão ou catálogo.");
        var map=root["map"]!.AsObject();int width=map["width"]!.GetValue<int>(),height=map["height"]!.GetValue<int>();
        if(map["schemaVersion"]?.GetValue<int>()!=4||width<16||height<16||width>128||height>128)throw new InvalidDataException("Mapa incompatível.");
        var settings=map["settings"]??throw new InvalidDataException("Configurações ausentes.");
        if(width!=height||width is not (72 or 96 or 128)||settings["biome"]?.GetValue<string>() is not ("temperate" or "arid" or "snowy" or "wetland")||settings["settlement"]?.GetValue<string>() is not ("hamlet" or "village" or "town")||settings["layout"]?.GetValue<string>() is not ("organic" or "grid"))throw new InvalidDataException("Configurações incompatíveis.");
        double water=settings["water"]!.GetValue<double>();_ = settings["rivers"]!.GetValue<bool>();
        if(!double.IsFinite(water)||water<0||water>1)throw new InvalidDataException("Água inválida.");
        foreach(string field in new[]{"terrain","heightLevel","zoneMap"})if(map[field] is not JsonArray cells||cells.Count!=width*height)throw new InvalidDataException("Mapa incompleto.");
        return (map,root["simulation"]!.AsObject());
    }
}
