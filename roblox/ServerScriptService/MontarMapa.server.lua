-- Script "MontarMapa" (ServerScriptService)
-- Monta o mapa exportado do QUEBRADA ROYALE quando o servidor liga:
--   1) encaixa cada bloco importado (Workspace > Mapa > mapa_X_Y) no lugar certo, usando as
--      marcas Marca_A e Marca_B que vieram dentro de cada arquivo;
--   2) põe as cópias dos modelos (carros, árvores, janelas...) a partir de ServerStorage > Modelos;
--   3) cria as caixas de colisão invisíveis (o chão, as paredes e as escadas "de verdade").
-- Os dados ficam em ServerStorage > Dados (ModuleScripts gerados pelo exportador).

local ServerStorage = game:GetService("ServerStorage")

local dados = ServerStorage:WaitForChild("Dados")
local pastaMapa = workspace:WaitForChild("Mapa")
local pastaModelos = ServerStorage:WaitForChild("Modelos")

local inicio = os.clock()

-- Peças do cenário: presas, sem colisão própria (quem colide são as caixas invisíveis),
-- sem toque/consulta (mais leve para o servidor).
local function prepararPecas(raiz)
	for _, d in ipairs(raiz:GetDescendants()) do
		if d:IsA("BasePart") then
			d.Anchored = true
			d.CanCollide = false
			d.CanTouch = false
			d.CanQuery = false
		end
	end
end

local function lerModulos(prefixo)
	local lista = {}
	local i = 1
	while dados:FindFirstChild(prefixo .. i) do
		for _, item in ipairs(require(dados[prefixo .. i])) do
			table.insert(lista, item)
		end
		i += 1
	end
	return lista
end

-- CFrame a partir de uma entrada: {x,y,z, ..., giro} (7 números) ou com a matriz inteira.
local function cframeDe(e, primeiroExtra, quantosExtras)
	local x, y, z = e[1], e[2], e[3]
	local r = primeiroExtra + quantosExtras
	if #e == r then
		return CFrame.new(x, y, z) * CFrame.Angles(0, e[r], 0)
	end
	return CFrame.new(x, y, z, e[r], e[r + 1], e[r + 2], e[r + 3], e[r + 4], e[r + 5], e[r + 6], e[r + 7], e[r + 8])
end

-- 1) Blocos ---------------------------------------------------------------
for _, bloco in ipairs(require(dados.DadosBlocos)) do
	local modelo = pastaMapa:FindFirstChild(bloco.nome)
	if not modelo then
		warn("[MontarMapa] Bloco não encontrado em Workspace.Mapa: " .. bloco.nome)
		continue
	end
	local marcaA = modelo:FindFirstChild("Marca_A", true)
	local marcaB = modelo:FindFirstChild("Marca_B", true)
	if marcaA and marcaB then
		local esperadoA = Vector3.new(bloco.a[1], bloco.a[2], bloco.a[3])
		local esperadoB = Vector3.new(bloco.b[1], bloco.b[2], bloco.b[3])
		local escala = (marcaB.Position - marcaA.Position).Magnitude / (esperadoB - esperadoA).Magnitude
		if math.abs(escala - 1) > 0.02 then
			warn(("[MontarMapa] %s veio com escala %.2f: reimporte com a unidade em studs."):format(bloco.nome, escala))
		end
		modelo:PivotTo(modelo:GetPivot() + (esperadoA - marcaA.Position))
		marcaA:Destroy()
		marcaB:Destroy()
	end
	prepararPecas(modelo)
end

-- 2) Modelos repetidos ------------------------------------------------------
-- Cada variação (M001_..., M002_...) tem uma peça "Origem" no ponto zero do modelo.
local variacoes = {}
local function variacao(id)
	if variacoes[id] ~= nil then
		return variacoes[id]
	end
	local v = pastaModelos:FindFirstChild(id, true)
	if v and not v:IsA("Model") then
		-- O Importar 3D às vezes cria só a peça: embrulha num Model.
		local m = Instance.new("Model")
		m.Name = id
		v:Clone().Parent = m
		v = m
	end
	variacoes[id] = v or false
	if not v then
		warn("[MontarMapa] Modelo não encontrado em ServerStorage.Modelos: " .. id)
	end
	return variacoes[id]
end

local pastaCopias = Instance.new("Folder")
pastaCopias.Name = "Objetos"
pastaCopias.Parent = pastaMapa
local copias = 0
for _, e in ipairs(lerModulos("DadosModelos")) do
	local v = variacao(e[4])
	if v then
		local c = v:Clone()
		local escala = e[5]
		if escala ~= 1 then
			c:ScaleTo(escala)
		end
		local origem = c:FindFirstChild("Origem", true)
		local alvo = cframeDe(e, 4, 2)
		if origem then
			-- Move de forma que a Origem caia no ponto e no giro da cópia.
			local deslocamento = origem.CFrame:ToObjectSpace(c:GetPivot())
			c:PivotTo(alvo * deslocamento)
			origem:Destroy()
		else
			c:PivotTo(alvo)
		end
		prepararPecas(c)
		c.Parent = pastaCopias
		copias += 1
		if copias % 500 == 0 then
			task.wait() -- não trava o servidor enquanto monta
		end
	end
end

-- 3) Colisões ---------------------------------------------------------------
local pastaColisao = Instance.new("Folder")
pastaColisao.Name = "Colisores"
pastaColisao.Parent = pastaMapa
local n = 0
for _, e in ipairs(lerModulos("DadosColisores")) do
	local p = Instance.new("Part")
	p.Name = "Colisor"
	p.Anchored = true
	p.CanCollide = true
	p.CanTouch = false
	p.CanQuery = true -- tiros e câmera param nas paredes
	p.Transparency = 1
	p.CastShadow = false
	p.Size = Vector3.new(math.max(e[4], 0.05), math.max(e[5], 0.05), math.max(e[6], 0.05))
	p.CFrame = cframeDe(e, 4, 3)
	p.Parent = pastaColisao
	n += 1
	if n % 1000 == 0 then
		task.wait()
	end
end

print(("[MontarMapa] pronto em %.1f s: %d objetos, %d colisores"):format(os.clock() - inicio, copias, n))
