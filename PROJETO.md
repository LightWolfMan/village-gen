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

Para comparar o resultado visual antes e depois de uma mudança, `tools/visual/render.mjs` roda o mesmo renderer da página fora do navegador e grava PNGs em disco, com os sprites Blender carregados. É a única parte do projeto com dependência de desenvolvimento, e ela fica isolada ali: a aplicação, o servidor e os testes continuam sem instalar nada. Use `npm install` uma vez e depois `npm run visual`.

Os comandos de verificação são:

```powershell
npm test
npm run check
```

## Arquitetura

`src/core` é determinístico e independente do DOM. Sua API pública principal é `generateVillage(seed, settings)`, que devolve um `VillageMap` serializável. `random.js` contém o PRNG e hashes estáveis; `pathfinding.js` resolve rotas ponderadas com estado de direção; `road-topology.js` preserva conexões cardinais, segmentos e spans; `urbanism.js` extrai fachadas, cresce lotes e aplica quotas; `generator.js` orquestra terreno, vias, zoneamento, edifícios e props; `validation.js` verifica limites, colisões, água, portas, lotes, pontes, zonas e conectividade.

`src/render/renderer.js` recebe somente o modelo serializável. A projeção padrão usa tiles 32×16 e degraus verticais de 6 pixels. O mapa completo é pré-renderizado em um canvas interno, em três passes: chão (terreno, zonas, vias e praça), decalques (reflexos e sombras) e objetos (edifícios e props). A separação existe porque um passe único deixava a sombra ser coberta por tiles pintados depois.

A tabela `TERRAIN` declara uma cor por tipo de terreno que cada bioma realmente emite, e `TERRAIN_FALLBACK` define o solo dominante de cada bioma, avisando uma vez no console quando encontra um tipo desconhecido. Não existe mais contorno por tile: o traço usa a própria cor de preenchimento apenas para selar a costura entre losangos, e contorno visível só aparece na fronteira entre tipos diferentes de terreno. Uma rampa limitada de luminância por nível de altura torna o relevo de seis níveis legível, e uma saia na borda do mundo impede que o mapa flutue sobre a cor de fundo. As sombras projetadas usam o hexágono convexo formado pela base e por sua cópia deslocada, com altura lida do próprio sprite quando o edifício é raster; a água recebe cópias espelhadas e levemente achatadas dos objetos de margem, recortadas pela superfície com um único `fill` em `destination-in`. Props recebem espelhamento e escala determinísticos derivados da posição, evitando dezenas de árvores idênticas.

Manifestos separados mantêm edifícios e ambiente desacoplados; qualquer imagem ausente recua somente aquele elemento para sua geometria Canvas. A câmera visível faz apenas composição, pan e zoom. `center()` enquadra o assentamento, calculado por `computeBuiltBounds`, e `center({ whole: true })` enquadra o mapa completo. `setShowZones(boolean)` recompõe o mundo sem mover a câmera, e a exportação PNG sempre usa o mapa inteiro.

`src/app.js` conecta formulário, geração, câmera, métricas e download. `server.mjs` é um servidor local restrito a GET/HEAD, implementado apenas com módulos nativos do Node. Os testes usam `node:test`, sem bibliotecas externas.

## Contrato do mapa

O contrato atual usa exclusivamente `schemaVersion: 3`; não existe adaptador para mapas v2. O modelo contém `seed`, `settings`, `width`, `height`, `waterLine`, `terrain`, `heightLevel`, `zoneMap`, `zones`, `roadTopology`, `gridSpec`, `plaza`, `roads`, `roadSegments`, `frontages`, `lots`, `bridgeSpans`, `buildings`, `props`, `stats` e `validation`. Ele não armazena os campos contínuos intermediários de elevação e umidade. `terrain`, `heightLevel` e `zoneMap` são vetores lineares indexados por `y * width + x`.

`zoneMap` usa `none`, `residential`, `commercial`, `craft`, `civic` e `agricultural`. Água é sempre `none`. Cada entrada de `zones` informa `id`, `type`, `label`, `anchor`, `cellCount`, `bounds` e `bridgeLinks`. Cada estrada acrescenta `connections` na máscara `N=1, E=2, S=4, W=8`, `segmentIds`, `bridgeSpanId`, `bridgeRole` e `bridgeIndex`. `roadSegments` registra eixo, classe, índices, extremidades e distância viária à praça; `frontages` liga trechos retos a um lado e uma zona; `lots` contém células, bounds, acesso e ocupante; `bridgeSpans` guarda o eixo, ordem, duas margens secas e comprimento. Cada construção declara `lotId`, `frontageId` e a `variant` usada diretamente pelo manifesto Blender.

