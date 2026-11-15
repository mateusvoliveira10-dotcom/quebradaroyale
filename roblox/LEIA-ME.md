# QUEBRADA ROYALE no Roblox — Parte 1 (mapa, personagem e controles)

Tudo aqui foi escrito para o Roblox Studio em português. Os nomes dos serviços
(ServerScriptService, ReplicatedStorage...) aparecem em inglês no **Explorador** mesmo com
o Studio em português.

## O que vem pronto

| Arquivo | Onde colocar no Studio | Tipo |
|---|---|---|
| `roblox/ReplicatedStorage/Config.lua` | ReplicatedStorage | **ModuleScript** chamado `Config` |
| `roblox/ServerScriptService/Jogadores.server.lua` | ServerScriptService | **Script** chamado `Jogadores` |
| `roblox/ServerScriptService/MontarMapa.server.lua` | ServerScriptService | **Script** chamado `MontarMapa` |
| `roblox/StarterPlayerScripts/Controles.client.lua` | StarterPlayer > StarterPlayerScripts | **LocalScript** chamado `Controles` |
| `roblox/ServerStorage/CriarAgua.lua` | ServerStorage | **ModuleScript** chamado `CriarAgua` |
| `exportar-roblox/roblox/Dados/*.lua` (8 arquivos) | ServerStorage > pasta `Dados` | **ModuleScript** cada um, com o mesmo nome do arquivo (sem `.lua`) |
| `exportar-roblox/roblox/mapa_*.glb` (52 arquivos) | importar em Workspace > pasta `Mapa` | modelo 3D |
| `exportar-roblox/roblox/modelos.glb` | importar e mover para ServerStorage > pasta `Modelos` | modelo 3D |

## Passo a passo

### 1. Criar o lugar
1. Abra o Roblox Studio > **Novo** > **Baseplate**.
2. No **Explorador**, apague a peça `Baseplate` (clique direito > Excluir). O chão agora é o mapa.
3. Aba **Página inicial** > **Configurações do jogo** > **Mundo**: deixe a gravidade padrão.
4. Em **Workspace**, nas **Propriedades**, ligue **StreamingEnabled** (o mapa é grande: o
   Roblox carrega só o que está perto de cada jogador).
5. Em **StarterPlayer** (Propriedades): **EnableMouseLockOption = desligado** (a trava de
   câmera do Roblox usa o Shift, que no jogo é correr) e **CameraMaxZoomDistance = 20**.

### 2. Criar as pastas
No **Explorador**, clique com o botão direito e use **Inserir objeto** > **Folder**:
- em **Workspace**: uma pasta chamada `Mapa`;
- em **ServerStorage**: uma pasta `Dados` e uma pasta `Modelos`.

### 3. Colar os scripts
Para cada linha da tabela acima: clique direito no lugar indicado > **Inserir objeto** >
**Script**, **LocalScript** ou **ModuleScript**; renomeie (F2) com o nome da tabela; dê
dois cliques para abrir, apague o que tiver dentro e cole o conteúdo do arquivo.

Os 8 arquivos de `Dados` são grandes (até 220 KB): abra o arquivo no Bloco de Notas,
Ctrl+A, Ctrl+C e cole no ModuleScript.

### 4. Importar o mapa (52 blocos)
1. Aba **Página inicial** (ou **Avatar**/**Modelo**, conforme a versão) > **Importar 3D**.
2. Escolha os arquivos `mapa_*.glb` (dá para selecionar vários de uma vez).
3. Na janela de importação, em **Configurações do arquivo**:
   - **Unidade de escala** (Scale unit): **Stud**;
   - **Inserir usando a posição da cena** (se aparecer): ligado;
   - **Ancorado** (Anchored): ligado;
   - **Usar mesmo material/peças** pode ficar como está.
4. **Importar**. Cada arquivo vira um modelo com o nome do arquivo (`mapa_0_0`...).
5. Arraste todos esses modelos para dentro de **Workspace > Mapa**.

O script `MontarMapa` encaixa cada bloco no lugar certo sozinho (pelas marcas que vieram
dentro dos arquivos), então não precisa posicionar nada à mão.

### 5. Importar os modelos repetidos
1. **Importar 3D** > `modelos.glb` (mesmas configurações).
2. Arraste o modelo importado para **ServerStorage > Modelos**.
   Dentro dele há 125 modelos (`M001_...`, `M002_...`): carros, árvores, janelas, portões.
   O `MontarMapa` faz as 11.211 cópias deles pelo mapa quando o jogo começa.

### 6. Criar a água (uma vez só)
1. **Exibir** > **Barra de comandos**.
2. Cole e aperte Enter: `require(game.ServerStorage.CriarAgua)()`
3. Espere a mensagem `[CriarAgua] água criada` na **Saída**. Salve o lugar (Ctrl+S).

### 7. Testar
1. **Testar** > **Jogar** (F5). Na **Saída** deve aparecer
   `[MontarMapa] pronto em X s: 11211 objetos, 11959 colisores`.
2. Controles: WASD andar, **Shift** correr, **C** agachar, **Z** deitar, **Espaço** pular
   (ou levantar, se agachado/deitado). O mouse fica preso no centro (Esc solta).
3. Multiplayer: **Testar** > **Clientes e servidores** > 2 jogadores > **Iniciar**.

### Se der problema
- **Aviso "escala 3.57"**: o bloco foi importado em metros. Reimporte com unidade **Stud**.
- **"Bloco não encontrado"**: o modelo não está em Workspace > Mapa ou foi renomeado.
- **Personagem cai pelo chão**: o `MontarMapa` não rodou (veja erros na Saída) ou as
  pastas `Dados`/`Modelos` estão com outro nome.
- **Arquivo grande demais para importar**: me avise qual; dá para dividir os blocos menores.

## Como gerar os arquivos de novo (se o mapa mudar)
No projeto do jogo de navegador:
1. `npm run dev` e abra `http://localhost:5173/?exportarRoblox`.
2. No console do navegador (F12): `exportarRoblox()` — grava em `exportar-roblox/`.
3. Água: `(await import('/src/tools/RobloxExport.ts')).exportarAgua(...)` (ver o código).
4. Texturas leves: `blender -b --python tools/blender/roblox_glb.py -- exportar-roblox exportar-roblox/roblox`.
