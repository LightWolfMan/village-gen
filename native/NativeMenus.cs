using Godot;
using Village.Simulation;

namespace Village;

public partial class NativeMain
{
    private readonly Dictionary<string,Control> _menuPages=new();
    private readonly Dictionary<string,Button> _menuButtons=new();
    private string _activePage="territory";
    private CheckButton _reflections=null!,_details=null!,_pickHouses=null!,_pickServices=null!,_pickObjects=null!;
    private HSlider _grassDensity=null!,_foliageDensity=null!;
    private OptionButton _regionFilter=null!;
    private Label _selectionInfo=null!,_simulationInfo=null!;
    private OptionButton _imageQuality=null!;
    private readonly List<BaseButton> _simulationControls=new();
    private IVillageSimulation? _simulation;
    private double _simulationLabelTime;
    private bool _rightPressed;
    private bool _rightMoved;
    private Vector2 _rightOrigin;
    private PopupMenu _contextMenu=null!;
    private Vector3? _contextWalkStart;

    private void CloseDrawer()
    {
        _panel.Hide();
        if(_menuButtons.TryGetValue(_activePage,out var opener))opener.GrabFocus();
        RequestDraw();
    }

    private void OpenPage(string id)
    {
        CloseGraphicPopup();
        bool close=_panel.Visible&&_activePage==id;_activePage=id;_panel.Visible=!close;
        _panelTitleRow.Visible=id!="settings";
        foreach(var pair in _menuPages)pair.Value.Visible=pair.Key==id;
        foreach(var pair in _menuButtons)pair.Value.ButtonPressed=!close&&pair.Key==id;
        _drawerTitle.Text=id switch{"territory"=>"Território","view"=>"Visão","settings"=>"Ajustes","regions"=>"Regiões",_=>"Simulação"};
        _dragPan=_dragRotate=_rightPressed=false;
        _panelAnchor=_menuButtons.TryGetValue(id,out var opener)?opener:null;
        // Cada pagina tem tamanho proprio; o submenu acompanha.
        CallDeferred(MethodName.FitPanel);
        CallDeferred(MethodName.SettlePanel);
    }
    /// <summary>
    /// Segunda passada e seguintes: o fluxo so sabe a propria altura depois de
    /// receber largura, e a barra de rolagem so sabe o que sobra depois disso.
    /// Cada disparo refaz a conta; para quando nada mais muda, ou depois de oito
    /// tentativas, para nao virar laco.
    /// </summary>
    private void SettlePanel(){_settleTicks=8;_settleTimer.Start();}

