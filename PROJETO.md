# Vilarejo II — gerador procedural isométrico

## Estado atual

Esta é uma reescrita integral da aplicação. A versão em uso não importa módulos, assets, modos de câmera ou contratos do protótipo top-down anterior. O produto atual gera assentamentos 2.5D isométricos determinísticos, roda localmente no navegador e não possui dependências de execução além do Node.js usado pelo servidor estático.

O gerador oferece quatro biomas (campo temperado, sertão árido, planalto nevado e pântano), dois traçados (orgânico e quadras), três escalas de assentamento e mapas de 72, 96 ou 128 tiles. Cidades usam 128 tiles automaticamente. Relevo, água, rios opcionais, estradas, pontes, praça, lotes, casas, serviços e objetos de cenário são derivados da seed. Serviços ocupam a região central e as casas se espalham gradualmente, evitando o aspecto de construções aleatórias dispersas pelo mapa.

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

`src/core` é determinístico e independente do DOM. Sua API pública principal é `generateVillage(seed, settings)`, que devolve um `VillageMap` serializável. `random.js` contém o PRNG e hashes estáveis; `pathfinding.js` resolve rotas ponderadas; `generator.js` constrói terreno, vias, lotes, edifícios e props; `validation.js` verifica limites, colisões, água, portas e conectividade.

`src/render/renderer.js` recebe somente o modelo serializável. A projeção padrão usa tiles 32×16 e degraus verticais de 6 pixels. O mapa completo é pré-renderizado em um canvas interno com faces de terreno, água, estradas, pontes, volumes, sombras e depth sort. A câmera visível faz apenas composição, pan e zoom, mantendo a navegação leve. A exportação PNG renderiza o mapa inteiro, independentemente do enquadramento da câmera.

`src/app.js` conecta formulário, geração, câmera, métricas e download. `server.mjs` é um servidor local restrito a GET/HEAD, implementado apenas com módulos nativos do Node. Os testes usam `node:test`, sem bibliotecas externas.

## Contrato do mapa

O modelo contém `schemaVersion`, `seed`, `settings`, `width`, `height`, `waterLine`, `terrain`, `heightLevel`, `plaza`, `roads`, `buildings`, `props`, `stats` e `validation`. Ele não armazena os campos contínuos intermediários de elevação e umidade. `terrain` e `heightLevel` são vetores lineares indexados por `y * width + x`.

As configurações normalizadas são `mapSize`, `biome`, `water`, `rivers`, `layout` e `settlement`. Os valores padrão são mapa 96, campo temperado, água 0.35, sem rio forçado, traçado orgânico e vila. A mesma seed com as mesmas configurações produz a mesma estrutura.

## Direção de arte

Terreno, transições, construções, estradas, pontes, luz e sombras são desenhados proceduralmente no Canvas. Os objetos especiais em `assets/props` foram criados especificamente para este projeto com geração de imagem e pós-processamento local para transparência e escala consistente. Nenhum asset do pacote Ninja Adventure ou de outra biblioteca externa faz parte da versão atual.

O renderizador possui desenhos procedurais de contingência para um arquivo de prop ausente, mas os assets distribuídos localmente são o caminho visual normal. A documentação detalhada dessas imagens fica em `assets/ART.md`.

## Validação e desempenho

O validador rejeita edifícios fora do mapa, sobrepostos ou sobre água, portas inválidas, vias fora dos limites e portas sem conexão navegável com a praça. A geração tenta novamente apenas a etapa de implantação usando sub-seeds estáveis quando necessário. A faixa-alvo é de 10–18 casas para povoado, 25–40 para vila e 55–85 para cidade.

Os 17 testes automatizados cobrem determinismo por hash, seeds vazias e longas, faixas de edifícios, serialização, limites, água, colisão, acesso à praça, landmarks, matrizes de centenas de configurações, projeção, bounds de renderização e servidor local. A bateria padrão percorre 300 seeds, e uma auditoria adicional percorreu 480 combinações extremas de bioma, traçado, assentamento, água e rios. Na verificação final, três vilas padrão foram geradas entre 98 e 154 ms, abaixo da meta de 500 ms da máquina de desenvolvimento.

## Próximas evoluções sugeridas

O modelo já permite adicionar exportação JSON sem acoplar o núcleo à interface. A evolução natural para jogo é criar uma malha navegável derivada de terreno, vias, portas e pontes, introduzir um personagem com colisão e usar os IDs estáveis de edifícios como pontos de interação. Interiores podem ser mapas separados derivados de uma sub-seed do edifício, evitando aumentar o peso do mapa externo.

Outras evoluções úteis são chunks para mapas maiores que 128, clima animado por bioma, ciclos de luz, editor manual de lotes, conjuntos adicionais de telhados e fachadas, população simulada e persistência de alterações do jogador. Essas extensões devem consumir o `VillageMap` atual em vez de inserir estado de jogo no gerador.

## Correções recentes

Em 19 de julho de 2026, o botão “Gerar novo vilarejo” passou a criar uma seed nova antes de cada geração; pressionar Enter no campo continua regenerando deliberadamente a seed digitada. O renderer também recebeu geometria independente para as duas orientações de telhado, removendo faces triangulares sobrepostas e adicionando cursos de telha alinhados entre cumeeira e beiral.
