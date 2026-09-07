# Modelos Village 4

## Contrato de construção — setembro de 2026

`building_contract.py` resolve um `BuildingProfile` imutável antes da geometria. `BuildingContext` combina perfil, paleta e coberturas nomeadas; famílias chamam `mats.roof(...)`, sem substituir `architecture.roof` globalmente. `RoofPlan` publica topo de parede/beiral, ápice e altura da superfície por posição. Mansardas e coruchéus consomem essas âncoras, não a altura presumida de outro bioma. Coberturas principais/anexos usam a mesma política; toldos leves das famílias continuam sendo componentes próprios. A elevação usa `profile.floor_lift` e preserva o agrupamento geométrico criado pelo Claude.

Pipeline: perfil → família/anexos → aberturas → elevação dos conjuntos conectados → soleira → auditoria → aplicação de modificadores/normalização → âncoras finais e catálogo → GLB. O catálogo acrescenta `construction` (versão, estilo, elevação) e `anchors` (solo, piso e coberturas em coordenadas finais GLB). Bounds e footprints continuam medidos, não impostos. Sem compatibilidade prometida com saves nesta fase.

`audit_supports` agora bloqueia exportações com peças isoladas. Exceção precisa: `ContinuousRail` em `bridge:middle`, apoiado por módulos vizinhos. O teste é de contato entre AABBs, não prova de apoio estrutural, contato real entre triângulos ou ausência de conjuntos inteiros flutuando; inspeção visual continua obrigatória. Validar com Blender `--background --factory-startup --python-exit-code 1 --python tools/blender/test_building_contract.py` e `node --test tests/models.test.mjs`. O preview nativo ganhou a câmera `cobertura` para inspecionar adornos altos.

As contagens históricas abaixo foram superadas: o catálogo atual tem 160 edifícios, 15 props e cinco módulos de ponte.

Execute `pwsh -NoProfile -File tools/blender/export-models.ps1` na raiz. O Blender 4.5 constrói e exporta 128 edifícios, dez objetos e cinco módulos de ponte, sem renderizar imagens. A execução utiliza somente Python incluído no Blender. Todos os modelos são originais deste projeto, sem assets externos.

`architecture.py` contém as doze famílias arquitetônicas e suas variantes de volumes. `environment_models.py` contém vegetação e objetos. `export_models.py` aplica os quatro biomas, acrescenta capela e torre, normaliza pivôs, aplica modificadores, une malhas por material e exporta GLB com catálogo em JSON e ESM. O exportador não depende das antigas imagens PNG.

Os biomas públicos são temperate, arid, snowy e wetland. Cada um tem 32 modelos: três variantes de cottage, townhouse, merchant e artisan; duas das outras dez famílias. Uma única orientação de cada modelo atende às quatro direções por rotação. No árido os telhados são lajes e os materiais adobe; no nevado as coberturas são mais altas e cobertas de neve; no pantanoso os volumes recebem palafitas, escadas e coberturas vegetais.

Um tile corresponde a uma unidade. GLB usa Y para cima, chão Y=0, pivô central em XZ e fachada voltada para +Z. O catálogo mede todos os vértices finais, inclusive telhados e anexos. Footprint é o teto inteiro das dimensões reais em XZ; `entrance` preserva o deslocamento lateral e a altura real da soleira, alinhada à base geométrica da folha da porta. O mercado usa piso de 0,18 unidade; demais famílias usam 0,28; as palafitas acrescentam 0,7. As escadas terminam nesse piso. Não se deve reescalar edifícios para encaixá-los em lotes menores. Leste e oeste trocam largura e profundidade.

Os módulos de ponte têm eixo X, extensão exata de um tile e corrimãos longitudinais até ambas as bordas. Start tem poste na borda X negativa, end na positiva, middle não tem poste, post tem um par central, e single tem os dois pares externos. A rotação Y=-90° orienta o eixo crescente para +Z. Para reconstruir somente pontes, execute Blender com `--python tools/blender/export_models.py -- --bridges-only` após o catálogo completo existir.

`node --test tests/models.test.mjs` verifica a existência de todos os GLBs, contagens, cabeçalhos binários, bounds medidos dos accessors glTF, transformações aplicadas, footprint, chão, pivô e orientação das entradas. Próximas evoluções podem introduzir níveis de detalhe e colisores simplificados, mantendo as medidas do catálogo como contrato de geração.
