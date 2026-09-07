# Tarefa independente — simulação do VillageGen

## Pedido para encaminhar ao Claude

Implemente a primeira versão funcional de crescimento orgânico por território no VillageGen, Godot 4.7.2 C#, offline. Trabalhe em paralelo ao Codex sem sobrescrever o trabalho dele. Preserve o estado atual e faça testes proporcionais, economizando leituras e tokens. Não instale outra engine nem biblioteca de física. Ferramentas locais estão em `workbench`; consulte `tools/native-env.ps1`.

### Divisão e propriedade de arquivos

Codex está trabalhando em HUD, menus Ajustes/Regiões/Visão/Simulação, opções gráficas, seleção, clique direito para passear, tooltip/ícones e tempo em segundos. **Não edite** `native/Native*.cs`, `native/Rendering/VillageScene.cs`, `native/Rendering/VillageDetails.cs`, `native/Rendering/VillagePresentation.cs`, assets de UI, scripts de publicação/atalho ou `PROJETO.md` durante o trabalho paralelo. Não publique em `dist` nem abra/feche o aplicativo do usuário.

Você pode criar/editar `native/Simulation/**`, `native/Core/Simulation/**`, `native/SimulationTests/**` e `native/Rendering/VillageSimulationIntegration.cs` (nova parte de `partial class VillageScene`). Se realmente precisar expor algo do planejador, faça a menor mudança em `native/Core/UrbanPlanner.cs`, preservando geração em lote. Nenhum outro agente vai editar esse arquivo nesta etapa. Não altere catálogos/GLBs nesta entrega: reutilize modelos existentes ou geometria procedural leve. Leia arquivos de outras áreas quando necessário, mas não os modifique. Registre entrega e pendências em `SIMULACAO-ENTREGA.md`.

### Contrato de integração pronto

`native/Simulation/IVillageSimulation.cs` define `IVillageSimulation` e `SimulationHost.Create(VillageScene scene, JsonObject map)`. **Mantenha as assinaturas.** Substitua o retorno `null` da fábrica por uma implementação real. Codex chamará a fábrica após cada geração, chamará `Advance(delta)` a cada frame e `Dispose()` antes da troca do mapa. O HUD controla `Speed` (0/1/2), `PeopleEnabled`, `VehiclesEnabled`, `EcologyEnabled`; mostra `StatusText`; chama `QueueGrowth(zone)` com residential/commercial/craft/agricultural. `IsRunning` informa se a viewport precisa continuar desenhando. O módulo deve criar seus próprios nós sob a cena recebida. Não capture teclado, mouse ou crie HUD.

### Escopo funcional prioritário

1. Relógio determinístico de passos fixos, pausa/1×/2×, limite de atraso acumulado e descarte correto. Nada de simular o tempo perdido em aba/janela suspensa.
2. `QueueGrowth(zone)` procura e reserva **novo lote livre** no distrito escolhido, junto à via já existente. Use o algoritmo de fachadas/footprints do projeto, não posições aleatórias. Respeite bounds reais rotacionados, lotes ocupados, água, props, árvores, curvas/cruzamentos, acesso à porta e quotas quando aplicável. Nunca mova casas existentes ou repinte outro distrito para forçar sucesso. Se não houver local válido, retorne false e informe a razão em StatusText.
3. Obra visível em etapas: marcação/fundação → estrutura/andaimes → cobertura → edifício concluído. Não encolha verticalmente um GLB inteiro, nem revele aos poucos uma vila que já estava pronta. Integre somente o lote/setor afetado; não regenere o mapa inteiro a cada tick. Preserve as vias como referência de fachada. Sem rampas artificiais de acesso.
4. Pessoas e carroças medievais em pequena quantidade, usando a rede **cardinal conectada** de vias e pontes, com destinos simples casa↔serviço/trabalho. Sem atravessar água, construções ou sair das pontes. Reutilize geometria/material, preferindo MultiMesh. Não prometa trânsito completo, combate, economia ou interiores. Pessoas podem ser representações estilizadas simples; carroças não precisam de física de rodas.
5. Árvores com estados jovem/adulta/morta e reposição controlada; nunca nascer sobre ruas, acessos ou lotes. Não mover/desativar árvores em renderização mantendo obstáculos invisíveis. Se a ecologia segura não couber, documente como pendente em vez de simular um toggle falso.

### Segurança e limites da primeira entrega

Não comprometa colisão, passeio, exportação ou determinismo da geração estática. Árvores/edifícios em obra precisam de volumes coerentes; atualizar somente a aparência não basta. O renderer atual agrupa modelos e materiais: use a parte `VillageSimulationIntegration.cs` para hooks incrementais e evite alterar batching estático. O Codex identifica elementos estáticos por metadados e nomes em sua própria parte de apresentação; use prefixo `Sim_` nos nós novos.

Uma primeira versão apenas em memória é aceitável, mas indique claramente que regenerar ou fechar descarta o progresso. Não adicione importadores de mapas antigos. Se exportar estado, mantenha-o separado do contrato v4 até revisão conjunta.

### Testes e entrega

Teste relógio com delta variável, pausa e 2×; determinismo da mesma sequência; lote novo seco e não sobreposto; limites e acessos; falha limpa quando não há lote; conclusão de obra; rotas dos agentes conectadas e pontes nos dois eixos; ciclo de árvore sem obstrução e limpeza após Dispose. Faça um smoke em uma pasta `.cache/claude-simulation-*`, sem publicar na distribuição. Pode compilar seu projeto isolado; coordene um build completo só quando as alterações concorrentes estiverem estáveis.

Ao concluir, escreva `SIMULACAO-ENTREGA.md` com arquivos alterados, comandos/testes executados, comportamento real, limitações e instruções de integração. Não declare implementado o que ficou apenas como interface/stub. O Codex fará integração final, revisão visual e publicação/atalho depois.
