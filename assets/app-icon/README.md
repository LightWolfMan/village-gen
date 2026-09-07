# Ícone do VillageGen

## Atual — flat, legível em tamanho pequeno — 7 de setembro de 2026

Substituída a vila isométrica detalhada por duas casas frontais, telhados terracota/ocre, paredes claras e contorno escuro. Criado com ImageGen integrado, orientado pelas skills de produção visual e geração de imagens. PNG original com transparência real em `village-icon.png`; exportação determinística por `node tools/build-icon.mjs` em sete tamanhos (16, 24, 32, 48, 64, 128, 256). `village.ico` identifica o executável; `villagegen-flat.ico` usa nome novo no atalho para evitar o cache da versão anterior. Prévia dos tamanhos pequenos inspecionada em `.cache/flat-icon-sizes.png`. Backup em `.cache/before-flat-icon/`.

Prompt (ImageGen integrado, uma imagem):

> Use case: logo-brand. One finished flat Windows desktop app icon for VillageGen, a procedural medieval village generator. A bold compact symbol of exactly two adjoining houses seen straight on: a dominant simple terracotta gable roof and a smaller ochre gable roof behind it, warm ivory solid house bodies, one single broad dark slate door cutout. Thick dark slate outer silhouette for legibility on light and dark desktops. Geometric flat vector-like shapes, solid colors only, no textures, no gradients, no shadows, no perspective, no terrain tile, no trees, no outlines on interior details, no windows, no chimneys, no text or letters. Designed first for 16 and 32 pixel recognition; very few large shapes and generous simple negative spaces. Centered square composition symbol fills 88% of canvas. Genuinely transparent background outside house silhouette. One icon only, not sheet, not mockup.

## Histórico — versão detalhada — 7 de setembro de 2026

Novo ícone criado com ImageGen integrado, sem CLI: vila isométrica sobre um tile, sem o antigo fundo verde. `village-icon.png` é a imagem gerada; `village.ico` identifica o aplicativo e `villagegen.ico` é a cópia usada no atalho, com novo nome para evitar reutilizar o cache do ícone anterior. Sete resoluções de 16 a 256 px, exportadas pelo script existente. Originais anteriores preservados em `.cache/before-villagegen-icon/`. Para reproduzir: `node tools/build-icon.mjs`, seguido de cópia de `village.ico` para `villagegen.ico`.

Prompt atual (ImageGen integrado):

> Use case: logo-brand. Create one premium Windows desktop application icon for VillageGen, a procedural medieval village generator. A compact isometric miniature village: one dominant cream timber house with terracotta roof, a second smaller roof, branching stone lane and one sculpted tree, sitting on a thick beveled diamond terrain tile. Distinct bold silhouette and large simple masses, tasteful stylized 3D game art, crisp warm lighting and subtle ambient shadows. Designed to remain recognizable at 32 pixels. Centered icon fills 85 percent of square composition. Truly transparent background outside the tile, no background scene, no text, no letters, no border, no watermark. Restrained cream, terracotta and slate palette with small natural foliage accent. One single icon only, not a sheet.

## Histórico — versão anterior

Criado em 2026-09-05 com a ferramenta integrada ImageGen, sem CLI ou assets de outros jogos. A direção visual usa uma vila isométrica com telhados terracota e fundo verde, coerente com a interface. A skill de produção visual orientou contraste, composição e exportação; o quadro visual não estava disponível por chamada direta nesta sessão.

`village-icon.png` preserva o original gerado. `village.ico` contém sete imagens PNG RGBA de 16, 24, 32, 48, 64, 128 e 256 pixels para o atalho Windows. `favicon.png` tem 64 × 64 pixels e identifica a aba do navegador. O redimensionamento e o empacotamento são determinísticos, sem alterações criativas adicionais. Para reproduzir os derivados, execute `node tools/build-icon.mjs` com as dependências de desenvolvimento e Chrome instalado. A distribuição do app usa somente os arquivos prontos.

## Prompt utilizado

Create one polished Windows desktop application icon for Village, a procedural medieval village generator. Square 1:1 composition, a single centered rounded-square dark forest green badge with transparent background outside the badge. Inside: a simple charming isometric miniature village symbol, one prominent warm cream timber cottage with a bold terracotta gabled roof in front and two smaller roof silhouettes behind, a small sage-green tree, and a warm gold path on a compact green ground diamond. Sculpted stylized 3D appearance with clean graphic shapes, excellent contrast, restrained soft lighting, thick readable silhouette, large elements and minimal tiny detail so recognizable at 32 pixels. Finished professional app icon, generous safe margin, no text, no lettering, no numbers, no watermark, no mockup, no surrounding interface. Output one high-resolution image. Palette forest green #14221c, sage #9ac76c, terracotta #b76642, cream #f1edda, gold #e6bc62.
