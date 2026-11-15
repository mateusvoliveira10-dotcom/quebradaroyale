-- ModuleScript "CriarAgua" (ServerStorage)
-- Rode UMA VEZ no Studio, pela Barra de Comandos (Exibir > Barra de comandos):
--     require(game.ServerStorage.CriarAgua)()
-- Ele enche de água do Terrain o mar, os lagos, os rios e as piscinas (dados em
-- ServerStorage > Dados > DadosAgua). A água fica salva no lugar; o Roblox já faz o
-- personagem nadar nela sozinho.

return function()
	local dados = require(game.ServerStorage.Dados.DadosAgua)
	local terreno = workspace.Terrain
	local passo = 2 / 0.28 -- faixas de 2 m, em studs
	for i, f in ipairs(dados) do
		local x0, x1, z, nivel, fundo = f[1], f[2], f[3], f[4], f[5]
		local altura = math.max(nivel - fundo, 1)
		local centro = Vector3.new((x0 + x1) / 2, nivel - altura / 2, z)
		terreno:FillBlock(CFrame.new(centro), Vector3.new(math.abs(x1 - x0), altura, passo), Enum.Material.Water)
		if i % 200 == 0 then
			task.wait()
		end
	end
	print("[CriarAgua] água criada: " .. #dados .. " faixas")
end
