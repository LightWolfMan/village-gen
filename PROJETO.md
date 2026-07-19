# Village v3 — gerador procedural isométrico por lotes

## Estado atual

Esta é uma reescrita integral da aplicação. A versão em uso não importa módulos, assets, modos de câmera ou contratos do protótipo top-down anterior. O produto atual gera assentamentos 2.5D isométricos determinísticos, roda localmente no navegador e não possui dependências de execução além do Node.js usado pelo servidor estático. Na versão 3, o bioma temperado combina terreno Canvas com 112 edifícios, vias, dez módulos de ponte, plantas e objetos pré-renderizados no Blender; outros biomas continuam usando o renderer procedural como fallback arquitetônico, mas já compartilham os props Blender próprios de cada clima.

O gerador oferece quatro biomas (campo temperado, sertão árido, planalto nevado e pântano), dois traçados (orgânico e quadras ortogonais), três escalas de assentamento e mapas de 72, 96 ou 128 tiles. Cidades usam 128 tiles automaticamente. Relevo, água, rios opcionais, estradas, pontes, praça, segmentos viários, fachadas, lotes, casas, serviços e objetos de cenário são derivados da seed. O fluxo v3 é `rua → segmento → fachada → lote → construção`; o modo orgânico acompanha trechos locais das vias e o modo de quadras parcela blocos cardinais.

Todo assentamento possui cinco distritos funcionais delimitados: residencial, mercantil, oficinas, cívico e rural. “Oficinas” representa a produção medieval de ferraria, moinho e artesanato; moradias mistas podem existir nos bairros mercantis e artesanais. O overlay de zonas pode ser ligado na interface sem alterar o mapa gerado. No conjunto temperado, hospedaria, loja, casa mercantil, oficina artesanal, ferraria, mercado e moinho possuem volumes e equipamentos próprios, em vez de reutilizar casas com outra cor.

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

`src/core` é determinístico e independente do DOM. Sua API pública principal é `generateVillage(seed, settings)`, que devolve um `VillageMap` serializável. `random.js` contém o PRNG e hashes estáveis; `pathfinding.js` resolve rotas ponderadas com estado de direção; `road-topology.js` preserva conexões cardinais, segmentos e spans; `urbanism.js` extrai fachadas, cresce lotes e aplica quotas; `generator.js` orquestra terreno, vias, zoneamento, edifícios e props; `validation.js` verifica limites, colisões, água, portas, lotes, pontes, zonas e conectividade.

`src/render/renderer.js` recebe somente o modelo serializável. A projeção padrão usa tiles 32×16 e degraus verticais de 6 pixels. O mapa completo é pré-renderizado em um canvas interno com faces de terreno, água, sprites ancorados de estradas e pontes, edifícios, props, sombras e depth sort. Manifestos separados mantêm edifícios e ambiente desacoplados; qualquer imagem ausente recua somente aquele elemento para sua geometria Canvas. A câmera visível faz apenas composição, pan e zoom. `setShowZones(boolean)` recompõe o mundo sem mover a câmera, e a exportação PNG sempre usa o mapa inteiro.

`src/app.js` conecta formulário, geração, câmera, métricas e download. `server.mjs` é um servidor local restrito a GET/HEAD, implementado apenas com módulos nativos do Node. Os testes usam `node:test`, sem bibliotecas externas.

## Contrato do mapa

O contrato atual usa exclusivamente `schemaVersion: 3`; não existe adaptador para mapas v2. O modelo contém `seed`, `settings`, `width`, `height`, `waterLine`, `terrain`, `heightLevel`, `zoneMap`, `zones`, `roadTopology`, `gridSpec`, `plaza`, `roads`, `roadSegments`, `frontages`, `lots`, `bridgeSpans`, `buildings`, `props`, `stats` e `validation`. Ele não armazena os campos contínuos intermediários de elevação e umidade. `terrain`, `heightLevel` e `zoneMap` são vetores lineares indexados por `y * width + x`.

`zoneMap` usa `none`, `residential`, `commercial`, `craft`, `civic` e `agricultural`. Água é sempre `none`. Cada entrada de `zones` informa `id`, `type`, `label`, `anchor`, `cellCount`, `bounds` e `bridgeLinks`. Cada estrada acrescenta `connections` na máscara `N=1, E=2, S=4, W=8`, `segmentIds`, `bridgeSpanId`, `bridgeRole` e `bridgeIndex`. `roadSegments` registra eixo, classe, índices, extremidades e distância viária à praça; `frontages` liga trechos retos a um lado e uma zona; `lots` contém células, bounds, acesso e ocupante; `bridgeSpans` guarda o eixo, ordem, duas margens secas e comprimento. Cada construção declara `lotId`, `frontageId` e a `variant` usada diretamente pelo manifesto Blender.

