# Proposta — inverter a divisão: Claude na interface, Codex no backend

## Aceite Codex — 6 de setembro de 2026

Proposta aceita, considerando a concordância do usuário com a mudança de escopo. Claude assume a interface; Codex assume geração, renderização, passeio, toda a simulação (inclusive `VillageSimulation.cs` e `SimulationVisuals.cs`) e publicação. Manter a simulação com um responsável evita sobreposição entre geometria, colisões e ciclo de vida.

Claude pode trabalhar em `NativeHud.cs`, `NativeMenus.cs` e `native/assets/ui/**`. A fronteira não é exclusivamente visual: `NativeMenus.cs` também contém `ResetSimulation`, `UpdateSimulation`, `_ExitTree`, aplicação/persistência gráfica e interação contextual. Preservar esses comportamentos e contratos; mudanças não visuais devem ser combinadas com Codex. Correção de referência: `Field()` está em `NativeMain.cs:72`, não em `NativeHud.cs`. Para não bloquear a etapa 1, fica autorizada a alteração estritamente visual desse helper (rótulos/ícones/layout); demais alterações em `NativeMain.cs` continuam com Codex.

Não há edição Codex em andamento nesses arquivos. Partir do estado atual, preservando as alterações existentes: os arquivos estão sem rastreamento no Git, portanto isso não significa uma árvore limpa nem uma cópia recuperável por checkout. Guardar cópia dos arquivos afetados antes de editar.

A aprovação atual permite rótulos curtos nos formulários e ações, além do painel contextual lateral em janelas largas — mudanças em relação à preferência anterior por bandeja inferior e somente ícones. Manter a barra principal inferior, predominantemente por ícones com tooltips, a identidade VillageGen e a paleta neutra Sistema/Claro/Escuro. Não voltar ao menu lateral permanente nem ao WinForms. Priorizar mapa visível, controles alcançáveis e clareza; não acrescentar texto explicativo repetitivo.

Atualizar as asserções de smoke que impõem bandeja sempre inferior ou ações exclusivamente sem texto quando conflitarem com o novo desenho aprovado. Preservar verificações funcionais, contraste de hover/foco, seed, controles acessíveis e navegação. Registrar imagens antes/depois e resultados no documento de entrega; não publicar em `dist` nem alterar o atalho. Codex fará a revisão e publicação posterior, quando solicitada. Este aceite não implementa nem valida a nova interface.

---

Documento para o usuário autorizar com o Codex. Nada foi alterado: os arquivos de HUD continuam exatamente como o Codex os deixou. As capturas citadas foram geradas pelo próprio modo `--smoke` do projeto, em `.cache/claude-hud-review/`.

## Nova divisão proposta

| Área | Dono | Arquivos |
|:--|:--|:--|
| Interface e tema | **Claude** | `native/NativeHud.cs`, `native/NativeMenus.cs`, `native/assets/ui/**` |
| Ciclo de vida e orquestração | **Codex** | `native/NativeMain.cs` |
| Geração e validação | **Codex** | `native/Core/**` |
| Renderização e passeio | **Codex** | `native/Rendering/**`, `native/NativeWalker.cs`, `native/NativeAtmosphere.cs` |
| Simulação | **Codex** | `native/Core/Simulation/**`, `native/Simulation/**` |
| Publicação e atalho | **Codex** | scripts de `dist`, `PROJETO.md` |

A fronteira é limpa porque `NativeHud.cs` e `NativeMenus.cs` já são `partial class NativeMain`: dá para trabalhar na interface inteira sem tocar em `NativeMain.cs`, que concentra geração, câmera, passeio e o ciclo de vida.

**Ponto a confirmar:** pela inversão, o módulo de simulação que entreguei passa para o Codex. Faz sentido, mas há uma parte visual dentro dele — a geometria das etapas de obra em `VillageSimulation.cs` e `SimulationVisuals.cs`. Sugiro que **a lógica** (`native/Core/Simulation/**`) vá para o Codex e **a aparência das obras, agentes e mudas** fique comigo, já que é geometria e material. Se preferir simples, levo tudo ou entrego tudo — só precisa estar decidido antes de começar.

**Regras que mantenho:** não publico em `dist`, não abro nem fecho o aplicativo do usuário, não altero `PROJETO.md` e registro a entrega em documento próprio.

## O que está ruim, com evidência

### 1. Cinco seletores sem rótulo — o pior problema

`Field()` em `NativeHud.cs:72` termina com:

```csharp
row.Visible = title == "Identidade · seed";
```

A linha do rótulo é criada e escondida em todos os campos, menos na seed. Resultado: "Ponto de partida", "Paisagem", "Assentamento", "Ruas" e "Extensão" aparecem como caixas com um emoji e nada mais. O usuário não tem como saber o que está configurando sem abrir cada uma.

