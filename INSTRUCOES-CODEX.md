# Briefing para o Codex — Evolução do "Vilarejo"

> Documento de handoff/orquestração. Você (Codex) vai **continuar** este projeto.
> Leia as seções 0–3 antes de tocar em código. Depois execute as tarefas da seção 4,
> na ordem sugerida (seção 5), respeitando os critérios de aceite. Reporte ao usuário
> em **pt-BR**, com screenshots/inspeções visuais quando concluir cada tarefa.

---

## 0. O que é o projeto

**Vilarejo** é um gerador procedural de vilas medievais 2D. Web app **local, offline,
determinístico por seed**, renderizado em **Canvas 2D** (pixel art, grade de 16px).
Zero dependências, zero build (roda direto do código).

Fluxo: `generateVillage(seed, settings) -> VillageMap` (dado puro, serializável) →
`renderVillageToCanvas(map)` desenha tudo num canvas offscreen → a classe `VillageRenderer`
faz câmera/zoom/pan e blita esse mundo pré-renderizado.

### Mapa de arquivos (todos relevantes)

| Arquivo | Papel |
|---|---|
| `src/core/generator.js` | Coração da geração: terreno, biomas, praça, estradas, edifícios, decorações, rio, stats. |
| `src/core/pathfinding.js` | `findTerrainPath` — A* ponderado por terreno (água=11, mata=2.7, resto=1) + ruído "orgânico". |
| `src/core/random.js` | PRNG determinístico: `createRandom(seed)`, `coordinateHash`, `hashString`. **Toda** aleatoriedade sai daqui. |
| `src/core/validation.js` | Valida limites, sobreposição, construção em água, e conectividade porta→praça. |
| `src/core/index.js` | Barrel de exports (`DEFAULT_SETTINGS`, `BIOMES`, `generateVillage`, `terrainAt`, `validateVillage`, ...). |
| `src/render/atlas.js` | `TILE=16`, `TERRAIN_FILLS`, `SPRITES`, `fillKeyFor`, `pickIndex`. Coordenadas de sprite já medidas e verificadas. |
| `src/render/renderer.js` | Todo o desenho: terreno, estradas, praça, sombras, edifícios, decorações, hillshade, ambiente/vinheta, câmera, export PNG. |
| `src/app.js` | UI: formulário, métricas, legenda, atalhos, download. |
| `index.html`, `styles.css` | Shell da UI (pt-BR), tema escuro, seletor de bioma, toggle de rio, legenda. |
| `tests/generator.test.mjs` | Testes do core (determinismo, faixas, 300 seeds válidas, <500ms). |
| `assets/tiles/` | `ninja-village.png` (320×192) e `ninja-floor.png` (352×417) — pacote **Ninja Adventure, CC0**. |
| `PROJETO.md`, `assets/CREDITS.md` | Documentação. |

### Contrato do `VillageMap` (campos que já existem)

```
{ version, seed, width, height, settings, biome, biomeLabel,
  terrain[],          // string por tile: water|sand|grass|forest|dirt|snow|marsh
  elevation[],        // 0..1 por tile (JÁ usado no hillshade)
  moisture[],         // 0..1 por tile
  plaza: {x,y,width,height},
  roads: [{x,y}, ...],
  buildings: [{ id,type,x,y,width,height,door:{x,y},facing,variant,material }, ...],
  decorations: [{ type,x,y,variant }, ...],
  stats: { houses, services, roadTiles, trees, terrainCounts, generationMs },
  validation: { valid, errors[] } }
```

---

## 1. Regras invioláveis (não quebre nenhuma)

1. **Zero dependências externas** no runtime do app (sem npm install de libs de terceiros no
   caminho do navegador). Exceção: se for fazer o **Track B (WebGL/3D)** da Tarefa 1, isso
   **quebra** esta regra — trate como decisão explícita do usuário (ver Tarefa 1).
