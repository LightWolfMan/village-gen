using Godot;

namespace Village;

public partial class NativeMain
{
    private PanelContainer _graphicPopup=null!;
    private VBoxContainer _graphicContent=null!;
    private Label _graphicTitle=null!;
    private Control? _graphicValue;
    private Button? _graphicOpener;

    private void CompactGraphicSettings(HFlowContainer settings)
    {
        _graphicPopup=new PanelContainer{Visible=false};_chrome.AddChild(_graphicPopup);
        _graphicContent=new VBoxContainer();_graphicContent.AddThemeConstantOverride("separation",10);_graphicPopup.AddChild(_graphicContent);
        var heading=new HBoxContainer();_graphicContent.AddChild(heading);
        _graphicTitle=Label("",14);_graphicTitle.SizeFlagsHorizontal=SizeFlags.ExpandFill;heading.AddChild(_graphicTitle);
        var close=IconButton("x","","Fechar esta opção",CloseGraphicPopup);close.CustomMinimumSize=new Vector2(32,32);heading.AddChild(close);
        var storage=new Control{Visible=false};_chrome.AddChild(storage);
        var choices=new (string Icon,string Title,Control Value)[]{
            ("sun","Iluminação",_quality),("water","Reflexos",_reflections),
            ("house","Detalhes",_details),("scan","Qualidade de imagem",_imageQuality),
            ("seed","Densidade de grama",_grassDensity),("tree","Copas das árvores",_foliageDensity),
            ("moon","Tema da interface",_themeChoice)};
        foreach(var choice in choices){choice.Value.Reparent(storage);choice.Value.Hide();}
        foreach(var child in settings.GetChildren()){settings.RemoveChild(child);child.QueueFree();}
        foreach(var choice in choices)
        {
            var button=new Button{TooltipText=choice.Title,CustomMinimumSize=new Vector2(44,44),ExpandIcon=true};
            bool colorido=choice.Icon!="scan";
            button.Icon=colorido?ColorIcon(choice.Icon):GD.Load<Texture2D>($"res://assets/ui/{choice.Icon}.svg");
            // Sem isto os seis icones coloridos herdavam a tinta escura do tema e
            // a faixa inteira virava sete manchas pretas no tema claro. O de
            // qualidade de imagem e monocromatico e continua seguindo o tema.
            if(colorido)KeepIconColors(button);
            button.AddThemeConstantOverride("icon_max_width",26);settings.AddChild(button);
            button.Pressed+=()=>{
                if(_graphicPopup.Visible&&_graphicOpener==button){CloseGraphicPopup();return;}
                if(_graphicValue!=null){_graphicValue.Hide();_graphicValue.Reparent(storage);}
                _graphicOpener=button;_graphicValue=choice.Value;
                _graphicTitle.Text=choice.Title+(choice.Value is Slider slider?$" · {slider.Value:0}%":"");
                choice.Value.Reparent(_graphicContent);choice.Value.Show();_graphicPopup.Show();
                _graphicPopup.ResetSize();
                var viewport=GetViewportRect().Size;
                _graphicPopup.Size=new Vector2(290,_graphicPopup.GetCombinedMinimumSize().Y);
                _graphicPopup.Position=new Vector2(Mathf.Clamp(button.GlobalPosition.X,12,viewport.X-_graphicPopup.Size.X-12),Mathf.Max(12,_panel.Position.Y-_graphicPopup.Size.Y-8));
                choice.Value.GrabFocus();RequestDraw();
            };
            if(choice.Value is Slider density)density.ValueChanged+=v=>{
                if(_graphicValue==choice.Value)_graphicTitle.Text=$"{choice.Title} · {v:0}%";
            };
        }
        _panel.VisibilityChanged+=()=>{if(!_panel.Visible)CloseGraphicPopup();};
        Resized+=CloseGraphicPopup;
    }

    private void CloseGraphicPopup()
    {
        if(_graphicPopup==null||!_graphicPopup.Visible)return;
        _graphicPopup.Hide();_graphicOpener?.GrabFocus();RequestDraw();
    }
}