As quotas de construções não-serviço são determinísticas. Povoados buscam 55% residencial, 35% agrícola, 5% comercial e 5% artesanal; vilas usam 58%, 17%, 13% e 12%; cidades usam 50%, 12%, 20% e 18%. Serviços cívicos e marcos funcionais são implantados antes e ficam fora dessas proporções. Quando uma zona não dispõe de lotes suficientes, somente seu cadastro é refeito com até quatro sub-seeds estáveis.

No traçado em quadras, `roadTopology` vale `orthogonal-cardinal` e `gridSpec` expõe `{centerX, centerY, spacing, radius}` para conversores externos. No traçado orgânico, `roadTopology` vale `organic-cardinal` e `gridSpec` é `null`. Na projeção isométrica, ruas ortogonais parecem diagonais na tela, mas continuam alinhadas aos eixos X/Y do modelo.

As configurações normalizadas são `mapSize`, `biome`, `water`, `rivers`, `layout` e `settlement`. Os valores padrão são mapa 96, campo temperado, água 0.35, sem rio forçado, traçado orgânico e vila. A mesma seed com as mesmas configurações produz a mesma estrutura.

O determinismo é garantido dentro de uma mesma versão do gerador, não entre versões. As correções de 15 de agosto de 2026 em margem, limiar de rocha, raio construído e escolha da praça alteram o mapa produzido para uma mesma seed: um mapa gerado antes dessa data não é idêntico ao gerado agora. Seeds anotadas em capturas ou anotações anteriores continuam válidas como entrada, mas devolvem um resultado diferente.

## Direção de arte

Terreno, água, transições, luz, sombras projetadas e reflexos continuam procedurais no Canvas. Edifícios temperados, três pisos viários, dez peças retas de ponte e dez props são modelos originais gerados por script e pré-renderizados no Blender 4.5.5. Nenhum asset do pacote Ninja Adventure, de SimCity ou de outra biblioteca externa faz parte da versão atual.

Os três pisos viários têm identidade material própria. A rua secundária é terra batida coesa, com sulcos discretos e poucos detritos; a via principal é calçamento em fiada corrida, com pedra sobre pedra; a praça usa lajota grande e clara, alinhada de modo que as juntas coincidam entre tiles vizinhos. A laje de cada via perdeu o chanfro grosso e ficou levemente maior que o tile, o que eliminou o anel escuro que fazia cada tile ler como peça solta em vez de superfície contínua, e as pedras deixaram de ter espessura proporcional à escala, voltando a parecer seixo em vez de lajota chata. Dois materiais novos, `earth_light` e `rut`, sustentam esses acabamentos em `tools/blender/render_environment.py`.

O renderizador possui desenhos procedurais de contingência para qualquer arquivo ausente. A visão geral fica em `assets/ART.md`; o contrato arquitetônico está em `assets/buildings/ART.md`; e vias, pontes e props são documentados em `assets/environment/ART.md`.

### Caminho para alta fidelidade isométrica

A versão 2.2 aproximou o Canvas do acabamento de city-builders isométricos pré-renderizados. A versão 2.3 concretizou o pipeline híbrido com cinco famílias temperadas. A versão 2.4 amplia esse conjunto para doze famílias em quatro orientações e leva a mesma câmera, iluminação e materiais para estradas, pontes, vegetação e objetos. A meta continua sendo reproduzir a leitura visual e a riqueza de volume dessa escola gráfica, sem copiar assets proprietários de jogos comerciais.

A versão 3 possui três variantes estruturais para `cottage`, `townhouse`, `merchant` e `artisan`, duas para as outras oito famílias e quatro orientações para cada uma, totalizando 112 PNGs. Anexos, cocheiras, vitrines, varandas, depósitos, coberturas produtivas, chaminés e pátios alteram volumes, não apenas cores. As pontes usam `single`, `start`, `middle`, `post` e `end` por eixo; peças intermediárias não fecham o tabuleiro transversalmente e postes internos aparecem somente no papel `post`, a cada três tiles do span.

O próximo salto visual recomendado é produzir famílias Blender para os outros três biomas e criar transições de calçamento que consumam a máscara cardinal das ruas. Atlases por bioma podem reduzir chamadas de desenho quando o número de variantes crescer. O custo 3D continuará restrito à produção dos sprites, preservando a execução offline e leve no navegador.

## Referências de urbanismo procedural