As quotas de construções não-serviço são determinísticas. Povoados buscam 55% residencial, 35% agrícola, 5% comercial e 5% artesanal; vilas usam 58%, 17%, 13% e 12%; cidades usam 50%, 12%, 20% e 18%. Serviços cívicos e marcos funcionais são implantados antes e ficam fora dessas proporções. Quando uma zona não dispõe de lotes suficientes, somente seu cadastro é refeito com até quatro sub-seeds estáveis.

No traçado em quadras, `roadTopology` vale `orthogonal-cardinal` e `gridSpec` expõe `{centerX, centerY, spacing, radius}` para conversores externos. No traçado orgânico, `roadTopology` vale `organic-cardinal` e `gridSpec` é `null`. Na projeção isométrica, ruas ortogonais parecem diagonais na tela, mas continuam alinhadas aos eixos X/Y do modelo.

As configurações normalizadas são `mapSize`, `biome`, `water`, `rivers`, `layout` e `settlement`. Os valores padrão são mapa 96, campo temperado, água 0.35, sem rio forçado, traçado orgânico e vila. A mesma seed com as mesmas configurações produz a mesma estrutura.

## Direção de arte

Terreno, água, transições, luz e sombras de contato continuam procedurais no Canvas. Edifícios temperados, três pisos viários, dez peças retas de ponte e dez props são modelos originais gerados por script e pré-renderizados no Blender 4.5.5. Nenhum asset do pacote Ninja Adventure, de SimCity ou de outra biblioteca externa faz parte da versão atual.

O renderizador possui desenhos procedurais de contingência para qualquer arquivo ausente. A visão geral fica em `assets/ART.md`; o contrato arquitetônico está em `assets/buildings/ART.md`; e vias, pontes e props são documentados em `assets/environment/ART.md`.

### Caminho para alta fidelidade isométrica

A versão 2.2 aproximou o Canvas do acabamento de city-builders isométricos pré-renderizados. A versão 2.3 concretizou o pipeline híbrido com cinco famílias temperadas. A versão 2.4 amplia esse conjunto para doze famílias em quatro orientações e leva a mesma câmera, iluminação e materiais para estradas, pontes, vegetação e objetos. A meta continua sendo reproduzir a leitura visual e a riqueza de volume dessa escola gráfica, sem copiar assets proprietários de jogos comerciais.

A versão 3 possui três variantes estruturais para `cottage`, `townhouse`, `merchant` e `artisan`, duas para as outras oito famílias e quatro orientações para cada uma, totalizando 112 PNGs. Anexos, cocheiras, vitrines, varandas, depósitos, coberturas produtivas, chaminés e pátios alteram volumes, não apenas cores. As pontes usam `single`, `start`, `middle`, `post` e `end` por eixo; peças intermediárias não fecham o tabuleiro transversalmente e postes internos aparecem somente no papel `post`, a cada três tiles do span.

O próximo salto visual recomendado é produzir famílias Blender para os outros três biomas e criar transições de calçamento que consumam a máscara cardinal das ruas. Atlases por bioma podem reduzir chamadas de desenho quando o número de variantes crescer. O custo 3D continuará restrito à produção dos sprites, preservando a execução offline e leve no navegador.

## Referências de urbanismo procedural

