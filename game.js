/*
 * BREMSPUNKT
 * Ein-Tipp-Praezisionsspiel: bremse so spaet wie moeglich vor der Gummiente.
 *
 * Aufbau (eine Datei, klar in Sektionen):
 *   CONFIG  - alle Tuning-Werte
 *   STATE   - Laufzeit-Zustand + State-Machine
 *   INPUT   - Tipp/Klick/Taste (Whole-Screen-Button)
 *   PHYSICS - Fahr- und Bremsphysik (Schritt 2)
 *   RENDER  - Zeichnen (Schritt 1: Debug-Overlay)
 *   LOOP    - requestAnimationFrame-Game-Loop
 */

// ============================================================
// CONFIG
// ============================================================
const CONFIG = {
  maxDt: 0.05, // dt-Clamp gegen Tab-Wechsel-Spruenge (s)

  // Physik (Baseline aus dem Prototyp)
  decel: 14, // Verzoegerung beim Bremsen (m/s^2)
  stopEpsilon: 0.05, // Tempo darunter gilt als Stillstand (m/s)

  startSpeedBase: 24, // Start-Tempo Runde 1 (m/s)
  startSpeedPerRound: 3, // Zuwachs pro Runde (m/s)
  startSpeedMax: 52, // Deckel (m/s)
  startSpeedJitter: 2, // +/- Zufall (m/s)

  startDistance: 150, // Start-Distanz zur Ente (m)
  startDistanceJitter: 15, // +/- Zufall (m)

  lives: 3, // Startleben
  roundMultiplierPerRound: 0.1, // Punkte x (1 + (round-1)*this)
};

// Score-Stufen nach gap (Restabstand beim Stillstand), erste passende gewinnt.
// streakBonus addiert sich pro aktuellem Streak; keepStreak haelt/erhoeht den Streak.
const TIERS = [
  { maxGap: 0.7, label: "Punktlandung", base: 1000, streakBonus: 100, keepStreak: true },
  { maxGap: 1.6, label: "Stark", base: 700, streakBonus: 60, keepStreak: true },
  { maxGap: 4, label: "Sauber", base: 400, streakBonus: 0, keepStreak: false },
  { maxGap: 10, label: "Okay", base: 150, streakBonus: 0, keepStreak: false },
  { maxGap: Infinity, label: "Feigling", base: 50, streakBonus: 0, keepStreak: false },
];

function tierForGap(gap) {
  return TIERS.find((t) => gap <= t.maxGap);
}

// Farbpalette (aus dem Brief)
const COLORS = {
  skyTop: "#243b6b",
  skyBottom: "#f3a26b",
  grass: "#3c8f4e",
  grassDark: "#347a44",
  road: "#3a3f47",
  roadEdge: "#5b6230",
  stripe: "#cdd2da",
  duckBody: "#FFCD2E",
  duckBeak: "#F5821F",
  dash: "#15171c",
};

// Szenen-/Perspektive-Parameter (Fake-3D Bodenebene)
const SCENE = {
  horizonFrac: 0.42, // Horizont bei 42 % Hoehe
  roadBottomFrac: 0.86, // Bildschirm-Y wo Distanz 0 liegt (Oberkante Cockpit)
  d0: 30, // Tiefenkompression: groesser = flacher
  roadHalfBottomFrac: 0.48, // halbe Strassenbreite unten / Viewbreite
  stripeSpacing: 10, // Meter zwischen Querstreifen (Timing-Anker)
  maxRenderDist: 260, // m, weiter weg wird nicht gezeichnet
};

// Projiziert eine Strassen-Distanz d (m) auf den Bildschirm.
// s in [0,1]: 1 = ganz vorne (gross), 0 = am Horizont (Fluchtpunkt).
function project(d) {
  const s = SCENE.d0 / (d + SCENE.d0);
  const horizonY = view.h * SCENE.horizonFrac;
  const bottomY = view.h * SCENE.roadBottomFrac;
  return {
    s,
    y: horizonY + (bottomY - horizonY) * s,
    halfW: view.w * SCENE.roadHalfBottomFrac * s,
    cx: view.w / 2,
  };
}

// +/- jitter um 0
function jitter(amount) {
  return (Math.random() * 2 - 1) * amount;
}

