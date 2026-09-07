# Simulação de crescimento — entrega do Claude

Primeira versão funcional de crescimento orgânico por território, circulação e ciclo de árvores. Godot 4.7.2, C#, offline, sem engine nem biblioteca de física adicional. `SimulationHost.Create` já devolve uma implementação real; o menu Simulação pode ser habilitado.

## Revisão de 6 de setembro — quatro defeitos corrigidos

Os quatro pontos levantados na revisão eram reais e estão corrigidos, cada um com teste que falha contra o código anterior (verificado revertendo a correção e reexecutando).

**1. Colisão deslocada.** `SimulationAddObstacle` calculava `box.GetCenter() - owner.GlobalPosition + owner.Position`, o que descontava o transform do dono e somava de volta a parte local — o offset entrava duas vezes. Agora usa `owner.ToLocal(box.GetCenter())`, que remove o transform exatamente uma vez. Medido com o código antigo, o corpo do canteiro caía a 69 × 79 unidades do lote e o da árvore a 21 × 92: tronco sem colisão e parede invisível longe dali, como descrito. A função também passou a substituir o volume anterior do mesmo dono, em vez de empilhar um segundo que ninguém removeria.

**2. Obras ocupando props e mudas.** O planejador reservava lotes e edifícios, mas não os props. Agora o construtor de `GrowthPlanner` calcula a pegada girada de cada prop a partir dos `bounds` do catálogo — a mesma matemática que `CoreTests` usa para validar props contra ruas — e reserva as células cobertas. As mudas da simulação reservam o próprio chão via `BlockTree`, rastreado por identidade: soltar uma árvore morta libera só as células que ela mesma acrescentou, nunca as de um prop vizinho.

**3. Canteiro sem colisão.** A obra passa a ter volume sólido a partir da fundação, com altura por etapa (0,22 m na fundação, 1,9 m na estrutura, 2,3 m na cobertura), substituído a cada troca de etapa e removido na conclusão, quando o volume do edifício assume. Antes dava para atravessar fundação e estrutura a pé.

**4. Registro duplicado.** `Commit` era chamado na reserva e de novo na conclusão, duplicando o registro interno e a contagem de orientação que alimenta `Score`. Agora o registro acontece uma única vez, na reserva — que é quando o chão de fato é tomado —, e `ConstructionSite.Reserved` guarda o objeto entregue depois em `Building`. Confirmado que o teste acusa a versão antiga.

## Arquivos

### Criados

| Arquivo | Linhas | Papel |
|:--|--:|:--|
| `native/Core/Simulation/SimulationClock.cs` | 44 | Relógio de passo fixo, pausa/1×/2×, teto de atraso |
| `native/Core/Simulation/RoadNetwork.cs` | 104 | Grafo cardinal de vias e pontes, rota e componente conexa |
| `native/Core/Simulation/GrowthPlanner.cs` | 221 | Busca incremental de lote reusando o algoritmo de fachadas |
| `native/Core/Simulation/ConstructionSite.cs` | 64 | Máquina de estados da obra e progresso |
| `native/Core/Simulation/AgentSystem.cs` | 141 | Pessoas e carroças com rotas casa↔serviço |
| `native/Core/Simulation/Ecology.cs` | 164 | Ciclo jovem/adulta/morta das mudas da simulação |
| `native/Core/Simulation/VillageSimulationModel.cs` | 145 | Orquestrador determinístico, independente de engine |
| `native/Simulation/VillageSimulation.cs` | 327 | Camada Godot: nós, geometria das etapas, agentes |
| `native/Simulation/SimulationVisuals.cs` | 56 | Malhas e materiais compartilhados |
| `native/Simulation/SimulationSmoke.cs` + `.tscn` | 126 | Smoke headless do módulo |
| `native/Rendering/VillageSimulationIntegration.cs` | 99 | Parte nova de `VillageScene` com os ganchos incrementais |
| `native/SimulationTests/` | 364 | Projeto de testes do núcleo |

### Alterados

- **`native/Simulation/IVillageSimulation.cs`** — só o corpo da fábrica. As assinaturas de `IVillageSimulation` e de `SimulationHost.Create` estão intactas. `null` continua significando indisponível: um mapa sem `roads`, `lots`, `buildings` ou `zoneMap` não recebe simulação, e uma exceção na construção vira aviso e `null`, nunca progresso falso.
- **`native/Core/UrbanPlanner.cs`** — apenas visibilidade. Treze declarações passaram de privadas a `internal` (`Key`, `Indexes`, `Directions`, `Mask`, `Segments`, `Frontages`, `Program`, `Slot`, `Candidate`, `MakeCandidate`, `Clear`, `Touches`, `Score`). Nenhuma linha de lógica mudou — `diff` com a versão anterior, normalizando só os modificadores, dá arquivo idêntico. A geração em lote continua exatamente como estava.

