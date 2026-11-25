const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;
const WORLD_SIZE = 4400;
const HALF = WORLD_SIZE / 2;

const SHIP_CLASSES = {
  fighter: {
    name: "Vadász", sizeTier: 1, radius: 12, mass: 1.4,
    speedMult: 1.25, thrustMult: 1.3, dmgMult: 0.65, rangeMult: 0.8,
    regenMult: 1.25, reloadMult: 1.0, hpMult: 0.8, armorMult: 0.6, baseCargo: 55,
    fuelMult: 1.0, fuelUse: 0.8, energyMult: 0.9
  },
  cruiser: {
    name: "Cirkáló", sizeTier: 2, radius: 16, mass: 2.7,
    speedMult: 0.8, thrustMult: 0.85, dmgMult: 1.15, rangeMult: 1.0,
    regenMult: 1.0, reloadMult: 1.25, hpMult: 1.35, armorMult: 1.3, baseCargo: 95,
    fuelMult: 1.2, fuelUse: 1.0, energyMult: 1.0
  },
  battleship: {
    name: "Anyahajó", sizeTier: 3, radius: 22, mass: 5.0,
    speedMult: 0.5, thrustMult: 0.58, dmgMult: 2.2, rangeMult: 1.3,
    regenMult: 0.6, reloadMult: 2.0, hpMult: 2.2, armorMult: 2.0, baseCargo: 160,
    fuelMult: 1.6, fuelUse: 1.5, energyMult: 1.3
  }
};

const SHIP_UPGRADE_DEFS = [
  { key: "hp", baseMat: 25, stepMat: 15, basePts: 5, stepPts: 5, baseEn: 10, stepEn: 5 },
  { key: "armor", baseMat: 25, stepMat: 15, basePts: 5, stepPts: 5, baseEn: 10, stepEn: 5 },
  { key: "w1", baseMat: 30, stepMat: 20, basePts: 8, stepPts: 6, baseEn: 15, stepEn: 8 },
  { key: "w2", baseMat: 35, stepMat: 20, basePts: 10, stepPts: 8, baseEn: 18, stepEn: 8 },
  { key: "regen", baseMat: 25, stepMat: 15, basePts: 5, stepPts: 5, baseEn: 12, stepEn: 6 },
  { key: "fuel", baseMat: 20, stepMat: 15, basePts: 5, stepPts: 4, baseEn: 10, stepEn: 5 },
  { key: "energy", baseMat: 20, stepMat: 15, basePts: 5, stepPts: 4, baseEn: 10, stepEn: 5 },
  { key: "speed", baseMat: 25, stepMat: 15, basePts: 6, stepPts: 5, baseEn: 12, stepEn: 6 },
  { key: "mining", baseMat: 25, stepMat: 15, basePts: 6, stepPts: 5, baseEn: 12, stepEn: 6 },
  { key: "cargo", baseMat: 20, stepMat: 14, basePts: 5, stepPts: 4, baseEn: 10, stepEn: 5 }
];

const BASE_UPGRADE_DEFS = [
  { key: "hp", baseMat: 40, stepMat: 25, basePts: 10, stepPts: 8, baseEn: 30, stepEn: 15 },
  { key: "armor", baseMat: 40, stepMat: 25, basePts: 10, stepPts: 8, baseEn: 30, stepEn: 15 },
  { key: "storage", baseMat: 35, stepMat: 20, basePts: 8, stepPts: 6, baseEn: 25, stepEn: 12 },
  { key: "energy", baseMat: 35, stepMat: 20, basePts: 8, stepPts: 6, baseEn: 25, stepEn: 12 },
  { key: "fuel", baseMat: 35, stepMat: 20, basePts: 8, stepPts: 6, baseEn: 25, stepEn: 12 }
];

const ABIL = {
  help: { cd: L => 28 - 2 * L },
  cloak: { cd: L => 32 - 2 * L },
  portal: { cd: L => 20 - 2 * L },
  shield: { cd: L => 26 - 2 * L },
  heal: { cd: L => 38 - 3 * L },
  dmg: { cd: L => 30 - 2 * L }
};
const ABIL_KEYS = Object.keys(ABIL);
const ABIL_MAX = 5;

function rand(min, max) { return min + Math.random() * (max - min); }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
function clamp(v, lo, hi) { return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo; }
function dist(a, b) { return (!a || !b) ? Infinity : Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0)); }

function createAsteroidShape(radius) {
  const vertices = randInt(7, 13);
  const shape = [];
  for (let i = 0; i < vertices; i++) {
    shape.push({ ang: (i / vertices) * Math.PI * 2, r: radius * rand(0.68, 1.28) });
  }
  return shape;
}

function recalcBaseStats(b, fill = false) {
  const prevHp = b.maxHp, prevAr = b.maxArmor;
  b.maxHp = 2600 + (b.levels.hp - 1) * 500;
  b.maxArmor = 900 + (b.levels.armor - 1) * 250;
  b.maxStorage = 400 + (b.levels.storage - 1) * 200;
  b.maxEnergy = 500 + (b.levels.energy - 1) * 200;
  b.maxFuel = 500 + (b.levels.fuel - 1) * 200;
  if (fill) { b.hp = b.maxHp; b.armor = b.maxArmor; }
  else {
    b.hp = clamp(b.hp + Math.max(0, b.maxHp - prevHp), 0, b.maxHp);
    b.armor = clamp(b.armor + Math.max(0, b.maxArmor - prevAr), 0, b.maxArmor);
  }
}

function createBase(team, name, x, y) {
  const b = {
    team, name, x, y, vx: 0, vy: 0, radius: 56, mass: 500, immovable: true,
    levels: { hp: 1, armor: 1, storage: 1, energy: 1, fuel: 1 },
    maxHp: 1500, hp: 1500, maxArmor: 500, armor: 500,
    maxStorage: 400, materials: 120, buildMaterials: 80,
    maxEnergy: 500, energy: 300, maxFuel: 500, fuel: 220, points: 50,
    underAttackTimer: 0, noMatAlertTimer: 0,
    droneBuildCd: rand(5, 11), autoUpgradeCd: rand(2.5, 5.5), fireCd: rand(0.2, 0.8), dropCooldown: 0
  };
  recalcBaseStats(b, true);
  return b;
}

function createDrone(team, x, y) {
  return {
    team, x, y, vx: rand(-20, 20), vy: rand(-20, 20), radius: 7, mass: 0.7,
    hp: 65, maxHp: 65, cargo: 0, maxCargo: 16, aiTimer: rand(0.2, 0.8), target: null
  };
}

