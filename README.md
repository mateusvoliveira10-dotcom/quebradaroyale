# QUEBRADA ROYALE

Jogo 3D de navegador ambientado em uma comunidade brasileira, com visual cartoon realista.
Feito com **Babylon.js**, **TypeScript** e **Vite**. Funciona offline. O mapa, as roupas, os sons
e as ilustrações do menu são gerados por código. Os arquivos externos são a logomarca
(`public/logo.webp`), o personagem-base em GLB (`public/models/`) e os modelos gerados pelos scripts
do Blender (`public/assets/`).

> Versão atual: **v0.3**. Traz lobby 3D, Battle Royale com bots, Deathmatch 5v5, Treinamento
> no galpão, personalização completa salva no navegador e correções de câmera e de teletransporte.

## Como rodar

Requisitos: Node.js 20+ e npm.

```bash
npm install
npm run dev
```

Abra <http://localhost:5173>. O jogo abre no **lobby**: escolha o modo, personalize o personagem
ou ajuste as configurações e clique em **JOGAR**.

| Comando             | O que faz                                          |
| ------------------- | -------------------------------------------------- |
| `npm run dev`       | Servidor de desenvolvimento com hot reload          |
| `npm run build`     | Checa tipos e gera a versão de produção em `dist/` |
| `npm run preview`   | Serve a pasta `dist/` localmente                    |

## Publicar de graça (GitHub Pages)

O repositório já vem pronto: `.github/workflows/deploy.yml` gera o build e publica a cada push na
branch `main`, e o Vite usa caminhos relativos (`base: './'`), então o jogo funciona em
`https://<usuario>.github.io/<repositorio>/`.

1. Crie um repositório **público** vazio no GitHub (sem README).
2. Na pasta do jogo: `git remote add origin https://github.com/<usuario>/<repositorio>.git` e
   `git push -u origin main`.
3. No GitHub: **Settings → Pages → Source: GitHub Actions**. O primeiro deploy leva ~2 minutos
   (aba **Actions**); depois o link aparece em Settings → Pages.

Para atualizar: `git add -A`, `git commit -m "..."` e `git push`. A pasta `art/` (fontes do
Blender, centenas de MB) e `backups/` não vão para o repositório.

## Modos

- **Battle Royale (30 participantes: você + 29 bots).** Entrada sempre pelo avião. `Espaço` salta. Se você não saltar,
  o salto é automático ainda sobre a comunidade. Na queda livre: `WASD` direciona, olhar para baixo
  + `W` mergulha e `Espaço` abre o paraquedas (ele também abre sozinho). Depois, pegue armas e
  sobreviva à zona que fecha. Não há renascimento. O último vivo vence.
- **Deathmatch 5v5.** Antes de entrar, escolha a arma principal. Você + 4 bots (azul) contra 5 bots
  (vermelho). Renascimento em 4 s, com proteção e 50 de escudo, em pontos da sua equipe. A vida
  regenera fora de combate e a munição de reserva é infinita. A partida dura 5 minutos e vence quem
  fizer mais eliminações. Não há fogo amigo.

### Combate (estilo Fortnite)

- **Vida + escudo:** 100 de vida e até 100 de escudo, que absorve o dano primeiro. **Sifão** no
  Deathmatch e no Battle Royale: cada eliminação devolve 50 (vida até 100, o resto vira escudo).
- **Mira:** retículo por arma (cruz; círculo na escopeta; ponto no rifle de precisão) que abre com
  a dispersão real (movimento, pulo, sprint, agachado e **bloom**, que cresce a cada tiro e se
  recupera rápido). **Precisão do primeiro tiro** na pistola e no fuzil: parado, no chão e mirando,
  depois de um instante sem atirar, o retículo fecha e fica vermelho, e o tiro vai no centro.
- **Dano:** crítico na cabeça por arma (escopeta 1,5x; submetralhadora 1,75x; pistola e fuzil 2x;
  rifle de precisão 2,5x) e queda de dano com a distância (forte na escopeta). Atirar interrompe
  o sprint.
