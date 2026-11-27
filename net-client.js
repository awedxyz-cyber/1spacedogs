let ws = null;
let netConnected = false;
let netStatusText = "";
let reconnectTimer = null;
let reconnectAttempts = 0;
let manualDisconnect = false;
let lastInputSend = 0;

function setOnlineStatus(txt) {
  netStatusText = txt;
  const el = document.getElementById("online-status");
  if (el) el.textContent = txt;
}

function normalizeWsUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (s.startsWith("wss://") || s.startsWith("ws://")) return s;
  if (s.startsWith("https://")) return "wss://" + s.slice(8);
  if (s.startsWith("http://")) return "ws://" + s.slice(7);
  return "wss://" + s;
}

function sendNetAction(payload) {
  if (gameMode !== "online" || !ws || ws.readyState !== WebSocket.OPEN) return;
  try { ws.send(JSON.stringify(payload)); } catch (_) {}
}

function applyServerEvents(events) {
  if (!Array.isArray(events) || !window.state) return;
  const st = window.state;
  for (const ev of events) {
    if (!ev || typeof ev !== "object") continue;
    if (ev.kind === "boom") {
      spawnParticles(ev.x, ev.y, ev.color || "#ffa94d", ev.big ? 24 : 12, true);
      playExplosionSoundAt(ev.x, ev.y, !!ev.big);
    } else if (ev.kind === "fx") {
      spawnParticles(ev.x, ev.y, ev.color || "#7cc4ff", ev.count || 12, true);
      playToneAt(ev.x, ev.y, 420, 780, 0.16, "triangle", 0.04, true);
    } else if (ev.kind === "shot1") {
      playToneAt(ev.x, ev.y, 680, 260, 0.07, "square", 0.025);
    } else if (ev.kind === "shot2") {
      if (ev.w2Type === "seeker") playToneAt(ev.x, ev.y, 320, 520, 0.14, "sawtooth", 0.035);
      else if (ev.w2Type === "beam") {
        playToneAt(ev.x, ev.y, 920, 210, 0.22, "sawtooth", 0.045);
        if (st.beams && st.beams.length < 180 && typeof ev.x2 === "number" && typeof ev.y2 === "number") {
          st.beams.push({ x1: ev.x, y1: ev.y, x2: ev.x2, y2: ev.y2, color: ev.color || "#66d9e8", life: 0.16, width: 6 });
        }
      } else playToneAt(ev.x, ev.y, 380, 140, 0.14, "sawtooth", 0.035);
    } else if (ev.kind === "hit") {
      spawnParticles(ev.x, ev.y, ev.color || "#ffd43b", ev.count || 6, false);
      playToneAt(ev.x, ev.y, 520, 220, 0.06, "triangle", 0.02);
    } else if (ev.kind === "abil") {
      if (ev.abil === "cloak") playToneAt(ev.x, ev.y, 900, 160, 0.4, "sine", 0.06, true);
      else if (ev.abil === "portal") playToneAt(ev.x, ev.y, 200, 1200, 0.3, "sawtooth", 0.05, true);
      else if (ev.abil === "shield") playToneAt(ev.x, ev.y, 300, 800, 0.3, "triangle", 0.06, true);
      else if (ev.abil === "dmg") playToneAt(ev.x, ev.y, 140, 500, 0.3, "sawtooth", 0.06, true);
      else if (ev.abil === "help") {
        [0, 170, 340].forEach((d, i) => setTimeout(() => playToneAt(ev.x, ev.y, 700 + i * 160, 950 + i * 160, 0.14, "square", 0.05, true, 4000), d));
      } else playToneAt(ev.x, ev.y, 440, 760, 0.2, "triangle", 0.04, true);
    } else if (ev.kind === "collide") {
      spawnParticles(ev.x, ev.y, ev.color || "#ced4da", 8, false);
      playToneAt(ev.x, ev.y, 190, 85, 0.11, "triangle", 0.035, true);
    }
  }
}

