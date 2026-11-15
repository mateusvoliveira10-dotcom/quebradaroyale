# Como pôr o QUEBRADA ROYALE no Roblox (bem fácil)

Você vai fazer só **5 coisas**. Tudo que precisa está na pasta:

`C:\Users\55379\Documents\QUEBRADA ROYALE\exportar-roblox\roblox`

## 1️⃣ Abrir um jogo novo
1. Abra o **Roblox Studio**.
2. Clique em **Novo** (ou **Criar**).
3. Clique em **Baseplate** (é o quadrado cinza, o primeiro).
4. Espere abrir. Você vai ver um chão cinza enorme. ✅

## 2️⃣ Colocar os scripts (1 arquivo só)
1. Abra a pasta lá de cima no Windows.
2. Ache o arquivo **QUEBRADA_ROYALE.rbxmx**.
3. **Arraste** esse arquivo com o mouse para dentro da janela do Roblox Studio (em cima do chão cinza) e solte.
4. Pronto: apareceu um item chamado **INSTALAR_QUEBRADA** na lista da direita (o **Explorador**). ✅

## 3️⃣ Colocar o mapa (os arquivos 3D)
1. No topo do Studio, clique na aba **Página inicial**.
2. Clique no botão **Importar 3D**.
3. Na janela que abrir, vá na mesma pasta e selecione **todos os arquivos que terminam em .glb**
   (clique no primeiro, aperte **Ctrl+A** para pegar todos) e clique em **Abrir**.
4. Vai aparecer a janela de importação. Do lado direito, procure **Unidade de escala**
   (ou **Scale unit**) e escolha **Stud**.
5. Clique no botão **Importar** (embaixo).
6. Espere. Pode demorar alguns minutos (são 53 arquivos). Uma barrinha mostra o progresso. ✅

> Se ele só deixar escolher **um arquivo por vez**, me avise: eu junto tudo em menos arquivos.

## 4️⃣ Mandar instalar (copiar e colar 1 linha)
1. No topo, clique na aba **Exibir**.
2. Clique em **Barra de comandos**. Aparece uma caixinha comprida embaixo da tela.
3. Clique nessa caixinha, cole a linha abaixo e aperte **Enter**:

```
require(workspace.INSTALAR_QUEBRADA)()
```

4. Clique na aba **Exibir** > **Saída** para ver as mensagens. Espere aparecer:
   **TUDO PRONTO! Salve (Ctrl+S) e aperte JOGAR (F5).** ✅
5. Aperte **Ctrl+S** para salvar o jogo (dê um nome, por exemplo *Quebrada Royale*).

> Se a mensagem disser **FALTA IMPORTAR ARQUIVOS**, importe o que faltou (passo 3) e cole
> esta outra linha na Barra de comandos:
> `require(game.ServerStorage.INSTALAR_QUEBRADA)()`

## 5️⃣ Jogar!
1. Aperte **F5** (ou o botão **Jogar** ▶ no topo).
2. Espere uns segundos: o mapa se monta sozinho.
3. Controles:
   - **W A S D**: andar
   - **Shift**: correr
   - **C**: agachar
   - **Z**: deitar
   - **Espaço**: pular (ou levantar)
   - **Esc**: soltar o mouse
4. Para sair do teste: aperte **Shift+F5** (ou o botão **Parar** ■).

### Jogar com 2 pessoas (testar o multiplayer)
Aba **Testar** > em **Clientes e servidores** escolha **2 jogadores** > **Iniciar**.
Abrem 3 janelas: o servidor e 2 jogadores. Ande com um e veja o outro se mexendo. 🎮

## Deu problema?
Tire um print da janela **Saída** (aquela das mensagens) e me mande. Eu te digo o que fazer.