function recalcShipStats(s, fill = false) {
  const cls = SHIP_CLASSES[s.shipClass] || SHIP_CLASSES.fighter;
  const prevHp = s.maxHp, prevAr = s.maxArmor, prevFu = s.maxFuel, prevEn = s.maxEnergy;
  s.radius = cls.radius; s.mass = cls.mass;
  s.maxHp = Math.round((180 + (s.levels.hp - 1) * 45) * cls.hpMult);
  s.maxArmor = Math.round((100 + (s.levels.armor - 1) * 35) * cls.armorMult);
  s.maxFuel = Math.round((100 + (s.levels.fuel - 1) * 35) * (cls.fuelMult || 1));
  s.maxEnergy = Math.round((140 + (s.levels.energy - 1) * 35) * (cls.energyMult || 1));
  s.regenRate = (3.5 + (s.levels.regen - 1) * 2.2) * cls.regenMult;
  s.w1Dmg = (15 + (s.levels.w1 - 1) * 4) * cls.dmgMult;
  s.w2Dmg = (26 + (s.levels.w2 - 1) * 6.5) * cls.dmgMult;
  s.w1Interval = 0.24 * cls.reloadMult;
  s.w2Interval = 0.75 * cls.reloadMult;
  s.w1Range = 450 * cls.rangeMult;
  s.w2Range = 330 * cls.rangeMult;
  s.maxSpeed = (290 + (s.levels.speed - 1) * 35) * cls.speedMult;
  s.thrustBase = (280 + (s.levels.speed - 1) * 32) * cls.thrustMult;
  s.miningDps = 38 + (s.levels.mining - 1) * 14;
  s.miningRange = (190 + (s.levels.mining - 1) * 16) * cls.rangeMult;
  s.maxCargo = (cls.baseCargo || 55) + ((s.levels.cargo || 1) - 1) * 30;
  s.cargo = clamp(s.materials || 0, 0, s.maxCargo);
  s.materials = s.cargo;
  if (fill) { s.hp = s.maxHp; s.armor = s.maxArmor; s.fuel = s.maxFuel; s.energy = s.maxEnergy; }
  else {
    s.hp = clamp(s.hp + Math.max(0, s.maxHp - prevHp), 0, s.maxHp);
    s.armor = clamp(s.armor + Math.max(0, s.maxArmor - prevAr), 0, s.maxArmor);
    s.fuel = clamp(s.fuel + Math.max(0, s.maxFuel - prevFu), 0, s.maxFuel);
    s.energy = clamp(s.energy + Math.max(0, s.maxEnergy - prevEn), 0, s.maxEnergy);
  }
}

function createShip(id, team, shipClass, x, y) {
  const w2Pool = ["twin", "seeker", "beam"];
  const s = {
    id, team, shipClass,
    isHuman: false, controllerClientId: null,
    input: { up: false, down: false, left: false, right: false, aimAngle: team === "blue" ? 0 : Math.PI, fire1: false, fire2: false, throttle: 1.0, mouseDist: 420 },
    w2Type: w2Pool[randInt(0, w2Pool.length - 1)],
    switchCount: 0, kills: 0, deaths: 0,
    x, y, vx: 0, vy: 0, angle: team === "blue" ? 0 : Math.PI, radius: 12, mass: 1.4,
    levels: { hp: 1, armor: 1, w1: 1, w2: 1, regen: 1, fuel: 1, energy: 1, speed: 1, mining: 1, cargo: 1 },
    maxHp: 120, hp: 120, maxArmor: 80, armor: 80, maxFuel: 100, fuel: 100, maxEnergy: 100, energy: 100, regenRate: 4,
    w1Dmg: 16, w1Cd: 0, w1Interval: 0.24, w1Range: 440, w2Dmg: 28, w2Cd: 0, w2Interval: 0.75, w2Range: 340,
    maxSpeed: 290, thrustBase: 280, throttle: 1.0, miningDps: 38, miningRange: 190,
    maxCargo: 55, cargo: 45, points: 10, materials: 45,
    respawnTimer: 0, waitingForBuildMat: false, baseDepositCd: 0,
    aiTimer: rand(0.2, 0.8), aiTarget: null, dropCooldown: 0,
    abil: {}, abilCd: {}, slotQ: null, slotE: null, cloakT: 0, shieldT: 0, shieldHp: 0, shieldMax: 1, shieldHit: 0, armorHit: 0,
    aiAbT: undefined, aiBuyT: undefined, dmgBoostT: 0, dmgMult: 1, helpT: 0, helpX: 0, helpY: 0, fuelEmpty: false
  };
  recalcShipStats(s, true);
  return s;
}

class Room {
  constructor(id, minutes = 3) {
    this.id = id;
    this.clients = new Map();
    this.events = [];
    this.resetWorld(minutes);
  }

  restart() {
    this.overT = 0;
    this.resetWorld(this.state.baseDuration / 60);
    for (const [, c] of this.clients) this.assignPlayer(c);
  }

  pushEvent(ev) {
    if (this.events.length < 80) this.events.push(ev);
  }

  placeNodeEnteringSystem(n) {
    const side = randInt(0, 3);
    const margin = 120;
    let sx = 0, sy = 0;
    if (side === 0) { sx = rand(-HALF + 150, HALF - 150); sy = -HALF - margin; }
    else if (side === 1) { sx = HALF + margin; sy = rand(-HALF + 150, HALF - 150); }
    else if (side === 2) { sx = rand(-HALF + 150, HALF - 150); sy = HALF + margin; }
    else { sx = -HALF - margin; sy = rand(-HALF + 150, HALF - 150); }
    const ang = Math.atan2(rand(-HALF * 0.65, HALF * 0.65) - sy, rand(-HALF * 0.65, HALF * 0.65) - sx) + rand(-0.22, 0.22);
    const sp = n.type === "asteroid" ? rand(24, 76) : rand(14, 34);
    n.x = sx; n.y = sy; n.vx = Math.cos(ang) * sp; n.vy = Math.sin(ang) * sp;
    n.hp = n.maxHp; n.respawnTimer = 0; n.dropCooldown = 0;
    if (n.type === "asteroid") n.shape = createAsteroidShape(n.radius);
  }

