window.MAPA = {
  "projeto": "Village-gen + Vila do Vale (fusão num jogo só)",
  "data": "2026-11-05",
  "commit": "d057912",
  "branch": "feat/fusao-zen",
  "primeira_execucao": false,
  "resumo": "O passeio zen roda dentro do projeto nativo (Godot 4.7.2 .NET, Forward+), passa por uma vila VillageGen de verdade e ganhou o pacote visual 1 (luz, névoa, paleta, chão e folhagem), ficando mais leve: p95 caiu de 30,0 pra 11,1 ms. Falta tirar a cara de enxerto: máscara de ocupação e versões de longe.",
  "partes": [
    {
      "id": "gerador",
      "nome": "Gerador VillageGen (C#)",
      "resumo": "Gera a vila: terreno, ruas, zonas, lotes e prédios. Agora também alimenta o passeio zen.",
      "status": "concluída",
      "evidencia": "native/Core; maquete antiga NATIVE_SMOKE_OK; vila mapSize 72 gerada em ~1,1 s (LOGBOOK M1a)"
    },
    {
      "id": "zen",
      "nome": "Passeio zen (Vila do Vale)",
      "resumo": "Carro na estrada, cenário, vida, áudio e moinho, dentro de native/. Casas hobbit e NPCs delas saíram.",
      "status": "concluída",
      "evidencia": "commits d7f3c88 e aea2863; testes headless verdes em d057912"
    },
    {
      "id": "mudanca",
      "nome": "Casa nova e testes (M0)",
      "resumo": "Vila na raiz de native/, cena zen_main.tscn, Forward+, run-zen/run-maquete. Testes leves via tools/run-godot-test.ps1 (headless, prioridade baixa, metade dos núcleos; timeout 300 s, -Log e -Extra).",
      "status": "concluída",
      "evidencia": "commit d825ce5; checks headless em 16-22 s (antes 55-64 s), pedido do Alisson; assets nature/pbr (~300 MB) fora do git"
    },
    {
      "id": "vila-estrada",
      "nome": "Vila ao lado da estrada (M1a)",
      "resumo": "Vila VillageGen real à esquerda da estrada (z≈-200), S = 1,5 m, ramal até a rua, prédios assentados, paleta coesa e tom por casa.",
      "status": "concluída",
      "evidencia": "commits d7f3c88 e aea2863; paleta e house_tint em d057912"
    },
    {
      "id": "visual",
      "nome": "Visual do passeio",
      "resumo": "Pacote 1 pronto: luz, névoa leve, paleta, chão com terrain.gdshader, grama na vila, árvores e pedras de verdade, folhas com corte por alfa. Pacote 2 na fila: estrada pintada, fumaça, árvore média nova, flag --low.",
      "status": "em andamento",
      "evidencia": "commit d057912; LOGBOOK 2026-11-05 (workflow melhorias-grafico-zen + 2 críticos); antes/depois em .cache/gfx/ab4-*.jpg"
    },
    {
      "id": "acabamento",
      "nome": "Sem cara de enxerto (M1b)",
      "resumo": "Desempenho já medido e folgado. Faltam a máscara de ocupação (road_distance 0 no ramal e ruas, fauna fora do site), versões simples de longe e testes da máscara.",
      "status": "em andamento",
      "evidencia": "-Benchmark em d057912: p95 11,1 ms contra teto ≈33 ms; máscara e proxies ainda não feitos"
    },
    {
      "id": "estrada-sem-fim",
      "nome": "Estrada sem fim com vilas (M2)",
      "resumo": "Uma vila a cada ~960 m, geradas em segundo plano e guardadas em cache. Hoje há um único site fixo (vale:site:-1).",
      "status": "não iniciada",
      "evidencia": "Vem depois do M1b"
    },
    {
      "id": "executavel",
      "nome": "Executável único (M3)",
      "resumo": "Export do jogo fundido com shader baker. Pendência do M0: o export já sai com a cena zen, e os .cmd de dist/ usam o EXE antigo.",
      "status": "não iniciada",
      "evidencia": "LOGBOOK 2026-11-03: build-native.ps1 -Export — tratar no M3"
    },
    {
      "id": "vila-viva",
      "nome": "Protótipo web Vila Viva",
      "resumo": "prototype/vila-relampago: partidas curtas, colheita e loja. Último trabalho antes da fusão.",
      "status": "travada",
      "esperando": "decisão do Alisson: fica em pausa até a fusão chegar a um marco jogável",
      "evidencia": "commits d923ada e f09bb02; pausado por decisão (LOGBOOK)"
    }
  ],
  "marcos": [
    {"id": "M0", "nome": "Mudança de casa", "status": "concluída", "total": 6, "feitos": 6},
    {"id": "M1a", "nome": "Uma vila de verdade ao lado da estrada", "status": "concluída", "total": 6, "feitos": 6},
    {"id": "M1b", "nome": "Sem cara de enxerto", "status": "em andamento", "total": 4, "feitos": 1},
    {"id": "M2", "nome": "Estrada sem fim com vilas", "status": "não iniciada", "total": 3, "feitos": 0},
    {"id": "M3", "nome": "Um executável", "status": "não iniciada", "total": 1, "feitos": 0},
    {"id": "M4", "nome": "NPCs nas ruas (opcional)", "status": "não iniciada", "total": 1, "feitos": 0, "opcional": true}
  ],
  "proximo_marco": {
    "id": "M1b",
    "nome": "Sem cara de enxerto",
    "faltam": 3,
    "itens_feitos": [
      "Desempenho dentro do baseline: avg 7,95 ms, p95 11,1 ms (teto ≈33 ms)"
    ],
    "itens_faltando": [
      "Máscara de ocupação: road_distance 0 no ramal e nas ruas, fauna fora do site",
      "Versões simples da vila vistas de longe (proxies)",
      "Testes cobrindo a máscara (zen_checks/zen_controls)"
    ]
  },
  "proximo_passo": {
    "acao": "Fazer a máscara de ocupação (road_distance 0 no ramal e nas ruas, fauna fora do site) já com uma checagem nova no zen_checks.",
    "porque": "Com o desempenho folgado (p95 11,1 ms), os proxies de longe não têm pressa; a máscara fecha 2 dos 3 itens que faltam do M1b de uma vez e é o que mais denuncia o enxerto de perto."
  },
  "decisoes": [
    {"pergunta": "M1b ou pacote visual 2 primeiro?", "opcoes": ["M1b primeiro, visual depois", "Intercalar", "Visual primeiro"], "padrao": "M1b primeiro, visual depois (estrada pintada, fumaça, árvore média, --low)", "desde": "2026-11-05"},
    {"pergunta": "Qual projeto é a casa do jogo fundido?", "opcoes": ["Village-gen/native", "Vila-do-Vale"], "padrao": "Village-gen/native (Godot 4.7.2 .NET)", "desde": "2026-11-03"},
    {"pergunta": "Qual renderer?", "opcoes": ["Forward+ padrão, Mobile com --low", "Só Mobile", "Só Forward+"], "padrao": "Forward+ padrão, Mobile com --low", "desde": "2026-11-03"},
    {"pergunta": "Escala da vila (metros por tile)?", "opcoes": ["1,0 m", "1,5 m", "2,0 m"], "padrao": "S = 1,5 m por tile", "desde": "2026-11-03"},
    {"pergunta": "Como se entra na vila?", "opcoes": ["Carro só até o ramal, vila a pé", "Carro entra na vila"], "padrao": "Carro só até o ramal, vila a pé", "desde": "2026-11-03"},
    {"pergunta": "Distância entre vilas na estrada?", "opcoes": ["~480 m", "~960 m", "~1920 m"], "padrao": "Uma vila a cada ~960 m", "desde": "2026-11-03"},
    {"pergunta": "Tamanho e tipo da vila gerada?", "opcoes": ["mapSize 48", "mapSize 72 'village'", "mapSize 96"], "padrao": "mapSize 72 'village'", "desde": "2026-11-03"},
    {"pergunta": "Biomas até o M2?", "opcoes": ["Só temperate", "Vários biomas"], "padrao": "Só temperate até o M2", "desde": "2026-11-03"},
    {"pergunta": "O que é o M4?", "opcoes": ["NPCs simples andando", "NPCs com rotina (Vila Viva)", "Pular o M4"], "padrao": "NPCs simples", "desde": "2026-11-03"}
  ],
  "decisoes_resolvidas": [
    {"pergunta": "Como corrigir os materiais desbotados?", "resposta": "Ajuste em runtime por material; depois virou paleta coesa por nome de material (PALETTE em zen_village.gd)", "em": "2026-11-03"},
    {"pergunta": "Amostras dos materiais no zen_warmup?", "resposta": "Descartado pela revisão: a vila já está nos 49 setores do warmup", "em": "2026-11-03"},
    {"pergunta": "Tonemap: Filmic ou AgX?", "resposta": "Filmic mantido (AgX com saturação <1 deixaria cinza, segundo os dois críticos)", "em": "2026-11-05"}
  ],
  "desempenho": {
    "fonte": "zen_drive_test --short, run-godot-test.ps1 -Benchmark, RX 7600 XT, Forward+ (LOGBOOK 2026-11-05)",
    "nova": {"avg": 7.95, "p95": 11.1, "max": 141.7, "acima_33": 2, "rotulo": "pacote visual 1 (d057912)"},
    "antiga": {"avg": 12.7, "p95": 30.0, "max": 141.8, "acima_33": 81, "rotulo": "M0 (d825ce5)"},
    "limite_m1b": "Teto do M1b: p95 ≈33 ms. Hoje 11,1 ms, com folga de ~22 ms pra proxies e mais vilas. O pico de 141,7 ms é único e já existia.",
    "testes": "Testes headless verdes; run-godot-test.ps1 com prioridade baixa e metade dos núcleos, timeout padrão 300 s."
  },
  "fila_visual": [
    {"item": "Trocar a árvore de distância média (acácia Poly Haven é rala)", "quando": "depois"},
    {"item": "Estrada pintada no terreno com borda irregular", "quando": "depois"},
    {"item": "Fumaça de chaminé", "quando": "depois"},
    {"item": "Flag --low de verdade (Mobile)", "quando": "depois"},
    {"item": "Sombra de nuvem no terrain.gdshader", "quando": "mais tarde"},
    {"item": "Lanternas e janelas acesas", "quando": "mais tarde"},
    {"item": "Ciclo de luz (dia/tarde)", "quando": "mais tarde"},
    {"item": "Moradores", "quando": "mais tarde (ver M4)"}
  ],
  "riscos": [
    {"risco": "Estrada e fauna invadindo a vila", "detalhe": "Sem máscara de ocupação, road_distance e fauna ainda não sabem onde a vila está (ramal e ruas).", "nivel": "médio"},
    {"risco": "--low ainda não existe", "detalhe": "A decisão diz Mobile com --low, mas a flag ainda não está implementada; PCs fracos não têm saída.", "nivel": "baixo"},
    {"risco": "Vila vista de longe sem versão simples", "detalhe": "Props têm visibility_range 80/140 m, os prédios ainda não têm proxy.", "nivel": "baixo"},
    {"risco": "Export aponta pra cena zen", "detalhe": "build-native.ps1 -Export já sai com o zen; os .cmd de dist/ seguem no EXE antigo. Tratar no M3.", "nivel": "baixo"}
  ],
  "paineis": [
    {"id": "checklist", "titulo": "Checklist do M1b", "motivo": "Faltam 3 itens no M1b; a lista mostra o que já foi riscado (desempenho) e o que ainda denuncia o enxerto."},
    {"id": "desempenho", "titulo": "Desempenho: antes x agora", "motivo": "O pacote visual 1 baixou o p95 de 30,0 pra 11,1 ms; mostrar a folga até o teto diz quanto sobra pra proxies e pras vilas do M2."},
    {"id": "fila-visual", "titulo": "Fila do visual", "motivo": "Há uma fila de melhorias visuais anotadas como 'depois'; deixá-la à vista ajuda a decidir quando encaixar entre os itens do M1b."},
    {"id": "riscos", "titulo": "Riscos que sobraram", "motivo": "O risco do p95 sumiu; os que restam (máscara, --low, longe, export) são poucos e apontam a ordem do trabalho."}
  ],
  "mudancas": [
    {"id": "visual", "de": "não existia", "para": "pacote visual 1 concluído (d057912); pacote 2 na fila"},
    {"id": "acabamento", "de": "0 de 4, desempenho sem medição", "para": "1 de 4: p95 11,1 ms (antes 30,0)"},
    {"id": "mudanca", "de": "M0 e testes em partes separadas", "para": "juntos em 'Casa nova e testes'; runner com timeout 300 s"}
  ]
}
;
