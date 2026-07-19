# Ambiente pré-renderizado da Village v2.4

As ruas, pontes, árvores, plantas e objetos desta entrega são modelos originais construídos pelo script `tools/blender/render_environment.py` e renderizados localmente no Blender 4.5.5 LTS. Não há textura, modelo ou sprite proprietário de SimCity ou de qualquer outro jogo.

`assets/environment` contém três superfícies viárias e três pontes. A rua secundária usa terra batida, sulcos de carroça e pedras esparsas; a via principal usa calçamento irregular; a praça usa pedras mais claras e densas. As pontes `ew`, `ns` e `cross` têm tabuleiro de carvalho, tábuas individualizadas e guarda-corpos. `manifest.json` fornece a âncora de chão e a largura-base de tile usada pelo renderer; se um arquivo faltar, o desenho Canvas anterior continua disponível como fallback.

O mesmo pipeline gera dez props em `assets/props`: carvalho temperado, pinheiro nevado, cacto, salgueiro, rocha, arbusto, juncos, poço, carroça e palheiro. Todos são PNG RGBA transparentes, sem cenário e com escala contratada pelo renderer.

Execute `npm run art:environment` para recriar vias, pontes e props, ou `npm run art:all` para regenerar toda a arte Blender. Os modelos intermediários não são armazenados porque os scripts são a fonte autoral e reproduzível.