Nada mais foi tocado. `native/Native*.cs`, `VillageScene.cs`, `VillageDetails.cs`, `VillagePresentation.cs`, assets de UI, scripts de publicação e `PROJETO.md` estão como o Codex deixou. Nada foi publicado em `dist` e o aplicativo do usuário não foi aberto.

## Comandos e testes executados

```powershell
. .\tools\native-env.ps1
dotnet build native\Village.Native.csproj -c Debug          # 0 erros, 0 avisos
dotnet run --project native\SimulationTests\SimulationTests.csproj -c Debug
dotnet run --project native\CoreTests\CoreTests.csproj -c Debug 6
& $VillageGodot --headless --path native res://Simulation/SimulationSmoke.tscn
```

- **21 testes de núcleo, todos passando.** Log em `.cache/claude-simulation-core/core-tests.log`.
- **29 verificações no smoke headless, `SIM_SMOKE_OK`.** Log em `.cache/claude-simulation-smoke/smoke.log`.
- **Regressão do Codex intacta:** `CoreTests` com 6 seeds nativas passou depois da mudança de visibilidade. Log em `.cache/claude-simulation-core/coretests.log`.

O que os testes cobrem: delta variável convertido em passos fixos; pausa e 2×; descarte do atraso de janela suspensa; mesmo número de passos produzindo estado idêntico com deltas diferentes; lote novo seco, dentro dos limites, sem sobrepor lote existente, dentro da zona pedida e com pegada nivelada; porta em via terrestre reta, fora de ponte, curva, cruzamento e praça; nunca reutilizar o mesmo lote; falha limpa e explicada em distrito saturado e em zona inválida; obra percorrendo as quatro etapas na ordem e concluindo com modelo real do catálogo; progresso monotônico; rotas dos agentes sempre em passos cardinais dentro da malha; travessia de pontes nos dois eixos sem sair delas; desligar pessoas/carroças congelando os agentes; mudas fora de rua, acesso, lote e água; ciclo jovem → adulta → morta → removida; ecologia desligada sem plantar; `IsRunning` acompanhando pausa e conteúdo; `Dispose` removendo a raiz e preservando o passeio.

Os quatro testes acrescentados na revisão: lote nunca invade a pegada girada de um prop do catálogo (três seeds, todas as zonas, trinta rodadas); lote nunca invade o chão de uma muda plantada; cada construção registrada exatamente uma vez, com a contagem de orientação inalterada na conclusão; e liberar uma muda morta não solta a reserva de outra viva. No smoke, o canteiro precisa ter corpo sólido com altura útil durante a obra, e tanto o corpo do canteiro quanto o da árvore adulta precisam ficar sobre o próprio elemento — é essa checagem de desvio que reprova a versão com o offset dobrado.

## Comportamento real

**Relógio.** Passo fixo de 0,1 s. `Advance` acumula `delta × velocidade` com teto de 0,5 s e consome passos inteiros; o excedente é descartado, então uma janela suspensa por 30 s gera cinco passos, não trezentos. Velocidade aceita 0, 1 e 2; qualquer outro valor é normalizado.

**Crescimento.** `QueueGrowth(zone)` monta os mesmos *slots* de fachada que o `UrbanPlanner` usa em lote — segmentos retos, sem ponte, sem praça, sem curva ou cruzamento vizinho —, gera o candidato com `MakeCandidate`, valida com `Clear` e ainda exige que a pegada esteja em terreno já nivelado. O lote é reservado no instante em que a obra abre, então dois pedidos seguidos no mesmo distrito nunca recebem o mesmo chão. Nada é movido, nenhuma zona é repintada. Sem lote válido, devolve `false` e o motivo aparece em `StatusText` por cinco segundos simulados, na frente do resto.

**Obra.** Quatro etapas com volume próprio: marcação (estacas e corda), fundação (laje de pedra), estrutura (montantes, vigas e andaime) e cobertura (duas águas inclinadas). A peça da etapa corrente cresce continuamente até o tamanho final, em vez de aparecer de uma vez. Na conclusão, o canteiro é removido e o GLB real do catálogo é instanciado com colisão e bounds atualizados. Nenhum GLB é encolhido verticalmente e nada é revelado de uma vila pronta: as casas não existiam antes da obra.

**Agentes.** Pessoas e carroças em quantidade proporcional ao porte (3 a 14 pessoas, 1 a 4 carroças), com origem na porta de uma casa e destino na porta de um serviço, todos na mesma componente conexa. As rotas saem de busca em largura sobre a máscara de conexões recíprocas, então cada passo é cardinal e a travessia de ponte acompanha o tabuleiro. Cada tipo usa MultiMesh; a altura vem de `SurfaceHeight`, que já resolve rampa e tabuleiro.

