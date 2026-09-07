# Prompt para o Codex — acabamento gráfico sem texturas

Documento pronto para ser passado ao Codex. Objetivo do usuário: **empurrar o VillageGen até o limite do que o Godot dá, sem criar textura nenhuma**, e sem que as duas frentes de trabalho se atropelem.

---

## Fato verificado, e é o que muda tudo

Rodei uma sonda no próprio Godot 4.7.2 deste projeto, habilitando cada efeito e observando a resposta do motor. O resultado:

```
Vulkan 1.3.260 - Forward Mobile - AMD Radeon(TM) Vega 8
WARNING: Screen-space ambient occlusion (SSAO) is only available
         when using the Forward+ or Compatibility renderers.
```

**A oclusão de contato que o usuário pediu não existe no renderizador atual.** `native/project.godot:20` está em `rendering_method="mobile"`. Não é ajuste de parâmetro: o motor recusa o efeito e avisa. Trocar para `forward_plus` é a primeira decisão, e ela é do Codex, porque muda o custo de GPU e a publicação.

Observação de método: uma sonda que só compara pixels **não serve** aqui — a `ReflectionProbe` do `VillageScene` termina de assar entre um quadro e outro e altera quase a tela inteira, dando falso positivo para qualquer efeito. O aviso do motor é a evidência confiável.

---

## Qual é o teto real sem textura

"PS2 no máximo" subestima. PS2 tinha textura e iluminação pobre; este projeto é o contrário — não tem textura, mas pode ter iluminação moderna. São eixos diferentes.

A referência honesta para geometria limpa com cor por vértice e boa luz é **Monument Valley, Townscaper, Islanders**: jogos atuais, não PS2. O que falta para PS3 é detalhe de superfície, e é justamente isso que dá para **gerar por shader**, sem arquivo de textura.

O alvo realista: **low-poly estilizado moderno** — acima de PS3 em iluminação, abaixo em detalhe de superfície.

---

## Trabalho proposto, em ordem

### Etapa 1 — sem trocar o renderizador
`native/NativeMain.cs:122-123`

1. `ambient_light_source` = Sky em vez de Color com energia 0.3. Superfície fosca com ambiente chapado é o que faz a cena parecer papel.
2. `tonemap_mode` = ACES ou AgX no lugar de Filmic, com `tonemap_exposure` ajustada.
3. `glow_enabled` com `glow_bloom` discreto.
4. `fog_enabled` com `fog_aerial_perspective`, para o horizonte deixar de ser um anel de cor chapada.
5. Sombras: a luz direcional usa os padrões. Ajustar `directional_shadow_mode` para 4 cascatas, `directional_shadow_blend_splits`, `directional_shadow_max_distance` e o bias.
6. `adjustment_enabled` com saturação e contraste, como correção de cor final.

### Etapa 2 — depois de trocar para `forward_plus`

7. **`ssao_enabled`** — o pedido do usuário. Sombra de contato entre casa e chão, entre tronco e grama. É o item que mais muda a percepção de volume.
8. `ssil_enabled` — luz rebatida; tira o aspecto de objeto recortado e colado.
9. `ssr_enabled` na água e `volumetric_fog_enabled` para raios de luz.
10. `CameraAttributesPractical` com `dof_blur_far_enabled` — o desfoque de profundidade dá o efeito tilt-shift de maquete, que numa câmera isométrica de cidade rende muito.
11. Medir FPS antes e depois nas três escalas de mapa e manter o nível "Econômico" funcionando. O aparelho de teste é uma Radeon Vega 8 integrada; não presumir folga.

### Etapa 3 — detalhe de superfície por shader, ainda sem textura
`native/Rendering/VillageScene.cs`

Aqui é onde a ausência de textura deixa de ser limitação:

12. **AO por vértice assado na geração.** A geometria é procedural — dá para escurecer vértices em cantos, pé de parede, junção de rua e base de muro no momento em que a malha é criada. Custa zero em tempo de execução e **funciona até no renderizador Mobile**.
13. **Ruído triplanar em shader** para quebrar a chapa de cor, com escala diferente por material.
14. **Normal procedural**: fiada de telha, curso de pedra e veio de madeira calculados matematicamente no shader, sem arquivo.
15. **Escurecimento de cavidade e desgaste de aresta**, derivados da normal e da altura.
16. **Água com onda, refração e espuma na margem**, em vez da superfície translúcida atual.
17. **Vento na folhagem** por deslocamento de vértice.
18. Variar `roughness` espacialmente. **Correção de um erro meu:** eu havia dito que era `Roughness=1` em tudo. Isso vale para `VillageScene.Material()`, usado em terreno, água e overlay — os edifícios já têm materiais PBR nomeados com `roughness` 0.72 no GLB, e o shader de detalhe usa 0.76 ou 0.93 por tipo. O que falta é variação **dentro** da superfície, não um valor por material.