- **Mira (estilo Fortnite):** câmera de ombro mais próxima (3,9 m, personagem no terço esquerdo), entrada e saída da mira em ~0,15 s, sensibilidade separada **ao mirar** e **na luneta** (Configurações, padrão 65%, a da luneta compensada pelo zoom) e rodinha do mouse trocando de arma (como Q). A setinha do mouse fica escondida durante a partida (classe `jogando` no body); só aparece em menus, pausa e "clique para jogar".
- **Loot sem entregar posição:** anel, feixe de luz e brilho da raridade só acendem a menos de 14 m (`GLOW_RANGE` em `LootSystem.ts`); de longe a arma é só um objeto no chão.
- **HUD:** números de dano brancos (vida), azuis (escudo) e amarelos (crítico); marcador vermelho
  e faixa **ELIMINADO** (com sequência x2, x3…) a cada eliminação sua; arcos em volta da mira
  apontando de onde veio o dano (azul quando bateu no escudo); barras de escudo nos inimigos.
- **Treinamento (Galpão da Quebrada).** Escolha a dificuldade: **fácil** (alvos grandes e parados),
  **médio** (menores, em posições variadas, somem) ou **difícil** (pequenos, móveis e com pouco tempo
  expostos). Troque de arma nas bancadas com `E`. Uma sessão dura 60 s, com pontos, tiros, acertos,
  precisão e recorde por dificuldade. `T` reinicia.

## Controles

| Tecla                  | Ação                                              |
| ---------------------- | ------------------------------------------------- |
| `W A S D`              | Mover (relativo à câmera)                         |
| `Shift`                | Correr                                            |
| `Espaço`               | Pular / escalar / passar por cima de muros        |
| `C`                    | Agachar                                           |
| `E`                    | Pegar arma                                        |
| `1` `2` / `Q`          | Escolher arma / alternar                          |
| Mouse esq. / dir.      | Atirar / mirar                                    |
| `R`                    | Recarregar                                        |
| `Esc`                  | Pausa (continuar, reiniciar, voltar ao lobby)     |
| `H` / `F3`             | Ajuda / painel de depuração                       |

## Favela do morro, lixo, barricadas, armas e desempenho

- **Morro da estátua cheio:** fileiras de casas no platô 2 em volta do cume (antes da escadaria,
  a oeste e a leste), com becos e loot (`buildFavelaDoMorro` em `builders/Morro.ts`). Os
  caminhos das escadarias e a caixa d'água comunitária ficam livres.
- **Lixo, pneus e barricadas** (`tools/blender/favela_props.py` → `favela.glb`, 341 KB): sacos
  amarrados e amassados (pretos com brilho de plástico, azuis e brancos), papelão e garrafa no
  lugar das esferas; pneus soltos, pilhas de pneus, barricadas de pneus com tambor enferrujado e
  de paletes com blocos de concreto, espalhados em terreno livre (`scatterVegetation`).
- **Armas novas** (`tools/blender/weapons.py` → `weapons.glb`, 240 KB): pistola, submetralhadora,
  escopeta pump, fuzil com trilho e mira holográfica, rifle de ferrolho com luneta. Mesmas medidas
  das antigas (as mãos encaixam igual) e uma malha por material (4–6 por arma, antes 8–10 peças).
- **Sons dos tiros** em camadas (`Audio.ts`): estalo, corpo com timbre de cada arma, soco
  grave, mecânica (pump, ferrolho) e eco de rua por reverb gerado no jogo.
- **Música desde a logo:** o `index.html` começa a tocar antes do jogo baixar; se o navegador
  bloquear som antes de interação, aparece "Clique ou aperte uma tecla para ligar o som".