O parcelamento é uma implementação original inspirada nos princípios de acessibilidade, interesse e crescimento normal à via descritos por Emilien et al. em [Procedural Generation of Villages on Arbitrary Terrains](https://perso.liris.cnrs.fr/egalin/Articles/2012-villages.pdf), nas faixas orientadas à rua de Vanegas et al. em [Procedural Generation of Parcels in Urban Modeling](https://twak.org/project/parcels/), na geração de ruas e lotes de [Parish e Müller](https://people.eecs.berkeley.edu/~sequin/CS285/PAPERS/Parish_Muller01.pdf) e no planejamento iterativo do [GDMC](https://arxiv.org/abs/2309.10871). Nenhum código ou asset desses projetos foi incorporado; em particular, repositórios GPL consultados permaneceram apenas como referência conceitual.

## Validação e desempenho

O validador rejeita edifícios fora do mapa, fora do próprio lote, sobrepostos, sobre água ou na zona errada, portas inválidas, vias fora dos limites e portas sem conexão navegável com a praça. Cada porta deve ser única, estar dentro do mapa, em terreno seco, sobre uma estrada terrestre que não seja ponte, curva ou cruzamento, ortogonalmente adjacente à fachada declarada e fora do footprint de qualquer prédio. Props e outras construções não podem ocupar a entrada. Pontes precisam formar cadeias retas, usar um único eixo, respeitar os limites de comprimento, possuir duas margens secas e apresentar papéis ordenados. A faixa-alvo é de 10–18 casas para povoado, 25–40 para vila e 55–85 para cidade.

Os 44 testes automatizados cobrem determinismo por hash, seeds vazias e longas, faixas de edifícios, serialização v3, quotas, diversidade arquitetônica, limites, água, colisão, contrato rígido das portas, acesso à praça, lotes, fachadas, segmentos, topologia viária, pontes sintéticas de 1, 2 e 5 tiles, projeção, manifestos Blender, 112 edifícios RGBA, dez pontes, placements por âncora, fallbacks, bounds, exportação e servidor local. A bateria final percorreu 300 seeds padrão em aproximadamente 35 segundos, manteve cada seed abaixo de 500 ms nesta execução e passou pela matriz de biomas, traçados, rios e escalas. O smoke no navegador cobriu rio em modo orgânico e em quadras, seed editável, console vazio e renderização do mapa completo.

## Próximas evoluções sugeridas

O modelo já permite adicionar exportação JSON sem acoplar o núcleo à interface. `zoneMap`, `roadTopology`, `gridSpec`, `roadSegments`, `frontages`, `lots` e `bridgeSpans` foram desenhados para conversores futuros: blocos e chunks no Minecraft, zoning e quadras no estilo SimCity, ou setores, linedefs e áreas de encontro em um mapa inspirado por Doom. A evolução natural para jogo é criar uma malha navegável derivada de terreno, vias, portas e pontes, introduzir um personagem com colisão e usar os IDs estáveis de edifícios como pontos de interação.

Outras evoluções úteis são chunks para mapas maiores que 128, clima animado por bioma, ciclos de luz, editor manual de lotes, conjuntos adicionais de telhados e fachadas, população simulada e persistência de alterações do jogador. Essas extensões devem consumir o `VillageMap` atual em vez de inserir estado de jogo no gerador.

## Correções recentes

Em 19 de julho de 2026, Village v3 substituiu a dispersão independente de edifícios pelo parcelamento orientado às ruas. A malha viária passou a preservar conexões cardinais e a direção anterior do A*; curvas e cruzamentos ganharam buffers sem portas. Pontes agora são spans retos contínuos, ordenados entre margens secas, com dez sprites próprios e sem o antigo `bridge-cross`. O contrato recebeu segmentos, fachadas, lotes e spans, enquanto o conjunto temperado cresceu para 112 edifícios com variantes volumétricas e footprints rotacionados.

O mesmo smoke revelou e corrigiu o submit implícito do campo de seed: Enter agora gera exatamente o texto digitado, enquanto “Gerar novo vilarejo” continua criando uma seed diferente antes da geração. O cabeçalho visível também passou a identificar explicitamente `Village v3`.

Em 19 de julho de 2026, o botão “Gerar novo vilarejo” passou a criar uma seed nova antes de cada geração; pressionar Enter no campo continua regenerando deliberadamente a seed digitada. O renderer também recebeu geometria independente para as duas orientações de telhado, removendo faces triangulares sobrepostas e adicionando cursos de telha alinhados entre cumeeira e beiral.

Ainda em 19 de julho de 2026, a versão 2.1 introduziu zoneamento funcional por tile, topologia ortogonal explícita, metadata de grade e diversidade arquitetônica por bioma e função. A interface passou a nomear o modo “Quadras ortogonais” e ganhou um overlay de zonas com legenda.

Na versão 2.2, entradas passaram a ser recursos reservados do mapa. O placement tenta primeiro fachadas visíveis ao sul e ao leste e só usa norte ou oeste como fallback; a validação impede água, pontes, props, edifícios, duplicatas e incoerência entre porta e orientação. O renderer passou a desenhar portas apenas na fachada verdadeira, além de ganhar fundações, beirais, textura de materiais e sombras mais profundas.

Na versão 2.3, Blender 4.5 passou a gerar vinte sprites originais para cottage, townhouse, workshop, civic e farmstead no campo temperado. Um manifesto fornece âncoras, footprint e porta visual; o renderer carrega tudo localmente, dimensiona sem deformação e volta automaticamente à geometria Canvas quando um arquivo ou família não está disponível. O pipeline completo acrescenta cerca de 542 KiB ao aplicativo e não introduz dependências de runtime.

Na versão 2.4, o conjunto arquitetônico passou a 48 sprites e ganhou sete funções próprias para comércio e produção. Um segundo pipeline Blender acrescentou pisos de terra, calçamento, praça, pontes de madeira e dez props climáticos. O lote completo de assets ocupa cerca de 1,44 MiB, continua original e reproduzível por `npm run art:all`. Corredores frontais foram reservados visualmente no mercado, na oficina e na ferraria, e os bounds de exportação passaram a usar as dimensões reais dos novos props.