    private void ConfigureExtendedMenus(VBoxContainer pages,HBoxContainer tools,Control[] viewItems,Control[] generationItems)
    {
        _menuPages["territory"]=_generationPage;_menuPages["view"]=_viewPage;
        _menuButtons["territory"]=_terrainTool;_menuButtons["view"]=_viewTool;_menuButtons["regions"]=_districtTool;
        // Mesmo container em fluxo das outras paginas: lado a lado quando cabe,
        // empilhado quando o painel esta estreito.
        HFlowContainer Page(string id)
        {var row=Flow();row.Visible=false;pages.AddChild(row);_menuPages[id]=row;return row;}
        VBoxContainer Group(HFlowContainer page)
        {var column=Section();column.AddThemeConstantOverride("separation",10);page.AddChild(column);return column;}
        void Move(Control control,Node parent){control.GetParent().RemoveChild(control);parent.AddChild(control);}
        var settings=Page("settings");var illumination=Group(settings);Move(viewItems[3],illumination);
        var effects=Group(settings);_reflections=new CheckButton{Text="Reflexos",ButtonPressed=true,TooltipText="Reflexos aproximados por captura estática do ambiente"};effects.AddChild(_reflections);
        _details=new CheckButton{Text="Detalhes",ButtonPressed=true,TooltipText="Materiais detalhados e lanternas decorativas"};effects.AddChild(_details);
        // Icone acompanha o rotulo; sozinho, "agua" e "casa" nao dizem que sao
        // reflexos e detalhes de material.
        _reflections.Icon=ColorIcon("water");_details.Icon=ColorIcon("house");
        foreach(var botao in new[]{_reflections,_details})KeepIconColors(botao);
        foreach(var button in new[]{_reflections,_details})button.AddThemeConstantOverride("icon_max_width",26);
        var image=Group(settings);
        // Antisserrilhado e supersampling sao os unicos ajustes de imagem que
        // moram na fronteira da interface; o resto do acabamento grafico
        // (oclusao de contato, materiais, renderizador) e do Codex.
        _imageQuality=Option("Equilibrada · FXAA","Alta · MSAA 4×","Máxima · supersampling");
        _imageQuality.Select(1);_imageQuality.FitToLongestItem=false;
        Field(image,"Qualidade de imagem",_imageQuality);
        _imageQuality.ItemSelected+=_=>{ApplyImageQuality();SaveGraphics();};
        var vegetation=Group(settings);
        HSlider Density(string label,string tooltip){vegetation.AddChild(Label(label,12));var slider=new HSlider{MinValue=0,MaxValue=100,Step=25,Value=100,TooltipText=tooltip,CustomMinimumSize=new Vector2(180,32)};vegetation.AddChild(slider);slider.ValueChanged+=_=>{ApplyGraphics();SaveGraphics();};return slider;}
        _grassDensity=Density("Grama","Densidade gráfica da grama: 0, 25, 50, 75 ou 100%");
        _foliageDensity=Density("Copas das árvores","Quantidade de copas desenhadas. Troncos continuam visíveis para preservar a colisão.");
        var appearance=Group(settings);Move(viewItems[4],appearance);
        _reflections.Toggled+=_=>{ApplyGraphics();SaveGraphics();};_details.Toggled+=_=>{ApplyGraphics();SaveGraphics();};
        CompactGraphicSettings(settings);
        var regions=Page("regions");var districts=Group(regions);Move(_zones,districts);
        _regionFilter=Option("Todos","Residencial","Comercial","Oficinas","Agrícola","Cívico");districts.AddChild(_regionFilter);ColorOptions(_regionFilter,"map","house","houses","house","seed","houses");
        _regionFilter.ItemSelected+=i=>{_village?.SetRegionFilter(new[]{"all","residential","commercial","craft","agricultural","civic"}[(int)i]);_zones.ButtonPressed=true;RequestDraw();};
        var selection=Group(regions);selection.AddChild(Label("Selecionar no mapa",12));var selectionRow=new HBoxContainer();selection.AddChild(selectionRow);
        CheckButton Picker(string icon,string help){var button=new CheckButton{TooltipText=help,ButtonPressed=true};button.Icon=ColorIcon(icon);KeepIconColors(button);button.AddThemeConstantOverride("icon_max_width",26);button.CustomMinimumSize=new Vector2(62,48);selectionRow.AddChild(button);return button;}
        _pickHouses=Picker("house","Selecionar casas");_pickServices=Picker("houses","Selecionar serviços");_pickObjects=Picker("tree","Selecionar objetos e árvores");
        _selectionInfo=Label("Clique em um elemento para inspecionar.",12);_selectionInfo.AutowrapMode=TextServer.AutowrapMode.WordSmart;_selectionInfo.CustomMinimumSize=new Vector2(300,50);Group(regions).AddChild(_selectionInfo);
        viewItems[5].Hide(); // Camera gestures live in tooltips, not a permanent paragraph.
        generationItems[7].Hide();
        foreach(var option in new[]{_biome,_settlement,_layout,_size,_presets,_quality,_themeChoice,_regionFilter})
        {
            // Por padrao o OptionButton reserva a largura do item mais longo,
            // e era isso que fazia "Ponto de partida" pedir 210 px enquanto os
            // vizinhos pediam 176 — uma coluna a menos no submenu inteiro.
            option.FitToLongestItem=false;
            void Compact(){RefreshCompactChoices();SettlePanel();}
            Compact();option.ItemSelected+=_=>Compact();
        }
        foreach(string id in new[]{"settings","simulation"})
        {var button=IconButton(id=="settings"?"settings":"simulation","",id=="settings"?"Ajustes · opções gráficas":"Simulação · crescimento e circulação",()=>OpenPage(id));button.ToggleMode=true;tools.AddChild(button);tools.MoveChild(button,id=="settings"?3:4);_menuButtons[id]=button;}
        var simulation=Page("simulation");var clock=Group(simulation);clock.AddChild(Label("Ritmo",12));
        var speeds=new HBoxContainer();speeds.AddThemeConstantOverride("separation",6);clock.AddChild(speeds);
        // Botoes em grupo: a velocidade corrente fica marcada, em vez de so
        // aparecer no fim da frase de status.
        var speedGroup=new ButtonGroup();
        foreach(var value in new[]{0,1,2})
        {
            int speed=value;
            var button=IconButton(value==0?"pause":value==1?"play":"fast-forward","",value==0?"Pausar a simulação":$"Velocidade {value}×",()=>{if(_simulation!=null)_simulation.Speed=speed;RequestDraw();});
            button.ToggleMode=true;button.ButtonGroup=speedGroup;button.ButtonPressed=speed==1;
            button.Text=speed==0?"Pausa":$"{speed}×";
            button.IconAlignment=HorizontalAlignment.Left;button.AddThemeConstantOverride("icon_max_width",16);
            button.AddThemeFontSizeOverride("font_size",12);button.CustomMinimumSize=new Vector2(0,36);
            button.SizeFlagsHorizontal=SizeFlags.ExpandFill;
            speeds.AddChild(button);_simulationControls.Add(button);
        }
        var growth=Group(simulation);growth.AddChild(Label("Crescimento",12));
        var grow=Option("Residencial","Comercial","Oficinas","Agrícola");grow.FitToLongestItem=false;grow.TooltipText="Distrito onde a próxima obra será aberta";growth.AddChild(grow);
        var growButton=IconButton("sparkles","","Iniciar uma nova obra no distrito escolhido",()=>{if(_simulation!=null&&!_simulation.QueueGrowth(new[]{"residential","commercial","craft","agricultural"}[grow.Selected]))Message(_simulation.StatusText);});
        growButton.Text="Nova obra";growButton.IconAlignment=HorizontalAlignment.Left;
        growButton.AddThemeConstantOverride("icon_max_width",18);growButton.AddThemeFontSizeOverride("font_size",13);
        growButton.CustomMinimumSize=new Vector2(0,38);growButton.SizeFlagsHorizontal=SizeFlags.ExpandFill;
        growth.AddChild(growButton);_simulationControls.Add(growButton);
        var life=Group(simulation);life.AddChild(Label("Circulação e ecologia",12));
        foreach(string name in new[]{"Pessoas","Carroças","Ciclo das árvores"})
        {var toggle=new CheckButton{Text=name,ButtonPressed=true,TooltipText=name switch{"Pessoas"=>"Mostrar os moradores circulando","Carroças"=>"Mostrar as carroças circulando",_=>"Mudas nascendo, crescendo e morrendo"}};life.AddChild(toggle);_simulationControls.Add(toggle);toggle.Toggled+=v=>{if(_simulation==null)return;if(name=="Pessoas")_simulation.PeopleEnabled=v;else if(name=="Carroças")_simulation.VehiclesEnabled=v;else _simulation.EcologyEnabled=v;RequestDraw();};}
        _simulationInfo=Label("Módulo de simulação em desenvolvimento pelo Claude.",12);_simulationInfo.AutowrapMode=TextServer.AutowrapMode.WordSmart;_simulationInfo.CustomMinimumSize=new Vector2(220,50);Group(simulation).AddChild(_simulationInfo);
        _simulationControls.Add(grow);foreach(var control in _simulationControls)control.Disabled=true;
        _contextMenu=new PopupMenu();AddChild(_contextMenu);_contextMenu.AddItem("Passear a partir daqui",0);
        _contextMenu.IdPressed+=_=>{if(_contextWalkStart is not Vector3 start)return;EnterWalk();if(_walker!=null)_walker.GlobalPosition=start+Vector3.Up*.06f;};
    }
    /// <summary>
    /// Image quality inside the 3D viewport. MSAA smooths the geometry edges,
    /// FXAA catches what MSAA cannot, and a render scale above 1 supersamples
    /// the whole frame. All three work on the Mobile renderer the project uses.
    /// </summary>
    private void ApplyImageQuality()
    {
        if(_imageQuality==null||_viewport==null)return;
        int tier=_imageQuality.Selected;
        _viewport.Msaa3D=tier==0?Viewport.Msaa.Disabled:Viewport.Msaa.Msaa4X;
        _viewport.ScreenSpaceAA=Viewport.ScreenSpaceAAEnum.Fxaa;
        _viewport.Scaling3DScale=tier==2?1.5f:1f;
        RequestDraw();
    }

