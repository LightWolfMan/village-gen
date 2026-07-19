# Arte original da Village v2

## Direção visual

Os props desta pasta são arte original gerada para a Village v2 em 18 de julho de 2026 com a ferramenta integrada ImageGen. Nenhum asset da versão anterior, pacote externo, marca ou sprite de terceiros foi reaproveitado. A direção comum é pixel art isométrica 2.5D de alta fidelidade, com câmera elevada em aproximadamente 30 graus, alinhamento visual a uma grade isométrica 2:1, luz vindo do canto superior esquerdo, contorno seletivo escuro, textura legível e ausência de sombras externas. Cada imagem foi gerada separadamente sobre chroma key magenta uniforme `#ff00ff`.

## Prompts finais

### Árvore temperada

O prompt pediu uma única árvore caducifólia temperada original, semelhante a um carvalho, com copa arredondada e densa, tronco curto robusto e raízes visíveis. A especificação visual exigiu pixel art artesanal de alta fidelidade, qualidade de RPG de Nintendo DS ou superior, clusters nítidos, vista isométrica 2:1, luz quente superior esquerda, folhagem em oliva, musgo e verde-floresta, casca marrom, silhueta totalmente visível, sem cenário, chão, texto, sombra, reflexo, gradiente, transparência nativa ou uso de magenta no objeto.

### Pinheiro nevado

O prompt pediu um único pinheiro original coberto por neve, com galhos triangulares em camadas e tronco curto aparente. A especificação exigiu a mesma pixel art isométrica, luz fria superior esquerda, agulhas verde-azuladas profundas, neve branco-azulada em saliências irregulares e ausência de chão, sombra, cenário, texto, reflexo, gradiente ou magenta no objeto.

### Cacto do deserto

O prompt pediu um único saguaro compacto original, com coluna central espessa, dois braços erguidos assimétricos e nenhuma flor. A especificação exigiu vista isométrica, superfície cerosa com nervuras, espinhos pontuais legíveis, verdes sálvia, oliva e azulados, luz quente superior esquerda, silhueta simples para redução e ausência de areia, pedras, caveiras, cenário, sombra, texto ou magenta no objeto.

### Salgueiro do pântano

O prompt pediu um único salgueiro pantanoso original, com tronco tortuoso, raízes aparentes, copa baixa larga e cortinas de folhas pendentes. A especificação exigiu pixel art isométrica nítida, luz úmida difusa superior esquerda, paleta dessaturada de sálvia, verde-pântano, teal escuro e marrom envelhecido, sem água, lama, cipós, fios translúcidos, sombra externa, cenário, texto ou magenta no objeto.

### Rocha

O prompt pediu uma única rocha de campo baixa, irregular, lascada e angular. A especificação exigiu planos fraturados bem legíveis, cinzas ardósia e azulados, pequenos líquens dessaturados, iluminação superior esquerda, silhueta compacta e ausência de chão, grama, gemas, cenário, sombra, texto ou magenta no objeto.

### Poço

O prompt pediu um único poço medieval completo, com bacia circular de alvenaria, dois pilares de madeira, pequeno telhado de duas águas com telhas, eixo, corda e balde. A especificação exigiu vista isométrica, pedra cinza quente, madeira envelhecida, telhas vermelho-amarronzadas, blocos e veios legíveis, sem grama, água espirrando, pessoas, cenário, sombra externa, texto ou magenta no objeto.

### Carroça

O prompt pediu uma única carroça medieval vazia, com caixa de tábuas, duas grandes rodas raiadas, aros de ferro e dois varais dianteiros, sem cavalo. A especificação exigiu eixo visual do canto superior esquerdo ao inferior direito, madeira em mel e nogueira, metais cinza-ferro, pixel art isométrica nítida e ausência de carga, feno, barris, sacos, animais, cenário, sombra, texto ou magenta no objeto.

### Palheiro

O prompt pediu um único palheiro cônico compacto, amarrado ao centro por uma corda escura e com silhueta rústica levemente irregular. A especificação exigiu tufos de palha em clusters legíveis, amarelo-palha, dourado, ocre e marrom, luz superior esquerda, poucos fios salientes, sem chão, cerca, forcado, cenário, sombra, texto ou magenta no objeto.

## Pós-processamento e contrato

Os originais foram processados localmente pelo helper oficial `remove_chroma_key.py` do skill ImageGen. Como a arte é pixel art opaca, o resultado final usou chave fixa `#ff00ff`, tolerância dura de 100 e alfa binário, preservando melhor as cores do que um despill suave. Após o recorte pelo bounding box do canal alpha, cada sprite foi reduzido proporcionalmente com `Pillow Image.Resampling.NEAREST`, centralizado horizontalmente e ancorado dois pixels acima da borda inferior de um canvas transparente.

O contrato final é `temperate-tree.png` em 64×96, `snowy-pine.png` em 64×96, `desert-cactus.png` em 48×64, `swamp-willow.png` em 80×96, `rock.png` em 48×40, `well.png` em 48×48, `cart.png` em 64×48 e `haystack.png` em 48×48. Todos são PNG RGBA, têm cantos totalmente transparentes, base visual centralizada e não carregam sombra projetada, permitindo que o renderer controle iluminação e sombra de maneira consistente.

Uma limpeza cromática dirigida removeu os poucos pixels magenta que restaram na borda após o nearest-neighbor. A validação final conferiu dimensões, canal RGBA, transparência dos quatro cantos, bounding box não vazio, cobertura plausível do objeto e ausência de pixels magenta visíveis. Os arquivos intermediários de geração e chroma key não fazem parte do projeto.