2. **Determinismo**: mesma `(seed, settings)` ⇒ mapa idêntico. Toda aleatoriedade vem de
   `createRandom`/`coordinateHash` semeados pela seed. Nunca use `Math.random`, `Date.now`, etc.
   na geração.
3. **Offline / self-contained**: nada de CDN, fonte remota, fetch externo. Só os assets locais.
4. **Pixel art**: `imageSmoothingEnabled = false`, grade base de 16px, `image-rendering: pixelated`.
5. **Fallback procedural**: se a arte (`ART.village`/`ART.floor`) não carregar, o desenho
   procedural precisa continuar funcionando (há `if (ART.floor)` / `if (ART.village)` guardando).
6. **Idioma da UI e docs: pt-BR.**
7. **O render é puramente visual** — não invente campos no `VillageMap` a partir do renderer;
   dados novos (altura, pontes, layout) nascem no **gerador** e o renderer só consome.
8. **Mantenha os testes verdes.** Se uma mudança altera invariantes, **atualize os testes**
   com intenção (documentando o porquê), não os apague.

---

## 2. Como rodar e como se autoverificar

### Rodar
- Servidor: `node server.mjs` → http://127.0.0.1:4173 (ou `INICIAR.cmd` no Windows).
- Testes: `node --test` (ou `npm.cmd test` — o sufixo `.cmd` é necessário nesta máquina porque
  a política do PowerShell bloqueia `npm.ps1`).
- Checagem de sintaxe: `node --check <arquivo>`.

### Verificação visual (IMPORTANTE — a aba do navegador aqui roda "hidden", então
`requestAnimationFrame` fica suspenso e a tela ao vivo pode não pintar). Use render **offscreen**:
no console do navegador (ou via ferramenta de browser), importe os módulos e renderize para um
canvas, exporte JPEG e inspecione. Exemplo que já funciona:

```js
const gen = await import('/src/core/index.js');
const rend = await import('/src/render/renderer.js');
await rend.loadArtAssets();
const v = gen.generateVillage('teste', { size: 72, biome: 'temperate' });
const world = rend.renderVillageToCanvas(v, { tileSize: 16 });
// crie um crop/contact-sheet e chame world.toDataURL('image/jpeg', 0.7) para inspecionar
```

### Inspecionar/medir os PNGs de arte (para posicionar sprites/tiles novos)
Pillow está disponível (`python -m pip install Pillow`). Técnica usada para mapear o atlas:
1. Ampliar a folha 6× com grade de 16px sobreposta e rótulos de coordenada (NEAREST) → ler tiles.
2. Amostrar a cor dominante + cobertura de cada tile (detecta preenchimentos "limpos" `#`).
3. Detectar caixas de sprite por componentes conexos de pixels opacos (cuidado: o topo da folha
   `ninja-village.png` é densamente empacotado e funde na segmentação — recorra a contact-sheet manual).

**Fatos já verificados (use-os):**
- `ninja-floor.png` = 352×417, grade 16px. Preenchimentos de terreno limpos e sem emenda já estão
  em `atlas.js:TERRAIN_FILLS` (grama, meadow/campo-seco, areia, terra, neve, água).
- `ninja-village.png` = 320×192. Sprites verificados em `atlas.js:SPRITES`: `cottage (256,96,64,64)`,
  `longhouse (192,96,64,80)`, `tree (64,96,32,48)`, `grove (0,144,64,48)`. Há mais casas, rochas/
  penhascos, tocos, barris e props no topo da folha, porém empacotados — meça com contact-sheet.

### Definition of done (toda tarefa)
- `node --test` verde (com testes novos/atualizados).
- Render offscreen inspecionado nos 4 biomas + 1 close-up, sem regressão visual.
- Sem erros no console do navegador.
- `renderVillageToCanvas(map)` mantém dimensões `width*16 × height*16` (export PNG intacto).

---

## 3. Estado visual atual (ponto de partida)

Já implementado (2 iterações):
- **Terreno com texturas reais** de `ninja-floor.png` + 7 tipos + 4 biomas.
- **Edifícios** com material (sapê/telha/madeira/pedra), variação por instância, serviços
  distintos (capela/mercado/moinho/torre/ferraria/hospedaria), + sprites reais para town-hall e
  parte das casas.
