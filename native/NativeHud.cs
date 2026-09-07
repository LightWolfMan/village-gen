using Godot;
using System.Text.Json.Nodes;

namespace Village;

public partial class NativeMain
{
    private Control _chrome=null!;
    private VBoxContainer _panelPages=null!;
    private Control? _panelAnchor;
    private Control _panelTitleRow=null!;
    private VBoxContainer _generationPage=null!,_viewPage=null!;
    private Label _drawerTitle=null!,_summary=null!;
    private Button _terrainTool=null!,_viewTool=null!,_districtTool=null!;
    private readonly Dictionary<string,Texture2D> _hudIcons=new();
    private Texture2D ColorIcon(string name)
    {
        string key="color/"+name;if(!_hudIcons.TryGetValue(key,out var texture))_hudIcons[key]=texture=GD.Load<Texture2D>($"res://assets/ui/{key}.svg");return texture;
    }
    /// <summary>
    /// Regra unica dos icones multicoloridos. O tema pinta icone com a cor do
    /// texto, e a textura e multiplicada por ela: no tema claro isso transforma
    /// sol, agua e arvore em borroes quase pretos. Branco e a identidade da
    /// multiplicacao, entao o RGB do arquivo passa intacto. Os monocromaticos de
    /// assets/ui continuam seguindo a tinta do tema, que e o que lhes da
    /// contraste. Desabilitado perde alfa, nao matiz, para continuar legivel.
    /// </summary>
    private void KeepIconColors(Control control)
    {
        foreach(string state in new[]{"normal","hover","pressed","hover_pressed","focus"})
            control.AddThemeColorOverride("icon_"+state+"_color",Colors.White);
        control.AddThemeColorOverride("icon_disabled_color",new Color(1,1,1,.45f));
    }
    private void ColorOptions(OptionButton button,params string[] names)
    {
        for(int i=0;i<button.ItemCount;i++)button.SetItemIcon(i,ColorIcon(names[Math.Min(i,names.Length-1)]));
        button.AddThemeConstantOverride("icon_max_width",22);
        KeepIconColors(button);
    }
    private Button IconButton(string icon,string text,string help,Action action)
    {
        var button=Button(text,action);DecorateIcon(button,icon,help);return button;
    }
    private void DecorateIcon(Button button,string name,string help)
    {
        if(!_hudIcons.TryGetValue(name,out var texture))
        {
            texture=GD.Load<Texture2D>($"res://assets/ui/{name}.svg");_hudIcons[name]=texture;
        }
        button.Icon=texture;button.ExpandIcon=true;button.IconAlignment=HorizontalAlignment.Center;button.VerticalIconAlignment=VerticalAlignment.Top;
        button.AddThemeConstantOverride("icon_max_width",30);button.AddThemeFontSizeOverride("font_size",11);
        button.CustomMinimumSize=new Vector2(78,66);button.TooltipText=help;
        button.Text="";button.VerticalIconAlignment=VerticalAlignment.Center;button.CustomMinimumSize=new Vector2(52,52);
    }
    private void SmallIcon(Button button,string icon)
    {
        DecorateIcon(button,icon,string.IsNullOrEmpty(button.TooltipText)?button.Text:button.TooltipText);
        button.VerticalIconAlignment=VerticalAlignment.Center;button.IconAlignment=HorizontalAlignment.Left;
        button.CustomMinimumSize=new Vector2(36,36);button.AddThemeConstantOverride("icon_max_width",18);button.AddThemeFontSizeOverride("font_size",13);
    }

    // Submenu compacto: duas colunas de campos, ancorado acima da barra e
    // alinhado ao botao que o abriu — nao uma faixa de ponta a ponta.
    private const int PanelWidth=640;
    private const int PanelMinWidth=320;
    private const int GroupWidth=168;
    private const int FlowGap=12;
    private const int PanelGap=12;
    // Medido, nao estimado: entre a borda do painel e o fluxo ha 12+12 do estilo
    // do PanelContainer, 12+12 das margens internas e a barra de rolagem. Com
    // -32 a previsao dava colunas que nao existiam e a pagina cortava.
    private const int PanelInset=56;
    private const int PanelMinHeight=80;
    private PanelContainer _topBar=null!,_dock=null!;
    private MarginContainer _panelInsets=null!;
    private ScrollContainer _panelScroll=null!;
    private Godot.Timer _settleTimer=null!;
    private int _settleTicks;
    private float _panelBottom=-128,_headerBottom=84;

    /// <summary>
    /// Groups flow: side by side while there is width, wrapped into a column
    /// when there is not. One container serves both the bottom tray and the
    /// side panel, so nothing depends on horizontal scrolling to be reachable.
    /// </summary>
    private static HFlowContainer Flow()
    {
        var flow=new HFlowContainer{SizeFlagsHorizontal=SizeFlags.ExpandFill};
        flow.AddThemeConstantOverride("h_separation",FlowGap);
        flow.AddThemeConstantOverride("v_separation",10);
        return flow;
    }
    /// <summary>One field per cell, so the band stays a single row while it fits.</summary>
    private static VBoxContainer Cell(int width)
    {
        var cell=new VBoxContainer{CustomMinimumSize=new Vector2(width,0)};
        cell.AddThemeConstantOverride("separation",3);
        return cell;
    }
    private static VBoxContainer Section()
    {
        var section=new VBoxContainer{CustomMinimumSize=new Vector2(GroupWidth,0)};
        section.AddThemeConstantOverride("separation",8);
        return section;
    }

