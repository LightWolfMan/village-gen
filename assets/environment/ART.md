# Ambiente pré-renderizado da Village v3

As ruas, pontes, árvores, plantas e objetos desta entrega são modelos originais construídos pelo script `tools/blender/render_environment.py` e renderizados localmente no Blender 4.5.5 LTS. Não há textura, modelo ou sprite proprietário de SimCity ou de qualquer outro jogo.

`assets/environment` contém três superfícies viárias e dez peças de ponte. A rua secundária usa terra batida, sulcos de carroça e pedras esparsas; a via principal usa calçamento irregular; a praça usa pedras mais claras e densas. Cada eixo `ew` e `ns` possui `single`, `start`, `middle`, `post` e `end`. Tabuleiro e corrimãos chegam às bordas do tile; nenhuma peça possui fechamento transversal interno. `start` e `end` recebem encontro de pedra, `single` recebe os dois e `post` é usado somente a cada três tiles internos. O manifesto schema 2 fornece a âncora de chão e a largura-base usada pelo renderer; se um arquivo faltar, o Canvas desenha a mesma topologia.

Os antigos `bridge-ew.png`, `bridge-ns.png` e `bridge-cross.png` não fazem parte do contrato e são removidos pelo pipeline antes da renderização. Pontes v3 são exclusivamente retas e o núcleo nunca solicita uma peça de canto ou cruzamento sobre água.

O mesmo pipeline gera dez props em `assets/props`: carvalho temperado, pinheiro nevado, cacto, salgueiro, rocha, arbusto, juncos, poço, carroça e palheiro. Todos são PNG RGBA transparentes, sem cenário e com escala contratada pelo renderer.

Execute `npm run art:environment` para recriar vias, pontes e props, ou `npm run art:all` para regenerar toda a arte Blender. Os modelos intermediários não são armazenados porque os scripts são a fonte autoral e reproduzível.