- **Travamento perto da estátua:** do alto do morro a câmera via a cidade inteira (5,6 milhões de
  triângulos, 1,9 milhão só de esquadrias). Detalhes pequenos (esquadrias, grades, madeira,
  portões, caixas d'água, lixo, carros) agora somem além de 75–130 m por bloco
  (`DETAIL_CULL` em `StaticBatcher.ts`), e as armas do chão aparecem até 70 m: a vista do cume
  caiu de 113 para 42 ms por quadro neste computador.

## Lobby e entrada no mapa

- **Lobby "boteco de laje"** (`src/world/builders/LobbyScene.ts`, usado por `src/modes/LobbyMode.ts`):
  mesa quadrada vermelha de bar com cadeiras dobráveis, garrafas e copos, guarda-sol listrado
  balançando, engradados e isopor, churrasqueira de tijolo com brasa e fumaça, caixa de som com
  os alto-falantes pulsando e LED mudando de cor, gambiarra de lâmpadas (algumas piscando),
  bandeirinhas e roupas no varal ao vento, muro grafitado "QUEBRADA", vasos de planta, pipas com
  rabiola e um bando de pássaros sobre o morro, e poeira dourada no ar. Só o personagem do jogador
  (sem pódio nem anel). A câmera entra num arco de aproximação de 2,6 s e depois orbita devagar.
  As peças paradas são juntadas por material (~18 malhas), então o lobby custa ~8% a mais que antes.
- **Queda** (`src/match/DropFx.ts`, ligado em `BattleRoyaleMode.ts`): na queda livre a câmera
  recua e abre o campo de visão com a velocidade e treme no mergulho; rastro de fumaça verde e
  amarela; traços de vento; braços e pernas sacudindo no ar (`CharacterModel.applyAirPose`). Na
  abertura do paraquedas, tranco de câmera (FOV e tremor) e velame tremulando
  (`DropSequence.ts`); com ele aberto a câmera vai para 11,5 m para ler o mapa. Marcador de pouso
  no chão embaixo do personagem, placas dos pontos de interesse (Campinho, Boteco, Mercadinho,
  Oficina, Mirante da Paz) vistas do alto e poeira ao pousar. Tudo só para o jogador e só durante
  a descida: a partida em si não fica mais pesada.

## Mapa: estátua, carros e acabamento

- **Estátua de braços abertos** no cume do morro (platô 3, a 10,5 m, com escadaria, mureta e loot ao
  pé do pedestal), virada para o cruzamento central e visível de boa parte do mapa. É uma figura
  genérica: túnica com pregas, faixa amarrada na cintura, braços um pouco acima da horizontal (gesto
  de abraço, não em cruz), cabeça lisa e pedestal de degraus quadrados. Ela lembra os monumentos dos
  morros brasileiros sem copiar o Cristo Redentor, cuja imagem tem uso comercial controlado pela
  Arquidiocese do Rio de Janeiro. Gerada por `tools/blender/statue.py` (~5,3 mil triângulos, 117 KB).
- **Carros populares genéricos** (`tools/blender/cars.py`, ~600 KB, ~4 mil triângulos cada): hatch
  quadradinho anos 90, sedã antigo de três volumes, perua de frente chata e duas cores, picape pequena
  com caçamba aberta e um carrinho arredondado de para-lamas saltados. Sem nomes, logotipos nem
  carroceria copiada; placas no padrão Mercosul sem letras. Onze cores de rua, táxis amarelos com
  luminoso e uma viatura genérica (portas escuras e giroflex, sem brasão).
- **No jogo** (`src/world/WorldAssets.ts`): os dois GLB carregam na tela de carregamento; cada peça vira
  uma malha-base que o mapa clona para o lote estático (sem draw call por carro) com os materiais da
  biblioteca do mapa. Colisores vêm das caixas `Col_*` do Blender (carroceria + cabine, dá para
  escalar). Sem os GLB, o mapa volta aos carros de caixas.
- **Acabamento:** texturas de 512 para reboco (tinta descascada, mofo subindo do chão), tijolo baiano
  (juntas tortas, quinas lascadas), concreto aparente (marcas de fôrma, escorridos), asfalto (brita,
  trincas, óleo, remendos) e calçada; caixas d'água com frisos e cano, algumas de fibrocimento velhas;
  pichações e grafites num atlas único (paredes laterais, fachadas e muro); "bolos" de fios nos
  postes; luz, névoa e cores menos "desenho" (sem passes novos de pós-processamento).

- **Vegetação e caçambas** (`tools/blender/vegetation.py`, 212 KB): mangueira, amendoeira (galhos
  em andares, folhas verdes e avermelhadas), coqueiro, árvore de calçada com tronco caiado,
  bananeira, mato, capim seco e trepadeira; caçamba de entulho amarela com nervuras, alças, faixas
  refletivas, ferrugem e entulho (sem nome de empresa). As árvores têm versão leve: o lote de cada
  material/bloco troca para ela a 72 m (LOD do Babylon, sem draw call a mais). O mato são dois tufos
  repetidos por thin instances (~2.800 cópias, um par de malhas por bloco de 48 m, some além de 85 m,
  sem sombra). `builders/Vegetation.ts` espalha árvores, bananeiras, mato, trepadeiras no muro e
  caçambas nos becos testando cada ponto contra os colisores (nada nasce em casa, carro, calçada ou
  loot); troncos e caçambas têm colisor e entram na grade dos bots. As árvores e caçambas antigas
  viraram os modelos novos sem mudar o sorteio do resto do mapa.

Para gerar os modelos de novo:

```bash
blender -b --python tools/blender/cars.py -- public/assets/world/cars.glb
blender -b --python tools/blender/statue.py -- public/assets/world/statue.glb
blender -b --python tools/blender/vegetation.py -- public/assets/world/vegetation.glb
```

## Música tema

"Quebrada Royale" (`public/assets/audio/quebrada-royale.mp3`, enviada pelo autor) toca em loop
desde a tela de carregamento e continua no lobby e na escolha do modo. Ao clicar em **JOGAR**
ela some com fade e volta, do ponto em que parou, quando o jogador retorna ao lobby. O volume
segue o volume geral das Configurações (60% dele, abaixo dos efeitos). Se o navegador bloquear
som antes de qualquer interação, a música começa no primeiro clique, toque ou tecla.
Código: `src/core/Music.ts`.

## Personalização

Cabelo (7), óculos (10 cores do mesmo modelo 3D), camisas (18, ver abaixo), acessórios (correntes,
boné para frente/para trás, pulseiras, relógio, mochila), parte de baixo (5) e calçados (4). Camisas,
partes de baixo e calçados são malhas 3D com skinning; o degradê do cabelo e as meias são pintados
no corpo; óculos e acessórios são malhas presas aos encaixes do esqueleto. Tudo acompanha as
animações. A escolha fica salva no `localStorage` e vale no lobby e em todos os modos.

### Óculos (modelo 3D)

Um único modelo, o enviado (estilo Juliet), em `art/source/oculos-original.glb` (Tripo, 1,96 milhão
de triângulos). `tools/blender/glasses.py` o reduz para ~16 mil triângulos, separa armação,
detalhes (ponte, dobradiças, hastes) e lentes pela cor da textura e pela posição, escala pela largura
do rosto (15,2 cm), apoia a ponte a 2,5 mm do nariz, alinha as lentes aos olhos (1,615 m), dobra
as hastes para acompanhar a lateral da cabeça e passar por fora das orelhas e garante pelo menos
1,5 mm de distância da pele. Sai em `public/assets/customization/glasses/glasses_base.glb`, com
miniaturas por cor. No jogo (`src/customization/glasses.ts`) o clone fica preso ao nó dos olhos,
que segue o osso da cabeça; as 10 variações só trocam cor e acabamento (armação fosca ou metálica,
lente lisa ou espelhada): grafite/escura, preto/verde, preto/azul, preto/vermelho-laranja,
preto/rosa, prata/dourada, prata/ciano, dourado/escura, grafite/roxa e prata/âmbar.

```bash
blender -b --python tools/blender/glasses.py -- art/build/personagem-base.blend art/source/oculos-original.glb public/assets/customization/glasses
```

### Partes de baixo e calçados (3D)

Bermuda esportiva, bermuda jeans, calça cargo, calça jogger e calça jeans, e os quatro calçados
(tênis branco, preto, casual e chuteira), são malhas 3D com skinning, geradas por
`tools/blender/garments.py` a partir do corpo do manequim, como as camisas:

- **Malhas:** `Bermuda_Curta` (barra a 0,60 m), `Bermuda_Longa` (0,53 m) e `Calca` (0,10 m, sobre o
  tênis) em `public/assets/customization/bottoms/bottoms_base.glb`, e `Tenis` em
  `shoes/shoes_base.glb`. O bico do tênis é remodelado como uma fôrma de calçado, sem o relevo dos
  dedos.
- **Texturas:** UV automática, com cada pixel pintado a partir da posição 3D do ponto no corpo.
  Isso põe listra lateral, cós, cordão, passadores, braguilha, bolsos (frente, trás e cargo),
  punho de jogger, costuras, sola, biqueira, faixa lateral e cadarço no lugar certo. Cada peça
  tem `albedo.webp`, `normal.png` (trama e costuras) e `thumb.webp`.
- **No jogo:** `src/customization/garments.ts` (catálogo) e `src/player/GarmentAsset.ts`
  (carregador comum a todas as roupas 3D, inclusive as camisas). O corpo descarta a pele
  coberta, e as meias continuam pintadas entre a bermuda e o tênis. As roupas não projetam sombra
  própria (o corpo por baixo já projeta), o que economiza desenhos.

Para gerar de novo:

```bash
blender -b --python tools/blender/garments.py -- art/build/personagem-base.blend public/assets/customization
```

### Camisas

Dez camisas inspiradas em times brasileiros, com escudos genéricos (sem logotipos oficiais,
fabricantes ou patrocinadores): Atlético-MG, Cruzeiro, São Paulo, Santos, Palmeiras, Flamengo,
Bahia, Grêmio, Fluminense e Botafogo. Elas substituíram o catálogo antigo, que está em
`backups/quebrada-royale-v0.4-antes-camisas-*.zip`.

Mais oito peças de duas **marcas fictícias, "Mike" e "Adimas"**, inspiradas na linguagem visual do
streetwear esportivo, com símbolos e letreiros próprios (nada de "swoosh", trevo ou três listras):

- **Linha MIKE** — símbolo "Onda-M" (uma fita contínua, fina nas pontas e cheia no meio, que desenha
  um M inclinado para a frente) e letreiro em fonte black itálica: camiseta **Wave** (preta),
  camiseta **Sport** (branca, faixa de velocidade curva), **Tech** manga longa (painéis curvos com
  fio neon) e **regata 7**.
- **Linha ADIMAS** — símbolo "losango vazado com duas barras" e sempre **duas** listras paralelas;
  letreiro em fonte black reta: camiseta **Classic** (branca), camiseta **Street** (preta e dourada),
  **Track** manga longa (duas listras nas mangas e laterais) e **regata 10**.

Todas as camisas são de **gola redonda** (sem gola V). As de time ganharam nome e número nas costas
("QUEBRADA 10", em fonte de numeração esportiva com contorno) e listras que continuam do tronco para
as mangas.

- **Catálogo central:** `src/customization/jerseys.ts`, com id, nome, modelo e cores.
- **Arquivos** (`public/assets/customization/jerseys/`):
  - `jersey_base.glb`: três modelos de malha, todos de gola redonda, com pesos de skinning de tecido
    (os do corpo, suavizados): `Camisa_GolaRedonda` (manga curta, ~9 mil triângulos),
    `Camisa_MangaLonga` (~10,6 mil) e `Regata` (cava própria, ~7,5 mil).
  - `fabric_normal.png`: trama do tecido e pespontos, comum a todas as camisas.
  - `<id>/albedo.webp`: atlas 1024 com frente, costas, mangas e gola.
  - `<id>/front.png` e `<id>/back.png`: frente e costas planificadas.
  - `<id>/thumb.webp`: miniatura renderizada no manequim.
- **Geração:** tudo sai de `tools/blender/jerseys.py`. A malha é recortada do corpo do manequim por
  planos exatos (barra, fim das mangas, gola redonda, costura raglan) e ganha **caimento de tecido**:
  abaixo do peito o tronco cai reto até a barra (sem marcar cintura e lombar), as mangas viram tubos
  arredondados (boca de sino leve na manga curta, punho franzido na longa, mais justas na axila), o
  deslocamento é suavizado na malha inteira e nenhum ponto fica a menos de 6 mm da pele em repouso.
  A gola é uma ribana estreita que sobe ~9 mm e encosta no pescoço. Texto e logos são rasterizados
  com antisserrilhado a partir de fontes de verdade (objeto de texto do Blender) e de polígonos.
  `--apenas=id1,id2` gera só algumas peças (para iterar rápido).
- **No jogo** (`src/player/GarmentAsset.ts`): cada personagem recebe um clone da malha do seu modelo,
  preso ao próprio esqueleto. Cada camisa é só um material, reaproveitado por todos que a vestem.
  Todas as texturas são carregadas na tela de carregamento, então a troca no menu é imediata. A
  pele coberta é descartada pelo shader do corpo (`ClothingMaterial.ts`), com os mesmos planos do
  script e 3,5 cm de pele mantida sob a gola e a manga (sem vão visível).
- **Menu PERSONALIZAR → CAMISAS:** clicar num cartão mostra a camisa no personagem (prévia);
  **EQUIPAR** salva; **REMOVER CAMISA** deixa sem camisa; **VER COSTAS** gira o personagem (também
  dá para arrastar). Bots usam camisas aleatórias; no Deathmatch o azul veste Cruzeiro e o vermelho,
  Flamengo.
Para gerar de novo e conferir:

```bash
blender -b --python tools/blender/jerseys.py -- art/build/personagem-base.blend public/assets/customization/jerseys
```

Com o `npm run dev` rodando: `/tools/jersey-sheet.html` mostra as miniaturas e as costas, e
`/tools/glb-viewer.html?jersey=jersey_fluminense` (ou `&model=long` / `&model=tank`) veste a camisa e toca as animações.

## Personagem-base (GLB)

`public/models/personagem-base.glb` é o personagem-base definitivo, gerado a partir do modelo da
Tripo (`art/source/manequim-original.glb`, 1,93 milhão de triângulos, sem esqueleto) por scripts do
Blender 4.5 em `tools/blender/`:

| Item          | Resultado                                                                 |
| ------------- | ------------------------------------------------------------------------- |
| Malha         | 25.998 triângulos, 1,75 m, pés em y = 0, frente em +Z (glTF)               |
| Texturas      | PBR 2048: cor e rugosidade/metal originais + normal map refeito do original |
| Esqueleto     | 52 ossos com nomes do Mixamo (`Hips`, `Spine`…`Head`, braços, dedos, pernas, pés) |
| Encaixes      | `socket_weapon_R/L`, `socket_head_top`, `socket_eyes`, `socket_back`, `socket_neck`, `socket_wrist_R/L`, `socket_hip_R` |
| Animações     | `idle`, `walk`, `run`, `sprint`, `jump`, `crouch`, `climb`, `aim`, `shoot`, `reload`, `death` |
| Arquivo       | 5,0 MB                                                                     |

As animações são keyframes criados por script, sem captura de movimento: servem para o jogo e
para testar o rig. Como os ossos seguem a nomenclatura do Mixamo, dá para trocá-las por animações
do Mixamo ou de mocap por retarget. Roupas devem ser malhas com pesos no mesmo esqueleto; peças
rígidas (armas, boné, óculos, mochila, correntes, relógio) se prendem aos nós `socket_*`.

Para gerar de novo (o Blender fica em `C:\Program Files\Blender Foundation\Blender 4.5`):

```bash
blender -b --python tools/blender/optimize.py -- art/source/manequim-original.glb art/build/01_otimizado.blend 26000 2048
blender -b --python tools/blender/rig_animate.py -- art/build/01_otimizado.blend public/models/personagem-base.glb art/build/personagem-base.blend
```

### No jogo

Jogador e bots usam esse GLB (`src/player/CharacterAsset.ts` + `CharacterModel.ts`):

- **Carregamento único:** o GLB é carregado na tela de carregamento (`Game.create`); cada personagem
  é um clone (`instantiateModelsToScene`) com esqueleto próprio que compartilha geometria, texturas
  e shaders. Os shaders do personagem (PBR com skinning, sombra e contorno) são compilados antes de
  a tela de carregamento sumir, e o pool de 29 bots já nasce criado.
- **Animações:** os 11 AnimationGroups viram tabelas de quatérnios amostradas a 30 quadros/s. Cada
  quadro mistura duas camadas por pesos suavizados: corpo inteiro (idle/walk/run/sprint/jump/
  crouch/climb/death, com a fase das passadas sincronizada à velocidade) e tronco (aim/shoot/reload),
  aplicada só nos ossos de `Spine1` para cima por uma máscara. A inclinação da mira gira `Spine1` e
  `Spine2`. Com arma, um IK de dois ossos leva a mão direita a uma empunhadura junto ao peito
  (pistola: braços estendidos), preservando a direção do cano, e a mão esquerda ao apoio de cada
  arma (`SUPPORT_GRIP` em `WeaponSystem.ts`). Queda livre e paraquedas usam poses do clipe `jump` com o corpo inclinado; o avião
  esconde o personagem.
- **Roupas:** a camisa é uma malha à parte (veja "Camisas"). Bermuda/calça, meias, tênis e o
  degradê do cabelo são pintados no corpo por um plugin do material PBR (`ClothingMaterial.ts`) a
  partir da posição de repouso de cada vértice, então acompanham qualquer animação. O cabelo é uma malha 3D
  moldada no couro cabeludo (`tools/blender/hair.py`, skinning no osso da cabeça). Boné, óculos,
  corrente, relógio, pulseiras e mochila são malhas presas aos `socket_*`; as armas ficam em
  `socket_weapon_R` (na mão) e nas costas (`socket_back`).
- **LOD dos bots:** de perto tudo; a média distância sem detalhes finos e com o esqueleto atualizado
  a cada 2 quadros; longe sem sombra e a cada 4 quadros; fora da tela a cada 10. Contorno só abaixo de 14 m.
- **Colisão com 30 personagens:** as caixas de colisão do mapa (milhares) saem da lista de malhas da cena
  e ficam só no índice espacial (`ColliderIndex`): movimento (`surroundingMeshes`), câmera, tiros e
  escalada consultam só as caixas perto. A grade dos bots tem quedas (descer de laje sem escada, até 7 m)
  e regiões pré-calculadas, então um caminho impossível é recusado na hora em vez de percorrer a grade.

Para inspecionar qualquer GLB, com esqueleto, encaixes e botões para tocar as animações, abra
<http://localhost:5173/tools/glb-viewer.html?file=/models/personagem-base.glb> com o `npm run dev` rodando.

## Estrutura

```
src/
├── appearance/   Appearance.ts (opções, salvar/carregar) · Styles.ts (cores e estilos)
├── bots/         Bot.ts (IA: percepção, decisão, caminhos, combate, cobertura)
├── camera/       ThirdPersonCamera.ts (ombro, colisão em linha livre, coice)
├── combat/       Actor.ts (vida, equipe, hitboxes) · CombatManager.ts (tiros, dano, abates)
├── customization/ jerseys.ts (catálogo central das camisas)
├── core/         Game.ts (orquestra modos) · Input · Audio · Settings · config
├── loot/         LootSystem.ts (loot no mapa, coleta do jogador e dos bots)
├── match/        DropSequence.ts (avião + paraquedas) · SafeZone.ts · Vehicles.ts
├── modes/        LobbyMode · BattleRoyaleMode · DeathmatchMode · TrainingMode
├── nav/          ColliderIndex.ts (consultas espaciais) · NavGrid.ts (grade + A*)
├── player/       CharacterController.ts (física compartilhada) · CharacterAsset.ts (GLB, clipes)
│                 · CharacterModel.ts (animação em camadas, encaixes) · ClothingMaterial.ts (roupas)
│                 · GarmentAsset.ts (roupas 3D: camisas, partes de baixo, calçados)
├── ui/           Hud · Menu (lobby) · ModeArt (ilustrações dos modos) · Overlays · Minimap
├── weapons/      armas, efeitos, alvos de estande (PopTarget)
└── world/        mapa da comunidade, galpão de treino, materiais, ambiente
```

Fora de `src/`: `public/` (logo e modelos servidos como estão), `art/` (arte-fonte e
intermediários do Blender, não vão para o build) e `tools/` (scripts do Blender e visualizador GLB).

## Notas técnicas

- **Mouse livre:** se o navegador recusar a captura do mouse (painel embutido, iframe, logo após
  `Esc`), o jogo segue com o cursor visível: WASD, câmera pelo movimento do mouse, tiro e mira
  continuam funcionando e `Esc` pausa. Os botões do mouse são lidos por eventos de ponteiro
  (`pointerdown`/`e.buttons`), porque o Babylon cancela o `pointerdown` do canvas e com isso o
  navegador não gera os `mousedown`.

- **Uma física para todos:** jogador e bots usam o mesmo `CharacterController` (alimentado por um
  `ControlInput`) e o mesmo `WeaponSystem` (alimentado por um `WeaponIntent`).
- **Bots:** navegam numa grade de 0,5 m amostrada dos colisores reais (escadas e rampas incluídas)
  com A*. O orçamento é de duas buscas por frame. Detalhes e sombras são reduzidos quando estão longe.
- **Spawns por modo:** o Battle Royale só tem avião. O Deathmatch usa pontos por equipe validados
  contra colisores. O Treinamento tem ponto fixo dentro do galpão.
- **Segurança de posição:** a recuperação de emergência só age em casos realmente inválidos (abaixo
  do mundo, fora da área do modo ou preso num colisor). Ela sempre registra um aviso no console e
  mostra uma mensagem no HUD.
