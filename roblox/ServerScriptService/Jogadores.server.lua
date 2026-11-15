-- Script "Jogadores" (ServerScriptService)
-- O SERVIDOR decide a velocidade de cada jogador (o jogador só PEDE para mudar de postura;
-- assim ninguém consegue correr mais rápido trapaceando).

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Config"))

-- Pasta com os eventos de rede (cria se ainda não existir)
local remotes = ReplicatedStorage:FindFirstChild("Remotes")
if not remotes then
	remotes = Instance.new("Folder")
	remotes.Name = "Remotes"
	remotes.Parent = ReplicatedStorage
end

-- Jogador -> Servidor: "quero mudar de postura" ("EmPe", "Correndo", "Agachado", "Deitado")
local mudarPostura = Instance.new("RemoteEvent")
mudarPostura.Name = "MudarPostura"
mudarPostura.Parent = remotes

local VELOCIDADE = {
	EmPe = Config.VelAndar,
	Correndo = Config.VelCorrer,
	Agachado = Config.VelAgachado,
	Deitado = Config.VelDeitado,
}

local function aplicarPostura(personagem, postura)
	local humanoid = personagem:FindFirstChildOfClass("Humanoid")
	if not humanoid then
		return
	end
	humanoid.WalkSpeed = VELOCIDADE[postura]
	-- Agachado ou deitado não pula (Espaço levanta, no script do jogador).
	if postura == "EmPe" or postura == "Correndo" then
		humanoid.JumpHeight = Config.AlturaPulo
	else
		humanoid.JumpHeight = 0
	end
	-- Atributo: os outros jogadores (e a interface) podem ler a postura de qualquer um.
	personagem:SetAttribute("Postura", postura)
end

local function aoNascer(personagem)
	local humanoid = personagem:WaitForChild("Humanoid")
	humanoid.UseJumpPower = false
	aplicarPostura(personagem, "EmPe")
end

Players.PlayerAdded:Connect(function(jogador)
	jogador.CharacterAdded:Connect(aoNascer)
	if jogador.Character then
		aoNascer(jogador.Character)
	end
end)

mudarPostura.OnServerEvent:Connect(function(jogador, postura)
	-- Nunca confie no que vem do jogador: só aceita os quatro nomes conhecidos.
	if typeof(postura) ~= "string" or VELOCIDADE[postura] == nil then
		return
	end
	local personagem = jogador.Character
	if personagem then
		aplicarPostura(personagem, postura)
	end
end)