    private static MarginContainer Insets(int amount)
    {
        var margin=new MarginContainer();
        foreach(var side in new[]{"left","right","top","bottom"})margin.AddThemeConstantOverride("margin_"+side,amount);
        return margin;
    }
    private void OpenDrawer(bool view)
    {
        OpenPage(view?"view":"territory");
    }
    private void BuildHudMain()
    {
        _stage=new SubViewportContainer{Stretch=true,MouseFilter=MouseFilterEnum.Ignore};AddChild(_stage);
        _stage.SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);_stage.Resized+=RequestDraw;
        _viewport=new SubViewport{Size=new Vector2I(1366,768),OwnWorld3D=true,RenderTargetUpdateMode=SubViewport.UpdateMode.Always,Msaa3D=Viewport.Msaa.Msaa4X,ScreenSpaceAA=Viewport.ScreenSpaceAAEnum.Fxaa};_stage.AddChild(_viewport);
        _chrome=new Control{MouseFilter=MouseFilterEnum.Ignore};AddChild(_chrome);_chrome.SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);

        var top=new PanelContainer();_topBar=top;_chrome.AddChild(top);top.SetAnchorsAndOffsetsPreset(LayoutPreset.TopWide);top.OffsetLeft=16;top.OffsetRight=-16;top.OffsetTop=16;top.OffsetBottom=72;
        var topMargin=Insets(10);top.AddChild(topMargin);_header=new HBoxContainer();_header.AddThemeConstantOverride("separation",16);topMargin.AddChild(_header);
        var icon=new TextureRect{Texture=GD.Load<Texture2D>("res://assets/app-icon/village-icon.png"),CustomMinimumSize=new Vector2(32,32),ExpandMode=TextureRect.ExpandModeEnum.IgnoreSize,StretchMode=TextureRect.StretchModeEnum.KeepAspectCentered};_header.AddChild(icon);
        _header.AddChild(Label("VillageGen",19));_summary=Label("Preparando o território",13);_summary.SizeFlagsHorizontal=SizeFlags.ExpandFill;_summary.ClipText=true;_header.AddChild(_summary);

        var dock=new PanelContainer();_dock=dock;_chrome.AddChild(dock);dock.SetAnchorsAndOffsetsPreset(LayoutPreset.BottomWide);dock.OffsetLeft=16;dock.OffsetRight=-16;dock.OffsetTop=-116;dock.OffsetBottom=-16;
        var dockMargin=Insets(10);dock.AddChild(dockMargin);var tools=new HBoxContainer();tools.AddThemeConstantOverride("separation",8);dockMargin.AddChild(tools);
        _terrainTool=Button("Território",()=>OpenDrawer(false));_terrainTool.ToggleMode=true;_terrainTool.TooltipText="Seed, bioma, tamanho e desenho das ruas";tools.AddChild(_terrainTool);
        _districtTool=Button("Regiões",()=>OpenPage("regions"));_districtTool.ToggleMode=true;tools.AddChild(_districtTool);
        _viewTool=Button("Visão",()=>OpenDrawer(true));_viewTool.ToggleMode=true;tools.AddChild(_viewTool);
        _walk=Button("Passear",EnterWalk);_walk.Disabled=true;tools.AddChild(_walk);
        DecorateIcon(_terrainTool,"map","Território · seed, paisagem, ruas e tamanho da vila");
        DecorateIcon(_districtTool,"layers","Regiões · distritos e seleção de elementos");
        DecorateIcon(_viewTool,"orbit","Visão · enquadrar a vila ou ver o território completo");
        DecorateIcon(_walk,"footprints","Passear · explorar a vila em primeira pessoa");
        tools.AddChild(IconButton("image-down","Exportar","Salvar uma imagem PNG do mapa inteiro",()=>_=Export()));
        _status=Label("Preparando…",12);_status.SizeFlagsHorizontal=SizeFlags.ExpandFill;_status.HorizontalAlignment=HorizontalAlignment.Right;_status.ClipText=true;tools.AddChild(_status);
        _generate=IconButton("sparkles","Nova vila","Sortear outra seed e gerar uma vila com os ajustes atuais",()=>_=Generate(true));tools.AddChild(_generate);

        _panel=new PanelContainer{Visible=false};_chrome.AddChild(_panel);
        // A caixa so sabe a altura certa depois que o fluxo recebe largura, e
        // isso e um quadro depois — chamada adiada nao serve, porque e drenada
        // antes do layout. O temporizador e filho deste no: some junto com a
        // cena, em vez de disparar sobre objetos ja liberados no desmonte.
        _settleTimer=new Godot.Timer{WaitTime=.03,OneShot=false};AddChild(_settleTimer);
        // Roda a serie inteira em vez de parar na primeira passada estavel: a
        // barra de rolagem so informa o que falta um quadro depois de o painel
        // mudar de tamanho, e parar cedo devolvia uma caixa 6 px curta.
        _settleTimer.Timeout+=()=>{FitPanel();if(--_settleTicks<=0)_settleTimer.Stop();};
        // Em janela larga o painel vira uma coluna lateral e devolve ao mapa a
        // faixa que a bandeja ocupava; em janela estreita continua embaixo, que
        // e onde ainda sobra espaco.
        Resized+=()=>{FitChrome();FitPanel();SettlePanel();};
        // Esc esconde o painel por fora de OpenPage e deixava o botao da barra
        // marcado com nada aberto. Qualquer caminho que feche solta os botoes.
        _panel.VisibilityChanged+=()=>{if(!_panel.Visible)foreach(var pair in _menuButtons)pair.Value.ButtonPressed=false;};
        var panelMargin=Insets(12);_panelInsets=panelMargin;_panel.AddChild(panelMargin);var column=new VBoxContainer();column.AddThemeConstantOverride("separation",8);panelMargin.AddChild(column);
        var titleRow=new HBoxContainer();column.AddChild(titleRow);_panelTitleRow=titleRow;_drawerTitle=Label("Desenhar uma nova vila",15);_drawerTitle.SizeFlagsHorizontal=SizeFlags.ExpandFill;titleRow.AddChild(_drawerTitle);
        titleRow.AddChild(Button("×",CloseDrawer));
        var scroll=new ScrollContainer{SizeFlagsVertical=SizeFlags.ExpandFill,SizeFlagsHorizontal=SizeFlags.ExpandFill,
            HorizontalScrollMode=ScrollContainer.ScrollMode.Disabled,VerticalScrollMode=ScrollContainer.ScrollMode.Auto};column.AddChild(scroll);_panelScroll=scroll;
        // Sem esticar: dentro do ScrollContainer a pagina tem de ficar do
        // tamanho do proprio conteudo, senao a medida de altura devolve o
        // espaco disponivel e a faixa nunca encolhe.
        var pages=new VBoxContainer{SizeFlagsHorizontal=SizeFlags.ExpandFill,SizeFlagsVertical=SizeFlags.ShrinkBegin};scroll.AddChild(pages);_panelPages=pages;
        _generationPage=new VBoxContainer{SizeFlagsHorizontal=SizeFlags.ExpandFill};_generationPage.AddThemeConstantOverride("separation",9);pages.AddChild(_generationPage);
        _viewPage=new VBoxContainer{Visible=false,SizeFlagsHorizontal=SizeFlags.ExpandFill};_viewPage.AddThemeConstantOverride("separation",12);pages.AddChild(_viewPage);
        _presets=Option("Personalizada","Vila equilibrada","Povoado rural","Cidade em quadras","Vila ribeirinha");Field(_generationPage,"Ponto de partida",_presets);_presets.ItemSelected+=i=>Preset((int)i);
        var seedRow=new HBoxContainer();_seed=new LineEdit{PlaceholderText="Seed da vila",MaxLength=100,SizeFlagsHorizontal=SizeFlags.ExpandFill,TooltipText="Identidade da vila · Enter gera com esta seed"};seedRow.AddChild(_seed);
        seedRow.AddChild(Button("Copiar",()=>{DisplayServer.ClipboardSet(_seed.Text);Message("Seed copiada.");}));Field(_generationPage,"Identidade · seed",seedRow);_seed.TextSubmitted+=text=>{_=Generate(false);};
        var grid=new GridContainer{Columns=2};grid.AddThemeConstantOverride("h_separation",10);grid.AddThemeConstantOverride("v_separation",10);_generationPage.AddChild(grid);
        _biome=Option("Temperado","Árido","Nevado","Pântano");_settlement=Option("Povoado","Vila","Cidade");_settlement.Select(1);
        _layout=Option("Orgânicas","Em quadras");_size=Option("72 × 72","96 × 96","128 × 128");_size.Select(1);
        foreach(var item in new[]{("Paisagem",_biome),("Assentamento",_settlement),("Ruas",_layout),("Extensão",_size)}){var cell=new VBoxContainer{SizeFlagsHorizontal=SizeFlags.ExpandFill};grid.AddChild(cell);Field(cell,item.Item1,item.Item2);}
        _settlement.ItemSelected+=_=>{_size.Disabled=_settlement.Selected==2;if(_size.Disabled)_size.Select(2);};
        var waterRow=new HBoxContainer();waterRow.AddThemeConstantOverride("separation",5);
        waterRow.AddChild(FieldIcon("water"));
        _water=new HSlider{MinValue=5,MaxValue=75,Step=5,Value=35,CustomMinimumSize=new Vector2(0,24),SizeFlagsHorizontal=SizeFlags.ExpandFill,SizeFlagsVertical=SizeFlags.ShrinkCenter,TooltipText="Presença de água no território"};waterRow.AddChild(_water);
        var waterLabel=Label("35%",11);waterLabel.CustomMinimumSize=new Vector2(30,0);waterLabel.VerticalAlignment=VerticalAlignment.Center;waterRow.AddChild(waterLabel);
        _generationPage.AddChild(waterRow);_water.ValueChanged+=v=>waterLabel.Text=$"{v:0}%";
        _river=new CheckButton{Text="Rio atravessando a vila"};_generationPage.AddChild(_river);
        _apply=Button("Aplicar território · manter seed",()=>_=Generate(false));_generationPage.AddChild(_apply);
        _generationPage.AddChild(Button("Restaurar ajustes",()=>Preset(1)));
        _generationPage.AddChild(Label("Alterar os ajustes não muda o mapa\naté você aplicar ou criar outra vila.",12));
        _viewPage.AddChild(Button("Enquadrar assentamento",()=>Center(false)));_viewPage.AddChild(Button("Ver território completo",()=>Center(true)));
        _zones=new CheckButton{Text="Distritos",TooltipText="Colorir os distritos sobre o mapa"};_viewPage.AddChild(_zones);_zones.Toggled+=value=>{_village?.SetShowZones(value);RequestDraw();};
        _quality=Option("Com sombras","Econômico · sem sombras");Field(_viewPage,"Iluminação",_quality);_quality.ItemSelected+=_=>{if(_sun!=null)_sun.ShadowEnabled=_quality.Selected==0;RequestDraw();SaveHudPreferences();};
        _themeChoice=Option("Sistema","Claro","Escuro");Field(_viewPage,"Aparência do HUD",_themeChoice);_themeChoice.ItemSelected+=_=>ApplyTheme();
        _viewPage.AddChild(Label("WASD · deslocar\nArrastar · mover o mapa\nBotão direito · girar\nRoda · aproximar e afastar",14));
        // A horizontal workbench, not a vertical form moved to the bottom.
        var generationItems=_generationPage.GetChildren().OfType<Control>().ToArray();
        var generationRow=Flow();_generationPage.AddChild(generationRow);
        // Uma celula por campo, todas na mesma faixa enquanto houver largura.
        // Empilhar quatro campos por coluna era o que obrigava a bandeja a
        // reservar 244 px de altura.
        var gridCells=generationItems[2].GetChildren().OfType<Control>().ToArray();
        var cells=new List<Control[]>{new[]{generationItems[0]},new[]{generationItems[1]}};
        cells.AddRange(gridCells.Select(cell=>new[]{cell}));
        cells.Add(new[]{generationItems[3]});
        cells.Add(new[]{generationItems[4]});
        cells.Add(new[]{generationItems[5],generationItems[6]});
        // Somadas, as celulas cabem numa faixa unica a 1600 de largura; abaixo
        // disso o fluxo quebra sozinho.
        int[] widths={168,168,168,168,168,168,168,168,168};
        for(int i=0;i<cells.Count;i++)
        {
            var cell=Cell(widths[Math.Min(i,widths.Length-1)]);generationRow.AddChild(cell);
            foreach(var control in cells[i]){control.GetParent().RemoveChild(control);cell.AddChild(control);}
        }
        // Sem isto, cada seletor exige a largura do seu item mais longo e o
        // submenu nunca fecha em duas colunas.
        foreach(var option in new[]{_presets,_biome,_settlement,_layout,_size}){option.ClipText=true;option.CustomMinimumSize=new Vector2(108,32);}
        _seed.CustomMinimumSize=new Vector2(96,0);
        _generationPage.RemoveChild(generationItems[2]);generationItems[2].QueueFree();
        _generationPage.RemoveChild(generationItems[7]);generationRow.AddChild(generationItems[7]);
        var viewItems=_viewPage.GetChildren().OfType<Control>().ToArray();var viewRow=Flow();_viewPage.AddChild(viewRow);
        foreach(var group in new[]{new[]{0,1},new[]{2,3},new[]{4},new[]{5}})
        {
            var section=Section();viewRow.AddChild(section);
            foreach(int index in group){_viewPage.RemoveChild(viewItems[index]);section.AddChild(viewItems[index]);}
        }
        _stats=Label("—",12);_stats.HorizontalAlignment=HorizontalAlignment.Right;titleRow.AddChild(_stats);titleRow.MoveChild(_stats,1);
        SmallIcon(_apply,"check");SmallIcon((Button)generationItems[6],"rotate-ccw");
        SmallIcon((Button)viewItems[0],"scan");SmallIcon((Button)viewItems[1],"globe");
        SmallIcon(seedRow.GetChild<Button>(1),"copy");
        // Compact action cards share one baseline; details remain in tooltips.
        void Card(Button button,string icon,string caption,string help)
        {
            // So icone, com o nome curto e a explicacao no tooltip. O caption
            // continua entrando na dica para a acao nunca ficar anonima.
            DecorateIcon(button,icon,$"{caption} · {help}");
            button.CustomMinimumSize=new Vector2(44,34);
            button.SizeFlagsHorizontal=SizeFlags.ExpandFill;
        }
        Card(_apply,"check","Aplicar","Aplicar os ajustes de território mantendo a seed atual");
        var restore=(Button)generationItems[6];Card(restore,"rotate-ccw","Restaurar","Restaurar os ajustes padrão do gerador");
        var actionSection=_apply.GetParent();actionSection.RemoveChild(_apply);actionSection.RemoveChild(restore);
        var actionRow=new HBoxContainer();actionRow.AddThemeConstantOverride("separation",8);actionSection.AddChild(actionRow);actionSection.MoveChild(actionRow,0);actionRow.AddChild(_apply);actionRow.AddChild(restore);
        Card((Button)viewItems[0],"scan","Centralizar","Enquadrar o assentamento e suas construções");
        Card((Button)viewItems[1],"globe","Mapa inteiro","Enquadrar todo o território, incluindo suas bordas");
        var cameraSection=viewItems[0].GetParent();cameraSection.RemoveChild(viewItems[0]);cameraSection.RemoveChild(viewItems[1]);
        var cameraRow=new HBoxContainer();cameraRow.AddThemeConstantOverride("separation",8);cameraSection.AddChild(cameraRow);cameraRow.AddChild(viewItems[0]);cameraRow.AddChild(viewItems[1]);
        // Faixa compacta pede rotulo curto; o tooltip guarda a frase inteira.
        _river.Text="Rio";_river.TooltipText="Criar um rio atravessando o território";
        ColorOptions(_biome,"tree","desert","snow","water");ColorOptions(_settlement,"house","houses","houses");
        // "Ruas" fica com o mapa; "Extensão" e "Ponto de partida" ficam sem
        // icone, porque a paleta disponivel nao tem nada que os distinga — e o
        // rotulo agora diz o que sao.
        ColorOptions(_layout,"map");
        ColorOptions(_quality,"sun","moon");ColorOptions(_themeChoice,"map","sun","moon");
        _river.Icon=ColorIcon("water");_river.AddThemeConstantOverride("icon_max_width",22);KeepIconColors(_river);
        var close=titleRow.GetChild<Button>(2);close.Text="";close.TooltipText="Recolher ajustes";SmallIcon(close,"x");
        ConfigureExtendedMenus(pages,tools,viewItems,generationItems);
        _hud=Label("WASD caminhar · Mouse olhar · Espaço pular · Shift correr · Esc pausar",14);AddChild(_hud);_hud.Visible=false;_hud.MouseFilter=MouseFilterEnum.Ignore;_hud.SetAnchorsAndOffsetsPreset(LayoutPreset.BottomWide);_hud.OffsetTop=-42;_hud.OffsetBottom=-16;_hud.HorizontalAlignment=HorizontalAlignment.Center;
        _notice=Label("",14);AddChild(_notice);_notice.Visible=false;_notice.MouseFilter=MouseFilterEnum.Ignore;_notice.SetAnchorsAndOffsetsPreset(LayoutPreset.TopWide);_notice.OffsetTop=82;_notice.OffsetBottom=112;_notice.HorizontalAlignment=HorizontalAlignment.Center;
    }

    /// <summary>
    /// Two approved shapes: a side column while there is width, the bottom tray
    /// otherwise. The column follows the height of its page instead of filling
    /// the window, so a short page does not leave a tall empty slab over the map.
    /// </summary>
    /// <summary>
    /// Barra inferior e cabecalho encolhem em janela baixa. Nao e cosmetico: sao
    /// os pixels que o submenu ganha de altura util em 800x480, onde a pagina de
    /// Territorio nao cabe inteira de jeito nenhum e o que da para melhorar e
    /// quanto dela aparece sem rolar.
    /// </summary>
    private static (float Margem,float Altura) ChromeMetrics(float windowHeight)
        =>windowHeight<600?(8f,88f):(16f,100f);
    /// <summary>Respiro entre as linhas do fluxo: menor na janela minima, onde cada linha disputa espaco.</summary>
    private static int RowGap(float windowHeight)=>windowHeight<600?6:10;
    /// <summary>
    /// Quanto da tela o submenu pode cobrir. Em janela de trabalho, os mesmos
    /// 29% de sempre. Abaixo de 600 px de altura a pagina de Territorio nao cabe
    /// dentro desse orcamento por aritmetica — sao 218 px de campos contra 195
    /// de espaco — e a escolha passa a ser entre dois pontos percentuais e uma
    /// rolagem permanente. O painel e dispensavel e ocupa metade da largura; a
    /// rolagem, nao. A excecao vale so ali, e a assercao cobra os dois limites.
    /// </summary>
    private static float AreaBudget(float windowHeight)=>windowHeight<600?.315f:.29f;
    private void FitChrome()
    {
        if(!Vivo(_dock)||!Vivo(_topBar))return;
        var (margem,altura)=ChromeMetrics(GetViewportRect().Size.Y);
        _dock.OffsetTop=-(margem+altura);_dock.OffsetBottom=-margem;
        _topBar.OffsetTop=margem;_topBar.OffsetBottom=margem+56;
        // Na janela minima as margens internas tambem cedem: sao os 8 px que
        // decidem se a pagina de Territorio cabe ou rola.
        if(Vivo(_panelInsets))foreach(var lado in new[]{"left","right","top","bottom"})
            _panelInsets.AddThemeConstantOverride("margin_"+lado,GetViewportRect().Size.Y<600?8:12);
        _panelBottom=-(margem+altura+PanelGap);
        _headerBottom=margem+Mathf.Max(56,_topBar.GetCombinedMinimumSize().Y)+PanelGap;
    }

    /// <summary>
    /// Altura maxima do submenu numa janela dada. Deixou de ser uma fracao fixa
    /// da altura: e o espaco que sobra de fato entre o cabecalho e a barra,
    /// limitado a 316 px e ao orcamento de area que mantem o painel abaixo dos
    /// 30% da tela. A conta vive aqui para a verificacao do smoke poder cobrar a
    /// mesma formula em toda a faixa de janela suportada, e nao so na que rodou.
    /// </summary>
    private float PanelCeiling(Vector2 size,float width)
    {
        var (margem,altura)=ChromeMetrics(size.Y);
        float cabecalho=margem+Mathf.Max(56,_topBar.GetCombinedMinimumSize().Y)+PanelGap;
        float livre=size.Y-(margem+altura+PanelGap)-cabecalho;
        return Mathf.Min(Mathf.Min(livre,316),size.X*size.Y*AreaBudget(size.Y)/Mathf.Max(1,width));
    }

    private static HFlowContainer? PageFlow(Control? page)
        =>page as HFlowContainer??page?.GetChildren().OfType<HFlowContainer>().FirstOrDefault();

    /// <summary>
    /// A celula vazia continuava reservando os 176 px do grupo mesmo sem nada
    /// dentro — era o que fazia a pagina Visao pedir a largura inteira para dois
    /// botoes, depois que Iluminacao e Aparencia mudaram para Ajustes.
    /// </summary>
    private static void HideEmptyCells(Control? page)
    {
        var flow=PageFlow(page);if(flow==null)return;
        foreach(var cell in flow.GetChildren().OfType<Control>())
        {
            if(cell is not BoxContainer&&cell is not GridContainer)continue;
            bool algum=cell.GetChildren().OfType<Control>().Any(c=>c.Visible);
            if(cell.Visible!=algum)cell.Visible=algum;
        }
    }

    private static float CellWidth(Control cell)=>Mathf.Max(cell.CustomMinimumSize.X,cell.GetCombinedMinimumSize().X);

    /// <summary>
    /// Altura que a pagina realmente ocupou, ou -1 quando a medida nao vale
    /// ainda. Uma etiqueta com quebra automatica so declara a propria altura
    /// depois de receber largura, e por isso a previsao fica curta nas paginas
    /// que tem uma. A medida so entra quando o fluxo ja esta na largura
    /// escolhida — do contrario sao as posicoes da pagina anterior, e foi isso
    /// que antes travava o painel no teto.
    /// </summary>
    private static float MeasuredHeight(Control? page,float expected)
    {
        var flow=PageFlow(page);
        if(flow==null||Mathf.Abs(flow.Size.X-expected)>24)return -1;
        var placed=flow.GetChildren().OfType<Control>().Where(c=>c.Visible&&c.Size.X>0).ToArray();
        return placed.Length>0?placed.Max(c=>c.Position.Y+c.Size.Y):-1;
    }

    /// <summary>
    /// Quebra prevista pelas larguras que as celulas declaram, do mesmo jeito que
    /// o HFlowContainer quebra. Prever e o que permite ao painel escolher a
    /// propria largura: medir o fluxo depois do layout realimenta o tamanho do
    /// pai e nunca assenta.
    /// </summary>
    private static (float Height,int Rows) PredictWrap(Control? page,float available,int gap)
    {
        var flow=PageFlow(page);
        if(flow==null)return (120,1);
        float used=0,line=0,total=0;int rows=1;
        foreach(var child in flow.GetChildren().OfType<Control>())
        {
            if(!child.Visible)continue;
            float width=CellWidth(child),height=child.GetCombinedMinimumSize().Y;
            if(used>0&&used+FlowGap+width>available){total+=line+gap;rows++;used=width;line=height;}
            else{used+=(used>0?FlowGap:0)+width;line=Mathf.Max(line,height);}
        }
        // Sem piso por linha: com a caixa por pagina, os 52 px reservavam uma
        // faixa vazia embaixo de toda pagina curta. O minimo do painel ja cuida
        // do caso degenerado.
        return (total+line,rows);
    }

    /// <summary>
    /// Larguras em que a quebra pode mudar: uma por coluna a mais, nunca abaixo
    /// da celula mais larga nem de um painel legivel.
    /// </summary>
    private static List<float> WrapWidths(Control? page,float maxWidth)
    {
        var list=new List<float>();
        var flow=PageFlow(page);
        if(flow!=null)
        {
            var widths=flow.GetChildren().OfType<Control>().Where(c=>c.Visible).Select(CellWidth).ToArray();
            float widest=widths.Length>0?widths.Max():0,running=0;
            for(int k=0;k<widths.Length;k++)
            {
                running+=(k>0?FlowGap:0)+widths[k];
                float candidate=Mathf.Max(Mathf.Max(running,widest)+PanelInset,PanelMinWidth);
                if(candidate<maxWidth&&!list.Contains(candidate))list.Add(candidate);
            }
        }
        list.Add(maxWidth);list.Sort();
        return list;
    }

    /// <summary>
    /// Submenu compacto ancorado acima da barra: tao estreito e tao baixo quanto
    /// a pagina aberta permitir. A largura sai da previsao da quebra, e nao de
    /// uma constante — era a constante que obrigava a pagina Visao, com dois
    /// botoes, a ocupar a mesma caixa da pagina de nove campos.
    /// </summary>
    private static bool Vivo(GodotObject? node)=>node!=null&&GodotObject.IsInstanceValid(node);
    private bool _fitting,_panelChanged;
    private Control? _fittedPage;private float _fittedWidth;
    private void FitPanel()
    {
        // Chamadas adiadas sobrevivem ao fim da cena: sem conferir que os nos
        // ainda existem, a ultima delas escreve num objeto ja liberado.
        if(_fitting||!Vivo(_panel)||!Vivo(_panelInsets)||!Vivo(_panelTitleRow)||!_panel.IsInsideTree())return;
        // A caixa muda de tamanho, o fluxo se reacomoda e chama de volta: sem
        // trava, a segunda chamada entra no meio da primeira.
        _fitting=true;
        try{FitPanelCore();}finally{_fitting=false;}
    }
    private void FitPanelCore()
    {
        var size=GetViewportRect().Size;
        FitChrome();
        var page=_menuPages.Values.FirstOrDefault(p=>p.Visible);
        HideEmptyCells(page);
        int gap=RowGap(size.Y);
        if(PageFlow(page) is HFlowContainer ativo)ativo.AddThemeConstantOverride("v_separation",gap);
        // Margens em vigor + cabecalho do painel + a separacao da coluna, mais
        // 8 px de folga para arredondamento e para uma etiqueta que cresca um
        // pouco entre duas passadas.
        float chrome=2*_panelInsets.GetThemeConstant("margin_top")+(_panelTitleRow.Visible?_panelTitleRow.GetCombinedMinimumSize().Y:0)+8+8;
        float maxWidth=Mathf.Min(PanelWidth,Mathf.Min(size.X-32,size.X*.55f));
        // O teto deixa de ser uma fracao fixa da altura e passa a ser o espaco
        // que sobra de fato entre o cabecalho e a barra, sem nunca deixar o
        // painel cobrir mais de 29% da tela — a folga da assercao de 30%.
        float width=maxWidth,height=PanelMinHeight;int fewest=int.MaxValue;bool coube=false;
        foreach(float candidate in WrapWidths(page,maxWidth))
        {
            var (content,rows)=PredictWrap(page,candidate-PanelInset,gap);
            float teto=PanelCeiling(size,candidate);
            float alvo=Mathf.Clamp(content+chrome,PanelMinHeight,Mathf.Max(PanelMinHeight,teto));
            // Cabendo, vale a caixa mais baixa: sobre o mapa, um submenu largo e
            // raso esconde menos horizonte do que um estreito e alto. Empatadas,
            // fica a mais estreita, que e a primeira da lista.
            if(content+chrome<=teto){if(!coube||alvo<height-1){coube=true;width=candidate;height=alvo;}}
            // Nao cabendo nenhuma, vale a que quebra em menos linhas: o orcamento
            // de area vira altura e aparece mais pagina sem rolar.
            else if(!coube&&rows<fewest){fewest=rows;width=candidate;height=alvo;}
        }
        float medida=MeasuredHeight(page,width-PanelInset);
        if(medida>0)height=Mathf.Clamp(Mathf.Max(height,medida+chrome),PanelMinHeight,Mathf.Max(PanelMinHeight,PanelCeiling(size,width)));
        // A barra de rolagem e a autoridade sobre o que falta: ela compara o
        // conteudo inteiro com a janela de rolagem, sem depender da minha
        // aritmetica de margens. Cada passada cobre a diferenca ate a barra
        // sumir ou o teto travar — e e assim que a caixa fica do tamanho da
        // pagina, e nao do tamanho que eu calculei que ela teria.
        if(_panelScroll!=null&&GodotObject.IsInstanceValid(_panelScroll)&&_panelScroll.IsInsideTree()&&_panel.Visible)
        {
            float falta=(float)(_panelScroll.GetVScrollBar().MaxValue-_panelScroll.GetVScrollBar().Page);
            // Alvo pelo tamanho de agora mais o que falta, e nao pela previsao
            // mais o que falta: somar a correcao sempre a previsao fazia a caixa
            // crescer, a barra sumir, a passada seguinte voltar a previsao e a
            // barra reaparecer, sem nunca assentar.
            // So corrige quando a caixa ja e desta pagina nesta largura: com
            // outra pagina ou outra largura, a altura de agora nao diz nada e
            // vale a previsao. Sem essa condicao a correcao so somava, e toda
            // pagina herdava a altura da anterior ate bater no teto.
            // Zona morta entre -6 e +1: fora dela a caixa persegue a barra com
            // 6 px de folga, dentro dela nao mexe. Sem a zona morta, somar a
            // folga a cada passada engordava o painel 6 px por vez.
            if(page==_fittedPage&&Mathf.IsEqualApprox(_fittedWidth,width))
            {
                float alvo=falta>1||falta<-6?_panel.Size.Y+falta+6:_panel.Size.Y;
                height=Mathf.Clamp(alvo,PanelMinHeight,Mathf.Max(PanelMinHeight,PanelCeiling(size,width)));
            }
        }
        _fittedPage=page;_fittedWidth=width;
        // Alinhado ao botao que abriu, preso dentro da tela.
        float left=_panelAnchor!=null&&_panelAnchor.IsInsideTree()?_panelAnchor.GetGlobalRect().Position.X:16;
        left=Mathf.Clamp(left,16,Mathf.Max(16,size.X-16-width));
        _panel.SetAnchorsPreset(LayoutPreset.BottomLeft);
        // Sem sair igual quando nada mudou, a reacomodacao do fluxo chamaria
        // FitPanel de volta para sempre.
        if(Mathf.IsEqualApprox(_panel.OffsetLeft,left)&&Mathf.IsEqualApprox(_panel.OffsetRight,left+width)
            &&Mathf.IsEqualApprox(_panel.OffsetTop,_panelBottom-height)){_panelChanged=false;return;}
        _panel.OffsetLeft=left;_panel.OffsetRight=left+width;
        _panel.OffsetBottom=_panelBottom;_panel.OffsetTop=_panelBottom-height;
        _panelChanged=true;
    }

    private void ApplyHudTheme()
    {
        _dark=_themeChoice.Selected==2||_themeChoice.Selected==0&&DisplayServer.IsDarkMode();
        var surface=new Color(_dark?"#1e262c":"#f7f4ee");var ink=new Color(_dark?"#f3eee4":"#26343b");var control=new Color(_dark?"#384450":"#e2ddd2");var accent=new Color(_dark?"#d7b47c":"#73522c");
        // Borda medida contra o preenchimento do proprio controle: 3:1 e o
        // minimo para o contorno de um componente. A anterior ficava em 1,3:1,
        // e por isso os controles quase se dissolviam no painel.
        var outline=new Color(_dark?"#8a939c":"#7d7568");
        StyleBoxFlat Box(Color color)=>new(){BgColor=color,BorderColor=outline,BorderWidthBottom=1,BorderWidthTop=1,BorderWidthLeft=1,BorderWidthRight=1,CornerRadiusTopLeft=5,CornerRadiusTopRight=5,CornerRadiusBottomLeft=5,CornerRadiusBottomRight=5,ContentMarginLeft=12,ContentMarginRight=12,ContentMarginTop=7,ContentMarginBottom=7};
        var theme=new Theme{DefaultFontSize=14};var panel=Box(surface);panel.ShadowSize=8;panel.ShadowColor=new Color(0,0,0,.18f);theme.SetStylebox("panel","PanelContainer",panel);
        // Icon-only controls need readable hints in both system themes.
        var tooltip=Box(surface);tooltip.ShadowSize=6;tooltip.ShadowColor=new Color(0,0,0,.22f);
        theme.SetStylebox("panel","TooltipPanel",tooltip);
        theme.SetColor("font_color","TooltipLabel",ink);theme.SetFontSize("font_size","TooltipLabel",14);
        foreach(var type in new[]{"Button","OptionButton","LineEdit","CheckButton"})
        {
            theme.SetStylebox("normal",type,Box(control));theme.SetStylebox("hover",type,Box(control.Lightened(.07f)));theme.SetStylebox("pressed",type,Box(control.Darkened(.06f)));theme.SetStylebox("disabled",type,Box(surface));
            var focus=Box(Colors.Transparent);focus.BorderColor=accent;focus.SetBorderWidthAll(2);theme.SetStylebox("focus",type,focus);
            theme.SetStylebox("hover_pressed",type,Box(control.Lightened(.04f)));
            foreach(var state in new[]{"font_color","font_hover_color","font_pressed_color","font_hover_pressed_color","font_focus_color"})theme.SetColor(state,type,ink);
            theme.SetColor("font_disabled_color",type,ink.Lerp(surface,.45f));
            foreach(var state in new[]{"icon_normal_color","icon_hover_color","icon_pressed_color","icon_focus_color"})theme.SetColor(state,type,ink);
            theme.SetColor("icon_pressed_color",type,accent);
        }
        // O slider nao tinha indicacao de foco nenhuma: navegando por teclado,
        // a agua e as densidades eram paradas invisiveis no caminho.
        var sliderFocus=Box(Colors.Transparent);sliderFocus.BorderColor=accent;sliderFocus.SetBorderWidthAll(2);
        foreach(var type in new[]{"HSlider","VSlider"})theme.SetStylebox("focus",type,sliderFocus);
        foreach(var type in new[]{"Label","CheckButton","PopupMenu"})theme.SetColor("font_color",type,ink);
        theme.SetStylebox("panel","PopupMenu",Box(surface));theme.SetStylebox("hover","PopupMenu",Box(control));theme.SetColor("font_hover_color","PopupMenu",ink);
        Theme=theme;_generate.AddThemeStyleboxOverride("normal",Box(accent));_generate.AddThemeStyleboxOverride("hover",Box(accent.Lightened(.1f)));
        foreach(var menu in _menuButtons.Values)
        {
            var selected=Box(surface.Lerp(accent,.17f));selected.BorderColor=accent;selected.SetBorderWidthAll(2);
            menu.AddThemeStyleboxOverride("pressed",selected);
            var hovered=(StyleBoxFlat)selected.Duplicate();hovered.BgColor=surface.Lerp(accent,.24f);
            menu.AddThemeStyleboxOverride("hover_pressed",hovered);
        }
        RefreshCompactChoices();
        _generate.AddThemeStyleboxOverride("pressed",Box(accent.Darkened(.08f)));
        foreach(var state in new[]{"font_color","font_hover_color","font_focus_color","font_pressed_color"})_generate.AddThemeColorOverride(state,surface);
        foreach(var state in new[]{"icon_normal_color","icon_hover_color","icon_focus_color","icon_pressed_color"})_generate.AddThemeColorOverride(state,surface);
        // Sem isto o anel de foco do botao principal era accent sobre accent —
        // 1:1, invisivel — porque ele e o unico controle preenchido de accent.
        var mainFocus=Box(Colors.Transparent);mainFocus.BorderColor=surface;mainFocus.SetBorderWidthAll(2);
        _generate.AddThemeStyleboxOverride("focus",mainFocus);
        foreach(var label in new[]{_hud,_notice}){label.AddThemeColorOverride("font_color",Colors.White);label.AddThemeColorOverride("font_shadow_color",Colors.Black);label.AddThemeConstantOverride("shadow_offset_x",1);label.AddThemeConstantOverride("shadow_offset_y",2);}
        if(!_smoke){_preferences.SetValue("appearance","theme",_themeChoice.Selected);_preferences.Save("user://preferences.cfg");}
    }
    private void UpdateHudSummary()
    {
        _summary.Text=_map==null?"Território indisponível":$"{_map["seed"]}   ·   {_village?.HouseCount??I(_map["stats"]?["houses"])} casas   ·   {_biome.GetItemText(_biome.Selected)}";
    }
    private void LoadHudPreferences()
    {
        // One-time import from the retired shell, without modifying its preference file.
        var previous=System.IO.Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.LocalApplicationData),"Village","desktop.json");
        JsonNode? settings=null;
        try{if(_preferences.HasSectionKey("territory","settings"))settings=JsonNode.Parse(_preferences.GetValue("territory","settings").AsString());else if(System.IO.File.Exists(previous))settings=JsonNode.Parse(System.IO.File.ReadAllText(previous));}catch{ }
        if(settings==null)return;
        _seed.Text=settings["seed"]?.GetValue<string>()??_seed.Text;
        foreach(var pair in new[]{("biome",_biome),("settlement",_settlement),("layout",_layout),("size",_size)})pair.Item2.Select(Math.Clamp(I(settings[pair.Item1]),0,pair.Item2.ItemCount-1));
        _water.Value=I(settings["water"],35);_river.ButtonPressed=settings["river"]?.GetValue<bool>()??false;_size.Disabled=_settlement.Selected==2;if(_size.Disabled)_size.Select(2);
        _quality.Select(Math.Clamp(I(settings["quality"]),0,1));_sun.ShadowEnabled=_quality.Selected==0;
    }
    private void SaveHudPreferences()
    {
        if(_smoke)return;
        var settings=new JsonObject{["seed"]=_seed.Text,["biome"]=_biome.Selected,["settlement"]=_settlement.Selected,["layout"]=_layout.Selected,["size"]=_size.Selected,["water"]=(int)_water.Value,["river"]=_river.ButtonPressed,["quality"]=_quality.Selected};
        _preferences.SetValue("territory","settings",settings.ToJsonString());_preferences.Save("user://preferences.cfg");
    }
    private static double Channel(float value)=>value<=.03928f?value/12.92:Math.Pow((value+.055)/1.055,2.4);
    private static double Relative(Color color)=>.2126*Channel(color.R)+.7152*Channel(color.G)+.0722*Channel(color.B);
    private static double Ratio(double a,double b)=>(Math.Max(a,b)+.05)/(Math.Min(a,b)+.05);

    /// <summary>
    /// Espera a caixa parar de mudar. O assentamento roda por temporizador, a
    /// um quadro de distancia; medir antes disso le um estado intermediario, e
    /// foi assim que a primeira versao registrou o teto no lugar da pagina.
    /// </summary>
    private async Task SettleHud()
    {
        var antes=Vector2.Zero;
        for(int quadro=0;quadro<40;quadro++)
        {
            await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame);
            if(quadro>2&&_settleTimer.IsStopped()&&_panel.Size==antes)break;
            antes=_panel.Size;
        }
    }

    private async Task HudSmoke(string folder)
    {
        OpenDrawer(false);
        await SettleHud();
        if(_stage.Size.DistanceTo(GetViewportRect().Size)>2)throw new InvalidOperationException("HUD resized the map viewport");
        // O painel agora tem dois formatos aprovados: coluna lateral em janela
        // larga e bandeja inferior em janela estreita. A verificacao passou a
        // cobrir o que importa nos dois — ficar ancorado numa borda, caber na
        // tela e deixar mapa suficiente visivel.
        var viewport=GetViewportRect().Size;
        var panelRect=_panel.GetGlobalRect();
        // Submenu compacto ancorado acima da barra inferior.
        if(_panel.AnchorTop<.99f)throw new InvalidOperationException("Submenu is not docked to the bottom");
        if(panelRect.Size.X>Mathf.Min(viewport.X-32,PanelWidth)+2)throw new InvalidOperationException($"Submenu is not compact: {panelRect.Size.X:0} px");
        if(panelRect.Position.X<-1||panelRect.Position.Y<-1||panelRect.End.X>viewport.X+1||panelRect.End.Y>viewport.Y+1)
            throw new InvalidOperationException("Panel falls outside the window");
        float covered=panelRect.Size.X*panelRect.Size.Y/(viewport.X*viewport.Y);
        // 30% na janela de trabalho; abaixo de 700 px de altura, os 32% que a
        // excecao documentada em AreaBudget permite — e nem um ponto a mais.
        float limite=viewport.Y<700?.32f:.30f;
        if(covered>limite)throw new InvalidOperationException($"Panel covers too much of the map: {covered:P0} (limit {limite:P0})");
        GD.Print($"HUD_SPACE_CHECK submenu={panelRect.Size.X:0}x{panelRect.Size.Y:0} covered={covered:P0}");
        // Nenhum controle pode ficar fora do painel: era o corte lateral que
        // obrigava a rolagem horizontal para alcancar Aplicar e Restaurar.
        foreach(var control in _menuPages["territory"].FindChildren("*","Control",true,false).OfType<Control>())
        {
            if(!control.IsVisibleInTree()||control.Size.X<=0)continue;
            var rect=control.GetGlobalRect();
            if(rect.End.X>panelRect.End.X+1||rect.Position.X<panelRect.Position.X-1)
                throw new InvalidOperationException($"Control cut off by the panel: {control.Name}");
        }
        // Em tela de trabalho a faixa mostra a pagina inteira: rolar para achar
        // o botao que aplica a mudanca foi um dos defeitos corrigidos, e a
        // verificacao anterior so olhava o eixo horizontal.
        // Medido pela extensao realmente ocupada pelos campos. A altura do
        // proprio container de fluxo nao serve: ele reporta o minimo como se
        // tudo empilhasse numa coluna.
        var territoryFlow=_menuPages["territory"].GetChildren().OfType<HFlowContainer>().FirstOrDefault();
        var laid=territoryFlow?.GetChildren().OfType<Control>().Where(c=>c.Visible&&c.Size.X>0).ToArray()??[];
        if(laid.Length>0)
        {
            // Medido pela propria barra de rolagem: conteudo contra janela. A
            // aritmetica de margens que havia aqui errava para os dois lados —
            // acusava corte onde nao havia e deixava passar corte onde havia.
            float bottom=(float)_panelScroll.GetVScrollBar().MaxValue;
            float room=(float)_panelScroll.GetVScrollBar().Page;
            GD.Print($"HUD_SUBMENU_CHECK columns={laid.Select(c=>Mathf.RoundToInt(c.Position.X)).Distinct().Count()} rows={laid.Select(c=>Mathf.RoundToInt(c.Position.Y)).Distinct().Count()} used={bottom:0}/{room:0}");
            // Vale tambem em 800x480: com o respiro menor entre as linhas e as
            // margens estreitas, a pagina de Territorio passou a caber inteira
            // ali tambem, e nao ha mais motivo para dispensar a janela minima.
            if(bottom>room+1)throw new InvalidOperationException($"Submenu clips its page: needs {bottom:0} px, has {room:0} px");
            // A verificacao acima so cobre a resolucao em que o smoke rodou, e
            // foi por isso que 1366x768 passou batido: a altura util la e menor
            // e a pagina cortava. Agora a formula do teto e conferida contra a
            // altura medida em toda a faixa de janela suportada.
            float chromeHeight=panelRect.Size.Y-room;
            if(viewport.Y>=700)foreach(var janela in new Vector2[]{new(1280,720),new(1366,768),new(1440,800),new(1600,900),new(1920,1080)})
            {
                float ceiling=PanelCeiling(janela,panelRect.Size.X);
                if(ceiling-chromeHeight<bottom)
                    throw new InvalidOperationException($"Submenu clips at {janela.X:0}x{janela.Y:0}: needs {bottom:0}, ceiling gives {ceiling-chromeHeight:0}");
            }
        }
        // Contraste medido, nao estimado a olho.
        foreach(int theme in new[]{1,2})
        {
            _themeChoice.Select(theme);ApplyTheme();
            var box=(StyleBoxFlat)_seed.GetThemeStylebox("normal");
            double fill=Relative(box.BgColor),edge=Relative(box.BorderColor),text=Relative(_seed.GetThemeColor("font_color"));
            double outlineRatio=Ratio(fill,edge),textRatio=Ratio(fill,text);
            if(outlineRatio<3)throw new InvalidOperationException($"Control outline contrast {outlineRatio:0.00}:1 below 3:1 (theme {theme})");
            if(textRatio<4.5)throw new InvalidOperationException($"Control text contrast {textRatio:0.00}:1 below 4.5:1 (theme {theme})");
            GD.Print($"HUD_CONTRAST_CHECK theme={theme} outline={outlineRatio:0.00} text={textRatio:0.00}");
            // Aparencia do foco (WCAG 2.2): 2 px de espessura e 3:1 entre o
            // estado com foco e o estado sem foco dos mesmos pixels — o anel
            // contra o que havia ali antes, e nao contra a vizinhanca inteira.
            // Um anel de 2 px nao consegue 3:1 dos dois lados quando os dois
            // lados ja estao a 6:1 um do outro; a regra e essa mesma.
            double fundo=Relative(((StyleBoxFlat)_panel.GetThemeStylebox("panel")).BgColor);
            foreach(var alvo in new (string Nome,Control No)[]{("campo",_seed),("slider",_water),("principal",_generate)})
            {
                var ring=(StyleBoxFlat)alvo.No.GetThemeStylebox("focus");
                bool preenchido=alvo.No.HasThemeStylebox("normal")&&alvo.No.GetThemeStylebox("normal") is StyleBoxFlat;
                double antes=preenchido?Relative(((StyleBoxFlat)alvo.No.GetThemeStylebox("normal")).BgColor):fundo;
                double ganho=Ratio(Relative(ring.BorderColor),antes);
                if(ring.BorderWidthTop<2)throw new InvalidOperationException($"Focus ring thinner than 2 px: {alvo.Nome}");
                if(ganho<3)throw new InvalidOperationException($"Focus ring contrast {ganho:0.00}:1 below 3:1 ({alvo.Nome}, theme {theme})");
                GD.Print($"HUD_FOCUS_CHECK theme={theme} {alvo.Nome}={ganho:0.00} px={ring.BorderWidthTop}");
            }
        }
        GD.Print($"HUD_IMAGE_CHECK msaa={_viewport.Msaa3D} fxaa={_viewport.ScreenSpaceAA} scale={_viewport.Scaling3DScale:0.00} size={_viewport.Size.X}x{_viewport.Size.Y}");
        // Cobrava MSAA especificamente, o que era verdade quando Equilibrada usava
        // MSAA 2x. O perfil atual e FXAA sem MSAA, entao a exigencia real e ter
        // algum antisserrilhado ativo — MSAA, FXAA ou supersampling.
        if(_viewport.Msaa3D==Viewport.Msaa.Disabled&&_viewport.ScreenSpaceAA==Viewport.ScreenSpaceAAEnum.Disabled&&_viewport.Scaling3DScale<=1.01f)
            throw new InvalidOperationException("Viewport lost anti-aliasing");
        foreach(var button in new[]{_terrainTool,_districtTool,_viewTool,_walk,_generate})if(button.Icon==null)throw new InvalidOperationException("HUD icon missing");
        // Icone != null nao detecta textura escurecida: era esse o buraco que
        // deixou os sete icones de Ajustes passarem pretos no tema claro. A
        // varredura e por caminho da textura, entao pega qualquer icone colorido
        // novo que apareca sem a neutralizacao — nao so os que eu ja conheco.
        foreach(int temaIcone in new[]{1,2})
        {
            _themeChoice.Select(temaIcone);ApplyTheme();
            int coloridos=0,monocromaticos=0;
            foreach(var no in _chrome.FindChildren("*","Control",true,false).OfType<Control>())
            {
                var textura=no switch{Button botao=>botao.Icon,TextureRect area=>area.Texture,_=>null};
                if(textura==null||string.IsNullOrEmpty(textura.ResourcePath))continue;
                bool colorido=textura.ResourcePath.Contains("/ui/color/");
                var tinta=no is TextureRect area2?area2.Modulate:no.GetThemeColor("icon_normal_color");
                if(colorido)
                {
                    coloridos++;
                    if(tinta.R<.99f||tinta.G<.99f||tinta.B<.99f)
                        throw new InvalidOperationException($"Icone colorido tingido pelo tema {temaIcone}: {no.Name} tinta={tinta.ToHtml()} ({textura.ResourcePath})");
                }
                else
                {
                    monocromaticos++;
                    // O monocromatico precisa do contrario: sem contraste ele some.
                    // O fundo e o preenchimento do proprio controle quando ele tem
                    // um — o botao principal e accent, nao a cor do painel — e so
                    // entao o painel atras.
                    double fundo=no.HasThemeStylebox("normal")&&no.GetThemeStylebox("normal") is StyleBoxFlat proprio
                        ?Relative(proprio.BgColor)
                        :Relative(((StyleBoxFlat)_panel.GetThemeStylebox("panel")).BgColor);
                    if(no is Button&&Ratio(Relative(tinta),fundo)<2.5)
                        throw new InvalidOperationException($"Icone monocromatico sem contraste no tema {temaIcone}: {no.Name} {Ratio(Relative(tinta),fundo):0.00}:1");
                }
            }
            GD.Print($"HUD_ICON_TINT_CHECK theme={temaIcone} coloridos={coloridos} monocromaticos={monocromaticos}");
            if(coloridos<6)throw new InvalidOperationException($"Varredura de icones coloridos nao encontrou a faixa de Ajustes: {coloridos}");
        }
        // Icone onde ele distingue de fato; "Extensao" e "Ponto de partida"
        // ficaram sem porque caiam no mesmo icone generico dos demais.
        foreach(var option in new[]{_biome,_settlement,_layout,_quality,_themeChoice})for(int i=0;i<option.ItemCount;i++)if(option.GetItemIcon(i)==null)throw new InvalidOperationException("Colored submenu icon missing");
        // No desenho so-icone o que precisa existir e a dica: um icone mudo,
        // sem tooltip, e o que tornava a barra indecifravel.
        foreach(var action in new Button[]{_apply,_terrainTool,_districtTool,_viewTool,_walk,_generate})
            if(string.IsNullOrEmpty(action.TooltipText))throw new InvalidOperationException($"Icon without a tooltip: {action.Name}");
        // Sem rotulo, o seletor tem de mostrar o valor e dizer no tooltip a que
        // campo pertence — senao volta a ser uma caixa anonima.
        var named=new HashSet<string>();
        foreach(var option in new[]{_biome,_settlement,_layout,_size,_presets,_quality,_themeChoice})
        {
            if(option.Text!=option.GetItemText(option.Selected))throw new InvalidOperationException($"Selector hides its value: {option.TooltipText}");
            if(string.IsNullOrEmpty(option.TooltipText))throw new InvalidOperationException("Selector without a tooltip");
            if(!named.Add(option.TooltipText))throw new InvalidOperationException($"Two fields share the name: {option.TooltipText}");
        }
        int savedTheme=_themeChoice.Selected;bool savedRiver=_river.ButtonPressed;
        foreach(int themeIndex in new[]{1,2})
        {
            _themeChoice.Select(themeIndex);ApplyTheme();
            foreach(bool pressed in new[]{false,true})
            {
                _river.ButtonPressed=pressed;
                foreach(string state in new[]{"font_hover_color","font_pressed_color","font_hover_pressed_color"})
                    if(_river.GetThemeColor(state)!=_river.GetThemeColor("font_color"))throw new InvalidOperationException("River toggle loses text contrast");
                var center=_river.GetGlobalRect().GetCenter();Input.ParseInputEvent(new InputEventMouseMotion{Position=center,GlobalPosition=center});
                await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame);await ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
                if(!string.IsNullOrWhiteSpace(folder))GetViewport().GetTexture().GetImage().SavePng(System.IO.Path.Combine(folder,$"hud-river-{themeIndex}-{pressed}.png"));
            }
        }
        _river.ButtonPressed=savedRiver;_themeChoice.Select(savedTheme);ApplyTheme();
        GD.Print("HUD_RIVER_CHECK light=True dark=True hover=True pressed=True");
        if(!string.IsNullOrWhiteSpace(folder))GetViewport().GetTexture().GetImage().SavePng(System.IO.Path.Combine(folder,"hud-territory.png"));
        _smoke=false;
        try
        {
            void Click(Vector2 p,bool down)=>Input.ParseInputEvent(new InputEventMouseButton{Position=p,GlobalPosition=p,ButtonIndex=MouseButton.Left,Pressed=down});
            Click(_panel.GetGlobalRect().GetCenter(),true);
            await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame);
            if(_dragPan)throw new InvalidOperationException("HUD click reached the camera");
            Click(_panel.GetGlobalRect().GetCenter(),false);
            var mapPoint=GetViewportRect().Size*new Vector2(.8f,.25f);Click(mapPoint,true);
            await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame);
            if(!_dragPan)throw new InvalidOperationException("Map click did not reach the camera");
            Click(mapPoint,false);
        }
        finally{_smoke=true;_dragPan=_dragRotate=false;}
        var window=GetWindow();var previous=window.Size;window.Size=new Vector2I(800,480);
        await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame);await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame);
        if(_generate.GetGlobalRect().End.X>GetViewportRect().End.X||_panel.GetGlobalRect().End.Y>GetViewportRect().End.Y-80)throw new InvalidOperationException("HUD overflow at 800x480");
        if(!string.IsNullOrWhiteSpace(folder))GetViewport().GetTexture().GetImage().SavePng(System.IO.Path.Combine(folder,"hud-small.png"));
        window.Size=previous;OpenDrawer(true);
        await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame);await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame);
        var previousTheme=_themeChoice.Selected;_themeChoice.Select(2);ApplyTheme();
        await ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
        if(!string.IsNullOrWhiteSpace(folder))GetViewport().GetTexture().GetImage().SavePng(System.IO.Path.Combine(folder,"hud-dark.png"));
        _themeChoice.Select(previousTheme);ApplyTheme();_panel.Hide();_terrainTool.ButtonPressed=_viewTool.ButtonPressed=false;
        GD.Print("HUD_CHECK fullMap=True bottomTray=True icons=True inputIsolation=True smallWindow=True themes=True");
    }
}