// Start-Tempo fuer eine Runde (ohne Jitter)
function speedForRound(round) {
  return Math.min(
    CONFIG.startSpeedBase + (round - 1) * CONFIG.startSpeedPerRound,
    CONFIG.startSpeedMax
  );
}

// State-Machine-Phasen
const PHASE = {
  READY: "READY", // wartet auf ersten Tipp
  CRUISE: "CRUISE", // Auto faehrt mit konstantem Tempo
  BRAKE: "BRAKE", // Auto bremst bis Stillstand
  RESULT: "RESULT", // Runde gewertet, Zwischenstand
  OVER: "OVER", // Game Over
};

// ============================================================
// STATE
// ============================================================
const state = {
  phase: PHASE.READY,
  time: 0, // Gesamtlaufzeit (s)

  round: 1,
  speed: 0, // aktuelles Tempo (m/s)
  distance: 0, // Restdistanz zur Ente (m)
  traveled: 0, // in dieser Runde zurueckgelegte Strecke (m), fuer scrollende Marker
  gap: 0, // Restdistanz beim Stillstand (m), Ergebnis der Runde
  outcome: null, // "stop" | "squish" | null

  score: 0,
  best: 0,
  lives: CONFIG.lives,
  streak: 0,

  // Ergebnis der letzten Runde (fuer Result-Screen)
  lastLabel: "",
  lastPoints: 0,

  // Debug/Diagnose
  fps: 0,
  taps: 0,
};

function setPhase(next) {
  state.phase = next;
}

// Neues Spiel: Score, Leben, Runde und Streak zuruecksetzen.
function resetGame() {
  state.round = 1;
  state.score = 0;
  state.lives = CONFIG.lives;
  state.streak = 0;
  startRound();
}

// Startet eine Runde: Tempo und Distanz fuer die aktuelle Runde setzen.
function startRound() {
  state.speed = speedForRound(state.round) + jitter(CONFIG.startSpeedJitter);
  state.distance = CONFIG.startDistance + jitter(CONFIG.startDistanceJitter);
  state.traveled = 0;
  state.gap = 0;
  state.outcome = null;
  setPhase(PHASE.CRUISE);
}

// ============================================================
// INPUT
// ============================================================
// Genau ein Input. Der ganze Screen ist der Brems-Button.
function handleTap() {
  state.taps++;

  switch (state.phase) {
    case PHASE.READY:
      startRound();
      break;
    case PHASE.CRUISE:
      setPhase(PHASE.BRAKE); // Bremsen einleiten
      break;
    case PHASE.BRAKE:
      // bremst bereits, Tipp ignorieren
      break;
    case PHASE.RESULT:
      if (state.lives <= 0) {
        setPhase(PHASE.OVER);
      } else {
        state.round++;
        startRound();
      }
      break;
    case PHASE.OVER:
      resetGame();
      break;
  }
}

function initInput(canvas) {
  canvas.addEventListener(
    "pointerdown",
    (e) => {
      e.preventDefault();
      handleTap();
    },
    { passive: false }
  );

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" || e.code === "Enter") {
      e.preventDefault();
      handleTap();
    }
  });
}

// ============================================================
// CANVAS
// ============================================================
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const view = { w: 0, h: 0, dpr: 1 };

function resize() {
  view.dpr = Math.min(window.devicePixelRatio || 1, 2);
  view.w = window.innerWidth;
  view.h = window.innerHeight;
  canvas.width = Math.round(view.w * view.dpr);
  canvas.height = Math.round(view.h * view.dpr);
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0); // in CSS-Pixeln zeichnen
}

// ============================================================
// PHYSICS (Schritt 2)
// ============================================================
function update(dt) {
  state.time += dt;

  if (state.phase === PHASE.CRUISE) {
    // Konstantes Tempo, Distanz schrumpft. Nicht bremsen = Ente ueberfahren.
    const step = state.speed * dt;
    state.distance -= step;
    state.traveled += step;
    if (state.distance <= 0) squish();
  } else if (state.phase === PHASE.BRAKE) {
    // Konstante Verzoegerung bis Stillstand.
    state.speed = Math.max(0, state.speed - CONFIG.decel * dt);
    const step = state.speed * dt;
    state.distance -= step;
    state.traveled += step;
    if (state.distance <= 0) {
      squish();
    } else if (state.speed <= CONFIG.stopEpsilon) {
      stop();
    }
  }
}