- **Passe 2.5D atual** em `renderer.js`: hillshade por elevação, **sombras longas** projetadas
  NO→SE (unificadas numa camada), faces de telhado/parede com duas tonalidades, oclusão de contato,
  tom ambiente por bioma + vinheta.

**Limitação que o usuário quer resolver:** os prédios ainda são **fachadas planas** (billboard).
As sombras dão a impressão de 2.5D, mas a geometria não é volumétrica. É isso que a Tarefa 1 ataca.

---

## 4. Tarefas

> Cada tarefa: **Objetivo → Abordagem → Onde mexer → Algoritmo → Critérios de aceite → Testes → Armadilhas.**

### Tarefa 1 — 2.5D de verdade (volume real), texturas convincentes

**Objetivo.** Que o vilarejo leia como um **relevo/diorama 3D**: terreno com altura (planaltos,
vales, margens), e edifícios como **volumes extrudados** (topo + paredes visíveis), não fachadas.

Há dois caminhos. **Comece pelo Track A** (mantém as restrições). Só faça o Track B se o usuário
confirmar que aceita uma dependência 3D.

#### Track A (recomendado) — Campo de altura + extrusão em Canvas 2D ("2.5D oblíquo")

Ideia: manter tiles quadrados top-down, mas **elevar** cada coisa na tela por sua altura, em pixels,
e desenhar as **faces laterais** (paredes/penhascos) que ficam expostas. Isso cria volume real.

1. **Campo de altura do terreno.** Discretize `elevation` em níveis (ex.: `LEVELS=5`, `STEP=4px`).
   - `heightLevel(x,y) = water ? 0 : 1 + floor(clamp((e - waterLine)/(1 - waterLine),0,1) * (LEVELS-1))`.
   - Guarde `waterLine` no mapa (o gerador já calcula em `makeTerrain`; exponha em `map.stats` ou
     `map.waterLine`). Alternativamente recompute o nível no renderer a partir de `elevation` com um
     limiar fixo — mas o ideal é o gerador expor `map.heightLevel[]` (array por tile), determinístico.
   - **Decisão de arquitetura:** adicione `map.heightLevel[]` no **gerador** (Regra 7), calculado
     junto de `elevation` em `makeTerrain` (`generator.js`).
2. **Projeção.** Ao desenhar o tile `(x,y)` de nível `L`, desenhe o **topo** em
   `screenY = y*TILE - L*STEP` (sobe na tela); `x` inalterado.
3. **Faces laterais (penhascos).** Para cada tile, olhe os vizinhos **sul** e **leste**. Se o nível
   do vizinho for menor, desenhe um retângulo vertical de altura `(L - Lviz)*STEP` logo abaixo/à
   direita do topo, com textura de "corte" (terra/rocha escurecida — reuse `TERRAIN_FILLS.dirt`
   com overlay escuro, ou meça um tile de rocha em `ninja-village.png`). Aplique gradiente de AO
   (mais escuro embaixo). Isso gera os degraus/planaltos.
4. **Ordem de desenho.** Terreno de cima para baixo (`y` crescente) e esquerda→direita garante que
   faces à frente cubram corretamente. Objetos continuam no passe ordenado por `y` (já existe).
5. **Água e margem.** Água fica no nível 0. Onde a terra vizinha é mais alta, desenhe a face de
   **barranco** + uma linha de espuma/molhado no contato (litoral). Dá profundidade real ao rio/lago.
6. **Edifícios extrudados.** Em `drawBuilding`/`drawSpriteBuilding`, eleve pelo nível do terreno do
   footprint e desenhe como **prisma**: (a) face lateral **leste** (parede em paralelogramo, tom
   escuro), (b) face **frontal** (parede), (c) **topo** (telhado com as duas tonalidades já
   existentes). Para sprites, componha uma parede lateral procedural atrás do sprite para dar
   espessura, ou troque casas por um desenho procedural volumétrico consistente.