O parcelamento é uma implementação original inspirada nos princípios de acessibilidade, interesse e crescimento normal à via descritos por Emilien et al. em [Procedural Generation of Villages on Arbitrary Terrains](https://perso.liris.cnrs.fr/egalin/Articles/2012-villages.pdf), nas faixas orientadas à rua de Vanegas et al. em [Procedural Generation of Parcels in Urban Modeling](https://twak.org/project/parcels/), na geração de ruas e lotes de [Parish e Müller](https://people.eecs.berkeley.edu/~sequin/CS285/PAPERS/Parish_Muller01.pdf) e no planejamento iterativo do [GDMC](https://arxiv.org/abs/2309.10871). Nenhum código ou asset desses projetos foi incorporado; em particular, repositórios GPL consultados permaneceram apenas como referência conceitual.

## Validação e desempenho

O validador rejeita edifícios fora do mapa, fora do próprio lote, sobrepostos, sobre água ou na zona errada, portas inválidas, vias fora dos limites e portas sem conexão navegável com a praça. Cada porta deve ser única, estar dentro do mapa, em terreno seco, sobre uma estrada terrestre que não seja ponte, curva ou cruzamento, ortogonalmente adjacente à fachada declarada e fora do footprint de qualquer prédio. Props e outras construções não podem ocupar a entrada. Pontes precisam formar cadeias retas, usar um único eixo, respeitar os limites de comprimento, possuir duas margens secas e apresentar papéis ordenados. A faixa-alvo é de 10–18 casas para povoado, 25–40 para vila e 55–85 para cidade.

Os 48 testes automatizados cobrem determinismo por hash, seeds vazias e longas, faixas de edifícios, serialização v3, quotas, diversidade arquitetônica, limites, água, colisão, contrato rígido das portas, acesso à praça, lotes, fachadas, segmentos, topologia viária, pontes sintéticas de 1, 2 e 5 tiles, projeção, manifestos Blender, 112 edifícios RGBA, dez pontes, placements por âncora, fallbacks, bounds, exportação e servidor local. Quatro testes de contrato guardam a paleta de terreno: todo terreno emitido por um bioma precisa ter cor própria, nenhuma paleta pode carregar cor que o bioma nunca emite, o fallback de cada bioma deve apontar para seu solo dominante e mapas reais não podem emitir terreno fora do conjunto declarado.

A bateria final percorreu 300 seeds padrão sem falhas, com a seed mais lenta em 457 ms. A varredura de robustez, com seis combinações de assentamento e traçado e 60 seeds cada, também terminou sem falhas em 360 seeds; a linha de base anterior era de 2 falhas em 360. Somados os dois conjuntos, a taxa de falha caiu de 2 em 660 seeds para zero.

Os tempos medianos de geração são de 109 ms para uma vila orgânica, 331 ms para uma cidade orgânica e 359 ms para uma cidade em quadras; o render de um mapa completo fica entre 210 e 711 ms, sendo o extremo superior a cidade de 128 tiles. A cidade ficou cerca de 15% mais lenta que antes desta rodada, porque a malha em quadras mais compacta oferece menos frente de rua e o parcelamento tenta mais vezes antes de fechar. O smoke no navegador cobriu rio em modo orgânico e em quadras, seed editável, console vazio e renderização do mapa completo.

## Próximas evoluções sugeridas

O modelo já permite adicionar exportação JSON sem acoplar o núcleo à interface. `zoneMap`, `roadTopology`, `gridSpec`, `roadSegments`, `frontages`, `lots` e `bridgeSpans` foram desenhados para conversores futuros: blocos e chunks no Minecraft, zoning e quadras no estilo SimCity, ou setores, linedefs e áreas de encontro em um mapa inspirado por Doom. A evolução natural para jogo é criar uma malha navegável derivada de terreno, vias, portas e pontes, introduzir um personagem com colisão e usar os IDs estáveis de edifícios como pontos de interação.

Outras evoluções úteis são chunks para mapas maiores que 128, clima animado por bioma, ciclos de luz, editor manual de lotes, conjuntos adicionais de telhados e fachadas, população simulada e persistência de alterações do jogador. Essas extensões devem consumir o `VillageMap` atual em vez de inserir estado de jogo no gerador.

## Correções recentes

Em 15 de agosto de 2026, uma rodada de correções visuais reescreveu a tabela de terreno do renderer. Nove tipos que o gerador realmente produzia — entre eles `rock`, `dry-grass`, `scrub`, `pine-forest`, `ice`, `snow-rock`, `swamp-forest` e `wet-grass` — não tinham cor e caíam num fallback silencioso para grama; era por isso que o sertão árido renderizava como campo verde e os bosques desapareciam em três dos quatro biomas. A entrada morta `dirt` foi removida, o fallback passou a ser explícito por bioma e o renderer ganhou passes separados, sombras projetadas, reflexo na água, variação determinística de props, rampa de luminância por altura, saia de borda e enquadramento pelo assentamento, tudo descrito na seção de arquitetura.

Na mesma rodada, o gerador recebeu quatro ajustes de terreno e traçado. `pruneOrphanShore` só preserva margem quando há água em raio de dois tiles, eliminando os riscos retos de areia que a faixa de elevação produzia no meio do continente. O limiar `ROCK_LINE` subiu de 0.79 para 0.83, de modo que rocha voltou a ser cume e afloramento em vez de platô — numa seed de relevo alto ela cobria 8% do mapa. O novo `builtRadius()` deriva da quantidade de construções o raio da malha em quadras, que antes usava uma fração fixa da largura do mapa e chegava ao dobro da área ocupada, produzindo quadras inteiras de rua deserta. E `choosePlaza` passou a pontuar 24 candidatos determinísticos pela terra seca ao redor, em vez de aceitar, num pântano, uma ilhota de 3×3 cercada de água. Esses quatro ajustes mudam o mapa produzido para uma mesma seed, conforme registrado no contrato do mapa.

O anel externo do traçado orgânico foi mantido no alcance anterior de propósito. Ele é a principal fonte de frente de rua reta, que é a única superfície onde o parcelamento pode encostar um edifício; apertá-lo adensava o desenho, mas estrangulava as seeds de pouca terra firme.

A rodada também tornou a geração resiliente. Antes, uma seed cujo parcelamento não fechasse simplesmente não produzia mapa: a interface exibia um alerta e nenhuma vila. Agora `generateVillage` tenta até quatro posições de praça, abrindo a busca a cada retentativa, e continua determinístico porque a ordem dos candidatos vem da própria seed. Os serviços ganharam uma medida compacta de recuo, usada apenas quando nenhuma das preferidas cabe — como o parcelador para na primeira que encaixa, os mapas que já fechavam continuam idênticos. E quando quem falha é um serviço, a escada de metas de casas é abandonada de imediato, já que serviços são colocados antes das casas e não dependem dessa meta.

Em 19 de julho de 2026, Village v3 substituiu a dispersão independente de edifícios pelo parcelamento orientado às ruas. A malha viária passou a preservar conexões cardinais e a direção anterior do A*; curvas e cruzamentos ganharam buffers sem portas. Pontes agora são spans retos contínuos, ordenados entre margens secas, com dez sprites próprios e sem o antigo `bridge-cross`. O contrato recebeu segmentos, fachadas, lotes e spans, enquanto o conjunto temperado cresceu para 112 edifícios com variantes volumétricas e footprints rotacionados.

O mesmo smoke revelou e corrigiu o submit implícito do campo de seed: Enter agora gera exatamente o texto digitado, enquanto “Gerar novo vilarejo” continua criando uma seed diferente antes da geração. O cabeçalho visível também passou a identificar explicitamente `Village v3`.

Em 19 de julho de 2026, o botão “Gerar novo vilarejo” passou a criar uma seed nova antes de cada geração; pressionar Enter no campo continua regenerando deliberadamente a seed digitada. O renderer também recebeu geometria independente para as duas orientações de telhado, removendo faces triangulares sobrepostas e adicionando cursos de telha alinhados entre cumeeira e beiral.

Ainda em 19 de julho de 2026, a versão 2.1 introduziu zoneamento funcional por tile, topologia ortogonal explícita, metadata de grade e diversidade arquitetônica por bioma e função. A interface passou a nomear o modo “Quadras ortogonais” e ganhou um overlay de zonas com legenda.

Na versão 2.2, entradas passaram a ser recursos reservados do mapa. O placement tenta primeiro fachadas visíveis ao sul e ao leste e só usa norte ou oeste como fallback; a validação impede água, pontes, props, edifícios, duplicatas e incoerência entre porta e orientação. O renderer passou a desenhar portas apenas na fachada verdadeira, além de ganhar fundações, beirais, textura de materiais e sombras mais profundas.

Na versão 2.3, Blender 4.5 passou a gerar vinte sprites originais para cottage, townhouse, workshop, civic e farmstead no campo temperado. Um manifesto fornece âncoras, footprint e porta visual; o renderer carrega tudo localmente, dimensiona sem deformação e volta automaticamente à geometria Canvas quando um arquivo ou família não está disponível. O pipeline completo acrescenta cerca de 542 KiB ao aplicativo e não introduz dependências de runtime.

Na versão 2.4, o conjunto arquitetônico passou a 48 sprites e ganhou sete funções próprias para comércio e produção. Um segundo pipeline Blender acrescentou pisos de terra, calçamento, praça, pontes de madeira e dez props climáticos. O lote completo de assets ocupa cerca de 1,44 MiB, continua original e reproduzível por `npm run art:all`. Corredores frontais foram reservados visualmente no mercado, na oficina e na ferraria, e os bounds de exportação passaram a usar as dimensões reais dos novos props.
