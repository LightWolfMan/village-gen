# Vilarejo II — gerador procedural isométrico

## Estado atual

Esta é uma reescrita integral da aplicação. A versão em uso não importa módulos, assets, modos de câmera ou contratos do protótipo top-down anterior. O produto atual gera assentamentos 2.5D isométricos determinísticos, roda localmente no navegador e não possui dependências de execução além do Node.js usado pelo servidor estático.

O gerador oferece quatro biomas (campo temperado, sertão árido, planalto nevado e pântano), dois traçados (orgânico e quadras ortogonais), três escalas de assentamento e mapas de 72, 96 ou 128 tiles. Cidades usam 128 tiles automaticamente. Relevo, água, rios opcionais, estradas, pontes, praça, lotes, casas, serviços e objetos de cenário são derivados da seed.

Todo assentamento possui cinco distritos funcionais delimitados: residencial, mercantil, oficinas, cívico e rural. “Oficinas” representa a produção medieval de ferraria, moinho e artesanato; moradias mistas podem existir nos bairros mercantis e artesanais. O overlay de zonas pode ser ligado na interface sem alterar o mapa gerado. A arquitetura varia por bioma, função, zona e escala, com famílias como cottage, townhouse, oficina, edifício cívico, fazenda, solar, torre, pátio de adobe, chalé, palafita e casa longa.

## Execução

No Windows, dê dois cliques em `INICIAR.cmd`. Para iniciar manualmente, abra o PowerShell nesta pasta e execute:

```powershell
npm start
```

Depois acesse `http://127.0.0.1:4173`. A aplicação funciona offline; nenhum CDN, fonte remota ou chamada de rede é necessário.

Os comandos de verificação são:

```powershell
npm test
npm run check
```

## Arquitetura

`src/core` é determinístico e independente do DOM. Sua API pública principal é `generateVillage(seed, settings)`, que devolve um `VillageMap` serializável. `random.js` contém o PRNG e hashes estáveis; `pathfinding.js` resolve rotas ponderadas; `generator.js` constrói terreno, vias, zoneamento, lotes, edifícios e props; `validation.js` verifica limites, colisões, água, portas, zonas e conectividade.

`src/render/renderer.js` recebe somente o modelo serializável. A projeção padrão usa tiles 32×16 e degraus verticais de 6 pixels. O mapa completo é pré-renderizado em um canvas interno com faces de terreno, água, estradas, pontes, volumes, onze famílias arquitetônicas, sombras e depth sort. A câmera visível faz apenas composição, pan e zoom, mantendo a navegação leve. `setShowZones(boolean)` recompõe o mundo com o overlay funcional sem mover a câmera. A exportação PNG renderiza o mapa inteiro, independentemente do enquadramento atual, e herda o estado do overlay.

`src/app.js` conecta formulário, geração, câmera, métricas e download. `server.mjs` é um servidor local restrito a GET/HEAD, implementado apenas com módulos nativos do Node. Os testes usam `node:test`, sem bibliotecas externas.

## Contrato do mapa

O contrato atual usa `schemaVersion: 2`. O modelo contém `seed`, `settings`, `width`, `height`, `waterLine`, `terrain`, `heightLevel`, `zoneMap`, `zones`, `roadTopology`, `gridSpec`, `plaza`, `roads`, `buildings`, `props`, `stats` e `validation`. Ele não armazena os campos contínuos intermediários de elevação e umidade. `terrain`, `heightLevel` e `zoneMap` são vetores lineares indexados por `y * width + x`.

`zoneMap` usa `none`, `residential`, `commercial`, `craft`, `civic` e `agricultural`. Água é sempre `none`. Cada entrada de `zones` informa `id`, `type`, `label`, `anchor`, `cellCount`, `bounds` e `bridgeLinks`. Cada edifício possui `zone` e `architecture`; o lote só é aceito quando o centro e pelo menos 60% do footprint pertencem a uma zona permitida.

No traçado em quadras, `roadTopology` vale `orthogonal-cardinal` e `gridSpec` expõe `{centerX, centerY, spacing, radius}` para conversores externos. No traçado orgânico, `roadTopology` vale `organic-cardinal` e `gridSpec` é `null`. Na projeção isométrica, ruas ortogonais parecem diagonais na tela, mas continuam alinhadas aos eixos X/Y do modelo.

As configurações normalizadas são `mapSize`, `biome`, `water`, `rivers`, `layout` e `settlement`. Os valores padrão são mapa 96, campo temperado, água 0.35, sem rio forçado, traçado orgânico e vila. A mesma seed com as mesmas configurações produz a mesma estrutura.

## Direção de arte

Terreno, transições, construções, estradas, pontes, luz e sombras são desenhados proceduralmente no Canvas. Os objetos especiais em `assets/props` foram criados especificamente para este projeto com geração de imagem e pós-processamento local para transparência e escala consistente. Nenhum asset do pacote Ninja Adventure ou de outra biblioteca externa faz parte da versão atual.