  resetWorld(minutes = 3) {
    const baseDur = clamp(Number(minutes) || 3, 1, 8) * 60;
    const star = { x: rand(-350, 350), y: rand(-350, 350), radius: rand(95, 135), color: ["#ffd43b", "#ffa94d", "#74c0fc", "#ff8787"][randInt(0, 3)] };
    const planets = [];
    for (let i = 0; i < randInt(3, 6); i++) {
      const ang = rand(0, Math.PI * 2), radDist = rand(520, 1750), r = rand(34, 72);
      planets.push({
        x: star.x + Math.cos(ang) * radDist, y: star.y + Math.sin(ang) * radDist, radius: r,
        color: ["#4c6ef5", "#2b8a3e", "#c92a2a", "#ae3ec9", "#15aabf", "#d9480f"][i % 6],
        hp: r * 25, maxHp: r * 25
      });
    }
    const blueBase = createBase("blue", "Kék Főbázis", -1650 + rand(-180, 180), rand(-600, 600));
    const redBase = createBase("red", "Piros Főbázis", 1650 + rand(-180, 180), rand(-600, 600));
    const spots = [{ x: -850, y: -750 }, { x: -850, y: 750 }, { x: 0, y: 0 }, { x: 850, y: -750 }, { x: 850, y: 750 }];
    const turrets = spots.map((sp, i) => ({
      id: i + 1, x: sp.x + rand(-220, 220), y: sp.y + rand(-220, 220), radius: 28,
      owner: null, captureProgress: 0, fireCd: rand(0.2, 1.0), hp: 400, maxHp: 400, dropCooldown: 0
    }));
    const nodes = [];
    for (let i = 0; i < 65; i++) {
      const type = i < 42 ? "asteroid" : (i < 54 ? "container" : "wreck");
      const radius = type === "asteroid" ? rand(13, 34) : rand(14, 21);
      const sp = type === "asteroid" ? rand(18, 72) : rand(10, 28);
      const ang = rand(0, Math.PI * 2);
      const maxHp = type === "asteroid" ? Math.round(radius * 3.2) : (type === "container" ? randInt(40, 70) : randInt(70, 120));
      nodes.push({
        id: i + 1, type, x: rand(-HALF + 220, HALF - 220), y: rand(-HALF + 220, HALF - 220),
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, radius,
        rot: rand(0, Math.PI * 2), rotSpeed: rand(-1.4, 1.4),
        shape: type === "asteroid" ? createAsteroidShape(radius) : null,
        hp: maxHp, maxHp,
        rewardMat: type === "container" ? randInt(18, 32) : (type === "wreck" ? randInt(15, 28) : Math.max(8, Math.round(radius * 0.7))),
        rewardPts: type === "wreck" ? 25 : (type === "container" ? 20 : 12),
        respawnTimer: 0, dropCooldown: 0
      });
    }
    const roster = ["fighter", "fighter", "cruiser", "cruiser", "battleship"];
    const ships = [];
    for (let i = 0; i < 5; i++) ships.push(createShip("B" + (i + 1), "blue", roster[i], blueBase.x + 95, blueBase.y + (i - 2) * 55));
    for (let i = 0; i < 5; i++) ships.push(createShip("R" + (i + 1), "red", roster[i], redBase.x - 95, redBase.y + (i - 2) * 55));
    const drones = [
      createDrone("blue", blueBase.x + 40, blueBase.y - 40),
      createDrone("blue", blueBase.x + 40, blueBase.y + 40),
      createDrone("red", redBase.x - 40, redBase.y - 40),
      createDrone("red", redBase.x - 40, redBase.y + 40)
    ];

    this.state = {
      roomId: this.id,
      star, planets,
      bases: { blue: blueBase, red: redBase },
      turrets, nodes, ships, drones,
      pickups: [], projectiles: [], beams: [], kraken: null,
      krakenSpawnCd: rand(16, 28),
      matchTime: 0, baseDuration: baseDur, targetDuration: baseDur, maxDuration: baseDur + 120, nextJudgeTime: baseDur,
      judgeNote: `Bíró: ${Math.floor(baseDur / 60)}:00-nál bírálat (összérték)`,
      teamKills: { blue: 0, red: 0 }, teamDeaths: { blue: 0, red: 0 }, turretHoldTime: { blue: 0, red: 0 },
      gameOver: null, winnerTeam: null, winReason: ""
    };
  }

  assignPlayer(client) {
    // Először keressünk szabad vagy AI által irányított hajót a kért/kevesebb játékosú csapatban
    const blueHumans = this.state.ships.filter(s => s.team === "blue" && s.isHuman).length;
    const redHumans = this.state.ships.filter(s => s.team === "red" && s.isHuman).length;
    const preferredTeam = (client.preferredTeam === "red" || client.preferredTeam === "blue")
      ? client.preferredTeam
      : (blueHumans <= redHumans ? "blue" : "red");

    let slot = this.state.ships.find(s => s.team === preferredTeam && !s.isHuman);
    if (!slot) slot = this.state.ships.find(s => !s.isHuman);
    if (!slot) slot = this.state.ships[0];

    slot.isHuman = true;
    slot.controllerClientId = client.id;
    client.shipId = slot.id;
    client.team = slot.team;
  }

  releasePlayer(client) {
    const s = this.state.ships.find(sh => sh.id === client.shipId && sh.controllerClientId === client.id);
    if (s) {
      s.isHuman = false;
      s.controllerClientId = null;
    }
  }

  addShipCargo(ship, amt) {
    if (amt <= 0) return 0;
    const add = Math.min(Math.max(0, ship.maxCargo - ship.cargo), amt);
    ship.cargo += add; ship.materials = ship.cargo;
    return add;
  }

  removeShipCargo(ship, amt) {
    if (amt <= 0) return 0;
    const rem = Math.min(ship.cargo, amt);
    ship.cargo -= rem; ship.materials = ship.cargo;
    return rem;
  }