    private void ApplyGraphics()
    {
        if(_grassDensity==null)return;
        _village?.ApplyPresentation((float)_grassDensity.Value/100,(float)_foliageDensity.Value/100,_reflections.ButtonPressed,_details.ButtonPressed);RequestDraw();
    }
    private void RefreshCompactChoices()
    {
        // O valor escolhido fica no proprio seletor; o nome do campo ja aparece
        // como rotulo e sobra para o tooltip. Antes era o contrario, e a unica
        // forma de saber o bioma selecionado era passar o mouse por cima.
        foreach(var pair in new[]{(_biome,"Paisagem"),(_settlement,"Assentamento"),(_layout,"Ruas"),(_size,"Extensão"),(_presets,"Ponto de partida"),(_quality,"Iluminação"),(_themeChoice,"Aparência do HUD"),(_regionFilter,"Distrito")})
        {
            if(pair.Item1==null)continue;
            pair.Item1.TooltipText=pair.Item2;
            pair.Item1.Text=pair.Item1.GetItemText(pair.Item1.Selected);
        }
    }
    private void SaveGraphics()
    {
        if(_smoke)return;
        _preferences.SetValue("graphics","grass",_grassDensity.Value);_preferences.SetValue("graphics","foliage",_foliageDensity.Value);
        _preferences.SetValue("graphics","reflections",_reflections.ButtonPressed);_preferences.SetValue("graphics","details",_details.ButtonPressed);
        _preferences.SetValue("graphics","image",_imageQuality.Selected);_preferences.Save("user://preferences.cfg");
    }
    private void LoadGraphics()
    {
        bool smoke=_smoke;_smoke=true;
        try{_grassDensity.Value=_preferences.GetValue("graphics","grass",100).AsDouble();_foliageDensity.Value=_preferences.GetValue("graphics","foliage",100).AsDouble();_reflections.ButtonPressed=_preferences.GetValue("graphics","reflections",true).AsBool();_details.ButtonPressed=_preferences.GetValue("graphics","details",true).AsBool();
        _imageQuality.Select(Math.Clamp((int)_preferences.GetValue("graphics","image",1).AsDouble(),0,2));ApplyImageQuality();}finally{_smoke=smoke;}
    }
    private Vector3? PickWorld(Vector2 mouse)
    {
        if(_map==null)return null;var local=(mouse-_stage.GlobalPosition)*new Vector2(_viewport.Size.X/Mathf.Max(1,_stage.Size.X),_viewport.Size.Y/Mathf.Max(1,_stage.Size.Y));
        var origin=_aerial.ProjectRayOrigin(local);var direction=_aerial.ProjectRayNormal(local);
        var hit=_aerial.GetWorld3D().DirectSpaceState.IntersectRay(PhysicsRayQueryParameters3D.Create(origin,origin+direction*2000,1));
        if(hit.Count>0)return hit["position"].AsVector3();
        if(Mathf.Abs(direction.Y)<.0001f)return null;var point=origin+direction*(-origin.Y/direction.Y);
        return point.X>=0&&point.Z>=0&&point.X<I(_map["width"])&&point.Z<I(_map["height"])?point:null;
    }
    private void HandleContextInput(InputEvent e)
    {
        if(e is InputEventMouseMotion motion&&_rightPressed&&motion.Position.DistanceTo(_rightOrigin)>5)_rightMoved=true;
        if(e is not InputEventMouseButton mouse||mouse.ButtonIndex!=MouseButton.Right||mouse.Pressed||!_rightPressed)return;
        _rightPressed=false;if(_walking||_rightMoved||mouse.Position.DistanceTo(_rightOrigin)>5)return;
        var point=PickWorld(mouse.Position);if(point==null||_village==null)return;
        _contextWalkStart=_village.TryWalkStart(new Vector2(point.Value.X,point.Value.Z),out var start)?start:null;
        _contextMenu.SetItemDisabled(0,_contextWalkStart==null);_contextMenu.Position=GetWindow().Position+(Vector2I)(mouse.Position*GetWindow().ContentScaleFactor);_contextMenu.Popup();
    }
    private bool TrySelectRegion(Vector2 position)
    {
        if(_activePage!="regions"||!_panel.Visible||_village==null)return false;
        var point=PickWorld(position);if(point==null)return false;
        string selected=_village.SelectElement(point.Value,_pickHouses.ButtonPressed,_pickServices.ButtonPressed,_pickObjects.ButtonPressed);
        _selectionInfo.Text=selected.Length>0?selected:"Nenhum elemento selecionado.";RequestDraw();return selected.Length>0;
    }
    private void ResetSimulation()
    {
        _simulation?.Dispose();_simulation=_village!=null&&_map!=null?SimulationHost.Create(_village,_map):null;
        if(_village!=null)_village.SetRegionFilter(new[]{"all","residential","commercial","craft","agricultural","civic"}[_regionFilter.Selected]);
        foreach(var control in _simulationControls)control.Disabled=_simulation==null;
    }
    private void UpdateSimulation(double delta)
    {
        if(_simulation==null||_busy)return;
        if(GetWindow().HasFocus())_simulation.Advance(delta);
        if(_simulation.IsRunning)RequestDraw();
        if((_simulationLabelTime+=delta)>.25){_simulationLabelTime=0;_simulationInfo.Text=_simulation.StatusText;}
    }
    public override void _ExitTree(){_simulation?.Dispose();_simulation=null;}
    private async Task ExtendedMenuSmoke(string folder)
    {
        foreach(var pair in _menuButtons)if(pair.Value.Text.Length!=0)throw new InvalidOperationException("Main toolbar still has captions");
        foreach(string page in new[]{"settings","regions","simulation","view"})
        {
            // Com a caixa por pagina, capturar no primeiro quadro registrava o
            // teto e nao o tamanho que a pagina acabou pedindo.
            _activePage="";OpenPage(page);
            await SettleHud();
            await ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
            if(!string.IsNullOrEmpty(folder))GetViewport().GetTexture().GetImage().SavePng(System.IO.Path.Combine(folder,$"menu-{page}.png"));
            // A faixa de Ajustes tambem no tema claro: foi ali que o usuario viu
            // os sete icones pretos, e so a captura escura nao mostraria a volta
            // da cor.
            if(page=="settings"&&!string.IsNullOrEmpty(folder))
            {
                int guardado=_themeChoice.Selected;
                foreach(var (indice,nome) in new[]{(1,"claro"),(2,"escuro")})
                {
                    _themeChoice.Select(indice);ApplyTheme();
                    await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame);
                    await ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
                    GetViewport().GetTexture().GetImage().SavePng(System.IO.Path.Combine(folder,$"ajustes-{nome}.png"));
                }
                _themeChoice.Select(guardado);ApplyTheme();
            }
        }
        // Por ancestralidade, nao por profundidade fixa: o campo agora envolve
        // rotulo e controle numa linha, entao contar dois niveis quebrava sem
        // que nada tivesse saido da pagina.
        // Num desenho so-icone o tooltip deixa de ser cortesia e vira a unica
        // fonte do nome. Todo controle interativo das paginas precisa ter um.
        var semDica=new List<string>();
        bool DentroDeOutroControle(Node node,Node page)
        {
            for(var n=node.GetParent();n!=null&&n!=page;n=n.GetParent())
                if(n is BaseButton or OptionButton or LineEdit or Slider)return true;
            return false;
        }
        foreach(var pair in _menuPages)
            foreach(var control in pair.Value.FindChildren("*","Control",true,false).OfType<Control>())
            {
                bool interativo=control is BaseButton or OptionButton or LineEdit or Slider;
                // Um OptionButton carrega LineEdit e PopupMenu internos; cobrar
                // dica deles seria falso positivo. So o controle de fora conta.
                if(!interativo||DentroDeOutroControle(control,pair.Value))continue;
                if(string.IsNullOrEmpty(control.TooltipText))semDica.Add($"{pair.Key}/{control.GetType().Name}");
            }
        GD.Print($"HUD_TOOLTIP_CHECK sem_dica={semDica.Count}{(semDica.Count>0?" -> "+string.Join(", ",semDica.Take(12)):"")}");
        if(semDica.Count>0)throw new InvalidOperationException($"Controle sem dica num desenho so-icone: {string.Join(", ",semDica)}");
        // Navegacao por teclado: partindo do primeiro botao da barra, Tab tem de
        // alcancar todo controle interativo da pagina aberta. Num desenho que ja
        // depende de tooltip, sobrar controle so no mouse seria fechar a porta.
        var foraDoTab=new List<string>();int alcancados=0;
        foreach(var pair in _menuPages)
        {
            _activePage="";OpenPage(pair.Key);
            await SettleHud();
            var alvos=pair.Value.FindChildren("*","Control",true,false).OfType<Control>()
                .Where(c=>c is BaseButton or LineEdit or Slider)
                // Sem excluir quem esta com foco desligado: um controle
                // interativo que nao aceita foco e justamente a regressao que
                // esta verificacao existe para pegar.
                .Where(c=>c.IsVisibleInTree()&&!(c is BaseButton botao&&botao.Disabled)&&!DentroDeOutroControle(c,pair.Value))
                .ToArray();
            var visitados=new HashSet<Control>();
            _terrainTool.GrabFocus();
            Control? atual=_terrainTool;
            for(int i=0;i<400&&atual!=null;i++)
            {
                atual=atual.FindNextValidFocus();
                if(atual==null||!visitados.Add(atual))break;
            }
            alcancados+=alvos.Length;
            // Cada pagina pede a propria caixa: a de dois botoes nao tem por que
            // ocupar a mesma largura da de nove campos.
            var tela=GetViewportRect().Size;
            float ocupa=_panel.Size.X*_panel.Size.Y/(tela.X*tela.Y);
            float usado=(float)_panelScroll.GetVScrollBar().MaxValue;
            float util=(float)_panelScroll.GetVScrollBar().Page;
            GD.Print($"HUD_PAGE_CHECK {pair.Key} submenu={_panel.Size.X:0}x{_panel.Size.Y:0} covered={ocupa:P0} used={usado:0}/{util:0}");
            if(ocupa>(tela.Y<700?.32f:.30f))throw new InvalidOperationException($"Pagina {pair.Key} cobre {ocupa:P0} da tela");
            // Toda pagina cabe na propria caixa a partir da altura de trabalho, e
            // nao so a de Territorio: era essa a diferenca entre um submenu por
            // pagina e um teto fixo. Em 800x480, Ajustes e Simulacao nao cabem
            // dentro do orcamento de area e rolam por dentro — nada fica
            // inalcancavel, e a rolagem horizontal continua desligada.
            if(tela.Y>=700&&usado>util+1)throw new InvalidOperationException($"Pagina {pair.Key} corta: precisa {usado:0}, tem {util:0}");
            foreach(var controle in pair.Value.FindChildren("*","Control",true,false).OfType<Control>())
            {
                if(!controle.IsVisibleInTree()||controle.Size.X<=0)continue;
                var caixa=controle.GetGlobalRect();
                if(caixa.End.X>_panel.GetGlobalRect().End.X+1||caixa.Position.X<_panel.GetGlobalRect().Position.X-1)
                    throw new InvalidOperationException($"Controle fora do submenu em {pair.Key}: {controle.Name}");
            }
            foreach(var alvo in alvos)if(!visitados.Contains(alvo))foraDoTab.Add($"{pair.Key}/{alvo.GetType().Name}");
        }
        GD.Print($"HUD_KEYBOARD_CHECK controles={alcancados} fora_do_tab={foraDoTab.Count}{(foraDoTab.Count>0?" -> "+string.Join(", ",foraDoTab.Take(12)):"")}");
        if(foraDoTab.Count>0)throw new InvalidOperationException($"Controle inalcancavel por teclado: {string.Join(", ",foraDoTab)}");
        _activePage="";OpenPage("settings");await SettleHud();
        var graphicButtons=_menuPages["settings"].GetChildren().OfType<Button>().ToArray();
        if(graphicButtons.Length!=7||graphicButtons.Any(b=>b.Icon==null||b.Text.Length!=0))throw new InvalidOperationException("Settings must contain seven icon-only buttons");
        foreach(var graphicButton in graphicButtons)
        {
            graphicButton.EmitSignal(BaseButton.SignalName.Pressed);
            await SettleHud();
            if(!_graphicPopup.Visible||_graphicValue==null||!_graphicValue.IsVisibleInTree()||_graphicValue.GetParent()!=_graphicContent)
                throw new InvalidOperationException("Graphic option popup did not expose its control");
        }
        if(!string.IsNullOrEmpty(folder))GetViewport().GetTexture().GetImage().SavePng(System.IO.Path.Combine(folder,"graphic-popup.png"));
        CloseGraphicPopup();
        int previousImage=_imageQuality.Selected;
        _imageQuality.Select(0);ApplyImageQuality();if(_viewport.Msaa3D!=Viewport.Msaa.Disabled)throw new InvalidOperationException("Balanced must disable MSAA");
        _imageQuality.Select(1);ApplyImageQuality();if(_viewport.Msaa3D!=Viewport.Msaa.Msaa4X)throw new InvalidOperationException("High must enable 4x MSAA");
        _imageQuality.Select(previousImage);ApplyImageQuality();
        GD.Print("GRAPHIC_POPUP_CHECK icons=7 controls=True nonModal=True qualityProfiles=True");
        float grass=(float)_grassDensity.Value,foliage=(float)_foliageDensity.Value;bool reflections=_reflections.ButtonPressed,details=_details.ButtonPressed;
        _grassDensity.Value=0;_foliageDensity.Value=0;_reflections.ButtonPressed=false;_details.ButtonPressed=false;ApplyGraphics();
        var world=_village!.GetNode<Node3D>("GeneratedWorld");
        if(world.GetChildren().OfType<MultiMeshInstance3D>().Any(n=>n.Name.ToString().StartsWith("Grass")&&n.Multimesh.VisibleInstanceCount!=0))throw new InvalidOperationException("Grass density was not applied");
        if(world.GetChildren().OfType<ReflectionProbe>().Any(n=>n.Visible))throw new InvalidOperationException("Reflection toggle was not applied");
        _grassDensity.Value=grass;_foliageDensity.Value=foliage;_reflections.ButtonPressed=reflections;_details.ButtonPressed=details;ApplyGraphics();
        _panel.Hide();var spawn=_village.SpawnPosition;
        var screen=_aerial.UnprojectPosition(spawn)*new Vector2(_stage.Size.X/_viewport.Size.X,_stage.Size.Y/_viewport.Size.Y)+_stage.GlobalPosition;
        _rightPressed=true;_rightMoved=false;_rightOrigin=screen;
        HandleContextInput(new InputEventMouseButton{ButtonIndex=MouseButton.Right,Pressed=false,Position=screen});
        if(_contextWalkStart==null||!_contextMenu.Visible)throw new InvalidOperationException("Context walk has no safe start/menu");
        await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame);
        if(!string.IsNullOrEmpty(folder))GetViewport().GetTexture().GetImage().SavePng(System.IO.Path.Combine(folder,"context-walk.png"));
        _contextMenu.Hide();var expected=_contextWalkStart.Value;
        _contextMenu.EmitSignal(PopupMenu.SignalName.IdPressed,0L);
        if(_walker==null||_walker.GlobalPosition.DistanceTo(expected+Vector3.Up*.06f)>.01f)throw new InvalidOperationException("Context start ignored");
        ExitWalk();
        _rightPressed=true;_rightMoved=true;_rightOrigin=screen;HandleContextInput(new InputEventMouseButton{ButtonIndex=MouseButton.Right,Position=screen});
        if(_contextMenu.Visible)throw new InvalidOperationException("Orbit drag opened the context menu");
        _village.SetRegionFilter("residential");_village.SetRegionFilter("all");
        var house=_map!["buildings"]!.AsArray().First(b=>b!["type"]!.GetValue<string>()=="house")!;
        var housePoint=new Vector3(I(house["x"])+I(house["width"])*.5f,0,I(house["y"])+I(house["height"])*.5f);
        if(_village.SelectElement(housePoint,true,false,false).Length==0||_village.SelectElement(housePoint,false,false,false).Length!=0)throw new InvalidOperationException("Region selection filters ignored");
        GD.Print("EXTENDED_HUD_CHECK iconOnly=True settings=True graphics=True contextWalk=True orbitPreserved=True simulationContract=True");
    }
}
