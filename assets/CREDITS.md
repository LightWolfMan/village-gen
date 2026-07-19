# Créditos de arte

O projeto foi concebido para usar como referência visual o pacote **Ninja Adventure — Asset Pack**, criado por Pixel-Boy e colaboradores, disponibilizado sob a licença Creative Commons Zero (CC0 1.0).

Fonte oficial: https://pixel-boy.itch.io/ninja-adventure-asset-pack

Esta versão incorpora localmente uma seleção do tileset oficial:

- `ninja-floor.png` fornece as texturas de terreno (grama, campo seco, areia, terra, neve e
  água), amostradas por `src/render/atlas.js` com variação por coordenada para um tapete
  orgânico e sem emenda. Também é a base das estradas de terra.
- `ninja-village.png` fornece sprites de edifícios (casa, casarão) e de árvores/arbustos.

Serviços (taverna, ferreiro, capela, mercado, moinho, torre), poços, cercas, hortas e demais
detalhes são desenhados por código na mesma escala de pixel art, com paletas de material
(sapê, telha, madeira, pedra) que variam por instância. Quando as folhas de arte não carregam,
o renderizador cai para um desenho procedural equivalente. Assim o aplicativo permanece offline
e evita redistribuir o pacote completo (~89 MB).
