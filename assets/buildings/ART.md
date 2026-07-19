# Edifícios pré-renderizados da Village v2.4

## Origem e contrato

Os 48 PNGs deste diretório são arte original construída proceduralmente no Blender 4.5.5 LTS pelo script `tools/blender/render_temperate_buildings.py`. Nenhum modelo, textura ou material de terceiro é incorporado. O modelo 3D intermediário não é salvo; o script Python é a fonte reproduzível da arte e evita cenas e caches sem uso no projeto.

Cada família possui as orientações `north`, `east`, `south` e `west`. As famílias residenciais são `cottage` e `townhouse`; `farmstead` atende a zona rural; `civic` atende edifícios comunitários; e `workshop` permanece como contingência genérica. A versão 2.4 acrescenta arquitetura dedicada para `inn`, `shop`, `merchant`, `artisan`, `smithy`, `market` e `mill`.

A separação não é uma troca de cores. Hospedarias têm anexo, placa e barris; lojas têm vitrine e toldo; casas mercantis têm fachada comercial e sacada; artesãos usam bancada e cobertura de trabalho; ferrarias possuem forja, chaminé e bigorna; mercados são pavilhões abertos; moinhos têm roda, grãos e sinalização frontal. A faixa central da entrada permanece livre de objetos visuais.

Os arquivos são PNG RGBA 256×256 com fundo transparente. `manifest.json` registra dimensões, footprint canônico, centro do chão e posição visual da porta; o renderer usa esses dados para alinhar e dimensionar o sprite sem deformação.

## Câmera, iluminação e regeneração

A câmera é ortográfica, com azimute de 45 graus e elevação de 30 graus. Uma unidade Blender corresponde a um tile; os eixos projetam os vetores de 16×8 pixels usados pelo losango 32×16 do Canvas. O render usa Eevee, 64 amostras, fundo transparente, luz principal quente superior esquerda, preenchimento frio suave e materiais de alta rugosidade.

Com Blender e PowerShell 7 instalados, execute `npm run art:buildings` para recriar somente os edifícios ou `npm run art:all` para recriar edifícios e ambiente. O navegador nunca executa Blender.
