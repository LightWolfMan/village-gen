# Interface — entrega do Claude

## Revisão final Codex — 7 de setembro de 2026

Esta seção atualiza e prevalece sobre as medidas e pendências históricas abaixo. Codex assumiu manutenção integral; não é necessário aguardar nova rodada do Claude. Revisados `NativeHud.cs` e `NativeMenus.cs`, incluindo previsão de quebra, estabilização por página/largura, foco e asserções. Não houve alteração de código nesta revisão.

Build sem erros/avisos. Smokes independentes em 800×480 e 1366×768 concluíram `NATIVE_SMOKE_OK` e `PERSISTENCE_CHECK`, com 35 controles alcançáveis na cadeia de foco. Logs `.cache/review-final-ui-small.log` e `.cache/review-final-ui-desktop.log`. Capturas de Território em janela pequena e Visão em desktop inspecionadas. Em 1366×768: Território 584×217, Visão 320×123, Ajustes 607×316, Regiões 484×229, Simulação 591×316; todas sem rolagem vertical necessária. Em 800×480: Território 202/202 px de conteúdo, sem rolagem; Ajustes 266/211, Simulação 382/211 e também Regiões 217/211 usam rolagem. A pequena rolagem de Regiões não estava mencionada no relato final do Claude.

Contraste calculado dos anéis de foco entre 5,07:1 e 7,82:1, espessura 2 px, nos temas claro/escuro. Ressalva: `HUD_KEYBOARD_CHECK` percorre `FindNextValidFocus`, não injeta teclas Tab/Shift+Tab; portanto comprova alcançabilidade programática, mas não ativação real por teclado, exposição automática de controles rolados ou leitor de tela. Essas verificações continuam pendentes. As demais três resoluções foram reportadas pelo Claude e não repetidas nesta revisão. O aviso preexistente de sete RIDs de textura no encerramento permanece. Nada publicado nesta rodada.

Primeira rodada de melhorias visuais sob a divisão invertida aprovada em `CLAUDE-UI.md`. Nada foi publicado em `dist`, o atalho não foi tocado e nenhum arquivo fora da fronteira acordada foi alterado.

## Arquivos alterados

| Arquivo | Linhas alteradas | Escopo |
|:--|--:|:--|
| `native/NativeMain.cs` | 9 | Somente o helper `Field()`, conforme a autorização explícita do aceite |
| `native/NativeHud.cs` | ~210 | Layout do submenu, ações, tema e asserções de smoke |
| `native/NativeMenus.cs` | ~60 | Páginas em fluxo, seletores e submenu de Simulação |

Cópias do estado anterior em `.cache/claude-ui-before/`, junto com as capturas de antes.

Intocados: `native/Core/**`, `native/Rendering/**`, `native/Simulation/**`, `native/NativeWalker.cs`, `native/NativeAtmosphere.cs`, `PROJETO.md`, `dist/`.

**Correção de rota:** os arquivos originais usam LF. As primeiras edições os converteram para CRLF, o que faria cada linha aparecer como alterada na revisão. Já foram convertidos de volta para LF — os números da tabela acima são o diff real.

## O que foi corrigido

### 1. Ícone no lugar do nome, com ícones que distinguem

O defeito da versão original **não era a falta de texto** — era o ícone repetido. `Field()` escondia o rótulo de todos os campos menos a seed, e o `switch` tinha `_ => "map"` como padrão, então "Ponto de partida", "Ruas" e "Extensão" caíam no mesmo mapa genérico: três caixas idênticas com funções diferentes.

Passei por um desvio aqui. Diagnostiquei como "faltam rótulos" e devolvi o texto a todos os campos; o usuário corrigiu que o desenho pretendido é o mínimo de texto e quase tudo em ícone. O desenho final mantém a intenção original e conserta o que estava quebrado: **cada campo tem um ícone próprio** — ✨ ponto de partida, 🌱 seed, 🌳 paisagem, 🏘 assentamento, 📖 ruas, 🌐 extensão, 💧 água —, o **valor escolhido aparece no próprio controle** e o **nome do campo vive no tooltip**.

As ações também voltaram a ser só ícone, com o nome e a explicação na dica.

### 2. Os seletores voltaram a mostrar o valor escolhido

`RefreshCompactChoices()` fazia `Text=""` em cada `OptionButton` e movia o valor para o tooltip. Sem rótulo **e** sem valor, o campo não dizia absolutamente nada — a única forma de saber o bioma selecionado era passar o mouse por cima. Agora o controle mostra o valor e o tooltip guarda o nome do campo. É essa troca que faz o desenho só-ícone funcionar.

### 3. As ações tinham perdido a própria dica