function applyServerState(snap) {
  if (!snap || typeof snap !== "object" || !Array.isArray(snap.ships)) return;
  const prev = window.state || {};
  const prevMap = new Map((prev.ships || []).map(s => [s.id, s]));

  if (Array.isArray(snap.nodes)) {
    const prevNodes = new Map((prev.nodes || []).map(n => [n.id, n]));
    snap.nodes = snap.nodes.map(n => {
      const o = prevNodes.get(n.id);
      let shape = n.shape || (o && o.shape) || null;
      if (n.type === "asteroid" && !shape) shape = createAsteroidShape(n.radius || 20);
      return { ...n, shape };
    });
  }

  const ships = snap.ships.map(s => {
    const old = prevMap.get(s.id);
    const jumpDist = old && typeof old.x === "number" ? Math.hypot(s.x - old.x, s.y - old.y) : 0;
    return {
      ...s,
      isPlayer: s.id === (prev.myShipId || s.id),
      x: old && typeof old.x === "number" && jumpDist < 320 ? old.x : s.x,
      y: old && typeof old.y === "number" && jumpDist < 320 ? old.y : s.y,
      targetX: s.x,
      targetY: s.y
    };
  });

  if (snap.gameOver && !prev.gameOver) {
    window.state = {
      ...prev, ...snap, ships,
      particles: prev.particles || [], shockwaves: prev.shockwaves || [], flashes: prev.flashes || [],
      nebulae: prev.nebulae || [], bgStars: prev.bgStars || [], theme: prev.theme || { bg: "#060816" },
      gameOver: null
    };
    finishMatch(snap.winnerTeam || (snap.bScore >= snap.rScore ? "blue" : "red"), snap.winReason || "Meccs vége");
    window.state.gameOver = snap.gameOver;
    return;
  }

  window.state = {
    ...prev,
    ...snap,
    ships,
    particles: prev.particles || [],
    shockwaves: prev.shockwaves || [],
    flashes: prev.flashes || [],
    nebulae: prev.nebulae || [],
    bgStars: prev.bgStars || [],
    theme: prev.theme || { bg: "#060816" },
    timeAlarmText: ""
  };

  if (Array.isArray(snap.events)) applyServerEvents(snap.events);
}

function scheduleReconnect() {
  if (manualDisconnect || gameMode !== "online") return;
  clearTimeout(reconnectTimer);
  reconnectAttempts++;
  const delay = Math.min(8000, 1200 * reconnectAttempts);
  setOnlineStatus(`Kapcsolat megszakadt — újracsatlakozás (${Math.round(delay / 1000)} mp)...`);
  reconnectTimer = setTimeout(() => {
    if (!manualDisconnect && gameMode === "online") connectOnline();
  }, delay);
}

function disconnectOnline() {
  manualDisconnect = true;
  clearTimeout(reconnectTimer);
  netConnected = false;
  setOnlineStatus("");
  if (ws) {
    try { ws.onclose = null; ws.close(); } catch (_) {}
    ws = null;
  }
}

function connectOnline() {
  const url = normalizeWsUrl(settings.onlineUrl);
  if (!url) {
    setOnlineStatus("Add meg a Render szerver címét (pl. wss://...onrender.com)!");
    return false;
  }
  manualDisconnect = false;
  clearTimeout(reconnectTimer);
  gameMode = "online";
  if (!window.state) generateSolarSystem();
  window.state.started = true;
  setOnlineStatus("Csatlakozás a szerverhez...");

  try {
    if (ws) { try { ws.onclose = null; ws.close(); } catch (_) {} }
    ws = new WebSocket(url);

    ws.onopen = () => {
      netConnected = true;
      reconnectAttempts = 0;
      setOnlineStatus(`Online csatlakozva (${settings.onlineRoom})`);
      ws.send(JSON.stringify({
        type: "join",
        roomId: settings.onlineRoom || "global-5v5",
        team: settings.onlineTeam || "auto",
        minutes: settings.minutes || 3
      }));
      closeMenu();
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (!msg || typeof msg.type !== "string") return;
        if (msg.type === "joined") {
          if (window.state) window.state.myShipId = msg.shipId;
          setOnlineStatus(`Szoba: ${msg.roomId} | Hajó: ${msg.shipId}`);
        } else if (msg.type === "state" && msg.state) {
          applyServerState(msg.state);
        }
      } catch (_) {}
    };

    ws.onerror = () => {
      setOnlineStatus("Hálózati hiba — újrapróbálás hamarosan...");
    };

    ws.onclose = () => {
      netConnected = false;
      scheduleReconnect();
    };
    return true;
  } catch (e) {
    setOnlineStatus("Nem sikerült elindítani a kapcsolatot.");
    scheduleReconnect();
    return false;
  }
}

function sendPlayerInputFrame(nowMs) {
  if (gameMode !== "online" || !ws || ws.readyState !== WebSocket.OPEN) return;
  if (nowMs - lastInputSend < 33) return;
  lastInputSend = nowMs;
  const st = window.state, p = getPlayerRef();
  if (!st || !p || st.gameOver) return;
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const aimAngle = Math.atan2(mouse.y - cy, mouse.x - cx);
  const mouseDist = Math.hypot(mouse.x - cx, mouse.y - cy);
  ws.send(JSON.stringify({
    type: "input",
    input: {
      up: !!(keys["KeyW"] || keys["ArrowUp"]),
      down: !!(keys["KeyS"] || keys["ArrowDown"]),
      left: !!(keys["KeyA"] || keys["ArrowLeft"]),
      right: !!(keys["KeyD"] || keys["ArrowRight"]),
      aimAngle,
      fire1: !!mouse.downLeft,
      fire2: !!(mouse.downRight || keys["Space"]),
      throttle: p.throttle || 1,
      mouseDist
    }
  }));
}

setInterval(() => {
  if (gameMode === "online" && ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify({ type: "ping" })); } catch (_) {}
  }
}, 20000);
