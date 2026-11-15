-- ModuleScript "INSTALAR_QUEBRADA"
-- Coloca cada script no lugar certo, organiza o mapa importado, cria a água e ajusta as
-- configurações. Rodar pela Barra de comandos do Studio:
--     require(workspace.INSTALAR_QUEBRADA)()
-- Pode rodar de novo quantas vezes quiser (por exemplo, depois de importar mais blocos):
--     require(game.ServerStorage.INSTALAR_QUEBRADA)()

return function()
	local ReplicatedStorage = game:GetService("ReplicatedStorage")
	local ServerScriptService = game:GetService("ServerScriptService")
	local ServerStorage = game:GetService("ServerStorage")
	local StarterPlayer = game:GetService("StarterPlayer")
	local instalador = script

	print("=========== INSTALANDO O QUEBRADA ROYALE ===========")

	local function pasta(pai, nome)
		local p = pai:FindFirstChild(nome)
		if not p then
			p = Instance.new("Folder")
			p.Name = nome
			p.Parent = pai
		end
		return p
	end

	-- Põe um script no lugar (troca o antigo de mesmo nome, se houver) e liga.
	local function colocar(nome, destino)
		local s = instalador:FindFirstChild(nome)
		if not s then
			return
		end
		local antigo = destino:FindFirstChild(nome)
		if antigo then
			antigo:Destroy()
		end
		s.Parent = destino
		if s:IsA("Script") or s:IsA("LocalScript") then
			s.Disabled = false
		end
		print("  ok  " .. nome .. "  ->  " .. destino:GetFullName())
	end

	-- 1) Scripts ---------------------------------------------------------------
	colocar("Config", ReplicatedStorage)
	colocar("Jogadores", ServerScriptService)
	colocar("MontarMapa", ServerScriptService)
	colocar("Controles", StarterPlayer:WaitForChild("StarterPlayerScripts"))
	colocar("CriarAgua", ServerStorage)
	local dados = pasta(ServerStorage, "Dados")
	local pacoteDados = instalador:FindFirstChild("Dados")
	if pacoteDados then
		for _, m in ipairs(pacoteDados:GetChildren()) do
			local antigo = dados:FindFirstChild(m.Name)
			if antigo then
				antigo:Destroy()
			end
			m.Parent = dados
		end
		pacoteDados:Destroy()
		print("  ok  dados do mapa  ->  ServerStorage.Dados")
	end

	-- 2) Mapa importado ---------------------------------------------------------
	local mapa = pasta(workspace, "Mapa")
	local modelos = pasta(ServerStorage, "Modelos")
	local blocos = 0
	for _, filho in ipairs(workspace:GetChildren()) do
		local nome = filho.Name:lower()
		if nome:match("^mapa_%-?%d+_%-?%d+") then
			filho.Parent = mapa
		elseif nome:match("^modelos") then
			filho.Parent = modelos
		end
	end
	for _, filho in ipairs(mapa:GetChildren()) do
		if filho.Name:lower():match("^mapa_") then
			blocos += 1
		end
	end
	local temModelos = #modelos:GetChildren() > 0

	-- 3) Chão de teste e configurações --------------------------------------------
	local base = workspace:FindFirstChild("Baseplate")
	if base and blocos > 0 then
		base:Destroy()
		print("  ok  Baseplate removido (o chão agora é o mapa)")
	end
	pcall(function()
		workspace.StreamingEnabled = true
	end)
	StarterPlayer.EnableMouseLockOption = false
	StarterPlayer.CameraMaxZoomDistance = 20

	-- 4) Água (só uma vez) -------------------------------------------------------
	local terreno = workspace.Terrain
	if not terreno:GetAttribute("AguaQuebrada") and ServerStorage:FindFirstChild("CriarAgua") and dados:FindFirstChild("DadosAgua") then
		print("  ... criando a água (mar, lagos, rios, piscinas). Espere um pouco...")
		require(ServerStorage.CriarAgua)()
		terreno:SetAttribute("AguaQuebrada", true)
	end

	-- 5) Guarda o instalador (para rodar de novo, se precisar) --------------------
	instalador.Parent = ServerStorage

	print("---------------------------------------------------")
	print(("Blocos do mapa encontrados: %d de 52"):format(blocos))
	print(temModelos and "Modelos (carros, árvores...): OK" or "Modelos: AINDA NÃO IMPORTADOS (falta o modelos.glb)")
	if blocos < 52 or not temModelos then
		print("FALTA IMPORTAR ARQUIVOS. Depois de importar, rode de novo:")
		print("    require(game.ServerStorage.INSTALAR_QUEBRADA)()")
	else
		print("TUDO PRONTO! Salve (Ctrl+S) e aperte JOGAR (F5).")
	end
	print("===================================================")
end
