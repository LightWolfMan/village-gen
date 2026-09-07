# VillageGen

Gerador procedural de vilas medievais em 3D, com Godot C#, modelos autorais Blender e execução local/offline. A interface atual é um HUD nativo sobre o mapa, sem WinForms, navegador ou servidor. A mesma seed e as mesmas configurações reproduzem o mapa dentro da versão 4.

## Início rápido

Baixe o pacote Windows x64 na página de [Releases](https://github.com/LightWolfMan/village-gen/releases), extraia a pasta inteira e abra `Village.exe`. A prévia nativa inclui o runtime: não precisa de navegador, servidor ou instalação do .NET. Não execute o EXE isolado de seu PCK e da pasta de dados. Esta é uma versão de desenvolvimento; savegame está desativado, mas as preferências são preservadas.

No Windows, abra o atalho **VillageGen** ou execute `INICIAR.cmd`. Ambos iniciam `dist/Village/Village.exe`. Preserve a pasta inteira da distribuição, incluindo PCK e runtime. Para compilar, use `tools/build-native.ps1 -Export`; as ferramentas ficam em `workbench/`. A implementação web anterior continua no repositório como referência e pode ser executada com `npm start`, mas não é usada pelo atalho.

O botão Nova vila sorteia outra seed; Aplicar ajustes ou Enter mantém a seed informada. Ajuste várias opções de território antes de aplicar; qualidade e distritos mudam imediatamente. Arraste esquerdo move o mapa, direito gira e inclina, e a roda amplia. Centralizar enquadra as construções; Vista geral enquadra o mapa. A exportação PNG sempre contém o mapa inteiro, independentemente da câmera atual.

Para recriar o atalho com o ícone próprio, execute `powershell -NoProfile -ExecutionPolicy Bypass -File tools/create-shortcut.ps1`. `INICIAR.cmd` usa o mesmo launcher nativo. O ícone está documentado em [assets/app-icon/README.md](assets/app-icon/README.md).

## Conteúdo

A interface usa uma barra inferior por ícones e temas Sistema, Claro e Escuro. **Território** abre a geração; **Regiões** reúne zonas e seleção; **Visão** controla o enquadramento; **Ajustes** contém as opções gráficas. Clique em Passear para explorar em primeira pessoa: WASD caminha, Espaço pula, Shift corre, mouse olha e Esc pausa. O personagem sobe degraus de até 26 cm. Continuar recaptura o mouse; Voltar à vista aérea recupera o enquadramento anterior. Água, obstáculos e laterais das pontes bloqueiam passagem. Não há interiores ou corpo visível.

Há quatro biomas, traçados orgânico e em quadras, assentamentos de três escalas e distritos residencial, comercial, artesanal, agrícola e cívico. O catálogo contém 160 modelos arquitetônicos, 15 objetos e cinco módulos longitudinais de ponte. Lotes usam as dimensões reais dos modelos, incluindo anexos; edifícios não são encolhidos para caber. Coberturas publicam âncoras explícitas para apoiar ornamentos em cada bioma.

A interface mantém o mapa anterior durante a geração em tarefa C#. Regiões reúne distritos e seleção; Ajustes usa sete ícones com popups não modais. Simulação inclui crescimento de construções, pausa e velocidades, moradores, transporte e ecologia experimental. Equilibrada usa FXAA, Alta acrescenta MSAA 4× e Máxima usa supersampling 1,5×; limite de 60 fps. As limitações e verificações estão em `PROJETO.md`.

## Desenvolvimento

Execute `npm ci` para instalar as dependências de desenvolvimento. `npm test` executa os testes, `npm run check` verifica a sintaxe, e `npm run test:audit` executa a bateria de seeds e configurações. As medições reais e limitações estão em [PROJETO.md](PROJETO.md).

Para capturas e testes em Chromium, execute `npx playwright install chromium` uma vez e depois `npm run visual -- --smoke --out .cache/visual-v4`. O comando `npm run visual -- --seed visual-17 --benchmark --out .cache/visual-v4-benchmark` mede intervalos de quadros durante navegação e estabilidade de recursos na troca de mapas. A ferramenta usa o renderer WebGL real, não uma simulação Canvas.

Se o Chromium automatizado usar SwiftShader, acrescente `--channel chrome` para testar o Chrome instalado. Nesta máquina, esse canal usou a Radeon Vega 8 e atingiu aproximadamente 60 fps no cenário medido. Consulte os detalhes e as limitações em `PROJETO.md`.

`npm run art:models` regenera os GLBs e seus catálogos medidos no Blender. Consulte [a documentação de arte](assets/ART.md) e [o pipeline Blender](tools/blender/README.md). `npm run vendor` reconstrói os módulos Three locais na versão fixada.

## Licenças

Código e modelos do projeto são originais; a licença de reutilização do projeto ainda precisa ser definida pelo proprietário. Nenhuma arte de outros jogos foi incorporada. Three.js é uma dependência sob licença MIT, preservada em `vendor/three/LICENSE`. Playwright é usado somente nas ferramentas de verificação e mantém seus termos no pacote de desenvolvimento.
