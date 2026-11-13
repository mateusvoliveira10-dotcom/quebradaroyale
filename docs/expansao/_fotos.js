// Ajudante de conferência (colar no console do servidor mapa-dev): congela o modo, esconde a
// interface e fotografa o mapa para docs/expansao/<nome>.jpg (endereço /__foto do vite.mapa.config.ts).
(() => {
  const g = window.game;
  const cam = g.camera.camera;
  const V = cam.position.constructor;
  const cv = g.engine.getRenderingCanvas();
  g.mode.update = () => {};
  for (const el of document.body.children) if (!el.contains(cv)) el.style.display = 'none';
  window.shot = (px, py, pz, tx, ty, tz, n = 4, minZ = 0.2) => {
    g.scene.activeCamera = cam;
    cam.lowerRadiusLimit = 0.1;
    cam.upperRadiusLimit = 5000;
    cam.lowerBetaLimit = 0.001;
    cam.upperBetaLimit = 3.14;
    cam.maxZ = 2500;
    cam.minZ = minZ;
    cam.setTarget(new V(tx, ty, tz));
    cam.setPosition(new V(px, py, pz));
    for (let i = 0; i < n; i++) {
      g.engine.beginFrame();
      g.scene.render();
      g.engine.endFrame();
    }
    return JSON.stringify({ ativas: g.scene.getActiveMeshes().length, tris: Math.round(g.scene.getActiveIndices() / 3), verts: g.scene.getTotalVertices() });
  };
  window.foto = async (nome, px, py, pz, tx, ty, tz, minZ) => {
    const st = window.shot(px, py, pz, tx, ty, tz, 6, minZ);
    const url = cv.toDataURL('image/jpeg', 0.82);
    const bin = atob(url.split(',')[1]);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const res = await fetch('/__foto?nome=' + nome, { method: 'POST', body: u8 });
    return nome + ' ' + st + ' ' + res.status;
  };
})();