// Auto kommt vor der Ente zum Stehen -> gewertet.
function stop() {
  state.gap = state.distance;
  state.outcome = "stop";

  const tier = tierForGap(state.gap);
  const raw = tier.base + state.streak * tier.streakBonus;
  const mult = 1 + (state.round - 1) * CONFIG.roundMultiplierPerRound;
  const points = Math.round(raw * mult);

  state.score += points;
  if (state.score > state.best) state.best = state.score;
  state.streak = tier.keepStreak ? state.streak + 1 : 0;

  state.lastLabel = tier.label;
  state.lastPoints = points;
  setPhase(PHASE.RESULT);
}

// Auto ueberfaehrt die Ente.
function squish() {
  state.distance = 0;
  state.gap = 0;
  state.outcome = "squish";

  state.lives = Math.max(0, state.lives - 1);
  state.streak = 0;
  state.lastLabel = "Squish";
  state.lastPoints = 0;
  setPhase(PHASE.RESULT);
}

// ============================================================
// RENDER (Schritt 1: Debug-Overlay)
// ============================================================
function render() {
  drawSky();
  drawGround();
  // Ente + Bremsweg-Indikator folgen in Schritt 4b
  drawOverlays();
  drawHud();
  drawHint();
}

// Himmel als Verlauf bis zum Horizont
function drawSky() {
  const horizonY = view.h * SCENE.horizonFrac;
  const grad = ctx.createLinearGradient(0, 0, 0, horizonY);
  grad.addColorStop(0, COLORS.skyTop);
  grad.addColorStop(1, COLORS.skyBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, view.w, horizonY);
}

// Gras + Strasse (Trapez zum Fluchtpunkt) + scrollende Querstreifen
function drawGround() {
  const horizonY = view.h * SCENE.horizonFrac;
  const cx = view.w / 2;

  // Gras unter dem Horizont
  ctx.fillStyle = COLORS.grass;
  ctx.fillRect(0, horizonY, view.w, view.h - horizonY);

  // Strasse als Trapez vom Fluchtpunkt nach unten
  const base = project(0);
  ctx.fillStyle = COLORS.road;
  ctx.beginPath();
  ctx.moveTo(cx - base.halfW, base.y);
  ctx.lineTo(cx + base.halfW, base.y);
  ctx.lineTo(cx + 1.5, horizonY);
  ctx.lineTo(cx - 1.5, horizonY);
  ctx.closePath();
  ctx.fill();

  // Strassenraender
  ctx.strokeStyle = COLORS.roadEdge;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - base.halfW, base.y);
  ctx.lineTo(cx - 1.5, horizonY);
  ctx.moveTo(cx + base.halfW, base.y);
  ctx.lineTo(cx + 1.5, horizonY);
  ctx.stroke();

  // Querstreifen alle stripeSpacing Meter, scrollen mit traveled
  const offset = state.traveled % SCENE.stripeSpacing;
  ctx.fillStyle = COLORS.stripe;
  for (let k = 1; ; k++) {
    const z = k * SCENE.stripeSpacing - offset;
    if (z <= 0) continue;
    if (z > SCENE.maxRenderDist) break;
    const p = project(z);
    const h = Math.max(1, p.s * 8);
    const w = p.halfW * 0.86;
    ctx.globalAlpha = 0.28 + 0.5 * p.s;
    ctx.fillRect(cx - w, p.y - h / 2, w * 2, h);
  }
  ctx.globalAlpha = 1;
}