7. **Sombras.** Mantenha o passe atual (`shadowPoly`), mas projete a partir da **base elevada**
   (some `L*STEP`). Sombra cai no terreno vizinho (pode cair "degrau abaixo").
8. **Iluminação/textura convincente.** Reforce: face NO clara, SE escura (já há base disso); AO nos
   vales (escurecer níveis baixos levemente); realce nas cristas. Para "realismo" de textura sem
   trocar o pacote, uma opção é gerar variação de brilho por ruído coerente no topo dos tiles.

> **Landing incremental:** dá para entregar em partes — (7.1) `heightLevel` no gerador; (7.2)
> extrusão só dos **edifícios** (maior impacto, menor risco); (7.3) terraços do terreno; (7.4)
> margens de água. Faça e verifique visualmente a cada parte.

#### Track B (opcional, "3D real") — WebGL

- Renderizar um **heightmap mesh** (plano subdividido, deslocado pela `elevation`) + prédios como
  caixas/instâncias, texturizando com os tiles do atlas como material. Câmera orbital leve.
- **Custo/decisão:** isso **quebra a Regra 1** (ex.: `three.js`) e é uma reescrita grande do render;
  o gerador (`src/core`) permanece intacto e vira a fonte do heightmap/entidades. **Só avance com
  aprovação explícita do usuário.** Se aprovado: isole em `src/render3d/` e mantenha o render 2D
  como fallback/alternativa (toggle na UI).

**Critérios de aceite (Track A).** Prédios com pelo menos duas faces visíveis (topo + lateral) e
"altura" perceptível; terreno com degraus onde a elevação muda; margens de água com barranco;
sombras coerentes com a base elevada; sem serrilhado/borrão; nitidez pixel-art preservada.

**Testes.** É render (não coberto por `node --test`) — verificação é **visual** (offscreen, 4 biomas
+ close-up). Mantenha `renderVillageToCanvas` retornando `width*16 × height*16`. Se expuser
`map.heightLevel[]`, adicione teste de determinismo (dois generates iguais ⇒ arrays iguais) e de
que `heightLevel.length === width*height`.

**Armadilhas.** (a) O canvas do mundo tem margem 0 hoje; ao elevar tiles no topo (`y-L*STEP`), o
conteúdo pode sair do topo do canvas — aumente a altura do canvas em `LEVELS*STEP` e desloque tudo
para baixo por esse offset, senão o export corta o topo. (b) Reordene bem o desenho para não ter
face lateral cobrindo o topo do tile de trás. (c) Sombras não devem escurecer por empilhamento —
o passe atual já resolve isso desenhando numa camada e compondo uma vez.

---

### Tarefa 2 — Estradas sobre rios viram pontes

**Objetivo.** Todo tile de estrada que fica **sobre água** deve renderizar como **ponte de madeira**
(deck + guarda-corpo + sombra na água), com orientação correta.

**Onde mexer.** `generator.js` (marcar), `renderer.js` (desenhar), `atlas.js` (opcional: sprite de
ponte se medir um na folha).

**Abordagem.**
1. **Gerador.** O A* (`findTerrainPath`) já permite estrada cruzar água (custo alto, mas passável),
   e `carveRiver` cria água atravessando. Depois de montar `roadSet` e antes de exportar, marque
   cada tile de estrada cujo `terrain[idx] === 'water'` como ponte. Guarde no dado:
   - opção simples: em cada item de `map.roads`, adicione `bridge: true`;
   - e/ou um `Set`/array `map.bridges = [{x,y,orientation}]` com orientação derivada dos vizinhos de
     estrada (`ns` se há estrada em N e S; `ew` se em L e O; default `ew`).
   - **Não** troque o terreno para não-água embaixo da ponte (a água deve aparecer sob ela).