**Árvores.** A simulação planta as próprias mudas em células livres — longe de rua e seu corredor, acesso, praça, lote, água e props existentes, e em terreno de nível uniforme. Cada muda tem geometria própria; a adulta ganha colisão, e quando morre e é removida, malha e colisor somem juntos. Nunca fica obstáculo invisível.

## Limitações e pendências

1. **Estado só em memória.** Regenerar o mapa ou fechar o aplicativo descarta obras, casas crescidas, agentes e mudas. Não há importador nem exportador; nada foi acrescentado ao contrato v4, conforme combinado.
2. **A ecologia cobre apenas as árvores da simulação.** As árvores do mapa gerado estão nos MultiMesh estáticos e nos colisores criados por `VillageScene.Build`; removê-las exigiria mexer no batching compartilhado, que está fora do meu escopo. Elas ficam intactas — nem envelhecem nem morrem. **Esta é a pendência principal.** Para cobri-las seria preciso, numa etapa conjunta, extrair os props de árvore do batch estático para um agrupamento por setor que aceite remoção individual.
3. **Casas crescidas ficam fora de `map["buildings"]`.** Vivem no estado da simulação e como nós próprios sob `Sim_Root`. Consequência prática: a seleção e o overlay de Regiões do Codex não as enxergam, e elas não entram em `stats`. Se isso for desejável, é uma decisão de integração — o objeto JSON de cada casa já é produzido por `GrowthPlanner.Commit` e está disponível em `ConstructionSite.Building`.
4. **Cada casa concluída é um nó próprio,** não uma instância acrescentada ao MultiMesh estático. Foi a única forma de crescer sem reconstruir o batch. O custo é uma chamada de desenho por casa crescida; para dezenas de casas isso é irrelevante, para centenas valeria reagrupar.
5. **Só casas crescem.** Os quatro distritos do HUD recebem a família residencial correspondente (`cottage`/`townhouse`, `merchant`, `artisan`, `farmstead`). Não há criação de novos serviços.
6. **Sem reaplainamento de terreno.** Como não posso reconstruir a malha estática, o crescimento recusa pegadas desniveladas em vez de criar rampa artificial. Em mapas muito acidentados isso reduz os lotes disponíveis — a recusa vem com motivo no `StatusText`.
7. **Agentes são estilizados.** Pessoas são cápsulas, carroças são caixa com duas rodas cilíndricas; sem física de rodas, sem desvio entre agentes, sem economia, combate ou interiores. Eles param um instante ao chegar e voltam.
8. **A parte visual não foi inspecionada em janela.** O smoke é headless e valida nós, contagens e contrato, não estética. A revisão visual fica com o Codex, como combinado.

## Integração

O contrato está pronto e o HUD já faz tudo o que é preciso; `_simulationControls` deixa de ficar desabilitado sozinho, porque `SimulationHost.Create` passa a devolver instância. Pontos a conferir na integração:

- **`ResetSimulation()` já está correto:** `Dispose()` antes de trocar o mapa, `Create` depois de `Build`. `Dispose` remove `Sim_Root` inteiro e desregistra os obstáculos que a simulação havia adicionado, então o passeio continua válido — verificado no smoke.
- **`Advance` só quando a janela tem foco** já é o comportamento em `NativeMenus.UpdateSimulation`, e combina com o teto de atraso do relógio.
- **`IsRunning`** fica falso quando pausado ou quando não há obra, agente nem muda, para a viewport poder parar de redesenhar.
- **Prefixo `Sim_`** em todos os nós criados: `Sim_Root`, `Sim_Sites`, `Sim_Flora`, `Sim_People`, `Sim_Carts`, `Sim_CartWheels`, `Sim_Site_N`, `Sim_Building_N`, `Sim_Tree_N`.
- **Ajustes gráficos:** `ApplyPresentation` percorre os filhos de `world` e ignora o que não é `MultiMeshInstance3D` com `authoredMaterial`, então os nós da simulação não são afetados. Se a intenção for que a densidade de copas também alcance as mudas, é uma mudança na apresentação do Codex, não aqui.
- **Reexecutar o smoke** depois da integração: `& $VillageGodot --headless --path native res://Simulation/SimulationSmoke.tscn`. Ele é autocontido e não publica nada.

O projeto compila sem erros e sem avisos. Um build completo com as alterações concorrentes ainda não foi feito — conforme combinado, deixei a compilação conjunta e a publicação para quando o trabalho paralelo estiver estável.