  spawnPickups(x, y, count, matValue = 8, ptValue = 4) {
    for (let i = 0; i < count && this.state.pickups.length < 240; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(25, 130);
      this.state.pickups.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, radius: 6, mat: matValue, pts: ptValue, life: 45 });
    }
  }

  computeTeamScore(team) {
    const kills = this.state.teamKills[team] || 0;
    const deaths = this.state.teamDeaths[team] || 0;
    const kdRatio = (kills + 1) / (deaths + 1);
    const kdPoints = kdRatio * 35 + kills * 12 - deaths * 6;
    const holdPoints = (this.state.turretHoldTime[team] || 0) * 0.45;
    const b = this.state.bases[team];
    const basePoints = (b.maxHp > 0 ? b.hp / b.maxHp : 0) * 80 + (b.maxArmor > 0 ? b.armor / b.maxArmor : 0) * 25;
    const teamPts = this.state.ships.filter(s => s.team === team).reduce((a, s) => a + (s.points || 0), 0) + (b.points || 0);
    return Math.round(kdPoints + holdPoints + basePoints + teamPts * 0.35);
  }

  finish(winnerTeam, reason) {
    if (this.state.gameOver) return;
    this.state.gameOver = winnerTeam === "blue" ? "KÉK CSAPAT GYŐZÖTT!" : "PIROS CSAPAT GYŐZÖTT!";
    this.state.winnerTeam = winnerTeam;
    this.state.winReason = reason;
  }

  handleAction(client, msg) {
    const ship = this.state.ships.find(s => s.id === client.shipId);
    if (!ship || this.state.gameOver) return;

    if (msg.type === "input" && msg.input) {
      const inp = msg.input;
      ship.input = {
        up: !!inp.up, down: !!inp.down, left: !!inp.left, right: !!inp.right,
        aimAngle: Number.isFinite(inp.aimAngle) ? inp.aimAngle : ship.angle,
        fire1: !!inp.fire1, fire2: !!inp.fire2,
        throttle: clamp(Number(inp.throttle) || 1, 0.2, 1),
        mouseDist: clamp(Number(inp.mouseDist) || 420, 120, 900)
      };
      ship.throttle = ship.input.throttle;
    } else if (msg.type === "setW2" && ["twin", "seeker", "beam"].includes(msg.w2Type)) {
      ship.w2Type = msg.w2Type;
    } else if (msg.type === "switchClass" && SHIP_CLASSES[msg.shipClass]) {
      const ownBase = this.state.bases[ship.team];
      if (ship.respawnTimer <= 0 && dist(ship, ownBase) <= ownBase.radius + 140 && ship.shipClass !== msg.shipClass) {
        const tier = SHIP_CLASSES[msg.shipClass].sizeTier;
        const sf = 1 + (ship.switchCount || 0) * 0.75;
        const cost = { mat: Math.round(25 * tier * sf), pts: Math.round(6 * tier * sf), en: Math.round(15 * tier * sf) };
        if (ship.materials >= cost.mat && ship.points >= cost.pts && ship.energy >= cost.en) {
          this.removeShipCargo(ship, cost.mat);
          ship.points -= cost.pts; ship.energy -= cost.en;
          ship.shipClass = msg.shipClass; ship.switchCount++;
          recalcShipStats(ship, true);
          this.pushEvent({ kind: "fx", x: ship.x, y: ship.y, color: "#7cc4ff", count: 14, tone: "switch" });
        }
      }
    } else if (msg.type === "buyShipUpgrade") {
      const def = SHIP_UPGRADE_DEFS.find(u => u.key === msg.key);
      if (def && ship.respawnTimer <= 0) {
        const lvl = (ship.levels[msg.key] || 1) - 1;
        const cost = { mat: def.baseMat + lvl * def.stepMat, pts: def.basePts + lvl * def.stepPts, en: def.baseEn + lvl * def.stepEn };
        if (ship.materials >= cost.mat && ship.points >= cost.pts && ship.energy >= cost.en) {
          this.removeShipCargo(ship, cost.mat);
          ship.points -= cost.pts; ship.energy -= cost.en;
          ship.levels[msg.key] = (ship.levels[msg.key] || 1) + 1;
          ship.points += 4;
          recalcShipStats(ship, false);
        }
      }
    } else if (msg.type === "buyBaseUpgrade") {
      const def = BASE_UPGRADE_DEFS.find(u => u.key === msg.key);
      const b = this.state.bases[ship.team];
      if (def && b) {
        const lvl = b.levels[msg.key] - 1;
        const cost = { mat: def.baseMat + lvl * def.stepMat, pts: def.basePts + lvl * def.stepPts, en: def.baseEn + lvl * def.stepEn };
        if (b.materials + ship.materials >= cost.mat && b.points + ship.points >= cost.pts && b.energy >= cost.en) {
          let rm = cost.mat, fm = Math.min(b.materials, rm); b.materials -= fm; rm -= fm;
          if (rm > 0) this.removeShipCargo(ship, rm);
          let rp = cost.pts, fp = Math.min(b.points, rp); b.points -= fp; rp -= fp;
          if (rp > 0) ship.points -= rp;
          b.energy -= cost.en; b.levels[msg.key] += 1; b.points += 5;
          recalcBaseStats(b, false);
        }
      }
    } else if (msg.type === "buyAbility" && ABIL[msg.key]) {
      const key = msg.key, L = ship.abil[key] || 0;
      if (ship.respawnTimer <= 0 && L < ABIL_MAX) {
        let target = null, replaced = null;
        if (L === 0) {
          const freeQ = !ship.slotQ, freeE = !ship.slotE;
          if (freeQ || freeE) target = (!msg.slot) ? (freeQ ? "Q" : "E") : ((msg.slot === "Q" && freeQ) || (msg.slot === "E" && freeE) ? msg.slot : null);
          else if (msg.slot === "Q" || msg.slot === "E") { target = msg.slot; replaced = msg.slot === "Q" ? ship.slotQ : ship.slotE; }
          if (!target) return;
        }
        const cost = { mat: 25 + 20 * L, pts: 6 + 5 * L, en: 10 + 5 * L };
        if (ship.materials >= cost.mat && ship.points >= cost.pts && ship.energy >= cost.en) {
          this.removeShipCargo(ship, cost.mat); ship.points -= cost.pts; ship.energy -= cost.en;
          if (replaced) { ship.abil[replaced] = 0; ship.abilCd[replaced] = 0; }
          if (target === "Q") ship.slotQ = key; else if (target === "E") ship.slotE = key;
          ship.abil[key] = L + 1;
        }
      }
    } else if (msg.type === "useAbility" && (msg.slot === "Q" || msg.slot === "E")) {
      this.useAbility(ship, msg.slot);
    } else if (msg.type === "newSystem") {
      this.resetWorld(this.state.baseDuration / 60);
      for (const [, c] of this.clients) this.assignPlayer(c);
    }
  }

  useAbility(ship, slot) {
    if (!ship || ship.respawnTimer > 0 || this.state.gameOver) return;
    const key = slot === "Q" ? ship.slotQ : ship.slotE;
    if (!key || !ABIL[key]) return;
    const L = ship.abil[key] || 0;
    if (L <= 0 || (ship.abilCd[key] || 0) > 0) return;

    if (key === "help") {
      for (const s of this.state.ships) {
        if (s !== ship && s.team === ship.team && s.respawnTimer <= 0) { s.helpT = 8 + 2 * L; s.helpX = ship.x; s.helpY = ship.y; }
      }
      this.pushEvent({ kind: "fx", x: ship.x, y: ship.y, color: "#ffd43b", count: 16, tone: "help" });
    } else if (key === "cloak") {
      ship.cloakT = 4 + 1.5 * L;
      this.pushEvent({ kind: "fx", x: ship.x, y: ship.y, color: "#b197fc", count: 14, tone: "cloak" });
    } else if (key === "portal") {
      const ang = ship.isHuman ? ship.input.aimAngle : ship.angle;
      const md = ship.isHuman ? ship.input.mouseDist : 520;
      const maxD = Math.min(Math.max(md, 160), 450 + 120 * L);
      for (let k = 0; k <= 16; k++) {
        const d = maxD * (1 - k / 16);
        if (d < 70) break;
        const tx = ship.x + Math.cos(ang) * d, ty = ship.y + Math.sin(ang) * d;
        if (Math.abs(tx) <= HALF - 60 && Math.abs(ty) <= HALF - 60 && dist({ x: tx, y: ty }, this.state.star) > this.state.star.radius + ship.radius + 30) {
          this.pushEvent({ kind: "fx", x: ship.x, y: ship.y, color: "#9775fa", count: 16, tone: "portal" });
          ship.x = tx; ship.y = ty; ship.vx *= 0.3; ship.vy *= 0.3;
          this.pushEvent({ kind: "fx", x: tx, y: ty, color: "#d0bfff", count: 16, tone: "portal" });
          break;
        }
      }
    } else if (key === "shield") {
      ship.shieldT = 5 + 1.5 * L; ship.shieldMax = 50 + 70 * L; ship.shieldHp = ship.shieldMax;
      this.pushEvent({ kind: "fx", x: ship.x, y: ship.y, color: "#6fd6ff", count: 12, tone: "shield" });
    } else if (key === "heal") {
      const range = 600 + 150 * L;
      for (const s of this.state.ships) {
        if (s.team === ship.team && s.respawnTimer <= 0 && Math.hypot(s.x - ship.x, s.y - ship.y) <= range) {
          s.hp = Math.min(s.maxHp, s.hp + s.maxHp * 0.5);
        }
      }
      this.pushEvent({ kind: "fx", x: ship.x, y: ship.y, color: "#51e07f", count: 14, tone: "heal" });
    } else if (key === "dmg") {
      ship.dmgBoostT = 6 + 1.5 * L; ship.dmgMult = 1.5 + 0.1 * L;
      this.pushEvent({ kind: "fx", x: ship.x, y: ship.y, color: "#ff8a3d", count: 14, tone: "dmg" });
    }
    ship.abilCd[key] = Math.max(8, ABIL[key].cd(L));
  }

  damageShip(ship, amt, attacker = null) {
    if (!ship || ship.respawnTimer > 0 || this.state.gameOver) return;
    if (ship.cloakT > 0) amt *= 0.5;
    let rem = amt;
    if (ship.shieldHp > 0) {
      const ab = Math.min(ship.shieldHp, rem);
      ship.shieldHp -= ab; rem -= ab; ship.shieldHit = 0.25;
      if (ship.shieldHp <= 0) ship.shieldT = 0;
      if (rem <= 0) return;
    }
    if (ship.armor > 0) {
      const ab = Math.min(ship.armor, rem * 0.75);
      ship.armor -= ab; rem -= ab; ship.armorHit = 0.2;
    }
    ship.hp -= rem;
    if (ship.hp > 0) return;

    ship.hp = 0; ship.deaths = (ship.deaths || 0) + 1;
    this.state.teamDeaths[ship.team] = (this.state.teamDeaths[ship.team] || 0) + 1;
    if (attacker && attacker.team !== ship.team) {
      attacker.kills = (attacker.kills || 0) + 1;
      this.state.teamKills[attacker.team] = (this.state.teamKills[attacker.team] || 0) + 1;
      attacker.points += 35;
      this.addShipCargo(attacker, 15);
    }
    ship.cloakT = 0; ship.shieldT = 0; ship.shieldHp = 0; ship.dmgBoostT = 0; ship.helpT = 0;
    ship.respawnTimer = 5.0; ship.waitingForBuildMat = true; ship.shipClass = "fighter";
    this.spawnPickups(ship.x, ship.y, 3, 10, 8);
    this.pushEvent({ kind: "boom", x: ship.x, y: ship.y, color: ship.team === "blue" ? "#4dabf7" : "#ff6b6b", big: true });
  }

  damageNode(node, amt, attacker = null) {
    if (!node || node.respawnTimer > 0) return;
    node.hp -= amt;
    if (node.hp > 0) return;
    const mc = randInt(1, 3);
    this.spawnPickups(node.x, node.y, mc, Math.max(4, Math.round(node.rewardMat / mc)), Math.max(2, Math.round(node.rewardPts / mc)));
    if (attacker) attacker.points += Math.max(4, Math.round(node.rewardPts * 0.4));
    node.respawnTimer = 6.0;
    this.pushEvent({ kind: "boom", x: node.x, y: node.y, color: "#ffd43b", big: false });
  }

  damageBase(base, amt, attacker = null) {
    if (!base || this.state.gameOver) return;
    base.underAttackTimer = 4.0;
    let rem = amt;
    if (base.armor > 0) { const ab = Math.min(base.armor, rem * 0.7); base.armor -= ab; rem -= ab; }
    base.hp -= rem;
    if (base.hp > 0) return;
    base.hp = 0;
    this.spawnPickups(base.x, base.y, 6, 12, 8);
    if (attacker) attacker.points += 50;
    this.pushEvent({ kind: "boom", x: base.x, y: base.y, color: base.team === "blue" ? "#4dabf7" : "#ff6b6b", big: true });
    this.finish(base.team === "red" ? "blue" : "red", "Az ellenséges főbázis megsemmisült");
  }

  fireW1(ship, ang) {
    if (ship.w1Cd > 0) return;
    const mult = ship.dmgBoostT > 0 ? ship.dmgMult : 1;
    ship.energy = Math.max(0, ship.energy - (ship.energy > 0 ? 2.5 : 0));
    ship.w1Cd = ship.w1Interval || 0.24;
    if (this.state.projectiles.length < 320) {
      this.state.projectiles.push({
        ownerId: ship.id, team: ship.team, kind: "w1",
        x: ship.x + Math.cos(ang) * (ship.radius + 6), y: ship.y + Math.sin(ang) * (ship.radius + 6),
        vx: Math.cos(ang) * 560, vy: Math.sin(ang) * 560,
        dmg: ship.w1Dmg * mult, life: (ship.w1Range || 450) / 560,
        color: ship.team === "blue" ? "#74c0fc" : "#ff8787"
      });
    }
  }

  fireW2(ship, ang) {
    if (ship.w2Cd > 0) return;
    const mult = ship.dmgBoostT > 0 ? ship.dmgMult : 1;
    const clsRel = SHIP_CLASSES[ship.shipClass]?.reloadMult || 1;
    if (ship.w2Type === "seeker") {
      ship.energy = Math.max(0, ship.energy - 16);
      ship.w2Cd = 1.15 * clsRel;
      if (this.state.projectiles.length < 320) {
        this.state.projectiles.push({
          ownerId: ship.id, team: ship.team, kind: "seeker",
          x: ship.x + Math.cos(ang) * (ship.radius + 8), y: ship.y + Math.sin(ang) * (ship.radius + 8),
          vx: Math.cos(ang) * 430, vy: Math.sin(ang) * 430,
          dmg: ship.w2Dmg * 1.15 * mult, life: rand(1.0, 4.0), homingTime: 1.6, color: "#ffa94d"
        });
      }
    } else if (ship.w2Type === "beam") {
      ship.energy = Math.max(0, ship.energy - 24);
      ship.w2Cd = 1.85 * clsRel;
      const r = (ship.w2Range || 330) * 1.55;
      const ex = ship.x + Math.cos(ang) * r, ey = ship.y + Math.sin(ang) * r;
      if (this.state.beams.length < 160) {
        this.state.beams.push({ x1: ship.x, y1: ship.y, x2: ex, y2: ey, color: ship.team === "blue" ? "#66d9e8" : "#ff6b6b", life: 0.16, width: 6 });
      }
      const lenSq = Math.max(1, (ex - ship.x) ** 2 + (ey - ship.y) ** 2);
      const hitSeg = (tx, ty, rad) => {
        const t = clamp(((tx - ship.x) * (ex - ship.x) + (ty - ship.y) * (ey - ship.y)) / lenSq, 0, 1);
        return Math.hypot(tx - (ship.x + t * (ex - ship.x)), ty - (ship.y + t * (ey - ship.y))) <= rad + 12;
      };
      for (const s of this.state.ships) if (s.team !== ship.team && s.respawnTimer <= 0 && hitSeg(s.x, s.y, s.radius)) this.damageShip(s, ship.w2Dmg * 1.9 * mult, ship);
      const eb = this.state.bases[ship.team === "blue" ? "red" : "blue"];
      if (hitSeg(eb.x, eb.y, eb.radius)) this.damageBase(eb, ship.w2Dmg * 1.9 * mult, ship);
      for (const n of this.state.nodes) if (n.respawnTimer <= 0 && hitSeg(n.x, n.y, n.radius)) this.damageNode(n, ship.w2Dmg * 1.9 * mult, ship);
    } else {
      ship.energy = Math.max(0, ship.energy - 12);
      ship.w2Cd = (ship.w2Interval || 0.75);
      for (const sp of [-0.08, 0.08]) {
        if (this.state.projectiles.length >= 320) break;
        const a = ang + sp;
        this.state.projectiles.push({
          ownerId: ship.id, team: ship.team, kind: "w2",
          x: ship.x + Math.cos(a) * (ship.radius + 8), y: ship.y + Math.sin(a) * (ship.radius + 8),
          vx: Math.cos(a) * 440, vy: Math.sin(a) * 440,
          dmg: ship.w2Dmg * mult, life: (ship.w2Range || 330) / 440,
          color: ship.team === "blue" ? "#a5d8ff" : "#ffa8a8"
        });
      }
    }
  }

  step(dt) {
    dt = clamp(dt, 0.001, 0.05);
    if (this.state.gameOver) return;
    const st = this.state;
    st.matchTime += dt;

    for (const t of st.turrets) {
      if (t.owner === "blue" || t.owner === "red") st.turretHoldTime[t.owner] += dt;
    }

    if (st.matchTime >= st.nextJudgeTime) {
      const bS = this.computeTeamScore("blue"), rS = this.computeTeamScore("red");
      if (Math.abs(bS - rS) <= 28 && st.matchTime < st.maxDuration) {
        st.targetDuration = Math.min(st.maxDuration, st.nextJudgeTime + 60);
        st.nextJudgeTime += 60;
        st.judgeNote = `Bíró: Szoros állás — +1p hosszabbítás (${Math.round(st.nextJudgeTime / 60)}:00-ig)`;
      } else {
        this.finish(bS >= rS ? "blue" : "red", `Bírói döntés (Kék: ${bS} vs Piros: ${rS})`);
        return;
      }
    }

    // Bázisok és drónok
    for (const team of ["blue", "red"]) {
      const b = st.bases[team], opp = team === "blue" ? "red" : "blue";
      b.underAttackTimer = Math.max(0, b.underAttackTimer - dt);
      b.fireCd = Math.max(0, b.fireCd - dt);
      b.hp = Math.min(b.maxHp, b.hp + (b.maxHp / 60) * dt);
      b.armor = Math.min(b.maxArmor, b.armor + (b.maxArmor / 60) * dt);
      b.fuel = Math.min(b.maxFuel, b.fuel + (b.maxFuel / 150) * dt);
      b.energy = Math.min(b.maxEnergy, b.energy + (b.maxEnergy / 110) * dt);
      if (b.materials >= 1 && b.energy >= 2) {
        const burn = Math.min(b.materials, 0.8 * dt);
        b.materials -= burn; b.energy = Math.max(0, b.energy - dt);
        b.buildMaterials = Math.min(b.maxStorage, b.buildMaterials + burn * 1.6);
      }
      if (b.fireCd <= 0) {
        const tgt = st.ships.find(s => s.team === opp && s.respawnTimer <= 0 && !(s.cloakT > 0) && dist(b, s) < 470);
        if (tgt && st.projectiles.length < 320) {
          b.fireCd = 0.42;
          const a = Math.atan2(tgt.y - b.y, tgt.x - b.x);
          st.projectiles.push({ ownerId: "base-" + team, team, kind: "base", x: b.x + Math.cos(a) * 62, y: b.y + Math.sin(a) * 62, vx: Math.cos(a) * 560, vy: Math.sin(a) * 560, dmg: 26, life: 1.0, color: team === "blue" ? "#74c0fc" : "#ffa8a8" });
        }
      }
      b.droneBuildCd -= dt;
      if (st.drones.filter(d => d.team === team).length < 5 && b.droneBuildCd <= 0 && b.buildMaterials >= 22 && b.energy >= 15) {
        b.droneBuildCd = rand(7, 13); b.buildMaterials -= 22; b.energy -= 15;
        st.drones.push(createDrone(team, b.x + rand(-40, 40), b.y + rand(-40, 40)));
      }
    }

    for (const dr of st.drones) {
      const ownB = st.bases[dr.team];
      dr.aiTimer -= dt;
      if (!dr.target || dr.aiTimer <= 0) {
        dr.aiTimer = rand(0.3, 0.7);
        const nd = st.nodes.find(n => n.respawnTimer <= 0 && dist(n, ownB) < 900);
        dr.target = dr.cargo >= dr.maxCargo ? ownB : (nd || ownB);
      }
      const dx = dr.target.x - dr.x, dy = dr.target.y - dr.y, d = Math.hypot(dx, dy);
      if (d > 24 && d > 0.001) { dr.vx += (dx / d) * 260 * dt; dr.vy += (dy / d) * 260 * dt; }
      dr.vx *= Math.pow(0.2, dt); dr.vy *= Math.pow(0.2, dt);
      dr.x = clamp(dr.x + dr.vx * dt, -HALF + 20, HALF - 20);
      dr.y = clamp(dr.y + dr.vy * dt, -HALF + 20, HALF - 20);
      if (d < ownB.radius + 75 && dr.cargo > 0) {
        const del = Math.min(dr.cargo, Math.max(0, ownB.maxStorage - ownB.materials));
        ownB.materials += del; dr.cargo -= del;
      }
    }

    // Kraken
    if (!st.kraken) {
      st.krakenSpawnCd -= dt;
      if (st.krakenSpawnCd <= 0) {
        st.krakenSpawnCd = rand(40, 60);
        st.kraken = { x: rand(-1200, 1200), y: rand(-900, 900), vx: 0, vy: 0, radius: 42, hp: 1400, maxHp: 1400, attackCd: 1.0, tentaclePhase: 0 };
      }
    } else {
      const k = st.kraken;
      k.tentaclePhase += dt * 4; k.attackCd = Math.max(0, k.attackCd - dt);
      const tgt = st.ships.find(s => s.respawnTimer <= 0 && dist(k, s) < 680);
      if (tgt) {
        const dx = tgt.x - k.x, dy = tgt.y - k.y, d = Math.hypot(dx, dy) || 1;
        k.vx += (dx / d) * 140 * dt; k.vy += (dy / d) * 140 * dt;
        if (k.attackCd <= 0 && d < 340 && st.projectiles.length < 320) {
          k.attackCd = 1.2;
          const a = Math.atan2(dy, dx);
          st.projectiles.push({ ownerId: "kraken", team: "kraken", kind: "kraken", x: k.x, y: k.y, vx: Math.cos(a) * 390, vy: Math.sin(a) * 390, dmg: 22, life: 1.0, color: "#da77f2" });
        }
      }
      k.vx *= Math.pow(0.25, dt); k.vy *= Math.pow(0.25, dt);
      k.x = clamp(k.x + k.vx * dt, -HALF + 60, HALF - 60);
      k.y = clamp(k.y + k.vy * dt, -HALF + 60, HALF - 60);
    }

    // Hajók (emberi + AI)
    for (const s of st.ships) {
      s.w1Cd = Math.max(0, s.w1Cd - dt);
      s.w2Cd = Math.max(0, s.w2Cd - dt);
      s.baseDepositCd = Math.max(0, (s.baseDepositCd || 0) - dt);
      s.cloakT = Math.max(0, (s.cloakT || 0) - dt);
      s.dmgBoostT = Math.max(0, (s.dmgBoostT || 0) - dt);
      if (s.shieldT > 0) { s.shieldT -= dt; if (s.shieldT <= 0) s.shieldHp = 0; }
      if (s.helpT > 0) s.helpT -= dt;
      for (const k of ABIL_KEYS) if ((s.abilCd[k] || 0) > 0) s.abilCd[k] = Math.max(0, s.abilCd[k] - dt);

      if (s.respawnTimer > 0) {
        s.respawnTimer -= dt;
        if (s.respawnTimer <= 0) {
          const b = st.bases[s.team];
          if (b.buildMaterials >= 35) {
            b.buildMaterials -= 35; s.waitingForBuildMat = false; s.shipClass = "fighter";
            s.x = b.x + rand(-70, 70); s.y = b.y + rand(-70, 70); s.vx = 0; s.vy = 0;
            recalcShipStats(s, true);
          } else { s.respawnTimer = 1.0; s.waitingForBuildMat = true; }
        }
        continue;
      }

      if (s.fuel <= 0.05) s.fuelEmpty = true;
      else if (s.fuelEmpty && s.fuel >= s.maxFuel * 0.1) s.fuelEmpty = false;
      const slow = (s.fuelEmpty ? 0.28 : 1) * (s.energy <= 0.5 ? 0.8 : 1);
      const fuelUse = SHIP_CLASSES[s.shipClass]?.fuelUse || 1;

      if (s.isHuman) {
        const inp = s.input;
        s.angle = inp.aimAngle;
        let ax = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
        let ay = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
        if (ax || ay) {
          const l = Math.hypot(ax, ay); ax /= l; ay /= l;
          const th = s.thrustBase * s.throttle * slow;
          s.vx += ax * th * dt; s.vy += ay * th * dt;
          if (s.fuel > 0) s.fuel = Math.max(0, s.fuel - 2.6 * fuelUse * s.throttle * dt);
        }
        if (inp.fire1) this.fireW1(s, s.angle);
        if (inp.fire2) this.fireW2(s, s.angle);
      } else {
        s.aiTimer -= dt;
        const opp = s.team === "blue" ? "red" : "blue";
        const ownB = st.bases[s.team], enemyB = st.bases[opp];
        if (!s.aiTarget || s.aiTimer <= 0) {
          s.aiTimer = rand(0.5, 1.0);
          const en = st.ships.find(o => o.team === opp && o.respawnTimer <= 0 && !(o.cloakT > 0) && dist(s, o) < 600);
          if (s.hp < s.maxHp * 0.35 || s.cargo >= s.maxCargo) s.aiTarget = ownB;
          else if (en) s.aiTarget = en;
          else s.aiTarget = enemyB;
        }
        const dx = s.aiTarget.x - s.x, dy = s.aiTarget.y - s.y, d = Math.hypot(dx, dy) || 1;
        s.angle = Math.atan2(dy, dx);
        if (d > 180) {
          s.vx += (dx / d) * s.thrustBase * 0.85 * slow * dt;
          s.vy += (dy / d) * s.thrustBase * 0.85 * slow * dt;
          if (s.fuel > 0) s.fuel = Math.max(0, s.fuel - 2.2 * fuelUse * dt);
        }
        if (d < s.w1Range) { this.fireW1(s, s.angle); if (d < s.w2Range) this.fireW2(s, s.angle); }
        if (Math.random() < 0.04) {
          const def = SHIP_UPGRADE_DEFS[randInt(0, SHIP_UPGRADE_DEFS.length - 1)];
          const lvl = (s.levels[def.key] || 1) - 1;
          const cost = { mat: def.baseMat + lvl * def.stepMat, pts: def.basePts + lvl * def.stepPts, en: def.baseEn + lvl * def.stepEn };
          if (s.materials >= cost.mat && s.points >= cost.pts && s.energy >= cost.en) {
            this.removeShipCargo(s, cost.mat); s.points -= cost.pts; s.energy -= cost.en;
            s.levels[def.key] = (s.levels[def.key] || 1) + 1; recalcShipStats(s, false);
          }
        }
      }

      // Automatikus közeli bányászat
      const nearNode = st.nodes.find(n => n.respawnTimer <= 0 && dist(s, n) < s.miningRange);
      if (nearNode && st.beams.length < 160) {
        st.beams.push({ x1: s.x, y1: s.y, x2: nearNode.x, y2: nearNode.y, color: "#74c0fc", life: 0.06 });
        this.damageNode(nearNode, s.miningDps * dt, s);
      }

      s.vx *= Math.pow(0.18, dt); s.vy *= Math.pow(0.18, dt);
      const maxSpd = s.maxSpeed * (s.isHuman ? s.throttle : 1) * slow;
      const spd = Math.hypot(s.vx, s.vy);
      if (spd > maxSpd && spd > 0.001) { s.vx = (s.vx / spd) * maxSpd; s.vy = (s.vy / spd) * maxSpd; }
      s.x = clamp(s.x + s.vx * dt, -HALF + 30, HALF - 30);
      s.y = clamp(s.y + s.vy * dt, -HALF + 30, HALF - 30);

      // Regeneráció és bázis kiszolgálás
      const ownB = st.bases[s.team];
      if (dist(s, ownB) < ownB.radius + 130) {
        if (s.baseDepositCd <= 0 && s.cargo >= 5) {
          s.baseDepositCd = 1.2;
          const tax = this.removeShipCargo(s, Math.max(2, Math.floor(s.cargo * 0.25)));
          ownB.materials = Math.min(ownB.maxStorage, ownB.materials + tax);
        }
        s.hp = Math.min(s.maxHp, s.hp + 26 * dt);
        s.armor = Math.min(s.maxArmor, s.armor + 22 * dt);
        s.fuel = Math.min(s.maxFuel, s.fuel + 16 * dt);
        s.energy = Math.min(s.maxEnergy, s.energy + 22 * dt);
      } else {
        s.hp = Math.min(s.maxHp, s.hp + s.regenRate * 0.35 * dt);
        s.armor = Math.min(s.maxArmor, s.armor + s.regenRate * 0.45 * dt);
        s.energy = Math.min(s.maxEnergy, s.energy + 3.2 * dt);
      }
    }

    for (const n of st.nodes) {
      if (n.respawnTimer > 0) { n.respawnTimer -= dt; if (n.respawnTimer <= 0) this.placeNodeEnteringSystem(n); continue; }
      n.rot += n.rotSpeed * dt; n.x += n.vx * dt; n.y += n.vy * dt;
      if (Math.abs(n.x) > HALF + 220 || Math.abs(n.y) > HALF + 220) this.placeNodeEnteringSystem(n);
    }

    for (const t of st.turrets) {
      t.fireCd = Math.max(0, t.fireCd - dt);
      let bN = 0, rN = 0;
      for (const s of st.ships) if (s.respawnTimer <= 0 && dist(s, t) < 135) { if (s.team === "blue") bN++; else rN++; }
      if (bN > rN) t.captureProgress = clamp(t.captureProgress + (18 + bN * 6) * dt, -100, 100);
      else if (rN > bN) t.captureProgress = clamp(t.captureProgress - (18 + rN * 6) * dt, -100, 100);
      if (t.captureProgress >= 60) t.owner = "blue";
      else if (t.captureProgress <= -60) t.owner = "red";
      else if (Math.abs(t.captureProgress) < 15) t.owner = null;
      if (t.owner && t.fireCd <= 0) {
        const tgt = st.ships.find(s => s.team !== t.owner && s.respawnTimer <= 0 && !(s.cloakT > 0) && dist(s, t) < 420);
        if (tgt && st.projectiles.length < 320) {
          t.fireCd = 0.85;
          const a = Math.atan2(tgt.y - t.y, tgt.x - t.x);
          st.projectiles.push({ ownerId: "turret-" + t.id, team: t.owner, kind: "turret", x: t.x, y: t.y, vx: Math.cos(a) * 480, vy: Math.sin(a) * 480, dmg: 18, life: 1.0, color: t.owner === "blue" ? "#4dabf7" : "#ff6b6b" });
        }
      }
    }

    for (let i = st.pickups.length - 1; i >= 0; i--) {
      const pk = st.pickups[i]; pk.life -= dt;
      if (pk.life <= 0) { st.pickups.splice(i, 1); continue; }
      for (const s of st.ships) {
        if (s.respawnTimer > 0 || s.cargo >= s.maxCargo) continue;
        const d = Math.hypot(s.x - pk.x, s.y - pk.y);
        if (d < 110 && d > 1) { pk.vx += ((s.x - pk.x) / d) * 260 * dt; pk.vy += ((s.y - pk.y) / d) * 260 * dt; }
        if (d < s.radius + pk.radius + 6 && this.addShipCargo(s, pk.mat) > 0) { s.points += pk.pts; st.pickups.splice(i, 1); break; }
      }
      if (st.pickups[i]) { pk.x = clamp(pk.x + pk.vx * dt, -HALF + 20, HALF - 20); pk.y = clamp(pk.y + pk.vy * dt, -HALF + 20, HALF - 20); }
    }

    for (let i = st.projectiles.length - 1; i >= 0; i--) {
      const p = st.projectiles[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.life <= 0) { st.projectiles.splice(i, 1); continue; }
      const att = st.ships.find(s => s.id === p.ownerId) || null;
      let hit = false;
      for (const s of st.ships) {
        if (s.respawnTimer <= 0 && s.team !== p.team && Math.hypot(s.x - p.x, s.y - p.y) < s.radius + 5) {
          this.damageShip(s, p.dmg, att); hit = true; break;
        }
      }
      if (!hit) {
        for (const tk of ["blue", "red"]) {
          if (tk !== p.team && Math.hypot(st.bases[tk].x - p.x, st.bases[tk].y - p.y) < st.bases[tk].radius + 4) {
            this.damageBase(st.bases[tk], p.dmg, att); hit = true; break;
          }
        }
      }
      if (!hit) {
        for (const n of st.nodes) {
          if (n.respawnTimer <= 0 && Math.hypot(n.x - p.x, n.y - p.y) < n.radius + 5) {
            this.damageNode(n, p.dmg, att); hit = true; break;
          }
        }
      }
      if (hit) st.projectiles.splice(i, 1);
    }

    for (let i = st.beams.length - 1; i >= 0; i--) { st.beams[i].life -= dt; if (st.beams[i].life <= 0) st.beams.splice(i, 1); }
  }

  snapshot(withShape = true) {
    const st = this.state;
    const events = this.events.splice(0, this.events.length);
    return {
      roomId: st.roomId,
      star: st.star,
      planets: st.planets,
      bases: st.bases,
      turrets: st.turrets,
      nodes: st.nodes.map(n => ({
        id: n.id, type: n.type, x: n.x, y: n.y, vx: n.vx, vy: n.vy,
        radius: n.radius, rot: n.rot, shape: withShape ? n.shape : undefined, hp: n.hp, maxHp: n.maxHp, respawnTimer: n.respawnTimer
      })),
      ships: st.ships.map(s => ({
        id: s.id, team: s.team, shipClass: s.shipClass, isHuman: s.isHuman,
        w2Type: s.w2Type, kills: s.kills, deaths: s.deaths,
        x: s.x, y: s.y, vx: s.vx, vy: s.vy, angle: s.angle, radius: s.radius,
        levels: s.levels, maxHp: s.maxHp, hp: s.hp, maxArmor: s.maxArmor, armor: s.armor,
        maxFuel: s.maxFuel, fuel: s.fuel, maxEnergy: s.maxEnergy, energy: s.energy,
        maxSpeed: s.maxSpeed, throttle: s.throttle, maxCargo: s.maxCargo, cargo: s.cargo, materials: s.cargo,
        points: s.points, respawnTimer: s.respawnTimer, waitingForBuildMat: s.waitingForBuildMat,
        abil: s.abil, abilCd: s.abilCd, slotQ: s.slotQ, slotE: s.slotE,
        cloakT: s.cloakT, shieldT: s.shieldT, shieldHp: s.shieldHp, shieldMax: s.shieldMax,
        shieldHit: s.shieldHit, armorHit: s.armorHit, dmgBoostT: s.dmgBoostT
      })),
      drones: st.drones,
      pickups: st.pickups,
      projectiles: st.projectiles,
      beams: st.beams,
      kraken: st.kraken,
      matchTime: st.matchTime,
      targetDuration: st.targetDuration,
      maxDuration: st.maxDuration,
      judgeNote: st.judgeNote,
      teamKills: st.teamKills,
      teamDeaths: st.teamDeaths,
      bScore: this.computeTeamScore("blue"),
      rScore: this.computeTeamScore("red"),
      gameOver: st.gameOver,
      winReason: st.winReason,
      events
    };
  }
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: true, service: "space-dogs-5v5-server" }));
});

