using Godot;
using System.Diagnostics;
using System.Text.Json.Nodes;
using Village.Core;
using Village.Rendering;
using GFile = Godot.FileAccess;

namespace Village;

public partial class NativeMain : Control
{
    private SubViewport _viewport=null!;
    private SubViewportContainer _stage=null!;
    private Node3D _world=null!;
    private VillageScene? _village;
    private Camera3D _aerial=null!;
    private NativeWalker? _walker;
    private PanelContainer _panel=null!;
    private Control _pause=null!;
    private HBoxContainer _header=null!;
    private LineEdit _seed=null!;
    private OptionButton _biome=null!,_settlement=null!,_layout=null!,_size=null!,_quality=null!,_themeChoice=null!,_presets=null!;
    private CheckButton _river=null!,_zones=null!;
    private HSlider _water=null!;
    private Label _status=null!,_stats=null!,_notice=null!,_hud=null!;
    private Button _apply=null!,_generate=null!,_walk=null!,_resume=null!;
    private DirectionalLight3D _sun=null!;
    private NativeAtmosphere _atmosphere=null!;
    private JsonObject? _map;
    private Vector3 _target;
    private float _yaw=Mathf.Pi/4, _pitch=.68f,_zoom=1;
    private bool _dragPan,_dragRotate,_walking,_busy,_dark,_smoke;
    private int _request;
    private double _diagnosticTime;
    private int _drawFrames=3;
    private ulong _benchmarkUntil;
    private void RequestDraw()=>_drawFrames=3;
    private readonly string _diagnosticFolder=OS.GetEnvironment("VILLAGE_DIAGNOSTICS_DIR");
    private string[] _biomes={"temperate","arid","snowy","wetland"},_settlements={"hamlet","village","town"};
    private readonly ConfigFile _preferences=new();
    private static int I(JsonNode? n,int fallback=0)=>n==null?fallback:(int)double.Parse(n.ToJsonString(),System.Globalization.CultureInfo.InvariantCulture);

