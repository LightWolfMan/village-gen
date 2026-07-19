# Edifícios pré-renderizados da Village v2.3

## Origem e contrato

Os vinte PNGs deste diretório são arte original construída proceduralmente no Blender 4.5.5 LTS pelo script `tools/blender/render_temperate_buildings.py`. O piloto não incorpora modelos, texturas ou materiais de terceiros. O Medieval Village MegaKit da Quaternius foi avaliado como fonte CC0 para uma expansão futura, mas o pacote completo não foi mantido nem redistribuído nesta entrega.

Cada uma das famílias `cottage`, `townhouse`, `workshop`, `civic` e `farmstead` possui as orientações `north`, `east`, `south` e `west`. Os arquivos são PNG RGBA 256×256 com fundo transparente. `manifest.json` registra dimensões, footprint canônico, centro do chão e posição visual da porta; o renderer usa esses dados para alinhar e dimensionar o sprite sem deformação.

O conjunto inteiro ocupa aproximadamente 542 KiB. O modelo 3D intermediário não é salvo: isso evita arquivos `.blend` redundantes e torna o script Python a fonte reproduzível da arte.

## Câmera e iluminação

A câmera é ortográfica, com azimute de 45 graus e elevação de 30 graus. Uma unidade Blender corresponde a um tile; com `ortho_scale` de aproximadamente 11,3137, os eixos projetam exatamente os vetores de 16×8 pixels usados pelo losango 32×16 do Canvas.

O render usa Eevee, 64 amostras, fundo transparente, luz principal quente superior esquerda, preenchimento frio suave e materiais de alta rugosidade. Sombras internas e oclusão dão volume aos modelos; a sombra projetada no terreno continua sendo responsabilidade do renderer para permanecer coerente com árvores, props e relevo.

## Regeneração

Com Blender e PowerShell 7 instalados, execute na raiz do projeto:

```powershell
npm run art:buildings
```

O comando substitui os vinte PNGs e recria `manifest.json`. Arquivos completos de pacotes 3D, caches e cenas temporárias devem ficar em `.cache/blender`, ignorado pelo Git. Para acrescentar uma família, crie seu builder no script, inclua-o em `builders` e regenere o conjunto; o navegador não executa Blender.
