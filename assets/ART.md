# Arte VillageGen

Revisão de vegetação/arquitetura: 160 GLBs arquitetônicos (40 por bioma), 15 objetos e cinco módulos de ponte. Ramos de árvores são geometria compartilhada, com folhagem de baixa subdivisão. Ícones coloridos dos submenus vêm do Microsoft Fluent Emoji (MIT); arquivos, revisão e licença em `native/assets/ui/color/`. `--props-only` no exportador Blender atualiza objetos preservando as entradas arquitetônicas do catálogo.

O HUD usa uma seleção externa de ícones Lucide 0.468.0, em `native/assets/ui/`, com licenças ISC/MIT preservadas. Eles são distribuídos offline e tintados pelo tema. Isso não altera a autoria dos modelos 3D descritos abaixo.

## Acabamento nativo em tempo de execução

O renderer Godot acrescenta materiais procedurais de pedra, madeira, reboco e telhado, sem novas texturas. `native/Rendering/VillageDetails.cs` concentra esses shaders, a grama agrupada por setores e a preparação de acessos; o renderer também acrescenta pequenas lanternas decorativas nas entradas compatíveis. Essas melhorias pertencem à versão nativa, não ao renderer web arquivado. Vidros usam clearcoat e uma captura estática do ambiente; as lanternas não emitem luz dinâmica sobre a cena.

As correções de maçanetas, recortes de vigas, divisões de janelas, fechamento inferior dos telhados e apoios de varanda são geometria Blender, incorporada aos GLBs reexportados. O detalhe precisa existir antes da união por material, pois o arquivo final não preserva uma malha individual para cada janela. O catálogo medido é regenerado junto dos arquivos; seu contrato permanece o mesmo. Teste de aberturas: Blender em background com `--python-exit-code 1 --python tools/blender/test_openings.py`.

Toda a geometria de edifícios, vegetação, objetos e pontes é autoral e reproduzível com Blender pelo comando `npm run art:models`. O navegador usa GLBs reais, não sprites ou vistas pré-renderizadas. Não há arte externa incorporada.

`models/catalog.js` e `models/catalog.json` registram dimensões medidas no mesmo processo de exportação. São 160 edifícios, 15 objetos e cinco módulos de ponte. A geometria usa Y vertical, frente +Z e uma unidade por tile; o catálogo inclui a posição real da soleira, footprint, bounds e rotações. O renderer instancia os modelos sem redimensionar os edifícios.

Os quatro biomas têm estilos geométricos diferentes. As famílias incluem habitações, comércio, produção e serviços; anexos, pátios, coberturas abertas, chaminés, vitrines e equipamentos variam por programa. Há modelos próprios para capela e torre. A variante declarada pela construção resolve diretamente um GLB.

Os módulos de ponte ocupam exatamente uma unidade no eixo X. As peças intermediárias não têm fechamento transversal; os postes internos são espaçados pelo contrato do span. Para travessias no eixo Z, aplicar rotação Y=−90°. Materiais usam cores e rugosidade, sem texturas externas.

O pipeline e os comandos detalhados estão em `tools/blender/README.md`. A dependência de renderização Three.js tem licença MIT preservada em `vendor/three/LICENSE`; ela não altera a autoria dos modelos.