    public override void _Ready()
    {
        Engine.MaxFps=60;
        MouseFilter=MouseFilterEnum.Ignore;GetWindow().MinSize=new Vector2I(800,480);
        GetWindow().ContentScaleMode=Window.ContentScaleModeEnum.Disabled;GetWindow().ContentScaleSize=Vector2I.Zero;
        void Dpi(){float scale=Mathf.Clamp(DisplayServer.ScreenGetDpi(GetWindow().CurrentScreen)/96f,1,2.5f);GetWindow().ContentScaleFactor=scale;GetWindow().MinSize=new Vector2I((int)(800*scale),(int)(480*scale));}
        GetWindow().DpiChanged+=Dpi;Dpi();
        _smoke=OS.GetCmdlineUserArgs().Contains("--smoke");
        SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);
        VillageGenerator.ConfigureCatalog(GFile.GetFileAsString("res://assets/models/catalog.json"));
        BuildUi(); BuildWorld();
        if(_preferences.Load("user://preferences.cfg")!=Error.Ok)
        {
            // The visible product rename must not discard the previous seed/theme.
            string previous=System.IO.Path.Combine(System.IO.Path.GetDirectoryName(OS.GetUserDataDir())!,"Village Native","preferences.cfg");
            if(System.IO.File.Exists(previous))_preferences.Load(previous);
        }
        LoadGraphics();_themeChoice.Select((int)_preferences.GetValue("appearance","theme",0)); ApplyTheme();
        GetWindow().FocusExited+=()=>{if(!_smoke)PauseWalk();_dragPan=_dragRotate=false;};
        DisplayServer.SetSystemThemeChangeCallback(Callable.From(()=>{if(_themeChoice.Selected==0)ApplyTheme();}));
        _seed.Text=NewSeed();LoadHudPreferences();
        var args=OS.GetCmdlineUserArgs();
        _smoke=args.Contains("--smoke");
        if(_smoke) {Preset(1);_seed.Text="visual-17";
            if(args.Contains("--smoke-river")){_river.ButtonPressed=true;_water.Value=55;_seed.Text="road-integration-17";}
            _=RunSmoke(args);
        } else _=Generate(false);
    }
    private static string NewSeed() => "Vila-"+Guid.NewGuid().ToString("N")[..10];
    private Button Button(string text,Action action) { var b=new Button{Text=text,CustomMinimumSize=new Vector2(0,36)}; b.Pressed+=action;return b; }
    private Label Label(string text,int size=13) { var l=new Label{Text=text}; l.AddThemeFontSizeOverride("font_size",size);return l; }
    private OptionButton Option(params string[] values) {var o=new OptionButton{CustomMinimumSize=new Vector2(0,34),SizeFlagsHorizontal=SizeFlags.ExpandFill};foreach(var s in values)o.AddItem(s);return o;}
    private void Field(VBoxContainer parent,string title,Control control)
    {
        // Icone no lugar do nome: o campo se identifica pelo simbolo, o valor
        // escolhido aparece no proprio controle e o nome vive no tooltip. O
        // defeito da versao original nao era a falta de texto — era o icone
        // repetido: "Ponto de partida", "Ruas" e "Extensao" caiam todos no
        // mesmo mapa generico, e viravam tres caixas identicas.
        string icon=title switch
        {
            "Paisagem"=>"tree","Assentamento"=>"houses","Ruas"=>"map","Extensão"=>"globe",
            "Ponto de partida"=>"sparkles","Identidade · seed"=>"seed",
            "Iluminação"=>"sun","Aparência do HUD"=>"moon","Qualidade de imagem"=>"scan",_=>"map"
        };
        var row=new HBoxContainer();row.AddThemeConstantOverride("separation",5);
        row.AddChild(FieldIcon(icon));
        control.SizeFlagsHorizontal=SizeFlags.ExpandFill;
        if(string.IsNullOrEmpty(control.TooltipText))control.TooltipText=title;
        row.AddChild(control);
        parent.AddChild(row);
    }
    private Control FieldIcon(string name)
    {
        var monochrome=new[]{"globe","scan","sparkles","map"}.Contains(name)&&!System.IO.File.Exists(ProjectSettings.GlobalizePath($"res://assets/ui/color/{name}.svg"));
        var texture=monochrome?GD.Load<Texture2D>($"res://assets/ui/{name}.svg"):ColorIcon(name);
        var rect=new TextureRect{Texture=texture,CustomMinimumSize=new Vector2(18,18),ExpandMode=TextureRect.ExpandModeEnum.IgnoreSize,StretchMode=TextureRect.StretchModeEnum.KeepAspectCentered};
        if(monochrome)rect.Modulate=new Color(_dark?"#c9d3d8":"#4a5a62");
        return rect;
    }

    private void BuildUi()
    {
        BuildHudMain();
        _pause=new Control{Visible=false,MouseFilter=MouseFilterEnum.Stop};AddChild(_pause);
        _pause.SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);
        var shade=new ColorRect{Color=new Color(0.025f,.035f,.045f,.64f),MouseFilter=MouseFilterEnum.Ignore};
        _pause.AddChild(shade);shade.SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);
        var centered=new CenterContainer{Name="PauseCenter"};_pause.AddChild(centered);centered.SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);
        var card=new PanelContainer{Name="PauseCard",CustomMinimumSize=new Vector2(360,0)};centered.AddChild(card);
        var pauseStyle=new StyleBoxFlat{BgColor=new Color("#fafbfc"),BorderColor=new Color("#cbd2dc"),ShadowColor=new Color(0,0,0,.35f),ShadowSize=24};
        pauseStyle.SetCornerRadiusAll(12);pauseStyle.SetBorderWidthAll(1);card.AddThemeStyleboxOverride("panel",pauseStyle);
        var pauseMargin=new MarginContainer();foreach(var side in new[]{"left","right","top","bottom"})pauseMargin.AddThemeConstantOverride("margin_"+side,24);card.AddChild(pauseMargin);
        var pauseColumn=new VBoxContainer();pauseColumn.AddThemeConstantOverride("separation",12);pauseMargin.AddChild(pauseColumn);
        var heading=Label("Passeio pausado",24);heading.AddThemeColorOverride("font_color",new Color("#202a35"));pauseColumn.AddChild(heading);
        var help=Label("O cursor está livre.\nContinue para voltar a explorar.",16);help.AddThemeColorOverride("font_color",new Color("#526071"));pauseColumn.AddChild(help);
        _resume=Button("Continuar passeio",ResumeWalk);_resume.CustomMinimumSize=new Vector2(0,44);pauseColumn.AddChild(_resume);
        var aerial=Button("Voltar à vista aérea",ExitWalk);aerial.CustomMinimumSize=new Vector2(0,44);pauseColumn.AddChild(aerial);
        foreach(var state in new[]{"font_color","font_hover_color","font_pressed_color","font_focus_color"})
        {
            _resume.AddThemeColorOverride(state,Colors.White);aerial.AddThemeColorOverride(state,new Color("#263443"));
        }
        foreach(var state in new[]{"normal","hover","pressed"})
        {
            var primary=new StyleBoxFlat{BgColor=new Color(state=="hover"?"#415772":"#2b3e54"),ContentMarginLeft=12,ContentMarginRight=12};primary.SetCornerRadiusAll(8);
            _resume.AddThemeStyleboxOverride(state,primary);
        }
        void FitPause()
        {
            float scale=1; // The root window scales the complete HUD for DPI.
            scale=Mathf.Min(scale,Mathf.Max(.75f,(GetViewportRect().Size.X-32)/360));
            card.CustomMinimumSize=new Vector2(360*scale,0);
            heading.AddThemeFontSizeOverride("font_size",(int)(24*scale));help.AddThemeFontSizeOverride("font_size",(int)(16*scale));
            foreach(var button in new[]{_resume,aerial}){button.AddThemeFontSizeOverride("font_size",(int)(16*scale));button.CustomMinimumSize=new Vector2(0,44*scale);}
        }
        Resized+=FitPause;FitPause();
    }
    private void BuildWorld()
    {
        _world=new Node3D();_viewport.AddChild(_world);
        var sky=new ProceduralSkyMaterial{SkyTopColor=new Color("#72a5cb"),SkyHorizonColor=new Color("#dde8da"),GroundHorizonColor=new Color("#95aa88"),GroundBottomColor=new Color("#62775b")};
        var environment=new Godot.Environment{
            BackgroundMode=Godot.Environment.BGMode.Sky,Sky=new Sky{SkyMaterial=sky},
            AmbientLightSource=Godot.Environment.AmbientSource.Sky,AmbientLightEnergy=.45f,
            TonemapMode=Godot.Environment.ToneMapper.Aces,TonemapExposure=1.05f,
            FogEnabled=true,FogDensity=.0007f,FogAerialPerspective=.25f,
            FogLightColor=new Color("#b7ccd2"),FogLightEnergy=.65f};
        // Forward+ is opt-in through Godot's --rendering-method argument until
        // the integrated GPU has a representative performance comparison.
        if(RenderingServer.GetCurrentRenderingMethod()=="forward_plus"){
            environment.SsaoEnabled=true;environment.SsaoRadius=.55f;environment.SsaoIntensity=1.15f;
            _quality.ItemSelected+=_=>environment.SsaoEnabled=_quality.Selected==0;
            Callable.From(()=>environment.SsaoEnabled=_quality.Selected==0).CallDeferred();
        }
        _world.AddChild(new WorldEnvironment{Environment=environment});
        _sun=new DirectionalLight3D{RotationDegrees=new Vector3(-55,-35,0),LightColor=new Color("#fff1e0"),LightEnergy=.85f,ShadowEnabled=true,
            DirectionalShadowMode=DirectionalLight3D.ShadowMode.Parallel4Splits,DirectionalShadowBlendSplits=true,
            DirectionalShadowMaxDistance=180,ShadowBias=.035f,ShadowNormalBias=.6f};_world.AddChild(_sun);
        _atmosphere=new NativeAtmosphere{Visible=false};_world.AddChild(_atmosphere);
        _aerial=new Camera3D{Projection=Camera3D.ProjectionType.Orthogonal,Size=80,Near=.05f,Far=1800,Current=true};_world.AddChild(_aerial);
    }
    private void ApplyTheme()=>ApplyHudTheme();
    private JsonObject Settings()=>new(){["mapSize"]=new[]{72,96,128}[_size.Selected],["biome"]=_biomes[_biome.Selected],["settlement"]=_settlements[_settlement.Selected],["layout"]=_layout.Selected==0?"organic":"grid",["water"]=_water.Value/100,["rivers"]=_river.ButtonPressed};
    private void Preset(int index)
    {
        if(index==0)return;
        _biome.Select(0);_settlement.Select(index==2?0:index==3?2:1);_layout.Select(index==3?1:0);_size.Select(index==3?2:1);
        _size.Disabled=index==3;_water.Value=index==2?15:index==3?25:index==4?45:35;_river.ButtonPressed=index==4;_presets.Select(index);
        RefreshCompactChoices();_status.Text="Ajustes pendentes · Aplicar mantém a seed";
    }
    private async Task Generate(bool random)
    {
        if(_busy)return;
        ExitWalk();if(random)_seed.Text=NewSeed();var seed=_seed.Text;var settings=Settings();int request=++_request;
        _busy=true;_apply.Disabled=_generate.Disabled=_walk.Disabled=true;_status.Text="Gerando mapa nativo…";
        var timer=Stopwatch.StartNew();
        try {
            var map=await Task.Run(()=>VillageGenerator.Generate(seed,settings));
            if(request!=_request||!IsInsideTree())return;
            var next=new VillageScene();_world.AddChild(next);
            try{next.Build(map);}catch{next.QueueFree();throw;}
            if(_village!=null)_village.BuildingsChanged-=RefreshBuildingStatistics;
            _village?.QueueFree();_village=next;_map=map;_village.SetShowZones(_zones.ButtonPressed);
            _village.BuildingsChanged+=RefreshBuildingStatistics;
            ResetSimulation();ApplyGraphics();
            _seed.Text=map["seed"]?.GetValue<string>()??seed;Center(false);
            _benchmarkUntil=Time.GetTicksMsec()+1200; // Let the one-shot reflection finish its faces.
            _status.Text=$"Mapa pronto · {timer.Elapsed.TotalSeconds.ToString("0.0",System.Globalization.CultureInfo.InvariantCulture)}s";
            RefreshBuildingStatistics();
            _atmosphere.Configure(I(map["width"]),I(map["height"]),map["settings"]!["biome"]!.GetValue<string>());
        } catch(Exception ex){GD.PushError(ex.ToString());_status.Text="Falha ao gerar";Message(ex.Message);}
        finally{_busy=false;_apply.Disabled=_generate.Disabled=false;_walk.Disabled=_map==null;
            SaveHudPreferences();UpdateHudSummary();RefreshCompactChoices();}
    }
    private void RefreshBuildingStatistics()
    {
        if(_village==null||_map==null)return;
        _stats.Text=$"{_village.HouseCount} casas · {_village.ServiceCount} serviços\n{I(_map["stats"]?["bridges"])} pontes · {_map["props"]!.AsArray().Count} objetos";
        UpdateHudSummary();RequestDraw();
    }
    private void Center(bool whole)
    {
        if(_village==null)return;
        var bounds=whole?_village.MapBounds:_village.VillageBounds;
        _target=bounds.GetCenter();_zoom=1;UpdateOrbit();
        float minX=float.PositiveInfinity,maxX=float.NegativeInfinity,minY=float.PositiveInfinity,maxY=float.NegativeInfinity;
        for(int i=0;i<8;i++){var p=bounds.GetEndpoint(i)-_target;float x=p.Dot(_aerial.GlobalBasis.X),y=p.Dot(_aerial.GlobalBasis.Y);minX=Mathf.Min(minX,x);maxX=Mathf.Max(maxX,x);minY=Mathf.Min(minY,y);maxY=Mathf.Max(maxY,y);}
        float aspect=_viewport.Size.X/(float)Mathf.Max(1,_viewport.Size.Y);
        _aerial.Size=Mathf.Max(10,Mathf.Max(maxY-minY,(maxX-minX)/aspect)*1.1f);
    }
    private void UpdateOrbit()
    {
        RequestDraw();
        _aerial.Position=_target+new Vector3(Mathf.Sin(_yaw)*Mathf.Cos(_pitch),Mathf.Sin(_pitch),Mathf.Cos(_yaw)*Mathf.Cos(_pitch))*180;
        _aerial.LookAt(_target);
    }
    public override void _Input(InputEvent e)
    {
        if(e is InputEventMouseButton click&&click.Pressed&&_graphicPopup?.Visible==true
            &&!_graphicPopup.GetGlobalRect().HasPoint(click.Position)
            &&!(_graphicOpener?.GetGlobalRect().HasPoint(click.Position)??false))CloseGraphicPopup();
        RequestDraw();
        HandleContextInput(e);
        if(e is InputEventMouseButton mouse&&!mouse.Pressed){if(mouse.ButtonIndex==MouseButton.Left)_dragPan=false;if(mouse.ButtonIndex==MouseButton.Right)_dragRotate=false;}
    }
    public override void _UnhandledInput(InputEvent e)
    {
        RequestDraw();
        if(_smoke)return;
        if(e is InputEventKey key&&key.Pressed&&!key.Echo) {
            if(key.Keycode==Key.Escape){if(_walking)PauseWalk();else if(_graphicPopup?.Visible==true)CloseGraphicPopup();else CloseDrawer();GetViewport().SetInputAsHandled();}
            if(key.PhysicalKeycode==Key.Space&&_walking)_walker?.Jump();
        }
        if(e is InputEventMouseMotion motion) {
            if(_walking){if(!_pause.Visible)_walker?.Look(motion.Relative);return;}
            if(_dragRotate){_yaw-=motion.Relative.X*.005f;_pitch=Mathf.Clamp(_pitch+motion.Relative.Y*.005f,.35f,1.39f);UpdateOrbit();}
            if(_dragPan){float s=_aerial.Size/Mathf.Max(1,_stage.Size.Y);_target+=(-_aerial.GlobalBasis.X*motion.Relative.X+new Vector3(-Mathf.Sin(_yaw),0,-Mathf.Cos(_yaw))*motion.Relative.Y)*s;UpdateOrbit();}
        }
        if(e is InputEventMouseButton mouse&&!_walking) {
            if(!mouse.Pressed){if(mouse.ButtonIndex==MouseButton.Left)_dragPan=false;if(mouse.ButtonIndex==MouseButton.Right)_dragRotate=false;return;}
            if(!_stage.GetGlobalRect().HasPoint(mouse.Position))return;
            GetViewport().GuiReleaseFocus();
            if(mouse.ButtonIndex==MouseButton.Left){if(TrySelectRegion(mouse.Position))return;_dragPan=true;}
            if(mouse.ButtonIndex==MouseButton.Right){_dragRotate=true;_rightPressed=true;_rightMoved=false;_rightOrigin=mouse.Position;}
            if(mouse.ButtonIndex==MouseButton.WheelUp)_aerial.Size=Mathf.Max(8,_aerial.Size/1.15f);
            if(mouse.ButtonIndex==MouseButton.WheelDown)_aerial.Size=Mathf.Min(240,_aerial.Size*1.15f);
        }
    }
    private void EnterWalk()
    {
        if(_map==null||_village==null||_busy)return;
        _walker=new NativeWalker();_walker.Configure(_map);_world.AddChild(_walker);_walker.GlobalPosition=_village.SpawnPosition+Vector3.Up*.06f;
        _walker.View.MakeCurrent();_walking=true;_atmosphere.Show();_chrome.Hide();_hud.Show();ResumeWalk();
    }
    private void ResumeWalk(){if(!_walking||_walker==null)return;_pause.Hide();_walker.Active=true;Input.MouseMode=Input.MouseModeEnum.Captured;}
    private void PauseWalk(){if(!_walking)return;_walker?.Pause();Input.MouseMode=Input.MouseModeEnum.Visible;_pause.Show();_resume.GrabFocus();}
    private void ExitWalk()
    {
        if(!_walking)return;_walking=false;_atmosphere.Hide();Input.MouseMode=Input.MouseModeEnum.Visible;_walker?.QueueFree();_walker=null;_aerial.MakeCurrent();_pause.Hide();_hud.Hide();_chrome.Show();
    }
    public override void _Process(double delta){
        UpdateSimulation(delta);
        if(!string.IsNullOrEmpty(_diagnosticFolder)&&(_diagnosticTime+=delta)>1){_diagnosticTime=0;
            System.IO.Directory.CreateDirectory(_diagnosticFolder);
            System.IO.File.WriteAllText(System.IO.Path.Combine(_diagnosticFolder,"engine.json"),new JsonObject{
                ["fps"]=Engine.GetFramesPerSecond(),["frameMs"]=delta*1000,["focus"]=GetWindow().HasFocus(),["walking"]=_walking,["active"]=_walker?.Active??false,
                ["mouse"]=Input.MouseMode.ToString(),["targetX"]=_target.X,["targetZ"]=_target.Z,["yaw"]=_walker?.Rotation.Y??_yaw,
                ["drawCalls"]=Performance.GetMonitor(Performance.Monitor.RenderTotalDrawCallsInFrame),["primitives"]=Performance.GetMonitor(Performance.Monitor.RenderTotalPrimitivesInFrame)
            }.ToJsonString());}
        if(_walking&&_walker!=null)_atmosphere.Follow(_walker.View.GlobalPosition);
        else if(_village!=null&&GetWindow().HasFocus()&&GetViewport().GuiGetFocusOwner() is not LineEdit) {
            var move=new Vector2((Input.IsPhysicalKeyPressed(Key.D)?1:0)-(Input.IsPhysicalKeyPressed(Key.A)?1:0),(Input.IsPhysicalKeyPressed(Key.W)?1:0)-(Input.IsPhysicalKeyPressed(Key.S)?1:0));
            MoveAerial(move,delta,Input.IsPhysicalKeyPressed(Key.Shift));
        }
        if(_walking&&_walker?.Active==true||_smoke||Time.GetTicksMsec()<_benchmarkUntil)_viewport.RenderTargetUpdateMode=SubViewport.UpdateMode.Always;
        else if(_drawFrames>0){_drawFrames--;_viewport.RenderTargetUpdateMode=SubViewport.UpdateMode.Once;}
        else _viewport.RenderTargetUpdateMode=SubViewport.UpdateMode.Disabled;
    }
    private void MoveAerial(Vector2 move,double delta,bool fast){
        if(move.LengthSquared()==0||_map==null)return;
        move=move.Normalized();float speed=Mathf.Max(8,_aerial.Size*.45f)*(fast?2:1);
        _target+=(_aerial.GlobalBasis.X*move.X+new Vector3(-Mathf.Sin(_yaw),0,-Mathf.Cos(_yaw))*move.Y)*speed*(float)Math.Min(delta,.05);
        _target.X=Mathf.Clamp(_target.X,0,I(_map["width"]));_target.Z=Mathf.Clamp(_target.Z,0,I(_map["height"]));UpdateOrbit();
    }
    private void Message(string text){_notice.Text=text;_notice.Show();}
    private async Task Export()
    {
        if(_village==null)return;
        var safeSeed=_map?["seed"]?.GetValue<string>()??"map";
        foreach(char c in System.IO.Path.GetInvalidFileNameChars())safeSeed=safeSeed.Replace(c,'-');
        var dialog=new FileDialog{FileMode=FileDialog.FileModeEnum.SaveFile,Access=FileDialog.AccessEnum.Filesystem,UseNativeDialog=true,CurrentFile="Village-"+safeSeed+".png"};
        dialog.Filters=new[]{"*.png ; Imagem PNG"};AddChild(dialog);
        dialog.FileSelected+=async path=>{
            try{
                var image=await FullMapImage();var error=image.SavePng(path);
                Message(error==Error.Ok?"Mapa completo exportado.":"Falha ao salvar PNG: "+error);
            }catch(Exception ex){Message("Falha ao exportar: "+ex.Message);}finally{dialog.QueueFree();}
        };
        dialog.Canceled+=()=>dialog.QueueFree();dialog.PopupCentered(new Vector2I(800,500));
        await Task.CompletedTask;
    }
    private async Task<Image> FullMapImage()
    {
        if(_village==null)throw new InvalidOperationException("Gere uma vila primeiro.");
        var shot=new SubViewport{Size=new Vector2I(4096,2825),World3D=_viewport.World3D,RenderTargetUpdateMode=SubViewport.UpdateMode.Always};
        AddChild(shot);
        var camera=new Camera3D{Projection=Camera3D.ProjectionType.Orthogonal,Near=.05f,Far=1800,Current=true};
        shot.AddChild(camera);
        var bounds=_village.MapBounds;var center=bounds.GetCenter();
        var direction=(_aerial.GlobalPosition-_target).Normalized();
        camera.Position=center+direction*300;camera.LookAt(center);
        float minX=float.PositiveInfinity,maxX=float.NegativeInfinity,minY=float.PositiveInfinity,maxY=float.NegativeInfinity;
        for(int i=0;i<8;i++){var p=bounds.GetEndpoint(i)-center;float x=p.Dot(camera.GlobalBasis.X),y=p.Dot(camera.GlobalBasis.Y);minX=Mathf.Min(minX,x);maxX=Mathf.Max(maxX,x);minY=Mathf.Min(minY,y);maxY=Mathf.Max(maxY,y);}
        camera.Size=Mathf.Max(maxY-minY,(maxX-minX)/(4096f/2825))*1.09f;
        bool sky=_atmosphere.Visible;_atmosphere.Hide();
        try{
            await ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
            await ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
            return shot.GetTexture().GetImage();
        }finally{_atmosphere.Visible=sky;shot.QueueFree();}
    }
    private async Task RunSmoke(string[] args)
    {
        try{await Smoke(args);}catch(Exception ex){GD.PushError(ex.ToString());GetTree().Quit(1);}
    }
    private async Task Smoke(string[] args)
    {
        await Generate(false);
        await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame);
        await ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
        string folder=OS.GetEnvironment("VILLAGE_SMOKE_DIR");
        if(!string.IsNullOrWhiteSpace(folder)){
            System.IO.Directory.CreateDirectory(folder);
            GetViewport().GetTexture().GetImage().SavePng(System.IO.Path.Combine(folder,"native-aerial.png"));
            if(_map!=null)System.IO.File.WriteAllText(System.IO.Path.Combine(folder,"native-map.json"),_map.ToJsonString());
        }
        if(_map!=null){
            _village!.ValidateIntegratedRoads();
            await HudSmoke(folder);
            await ExtendedMenuSmoke(folder);
            var before=_target;MoveAerial(Vector2.Right,1.0/60,false);float straight=_target.DistanceTo(before);
            _target=before;MoveAerial(new Vector2(1,1),1.0/60,false);float diagonal=_target.DistanceTo(before);
            if(straight<=0||Mathf.Abs(straight-diagonal)>.001f)throw new InvalidOperationException("Aerial navigation/diagonal mismatch");
            _target=before;UpdateOrbit();GD.Print("AERIAL_NAV_CHECK normalized=True moved=True");
            EnterWalk();
            for(int i=0;i<45;i++)await ToSignal(GetTree(),SceneTree.SignalName.PhysicsFrame);
            float surface=_village!.SurfaceHeight(_walker!.GlobalPosition.X,_walker.GlobalPosition.Z)??throw new InvalidOperationException("Missing spawn surface");
            float error=Mathf.Abs(_walker.GlobalPosition.Y-surface);
            GD.Print($"PLAYER_CHECK floor={_walker.IsOnFloor()} error={error:0.000} bounds={_village.MapBounds.HasPoint(_walker.GlobalPosition)}");
            if(!_walker.IsOnFloor()||error>.08f)throw new InvalidOperationException("Spawn/ground collision mismatch");
            float groundY=_walker.GlobalPosition.Y;
            _walker?.Jump();
            for(int i=0;i<15;i++)await ToSignal(GetTree(),SceneTree.SignalName.PhysicsFrame);
            if(_walker!.GlobalPosition.Y<groundY+.2f)throw new InvalidOperationException("Jump did not rise");
            if(!string.IsNullOrWhiteSpace(folder))GetViewport().GetTexture().GetImage().SavePng(System.IO.Path.Combine(folder,"native-walk.png"));
            var image=await FullMapImage();
            if(!string.IsNullOrWhiteSpace(folder))image.SavePng(System.IO.Path.Combine(folder,"native-full-map.png"));
            if(!string.IsNullOrWhiteSpace(folder))
            {
                _walker.Active=false;
                foreach(var facing in new[]{"south","east","north","west"})
                {
                    var b=_map["buildings"]!.AsArray().FirstOrDefault(b=>b?["orientation"]?.GetValue<string>()==facing&&b["assetId"]!.GetValue<string>().Contains(":cottage:")&&!b["assetId"]!.GetValue<string>().EndsWith(":2"));
                    if(b==null)continue;
                    float Read(string key)=>(float)double.Parse(b["entrance"]![key]!.ToJsonString(),System.Globalization.CultureInfo.InvariantCulture);
                    var p=new Vector3(Read("x"),Read("level")*.25f,Read("y"));
                    var forward=facing switch{"east"=>Vector3.Right,"west"=>Vector3.Left,"north"=>Vector3.Forward,_=>Vector3.Back};
                    _walker.View.Fov=75;_walker.View.GlobalPosition=p+forward*1.8f+Vector3.Up*.9f;_walker.View.LookAt(p+Vector3.Up*.7f);
                    await ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
                    await ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
                    GetViewport().GetTexture().GetImage().SavePng(System.IO.Path.Combine(folder,$"native-door-{facing}.png"));
                }
            }
            ExitWalk();
        }
        _pause.Show();
        await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame);
        await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame);
        var card=_pause.GetNode<PanelContainer>("PauseCenter/PauseCard");
        if(card.GetGlobalRect().GetCenter().DistanceTo(GetViewportRect().GetCenter())>2)throw new InvalidOperationException("Pause card is not centred");
        if(!string.IsNullOrWhiteSpace(folder))GetViewport().GetTexture().GetImage().SavePng(System.IO.Path.Combine(folder,"native-pause.png"));
        _pause.Hide();await WalkRegression.Run(this);
        GD.Print("SAVEGAME_DISABLED development_phase=True preferences_preserved=True");
        GD.Print(_map==null?"NATIVE_SMOKE_FAILED":"NATIVE_SMOKE_OK");
        GetTree().Quit(_map==null?1:0);
    }
}