const wss = new WebSocket.Server({ server });
const rooms = new Map();
let nextClientId = 1;

function getOrCreateRoom(roomId, minutes = 3) {
  const cleanId = String(roomId || "global-5v5").slice(0, 32);
  if (!rooms.has(cleanId)) rooms.set(cleanId, new Room(cleanId, minutes));
  return rooms.get(cleanId);
}

wss.on("connection", (ws) => {
  const client = { id: "c-" + (nextClientId++), ws, room: null, shipId: null, preferredTeam: null, alive: true };
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      if (!msg || typeof msg.type !== "string") return;
      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }
      if (msg.type === "join") {
        if (client.room) client.room.releasePlayer(client);
        client.preferredTeam = (msg.team === "blue" || msg.team === "red") ? msg.team : null;
        const room = getOrCreateRoom(msg.roomId || "global-5v5", msg.minutes || 3);
        if (room.state.gameOver && room.clients.size === 0) room.resetWorld(room.state.baseDuration / 60);
        room.clients.set(client.id, client);
        client.room = room;
        room.assignPlayer(client);
        ws.send(JSON.stringify({ type: "joined", clientId: client.id, shipId: client.shipId, team: client.team, roomId: room.id }));
        return;
      }
      if (client.room) client.room.handleAction(client, msg);
    } catch (e) { console.error("üzenet hiba:", e && e.message); }
  });

  ws.on("close", () => {
    client.alive = false;
    if (client.room) {
      client.room.releasePlayer(client);
      client.room.clients.delete(client.id);
      if (client.room.clients.size === 0 && client.room.id !== "global-5v5") {
        rooms.delete(client.room.id);
      }
    }
  });
});

