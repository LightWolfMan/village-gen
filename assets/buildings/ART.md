# Edifícios pré-renderizados da Village v3

## Origem e contrato

Os 112 PNGs deste diretório são arte original construída proceduralmente no Blender 4.5.5 LTS pelo script `tools/blender/render_temperate_buildings.py`. Nenhum modelo, textura ou material de terceiro é incorporado. O modelo 3D intermediário não é salvo; o script Python é a fonte reproduzível da arte e evita cenas e caches sem uso no projeto.

Cada família possui as orientações `north`, `east`, `south` e `west`. `cottage`, `townhouse`, `merchant` e `artisan` possuem três variantes; `workshop`, `civic`, `farmstead`, `inn`, `shop`, `smithy`, `market` e `mill` possuem duas. Leste e oeste trocam largura e profundidade no manifesto para que o footprint lógico acompanhe a rotação real.

A separação não é uma troca de cores. Hospedarias têm anexo, placa, barris e cocheira; lojas têm vitrine, toldo e galeria; casas mercantis têm fachada comercial, sacada, bay window e depósito; artesãos usam bancada, cobertura de trabalho, galpão e forno; ferrarias possuem forja, chaminé, bigorna e carvoaria; mercados são pavilhões abertos com alas cobertas; moinhos têm roda e celeiro. A faixa central da entrada permanece livre de objetos visuais.

Os arquivos são PNG RGBA 256×256 com fundo transparente. `manifest.json` usa schema 2 e registra `variant`, dimensões, footprint orientado, centro do chão e posição visual da porta. O renderer procura a variante exata, recua para a variante zero da mesma família quando o PNG falta e somente depois usa o fallback Canvas.

## Câmera, iluminação e regeneração

A câmera é ortográfica, com azimute de 45 graus e elevação de 30 graus. Uma unidade Blender corresponde a um tile; os eixos projetam os vetores de 16×8 pixels usados pelo losango 32×16 do Canvas. O render usa Eevee, 64 amostras, fundo transparente, luz principal quente superior esquerda, preenchimento frio suave e materiais de alta rugosidade.

Com Blender e PowerShell 7 instalados, execute `npm run art:buildings` para recriar somente os edifícios ou `npm run art:all` para recriar edifícios e ambiente. O navegador nunca executa Blender.
