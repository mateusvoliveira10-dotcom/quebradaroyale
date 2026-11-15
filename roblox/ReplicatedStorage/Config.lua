-- ModuleScript "Config" (ReplicatedStorage)
-- Números do jogo num lugar só (servidor e jogadores leem daqui).
-- 1 stud = 0,28 m. As velocidades seguem o jogo de navegador (m/s convertido para studs/s).

local Config = {}

Config.STUDS_POR_METRO = 1 / 0.28

-- Velocidades (studs por segundo)
Config.VelAndar = 22     -- 6,2 m/s: corrida leve padrão
Config.VelCorrer = 31    -- 8,6 m/s: segurando Shift
Config.VelAgachado = 12  -- 3,4 m/s
Config.VelDeitado = 5    -- 1,35 m/s: rastejando
Config.VelNadar = 13     -- 3,6 m/s

-- Pulo (altura em studs; ~1,3 m)
Config.AlturaPulo = 5

-- Câmera por cima do ombro (deslocamento do ponto mirado, em studs)
Config.OmbroX = 2
Config.CameraAltura = {
	EmPe = 0.5,
	Correndo = 0.5,
	Agachado = -1.2,
	Deitado = -2.4,
}

-- Animações das posturas (crie no Editor de Animação e cole o ID "rbxassetid://...").
-- Vazio = sem animação (o personagem só fica mais lento e a câmera desce).
Config.Animacoes = {
	Agachado = "",
	Deitado = "",
}

return Config