Os itens 12 a 18 não dependem da troca de renderizador e não criam nenhum asset.

---

## O que já está feito, para não refazer

Dentro da fronteira de interface, o Claude já entregou:

- `SubViewport` de **MSAA 2× sem FXAA** para **MSAA 4× + FXAA**.
- Seletor **Qualidade de imagem** em Ajustes, três níveis, o mais alto com supersampling 1.5×, persistido nas preferências.
- Medição `HUD_IMAGE_CHECK` a cada execução do smoke e asserção que impede desligar o antisserrilhado por acidente.
- Verificado que o `SubViewport` acompanha a janela (1600×885 em janela de 1600×900) — não há upscaling escondido.

**Arquivos tocados pelo Claude:** `NativeHud.cs`, `NativeMain.cs` (só o helper `Field()`), `NativeMenus.cs`.

---

## Pessoas e veículos

O usuário foi direto: *"atualmente é um cilindro andando pela cidade"*. Ele tem razão, e a culpa é do Claude — foi o que saiu na rodada de simulação, antes de a simulação passar para o Codex.

**Arquivos:** `native/Simulation/SimulationVisuals.cs` e o `SyncAgents` de `native/Simulation/VillageSimulation.cs`.

### Hoje
Pessoa = uma `CapsuleMesh` r 0.12 × h 0.62 por agente num MultiMesh. Carroça = `BoxMesh` 0.46 × 0.34 × 0.78 e duas rodas. Sem membros, sem animação.

### Proposta: figura articulada por partes

Um `MultiMeshInstance3D` por parte, todos com o mesmo número de instâncias, indexados pelo mesmo agente:

| Parte | Malha | Nota |
|:--|:--|:--|
| Cabeça | esfera r ≈ 0.09 | tom de pele |
| Tronco | caixa 0.22 × 0.30 × 0.14 | cor da roupa, varia por agente |
| Braços (2) | caixa 0.07 × 0.26 × 0.07 | balanço oposto à perna do mesmo lado |
| Pernas (2) | caixa 0.08 × 0.30 × 0.08 | balanço alternado |

Seis MultiMesh com poucas dezenas de instâncias cada — irrelevante perto dos 160 edifícios já instanciados.

**Animação sem esqueleto.** O modelo já expõe tudo: `Agent.LegProgress` vai de 0 a 1 dentro de cada trecho, `Agent.Speed` dá a cadência e `Agent.Heading` a orientação. Com `φ = LegProgress · 2π · passosPorTrecho`:

- perna direita: rotação em X de `sin(φ) · 0.5 rad`; esquerda `sin(φ + π) · 0.5`
- braços: o oposto do lado correspondente, amplitude `0.35 rad`
- tronco: sobe-desce de `|sin(φ)| · 0.02 m`
- agente parado (`WaitSteps > 0`): φ congelado

Tudo derivado do estado do agente, que já é determinístico — sem estado próprio e sem depender de tempo real.

**Alternativa em sprite**, estilo SimCity 2000: billboard com atlas de 4 a 8 quadros por direção, trocando pelo mesmo φ. Mais barato e com sabor retrô, mas exige arte nova e mistura sprite com o 3D. Só vale se o usuário preferir a estética.

**Carroça:** caixote com laterais inclinadas, varal na frente e rodas girando por φ. Sem física de roda.

**Cuidados:** manter o contrato de `IVillageSimulation`, manter o prefixo `Sim_` nos nós, e o smoke `res://Simulation/SimulationSmoke.tscn` deve continuar passando. Os agentes são decorativos e não têm colisão — não precisam passar a ter.

---

## Texturas estilo .kkrieger — sim, e já está começado

O pedido do usuário: gerar textura por procedimento, como o .kkrieger fazia em 96 KB, em vez de criar arquivos de arte.

### Fatos verificados neste projeto

Li os 180 GLB direto do container glTF e o shader existente. Três achados que mudam o plano:

1. **Já existe um shader procedural de detalhe.** `Rendering/VillageDetails.cs:80` define `DetailShader`, e `RefineMaterial` despacha por **nome do material** para quatro receitas: tábua e viga (`kind 2`), pedra e tijolo (`kind 3`), telha e ardósia (`kind 4`), reboco e cal (`kind 0`). Ele já projeta por posição local escolhendo o plano pela normal, já desenha junta de argamassa com fiada alternada e antisserrilhado por `fwidth`, e já modula `ALBEDO` e `ROUGHNESS`. **Não comece do zero: estenda isto.**

2. **Os UV dos modelos não servem.** Todos os 180 GLB declaram `TEXCOORD_0`, mas os dados são degenerados — no `temperate-cottage-0` são 72 valores distintos para 216 vértices, e alguns primitivos nem têm o atributo. Ou seja: **textura mapeada por UV vai falhar**. A projeção triplanar por posição local que o shader já usa é a abordagem certa e precisa continuar.

3. **A arte já diz o que cada superfície é.** Cada edifício traz de 9 a 12 materiais PBR nomeados: `Foundation stone`, `Ivory plaster`, `Clay tiles`, `Dark beams`, `Door oak`, `Warm brass`. É a metade difícil de um sistema procedural — saber que superfície é qual — e está pronta.

### O que falta para virar textura de verdade

O shader atual altera **cor e rugosidade**. O que dá aparência de textura é **relevo**, e é isso que falta:

19. **Normal procedural.** Derivar um campo de altura `h(p)` do mesmo padrão que já desenha a junta e perturbar `NORMAL` com `dFdx`/`dFdy` no fragmento. Sem arquivo, sem UV, sem tangente — e é o item de maior efeito da lista inteira. Telha ganha ressalto, pedra ganha profundidade de junta, tábua ganha veio.
20. **Ruído fbm** de 3 a 4 oitavas sobre o `hash` que já existe, para manchado de escala maior. Hoje o ruído é de uma oitava só, na escala do pixel.
21. **Escurecimento de cavidade** nas juntas, derivado do mesmo `joint` já calculado.
22. **Rugosidade espacial**: pedra mais lisa no topo e áspera na junta; madeira variando com o veio.
23. **Variação por instância**: passar um deslocamento por edifício e deslocar o padrão, para casas do mesmo modelo não repetirem a mesma pedra.
24. **Estender ao terreno e às vias**, que hoje usam material chapado — é a maior área de tela do jogo.

### Shader por pixel ou textura assada?

Duas rotas, e a escolha é de desempenho:

- **Por pixel** (o que existe hoje): zero memória, custo de ALU a cada quadro. Simples e já funciona.
- **Assada no carregamento**, ao estilo .kkrieger: gerar uma vez em `Image`/`ImageTexture` — albedo, normal e rugosidade por receita — e amostrar com `uv1_triplanar`. Custa memória e uns poucos centésimos de segundo na carga, mas troca fbm por pixel por uma amostragem.

Para o aparelho de teste, uma **Radeon Vega 8 integrada**, a rota assada tende a ser mais segura assim que o ruído passar de uma ou duas oitavas. Sugiro medir as duas com o mesmo `--smoke` antes de escolher, e manter o nível "Econômico" ligando a versão mais barata.

Nenhuma das duas cria arquivo de arte nem toca no catálogo — continua valendo a restrição de não fazer textura à mão.

---

## Divisão para trabalho em paralelo

| Frente | Dono | Arquivos |
|:--|:--|:--|
| Qualidade de imagem do viewport | Claude — **feito** | `NativeHud.cs`, `NativeMenus.cs` |
| Renderizador, ambiente, sol, névoa, DOF | **Codex** | `project.godot`, `NativeMain.cs` |
| Materiais, shaders procedurais, AO por vértice | **Codex** | `Rendering/VillageScene.cs`, `Rendering/VillageDetails.cs` |
| Pessoas e carroças | **Codex** | `Simulation/SimulationVisuals.cs`, `Simulation/VillageSimulation.cs` |
| Interface e submenus | Claude | `NativeHud.cs`, `NativeMenus.cs` |

Nenhum arquivo aparece em duas linhas com donos diferentes, então as frentes podem correr ao mesmo tempo.

## Como verificar

O smoke do projeto já serve: `& $VillageGodot --path native --resolution 1600x900 -- --smoke`, com `VILLAGE_SMOKE_DIR` apontando para uma pasta em `.cache/`. Ele grava capturas dos quatro biomas e imprime `NATIVE_SMOKE_OK`. Para esta frente vale acrescentar medição de FPS antes e depois, já que o alvo é uma integrada Vega 8. Não publicar em `dist` antes da revisão conjunta.