2. **Renderer.** Em `drawRoadTile` (ou um `drawBridgeTile`), se o tile é ponte: em vez do
   preenchimento de terra, desenhe **água** (fill de `TERRAIN_FILLS.water`) e por cima o deck:
   pranchas de madeira (tom `#8a6a3c`/`#6a4d2c`) na direção da travessia, guarda-corpo nas laterais,
   e uma faixa de sombra da ponte projetada na água (coerente com a luz NO→SE).
3. **Continuidade:** trate as bordas da ponte (rampas) onde ela encontra a terra, para não "flutuar".

**Critérios de aceite.** Com `rivers: true`, nenhuma estrada aparece como "terra sobre água"; todo
cruzamento vira ponte visível e orientada; a água aparece sob a ponte; conectividade porta→praça
continua válida.

**Testes.** Adicione: gerar com `{ rivers:true }` em várias seeds e assert que **todo** tile de
estrada sobre `terrain==='water'` tem `bridge` marcado, e que `map.validation.valid === true`.
(Os testes padrão usam `rivers:false`, então não quebram.)

**Armadilhas.** Rivers hoje é **default `false`**. Não ligue por padrão (mudaria os testes de 300
seeds). A orientação da ponte precisa dos 4 vizinhos de estrada — reutilize a lógica `n/s/w/e` que
`drawRoadTile` já calcula.

---

### Tarefa 3 — Opção de ruas em grade (quadras), não só radiais/diagonais

**Objetivo.** Um `layout` alternativo em **grade ortogonal** (quadras retangulares) para parecer um
povoado/cidade planejada, além do atual radial-orgânico.

**Onde mexer.** `generator.js` (novo gerador de vias + setting), `index.html`/`app.js`/`styles.css`
(controle na UI), `core/index.js` (se expuser constantes).

**Abordagem.**
1. **Setting.** Adicione `layout: "organic" | "grid"` em `DEFAULT_SETTINGS` e `normalizeSettings`
   (default `"organic"` para não mexer nos testes atuais).
2. **Gerador de grade.** Quando `layout === "grid"`: em vez dos ramais radiais
   (`branchCount` spokes), gere ruas retas:
   - Defina um espaçamento de quadra `block` (ex.: `rng.pick([6,7,8])`).
   - Trace ruas **verticais** em `x = centerX + k*block` e **horizontais** em `y = centerY + k*block`,
     cobrindo um distrito central (ex.: raio ~ `width*0.32`). Cada rua é uma linha reta de tiles.
   - Pule/rompa segmentos que caem em água (ou marque como ponte — integra com a Tarefa 2).
   - Conecte a grade às bordas do mapa (2–3 vias arteriais retas) para manter a entrada/saída.
   - Junte tudo no `roadSet`. A praça continua no centro (encaixe-a numa interseção da grade).
3. **Edifícios.** `placeBuildings` já encaixa lotes adjacentes a **qualquer** tile de estrada com
   `facing` — funciona para grade sem mudança. As casas vão se alinhar às quadras naturalmente.
4. **UI.** `<select id="layout-input">` (Radial/Orgânico vs. Grade/Quadras); ligue em
   `settingsFromForm` e regenerar no `change` (como já feito para bioma).

**Critérios de aceite.** Com `layout:"grid"`, as ruas são predominantemente ortogonais formando
quadras; casas alinhadas às ruas; `validation.valid === true`; determinismo mantido. Com
`layout:"organic"`, comportamento idêntico ao atual.

**Testes.** Novo teste: `{layout:"grid"}` determinístico e válido em N seeds; e que a proporção de
segmentos de estrada retos (mesma linha/coluna contígua) é maior do que no organic (heurística
simples). Não altere os testes existentes (default continua organic).

**Armadilhas.** Garanta conectividade (a grade precisa tocar a praça e as bordas) — rode o
validador. Evite ruas em cima de água sem ponte. Cuide para ainda atingir 25–40 casas no default de
tamanho (senão o recovery dispara).

---

### Tarefa 4 — Opção de menos / mais prédios

**Objetivo.** Controle explícito da densidade populacional: **povoado pequeno ↔ vila ↔ cidade**.

