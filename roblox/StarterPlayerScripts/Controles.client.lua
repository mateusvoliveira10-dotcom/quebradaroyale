-- LocalScript "Controles" (StarterPlayer > StarterPlayerScripts)
-- Roda no computador de cada jogador: teclas, câmera por cima do ombro e postura.
--   Shift  correr (segurando)
--   C      agachar / levantar
--   Z      deitar / levantar
--   Espaço levanta (quando agachado ou deitado)

local Players = game:GetService("Players")
local UserInputService = game:GetService("UserInputService")
local RunService = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Config"))
local mudarPostura = ReplicatedStorage:WaitForChild("Remotes"):WaitForChild("MudarPostura")

local jogador = Players.LocalPlayer
local postura = "EmPe"
local correndo, agachado, deitado = false, false, false
local faixas = {} -- animações carregadas (Agachado / Deitado)

local VELOCIDADE = {
	EmPe = Config.VelAndar,
	Correndo = Config.VelCorrer,
	Agachado = Config.VelAgachado,
	Deitado = Config.VelDeitado,
}

local function humanoidAtual()
	local personagem = jogador.Character
	return personagem and personagem:FindFirstChildOfClass("Humanoid")
end

local function tocarAnimacao(nome)
	for chave, faixa in pairs(faixas) do
		if chave ~= nome and faixa.IsPlaying then
			faixa:Stop(0.2)
		end
	end
	local faixa = faixas[nome]
	if faixa and not faixa.IsPlaying then
		faixa:Play(0.2)
	end
end

-- Decide a postura pelas teclas e avisa o servidor (só quando muda).
local function atualizarPostura()
	local nova = "EmPe"
	if deitado then
		nova = "Deitado"
	elseif agachado then
		nova = "Agachado"
	elseif correndo then
		nova = "Correndo"
	end
	if nova == postura then
		return
	end
	postura = nova
	mudarPostura:FireServer(postura)
	-- Também aplica aqui na hora (resposta imediata); o servidor confirma em seguida.
	local humanoid = humanoidAtual()
	if humanoid then
		humanoid.WalkSpeed = VELOCIDADE[postura]
	end
	tocarAnimacao(postura)
end

UserInputService.InputBegan:Connect(function(entrada, processado)
	if processado then
		return -- digitando no chat, por exemplo
	end
	local tecla = entrada.KeyCode
	if tecla == Enum.KeyCode.LeftShift or tecla == Enum.KeyCode.RightShift then
		correndo = true
		agachado, deitado = false, false
	elseif tecla == Enum.KeyCode.C then
		agachado = not agachado
		deitado = false
	elseif tecla == Enum.KeyCode.Z then
		deitado = not deitado
		agachado = false
	elseif tecla == Enum.KeyCode.Space and (agachado or deitado) then
		agachado, deitado = false, false
	end
	atualizarPostura()
end)

UserInputService.InputEnded:Connect(function(entrada)
	if entrada.KeyCode == Enum.KeyCode.LeftShift or entrada.KeyCode == Enum.KeyCode.RightShift then
		correndo = false
		atualizarPostura()
	end
end)

-- Ao nascer: volta a ficar em pé e carrega as animações das posturas (se tiver IDs).
local function aoNascer(personagem)
	postura, correndo, agachado, deitado = "EmPe", false, false, false
	faixas = {}
	local humanoid = personagem:WaitForChild("Humanoid")
	local animador = humanoid:WaitForChild("Animator")
	for nome, id in pairs(Config.Animacoes) do
		if id ~= "" then
			local anim = Instance.new("Animation")
			anim.AnimationId = id
			faixas[nome] = animador:LoadAnimation(anim)
			faixas[nome].Looped = true
		end
	end
end
jogador.CharacterAdded:Connect(aoNascer)
if jogador.Character then
	aoNascer(jogador.Character)
end

-- Câmera por cima do ombro, estilo battle royale: o mouse fica preso no centro e o corpo
-- vira para onde a câmera olha.
RunService:BindToRenderStep("CameraOmbro", Enum.RenderPriority.Camera.Value + 1, function(dt)
	local personagem = jogador.Character
	local humanoid = personagem and personagem:FindFirstChildOfClass("Humanoid")
	local raiz = personagem and personagem:FindFirstChild("HumanoidRootPart")
	if not humanoid or not raiz or humanoid.Health <= 0 then
		return
	end
	UserInputService.MouseBehavior = Enum.MouseBehavior.LockCenter
	humanoid.AutoRotate = false
	local olhar = workspace.CurrentCamera.CFrame.LookVector
	local giro = math.atan2(-olhar.X, -olhar.Z)
	raiz.CFrame = CFrame.new(raiz.Position) * CFrame.Angles(0, giro, 0)
	local alvo = Vector3.new(Config.OmbroX, Config.CameraAltura[postura], 0)
	humanoid.CameraOffset = humanoid.CameraOffset:Lerp(alvo, math.min(1, dt * 10))
end)