// Text-Overlays je nach Phase (Start, Ergebnis, Game Over)
function drawOverlays() {
  const cx = view.w / 2;
  const cy = view.h / 2;
  ctx.textAlign = "center";

  if (state.phase === PHASE.READY) {
    panel(cx, cy, 360, 120);
    ctx.fillStyle = "#f5f5f5";
    ctx.font = "700 36px system-ui, sans-serif";
    ctx.fillText("BREMSPUNKT", cx, cy - 6);
    ctx.fillStyle = "#cdd8ea";
    ctx.font = "16px system-ui, sans-serif";
    ctx.fillText("Bremse so spaet wie moeglich vor der Ente", cx, cy + 26);
  }

  if (state.phase === PHASE.RESULT) {
    panel(cx, cy, 380, 110);
    if (state.outcome === "squish") {
      ctx.fillStyle = "#ff5b5b";
      ctx.font = "700 30px system-ui, sans-serif";
      ctx.fillText("SQUISH!", cx, cy - 4);
      ctx.fillStyle = "#cdd8ea";
      ctx.font = "16px system-ui, sans-serif";
      ctx.fillText(`Ente plattgefahren  -  Leben uebrig: ${state.lives}`, cx, cy + 26);
    } else {
      ctx.fillStyle = "#ffd84d";
      ctx.font = "700 30px system-ui, sans-serif";
      ctx.fillText(`${state.lastLabel}`, cx, cy - 6);
      ctx.fillStyle = "#f5f5f5";
      ctx.font = "17px system-ui, sans-serif";
      ctx.fillText(`Abstand ${state.gap.toFixed(2)} m   +${state.lastPoints} Punkte`, cx, cy + 24);
    }
  }

  if (state.phase === PHASE.OVER) {
    panel(cx, cy, 360, 120);
    ctx.fillStyle = "#ff5b5b";
    ctx.font = "700 38px system-ui, sans-serif";
    ctx.fillText("GAME OVER", cx, cy - 6);
    ctx.fillStyle = "#f5f5f5";
    ctx.font = "18px system-ui, sans-serif";
    ctx.fillText(`Punkte ${state.score}    Best ${state.best}`, cx, cy + 28);
  }
}

// Halbtransparentes, abgerundetes Panel hinter Overlay-Text
function panel(cx, cy, w, h) {
  const x = cx - w / 2;
  const y = cy - h / 2;
  const r = 16;
  ctx.fillStyle = "rgba(10, 12, 18, 0.66)";
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

// Kontext-Hinweis unten
function drawHint() {
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.font = "15px system-ui, sans-serif";
  ctx.fillText(hintForPhase(), view.w / 2, view.h - 26);
}

// HUD (Debug-Stil, Schritt 4 macht daraus echtes HUD mit Enten-Icons)
function drawHud() {
  ctx.textAlign = "left";
  ctx.font = "16px ui-monospace, monospace";
  ctx.fillStyle = "#cdd8ea";
  ctx.fillText(`Punkte ${state.score}`, 20, 28);
  ctx.fillText(`Best ${state.best}`, 20, 50);
  if (state.streak > 0) {
    ctx.fillStyle = "#ffd84d";
    ctx.fillText(`Streak x${state.streak}`, 20, 72);
  }

  ctx.textAlign = "right";
  ctx.fillStyle = "#cdd8ea";
  ctx.fillText(`Runde ${state.round}`, view.w - 20, 28);
  ctx.fillStyle = "#ff8a8a";
  ctx.fillText(`Leben ${"\u{1F986}".repeat(state.lives)}`, view.w - 20, 50);
  ctx.textAlign = "center";
}

function hintForPhase() {
  switch (state.phase) {
    case PHASE.READY:
      return "Tippen zum Losfahren";
    case PHASE.CRUISE:
      return "Tippen zum Bremsen - so spaet wie moeglich!";
    case PHASE.BRAKE:
      return "Bremst...";
    case PHASE.RESULT:
      return "Tippen fuer die naechste Runde";
    case PHASE.OVER:
      return "Tippen fuer Neustart";
    default:
      return "";
  }
}

// ============================================================
// LOOP
// ============================================================
let lastTime = 0;

function frame(now) {
  const nowSec = now / 1000;
  let dt = nowSec - lastTime;
  lastTime = nowSec;
  if (dt > CONFIG.maxDt) dt = CONFIG.maxDt; // Clamp
  if (dt < 0) dt = 0;

  if (dt > 0) state.fps = state.fps * 0.9 + (1 / dt) * 0.1; // geglaettet

  update(dt);
  render();

  requestAnimationFrame(frame);
}

// ============================================================
// BOOT
// ============================================================
function boot() {
  resize();
  window.addEventListener("resize", resize);
  initInput(canvas);
  requestAnimationFrame((t) => {
    lastTime = t / 1000;
    requestAnimationFrame(frame);
  });
}

boot();