**Onde mexer.** `generator.js` (alvo de casas/serviços), UI, e **testes** (as faixas 25–40).

**Abordagem.**
1. **Setting.** Adicione `settlement: "hamlet" | "village" | "town"` (ou um número
   `houseTarget`). Default = `"village"` (25–40) para preservar os testes atuais.
2. **Alvo de casas.** Onde hoje há:
   ```js
   const targetHouses = Math.max(25, Math.min(40, Math.round(rng.int(28,36) * density)));
   ```
   substitua a faixa por uma dependente do `settlement`:
   - hamlet: ~10–18; village: 25–40 (atual); town: ~55–85 (e considere aumentar `size` mínimo).
   - Mantenha a interação com `density` como multiplicador fino.
3. **Serviços.** Escale os serviços extras com o tamanho (hamlet: só 1–2 serviços; town: todos).
   `EXTRA_SERVICES`/`extraCount` já existem — ajuste `extraCount` por `settlement`.
4. **Recovery.** O laço de recuperação (spokes extras + regenerar halo) já garante lotes; confirme
   que ainda alcança o alvo em `town` (mapas maiores ajudam).
5. **UI.** `<select id="settlement-input">` com as 3 opções; ligar em `settingsFromForm`.

**Critérios de aceite.** Cada tamanho gera consistentemente na sua faixa de casas; todos válidos e
determinísticos; default inalterado.

**Testes.** **Atualize** os asserts `houses >= 25 && <= 40` para respeitar o `settlement` (o default
segue 25–40). Adicione testes por tamanho: hamlet dentro da faixa pequena, town dentro da grande,
todos `valid`. Rode o teste de 300 seeds (usa default) — deve continuar verde.

**Armadilhas.** `town` com muitas casas pode estourar 500ms de geração (há teste de teto). Se
necessário, otimize `placeBuildings` (hoje varre candidatos com `splice` O(n) — considere índice) ou
suba o teto do teto **apenas para `town`** (documente). Não deixe o default mais lento.

---

### Tarefa 5 — Nada pode se sobrepor

**Objetivo.** Eliminar sobreposição **visual** entre objetos. Hoje não há sobreposição de células
lógicas entre edifícios (via `canPlace`, que reserva 1 tile de borda) nem de decorações em células
ocupadas (via `blocked`), **mas** sprites/telhados "transbordam" o footprint e encostam nos vizinhos;
árvores (~2 tiles) invadem células vizinhas.

**Onde mexer.** `generator.js` (folgas/espaçamento no `blocked`/`occupied` e na colocação de decos),
`renderer.js` (reduzir transbordo dos sprites, se preciso).

**Abordagem.**
1. **Folga ao redor de edifícios para decorações.** Ao montar `blocked` em `makeDecorations`,
   adicione o footprint dos edifícios **+ 1 tile de margem** (não só as células do prédio). Assim
   nenhuma deco nasce colada num prédio.
2. **Espaçamento mínimo entre decorações grandes.** Ao colocar `tree`/`grove` (e outras "altas"),
   marque um raio (ex.: 3×3) como `blocked` para não formarem cachos que se fundem.
3. **Transbordo dos sprites.** Em `renderer.js`, os sprites hoje são desenhados com overhang
   (ex.: árvore `drawImage(... px-8, py-28 ...)`, edifícios `dx = ... dy = y + h - dh + 4`). Reduza o
   overhang para caber dentro do footprint + margem reservada, OU aumente a margem reservada no
   gerador para bater com o desenho. **Regra prática:** a margem lógica reservada deve ser ≥ ao
   transbordo visual em tiles.
4. **Ordem de profundidade.** O passe já ordena por `y + height`; garanta que objetos mais à frente
   (maior `y`) desenhem por cima — assim, mesmo encostando, a oclusão fica correta.
5. **Praça e vias.** Decos e prédios já evitam `roadSet`/plaza; mantenha.