O renderizador possui desenhos procedurais de contingência para um arquivo de prop ausente, mas os assets distribuídos localmente são o caminho visual normal. A documentação detalhada dessas imagens fica em `assets/ART.md`.

### Caminho para alta fidelidade isométrica

A versão 2.2 aproxima o Canvas do acabamento de city-builders isométricos pré-renderizados: edifícios têm fundações de pedra, beirais com espessura, telhas e juntas orientadas pela água do telhado, textura própria por material, detalhes arquitetônicos, soleira ligada ao tile real da porta e sombras de contato em camadas. A meta é reproduzir a leitura visual e a riqueza de volume dessa escola gráfica, sem copiar assets proprietários de jogos comerciais.

O salto seguinte recomendado é manter o mesmo `VillageMap`, substituir apenas a camada de desenho dos prédios e usar sprites obtidos por render ortográfico de modelos 3D livres. O [Medieval Village MegaKit da Quaternius](https://quaternius.com/packs/medievalvillagemegakit.html) é CC0, modular e alinhado a grade, sendo o candidato principal para esse pipeline. Como alternativas menores, o OpenGameArt oferece [edifícios medievais isométricos com fontes Blender](https://opengameart.org/content/isometric-medieval-buildings) e o conjunto modular [Isometric Buildings 1](https://opengameart.org/content/isometric-buildings-1), ambos sob CC0.

O pipeline sugerido é importar somente os modelos efetivamente usados, fixar câmera ortográfica, iluminação e paleta, renderizar quatro orientações em PNG transparente e montar atlases por bioma e nível de detalhe. Isso preserva execução offline e leve no navegador: o custo de 3D ocorre uma única vez durante a produção dos sprites, não durante a geração da vila. Nenhum desses pacotes externos foi incorporado agora, evitando arquivos sem uso e mantendo a origem de cada asset explícita.

## Validação e desempenho

O validador rejeita edifícios fora do mapa, sobrepostos, sobre água ou na zona errada, portas inválidas, vias fora dos limites e portas sem conexão navegável com a praça. Cada porta deve ser única, estar dentro do mapa, em terreno seco, sobre uma estrada terrestre que não seja ponte, ortogonalmente adjacente à fachada declarada e fora do footprint de qualquer prédio. Props e outras construções não podem ocupar a entrada. Ele também verifica metadados, anchors, bounds, água não zonificada, contiguidade funcional por terra ou ponte, grid ortogonal e ocupação mínima do footprint. A faixa-alvo é de 10–18 casas para povoado, 25–40 para vila e 55–85 para cidade.

Os 24 testes automatizados cobrem determinismo por hash, seeds vazias e longas, faixas de edifícios, serialização, zonas, diversidade arquitetônica, limites, água, colisão, contrato rígido das portas, acesso à praça, landmarks, topologia viária, projeção, geometria das fachadas e telhados, bounds de renderização e servidor local. A bateria padrão percorreu 300 seeds em cerca de 35 segundos nesta revisão, com a geração individual mais lenta abaixo de 500 ms, e a matriz de biomas, traçados e escalas também passou.

## Próximas evoluções sugeridas

O modelo já permite adicionar exportação JSON sem acoplar o núcleo à interface. `zoneMap`, `roadTopology` e `gridSpec` foram desenhados para conversores futuros: blocos e chunks no Minecraft, zoning e quadras no estilo SimCity, ou setores, linedefs e áreas de encontro em um mapa inspirado por Doom. A evolução natural para jogo é criar uma malha navegável derivada de terreno, vias, portas e pontes, introduzir um personagem com colisão e usar os IDs estáveis de edifícios como pontos de interação.

Outras evoluções úteis são chunks para mapas maiores que 128, clima animado por bioma, ciclos de luz, editor manual de lotes, conjuntos adicionais de telhados e fachadas, população simulada e persistência de alterações do jogador. Essas extensões devem consumir o `VillageMap` atual em vez de inserir estado de jogo no gerador.

## Correções recentes

Em 19 de julho de 2026, o botão “Gerar novo vilarejo” passou a criar uma seed nova antes de cada geração; pressionar Enter no campo continua regenerando deliberadamente a seed digitada. O renderer também recebeu geometria independente para as duas orientações de telhado, removendo faces triangulares sobrepostas e adicionando cursos de telha alinhados entre cumeeira e beiral.

Ainda em 19 de julho de 2026, a versão 2.1 introduziu zoneamento funcional por tile, topologia ortogonal explícita, metadata de grade e diversidade arquitetônica por bioma e função. A interface passou a nomear o modo “Quadras ortogonais” e ganhou um overlay de zonas com legenda.

Na versão 2.2, entradas passaram a ser recursos reservados do mapa. O placement tenta primeiro fachadas visíveis ao sul e ao leste e só usa norte ou oeste como fallback; a validação impede água, pontes, props, edifícios, duplicatas e incoerência entre porta e orientação. O renderer passou a desenhar portas apenas na fachada verdadeira, além de ganhar fundações, beirais, textura de materiais e sombras mais profundas.
