# Arte original da Village v2.4

A direção visual atual é isométrica 2.5D pré-renderizada, inspirada na clareza e no volume dos city-builders clássicos sem copiar seus assets. Toda a arte de edifícios, estradas, pontes, vegetação e objetos é modelada proceduralmente nos scripts Python deste repositório e renderizada localmente pelo Blender 4.5.5 LTS. O navegador carrega apenas PNGs transparentes e manifestos JSON; portanto, o custo 3D existe somente durante a produção e o aplicativo continua leve em execução.

O comando `npm run art:all` reproduz o conjunto completo. `npm run art:buildings` recria as 48 vistas arquitetônicas e `npm run art:environment` recria vias, pontes e dez props. Os contratos detalhados ficam em `assets/buildings/ART.md` e `assets/environment/ART.md`.

Os oito props da versão 2.0 foram inicialmente explorados com ImageGen e chroma key local. Na versão 2.4, todos foram substituídos por renders Blender autorais para unificar câmera, materiais, iluminação e escala; nenhum raster antigo é necessário em runtime.