**Critérios de aceite.** Em inspeção visual (close-up denso), nenhum prédio invade o telhado/parede
de outro; árvores não se fundem umas nas outras nem cobrem portas; tudo "assenta" com respiro. Casas
ainda dentro de 25–40 no default (a folga extra reduz capacidade — verifique).

**Testes.** Mantenha o invariante existente ("decoração não cai em célula ocupada"). Adicione um
teste mais forte: para todo par (edifício, decoração), a decoração não está dentro do footprint do
edifício **nem na margem de 1 tile**. Opcional: nenhuma árvore a distância Chebyshev < 2 de outra
árvore. Rode 300 seeds (deve seguir válido e 25–40 casas).

**Armadilhas.** Mais folga = menos lotes ⇒ o recovery pode disparar mais; confirme que ainda atinge
25–40. Se ficar apertado, aumente levemente o `size` default ou o número de tentativas, não relaxe a
folga.

---

## 5. Ordem sugerida de execução

1. **Tarefa 5 (não sobrepor)** — barato, melhora tudo e limpa a base antes das mudanças visuais.
2. **Tarefa 2 (pontes)** — pequena, independente, e prepara a Tarefa 3 (grade sobre água).
3. **Tarefa 4 (menos/mais prédios)** — setting + faixas + testes; baixo risco.
4. **Tarefa 3 (ruas em grade)** — média; usa pontes da Tarefa 2.
5. **Tarefa 1 (2.5D/3D)** — maior; faça incremental (edifícios → terreno → água). Deixe por último
   para não retrabalhar geometria enquanto o resto muda.

Faça **um commit por tarefa** (ou por sub-etapa da Tarefa 1), com `node --test` verde e verificação
visual antes de seguir.

---

## 6. Checklist final (antes de entregar ao usuário)

- [ ] `node --test` verde (testes atualizados/novos incluídos).
- [ ] Verificação visual offscreen nos 4 biomas + close-up para cada tarefa concluída.
- [ ] Sem erros no console do navegador.
- [ ] Export PNG mantém `width*16 × height*16` (Tarefa 1: lembre do offset de altura no canvas).
- [ ] Determinismo preservado (dois generates iguais ⇒ mapas idênticos).
- [ ] Zero dependências novas (a menos que o usuário tenha aprovado o Track B).
- [ ] `PROJETO.md` e `assets/CREDITS.md` atualizados com o que mudou.
- [ ] Relatório final ao usuário em pt-BR, com imagens de antes/depois e as ressalvas honestas
      (ex.: "seeds antigas renderizam diferente", limitações do Track A vs. 3D real).

---

## 7. Notas de contexto úteis (economizam tempo)

- **`addPlaza` força "grass"** nas células da praça+margem (um teste depende disso). Não remova.
- **`canPlace` só bloqueia água** para edifícios (além de estrada/plaza/sobreposição). Tipos novos
  de terreno (areia/terra/neve/pântano) são construíveis — mantenha essa premissa coerente com 3D.
- **Recovery de lotes** (`generator.js`, quando casas < alvo): adiciona 4 spokes e regenera um "halo"
  para `biome.ground`, depois recoloca com um RNG derivado (`|lots|retry`). Determinístico.
- **Serviços**: `CORE_SERVICES` (4 fixos) + `EXTRA_SERVICES` (0–3 por tamanho). `stats.services`
  hoje varia 4–8 (os testes já usam faixa, não igualdade).
- **Sombra sem empilhamento**: `renderVillageToCanvas` desenha todas as sombras numa camada própria
  e compõe **uma vez** com `globalAlpha`. Preserve esse padrão ao mexer em sombras/3D.
- **Hillshade** usa `map.elevation` e o gradiente com vizinhos (luz NO). A Tarefa 1 reaproveita a
  mesma direção de luz (NO→SE) para consistência.
- **Métricas/legenda** na UI leem `map.stats.terrainCounts`, `map.biomeLabel`, `map.stats.houses/
  services/trees`. Se criar terrenos/estruturas novas, alimente esses campos para a UI refletir.