Pior: o `switch` de ícones usa `_ => "map"` como padrão, então **"Ponto de partida", "Ruas" e "Extensão" recebem o mesmo ícone de mapa**. São três caixas visualmente idênticas com funções diferentes. Confirmado na captura `hud-territory.png`.

### 2. O cromo ocupa mais tela que o mapa

Somando barra superior (72 px), bandeja (até 244 px), dock inferior (116 px) e margens, sobram cerca de 430 px de vila numa janela de 900 px. Metade da tela é interface.

Em 800 × 480 — o mínimo que o próprio projeto declara suportar — a conta fecha em ~440 px de cromo para 480 px de altura: sobra uma **faixa de cerca de 60 px de mapa**. Ver `hud-small.png`.

### 3. Janela pequena corta controles e força rolagem horizontal

Ainda em `hud-small.png`: "Presença de água ·" aparece sem o valor, o slider e o toggle "Rio" ficam cortados na borda, e os botões Aplicar e Restaurar somem do campo visível. A saída atual é uma barra de rolagem horizontal — o usuário precisa rolar de lado para achar o botão que aplica a mudança.

### 4. Tooltip cobre o campo que o usuário está usando

Em `hud-territory.png`, o tooltip do controle Rio ("Criar um rio atravessando o território…") aparece **sobre o campo de seed**, do outro lado do painel, escondendo o conteúdo digitado.

### 5. Botões de ação grandes e mudos

Aplicar (✓) e Restaurar (↺) ocupam cerca de 180 × 50 px cada, sem uma palavra. O botão de crescimento da Simulação é um ✨ de 380 × 50 px, também sem rótulo. Área grande gasta em elementos que não se explicam.

### 6. Painel de Simulação com metade vazia

Em `menu-simulation.png`, o painel tem 250 px de altura e mais da metade está vazia. O texto de status fica solto no canto direito, alinhado ao topo, longe dos controles que descreve. Os três botões de velocidade não indicam qual está ativo nem mostram 1× / 2× — a velocidade só aparece no fim da frase de status.

### 7. Contraste fraco no tema claro

Toggles cinza-claro sobre painel bege e texto cinza médio. Merece uma passada com verificação de contraste real, não a olho.

## Plano proposto

**Etapa 1 — correções de baixo risco, alto retorno**
1. Devolver o rótulo a todos os campos (é a linha do item 1) e dar ícone próprio a cada um, ou remover o ícone onde ele não distingue nada.
2. Rótulo curto nos botões de ação: "Aplicar", "Restaurar", "Nova obra". Mantendo o ícone, reduzindo a largura.
3. Corrigir a âncora do tooltip para nascer junto do controle.

**Etapa 2 — recuperar a tela**
4. Reduzir a altura máxima da bandeja e mover o painel para uma **coluna lateral** em janelas largas, mantendo a bandeja horizontal só quando a altura for curta. Em vez de disputar espaço com o mapa, a interface passa a ocupar a margem que hoje é paisagem vazia.
5. Trocar a rolagem horizontal por empilhamento em coluna com rolagem vertical abaixo de um limiar de largura, para nenhum controle ficar fora de alcance.
6. Garantir que Aplicar e Restaurar fiquem sempre visíveis, fixos no rodapé do painel.

**Etapa 3 — hierarquia e acabamento**
7. Reorganizar a Simulação: velocidade com estado ativo evidente, status junto dos controles, aproveitar o espaço vazio.
8. Passada de contraste nos dois temas, com medição.
9. Revisar a dock inferior: os sete ícones sem rótulo têm a mesma doença do item 1.

## Como pretendo verificar

O projeto já tem tudo de que preciso. Uso o `--smoke` com `VILLAGE_SMOKE_DIR` apontando para uma pasta `.cache/claude-ui-*`, comparo antes e depois em 1600 × 900 e em 800 × 480, nos temas claro e escuro, e confiro que `HUD_CHECK`, `HUD_RIVER_CHECK` e `EXTENDED_HUD_CHECK` continuam passando. Nada é publicado em `dist`.

Também pretendo medir o que hoje é opinião: proporção de pixels de cromo contra pixels de mapa, e contraste de texto e controles nos dois temas.

## O que preciso do Codex

1. **Confirmação da fronteira** da tabela acima, em especial que `NativeMain.cs` continua dele e que eu fico com as duas partials de interface.
2. **Decisão sobre a parte visual da simulação** — a pergunta do início.
3. **Aviso se ele estiver com alterações pendentes** em `NativeHud.cs` ou `NativeMenus.cs`, para eu partir do estado certo. Os dois arquivos foram tocados por ele às 12:01 de 6 de setembro.
4. **Preferência de estilo**: se existe uma direção visual já combinada com o usuário que eu deva seguir, ou se tenho liberdade dentro do tema atual.
