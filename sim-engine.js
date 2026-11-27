function updateOnlineVisuals(dt) {
  const st = window.state;
  if (!st || !st.ships) return;
  st.time += dt;
  for (const s of st.ships) {
    if (s.respawnTimer > 0) continue;
    s.x = clamp(s.x + (s.vx || 0) * dt, -HALF + 30, HALF - 30);
    s.y = clamp(s.y + (s.vy || 0) * dt, -HALF + 30, HALF - 30);
    if (typeof s.targetX === "number" && typeof s.targetY === "number") {
      const blend = Math.min(1, dt * 18);
      s.x += (s.targetX - s.x) * blend;
      s.y += (s.targetY - s.y) * blend;
    }
  }
  const activeShips = st.ships.filter(s => s.respawnTimer <= 0);
  applyDynamicCollisions(st, activeShips);
  for (const s of activeShips) {
    s.x = clamp(s.x, -HALF + 30, HALF - 30);
    s.y = clamp(s.y, -HALF + 30, HALF - 30);
  }
  for (let i = st.beams.length - 1; i >= 0; i--) { st.beams[i].life -= dt; if (st.beams[i].life <= 0) st.beams.splice(i, 1); }
  for (let i = st.particles.length - 1; i >= 0; i--) {
    const pt = st.particles[i]; pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.life -= dt;
    if (pt.life <= 0) st.particles.splice(i, 1);
  }
  for (let i = st.shockwaves.length - 1; i >= 0; i--) {
    const sw = st.shockwaves[i]; sw.life -= dt; sw.r += (sw.maxR - sw.r) * Math.min(1, dt * 11);
    if (sw.life <= 0) st.shockwaves.splice(i, 1);
  }
}