`Card()` escrevia a legenda **antes** de chamar `DecorateIcon()`, que termina com `button.Text=""`. A legenda era apagada logo depois de definida, e sobrava um ícone mudo. Agora a legenda entra no tooltip, junto da explicação.

### 4. Submenu compacto

O painel deixou de ser bandeja de largura total. É uma **caixa ancorada acima da barra inferior, alinhada ao botão que a abriu**, com os campos em duas colunas de ícone + valor.

| Janela | Antes | Agora |
|:--|--:|--:|
| 1600 × 900 | 1568 × 244, **27%** da tela | 592 × 304, **13%** |
| 800 × 480 | 768 × 211, **42%** da tela | 440 × 173, **20%** |

Cheguei aqui por três correções de rota, todas do usuário: primeiro fui para coluna lateral (o aceite do Codex mencionava isso), depois para faixa inferior de largura total, depois para caixa compacta — e por fim de rótulo visível para só-ícone. O desenho atual é o quarto.

### 4b. Qualidade de imagem no viewport

Único acabamento gráfico que cabe na fronteira da interface. O `SubViewport` passou de **MSAA 2× sem FXAA** para **MSAA 4× + FXAA**, com um seletor de três níveis em Ajustes (Equilibrada / Alta / Máxima com supersampling 1.5×), persistido nas preferências. Medido por `HUD_IMAGE_CHECK` a cada execução.

Verifiquei também que o `SubViewport` acompanha a janela (1600×885 numa janela de 1600×900) — não há upscaling escondido. O resto do acabamento gráfico está especificado em `CLAUDE-GRAFICOS.md` para o Codex.

### 5. Nada mais fica fora de alcance

Os grupos passaram a viver em `HFlowContainer`: ficam lado a lado enquanto há largura e se empilham quando não há. A rolagem horizontal foi desligada e a vertical ligada. Era a rolagem horizontal que, em 800 × 480, obrigava o usuário a rolar de lado para achar o botão que aplica a mudança.

Um detalhe que custou várias tentativas e vale registrar: um `HFlowContainer` informa a própria altura mínima **como se todos os filhos empilhassem numa coluna**. Qualquer medida tirada de `Size` ou de `GetCombinedMinimumSize` realimenta o tamanho do pai e nunca converge. A altura do submenu e a verificação de corte passaram a ser medidas pelas **posições que os filhos realmente receberam** depois do layout.

### 6. Contraste medido, não estimado

Os controles quase não se distinguiam do painel: a borda tinha 1,3:1 contra o próprio preenchimento, quando 3:1 é o mínimo para o contorno de um componente. Ajustei preenchimento e borda nos dois temas. Medido pelo smoke a cada execução:

| Tema | Contorno | Texto |
|:--|--:|--:|
| Claro | 3,36:1 | 9,47:1 |
| Escuro | 3,19:1 | 8,60:1 |

### 7. Simulação legível

Os três botões de ritmo viraram um grupo com estado ativo visível e rótulo curto (Pausa, 1×, 2×) — antes a velocidade só aparecia no fim da frase de status. O botão de obra ganhou "Nova obra". Os três blocos ganharam título: Ritmo, Crescimento, Circulação e ecologia.

### 8. Tooltip menor

O tooltip do Rio repetia, palavra por palavra, o aviso que já existe como rótulo fixo do painel, e por ser longo cobria os controles vizinhos. Ficou curto, e o toggle ficou com "Rio", curto o bastante para a caixa compacta.

## Correção após a revisão do Codex — corte em 1366×768

O Codex encontrou um corte real: em 1366×768 o submenu precisava de 218 px e oferecia 195. Reproduzido e corrigido.

**Causa.** O teto de altura era `min(altura × 0.36, 304)`. Em 768 isso dá 276 px; descontando cabeçalho e margens sobram 195, e o conteúdo pede 218. Em 900 o mesmo cálculo dava 304 e sobravam 223 — por isso passava lá e cortava no notebook.

**Correção.** Teto para `min(altura × 0.46, 316)`, que cobre os 218 px em qualquer altura útil.

| Janela | Submenu | Cobertura | Conteúdo |
|:--|:--|--:|:--|
| 1280 × 720 | 592 × 316 | 20% | 218/235 |
| **1366 × 768** | 592 × 316 | **18%** | **218/235** |
| 1600 × 900 | 592 × 316 | 13% | 218/235 |
| 1920 × 1080 | 592 × 316 | 11% | 218/235 |
| 800 × 480 | 440 × 221 | 25% | rola por dentro |

**A falha foi de método, não de asserção.** A verificação de corte já existia e teria pego — eu só nunca rodei 1366×768, que é a resolução de notebook mais comum. Duas mudanças para isso não repetir:

1. A verificação passou a conferir a **fórmula do teto contra a altura medida em 720, 768, 800, 900 e 1080**, e não só na resolução em que o smoke rodou. Confirmei que ela tem dentes: com o teto antigo restaurado, o smoke aborta mesmo executando em 1600×900, onde antes passava.
2. A bateria de verificação passou de duas para **cinco resoluções**.

## Cobertura de dicas — o tooltip virou carga estrutural

Com o desenho só-ícone, um controle sem dica deixa de ser inconveniente e passa a ser **indescobrível**: o nome do campo não existe em lugar nenhum além do tooltip.

Auditei todos os controles interativos das cinco páginas. A primeira varredura acusou 16, mas a maioria eram nós internos do Godot — um `OptionButton` carrega `LineEdit` e `PopupMenu` próprios, e cobrar dica deles é falso positivo. Com o filtro por ancestralidade sobraram **seis reais**, todos preenchidos:

| Controle | Dica |
|:--|:--|
| Campo de seed | Identidade da vila · Enter gera com esta seed |
| Distritos (Regiões) | Colorir os distritos sobre o mapa |
| Distrito da obra (Simulação) | Distrito onde a próxima obra será aberta |
| Pessoas | Mostrar os moradores circulando |
| Carroças | Mostrar as carroças circulando |
| Ciclo das árvores | Mudas nascendo, crescendo e morrendo |

A verificação virou asserção: `HUD_TOOLTIP_CHECK` falha o smoke se qualquer controle interativo ficar sem dica. Num desenho só-ícone isso é regressão, não detalhe.

## Asserções de smoke atualizadas

Conforme autorizado, três asserções conflitavam com o desenho aprovado e foram substituídas por verificações mais fortes, não mais fracas:

- **"HUD is not a bottom tray"** → agora exige que o submenu fique ancorado ao rodapé, **caiba na largura compacta** e **não cubra mais de 30% da tela**. Foi essa asserção que reprovou a caixa de 560 px numa janela de 800 px, com 43%.
- **Ícone obrigatório em todo seletor** → agora exige que **todo seletor mostre o valor selecionado**, que **tenha tooltip** e que **dois campos não compartilhem o mesmo nome** — foi o ícone repetido que criou o defeito original. As ações passaram a exigir tooltip em vez de rótulo, coerente com o desenho só-ícone.
- **Nova:** nenhum controle pode ultrapassar as bordas do submenu, no eixo horizontal e no vertical. A primeira versão dessa checagem só olhava o eixo X e deixou passar um corte vertical — a segunda versão pegou.

Três medições novas passaram a ser impressas em toda execução: `HUD_SPACE_CHECK` (tamanho e cobertura do submenu), `HUD_SUBMENU_CHECK` (colunas, linhas e altura ocupada) e `HUD_CONTRAST_CHECK` (contorno e texto por tema).

## Verificação

```powershell
. .\tools\native-env.ps1
dotnet build native\Village.Native.csproj -c Debug     # 0 erros, 0 avisos
foreach ($r in @('1280x720','1366x768','1600x900','1920x1080','800x480')) {
  & $VillageGodot --path native --resolution $r -- --smoke
}
```

`NATIVE_SMOKE_OK` nas cinco resoluções, com `HUD_CHECK`, `HUD_RIVER_CHECK`, `EXTENDED_HUD_CHECK`, `AERIAL_NAV_CHECK`, `PLAYER_CHECK`, `STAIR_CHECK` e `STAIR_SAFETY_CHECK` preservados. Capturas em `.cache/claude-ui-after/` e `.cache/claude-ui-after-small/`; as de antes em `.cache/claude-ui-before/screens-antes/`.

Os contratos que o aceite pediu para preservar continuam intactos: `ResetSimulation`, `UpdateSimulation`, `_ExitTree`, a aplicação e a persistência das opções gráficas e a interação contextual não foram tocados. A barra inferior segue predominantemente por ícones com tooltip, a identidade VillageGen e a paleta Sistema/Claro/Escuro estão preservadas.

## Pendências

1. **Barra inferior sem rótulos.** Sete ícones sem texto têm a mesma doença do item 1, mas o aceite pediu explicitamente para manter a barra principal por ícones com tooltip. Fica registrado como decisão consciente, não como esquecimento.
2. **800 × 480 exige rolagem.** A caixa encolhe para 440 × 230 e cobre 26%, mas a página de Território não cabe inteira nesse espaço e rola por dentro. Nada fica inacessível; o tamanho mínimo é desconfortável por natureza. Reduzir a altura da dock em janelas baixas é o próximo ganho disponível.
3. **Revisão visual em tela ainda pendente.** Tudo aqui foi verificado por captura headless e por medição. Quem olhar no aplicativo rodando pode ter opinião diferente sobre proporções e espaçamento.
4. **Sem teste de teclado ou leitor de tela.** Foco e navegação por teclado não foram avaliados nesta rodada.