// Kapcsolattartó ping (30 mp) — elkerüli az üresjáratú bontást
const hb = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// 50 Hz szimuláció + 20 Hz állapotküldés
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.05, Math.max(0.001, (now - lastTick) / 1000));
  lastTick = now;

  for (const [, room] of rooms) {
    try {
      room.step(dt);
      if (room.state.gameOver) {
        room.overT = (room.overT || 0) + dt;
        if (room.overT > 25) room.restart();
      } else room.overT = 0;
    } catch (e) { console.error("step hiba:", e && e.stack ? e.stack : e); }
  }
}, 20);

setInterval(() => {
  for (const [, room] of rooms) {
    if (room.clients.size === 0) continue;
    room.snapN = (room.snapN || 0) + 1;
    const snap = room.snapshot(room.snapN % 30 === 1);
    const payload = JSON.stringify({ type: "state", state: snap }, (k, v) => (typeof v === "number" && !Number.isInteger(v)) ? Math.round(v * 100) / 100 : v);
    for (const [, c] of room.clients) {
      if (c.ws.readyState === WebSocket.OPEN) {
        try { c.ws.send(payload); } catch (_) {}
      }
    }
  }
}, 66);

server.listen(PORT, () => {
  console.log("Space Dogs 5v5 Server listening on port", PORT);
});