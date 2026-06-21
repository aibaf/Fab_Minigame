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
};

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
  gap: 0, // Restdistanz beim Stillstand (m), Ergebnis der Runde
  outcome: null, // "stop" | "squish" | null

  // Debug/Diagnose
  fps: 0,
  taps: 0,
};

function setPhase(next) {
  state.phase = next;
}

// Startet eine Runde: Tempo und Distanz fuer die aktuelle Runde setzen.
function startRound() {
  state.speed = speedForRound(state.round) + jitter(CONFIG.startSpeedJitter);
  state.distance = CONFIG.startDistance + jitter(CONFIG.startDistanceJitter);
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
      state.round++; // naechste Runde (Leben/Game-Over folgt in Schritt 3)
      startRound();
      break;
    case PHASE.OVER:
      state.round = 1;
      startRound(); // Neustart (Platzhalter bis Schritt 3)
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
    state.distance -= state.speed * dt;
    if (state.distance <= 0) squish();
  } else if (state.phase === PHASE.BRAKE) {
    // Konstante Verzoegerung bis Stillstand.
    state.speed = Math.max(0, state.speed - CONFIG.decel * dt);
    state.distance -= state.speed * dt;
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
  setPhase(PHASE.RESULT);
}

// Auto ueberfaehrt die Ente.
function squish() {
  state.distance = 0;
  state.gap = 0;
  state.outcome = "squish";
  setPhase(PHASE.RESULT);
}

// ============================================================
// RENDER (Schritt 1: Debug-Overlay)
// ============================================================
function render() {
  ctx.clearRect(0, 0, view.w, view.h);
  ctx.fillStyle = "#15171c";
  ctx.fillRect(0, 0, view.w, view.h);

  const cx = view.w / 2;
  const cy = view.h / 2;

  ctx.fillStyle = "#f5f5f5";
  ctx.textAlign = "center";
  ctx.font = "600 28px system-ui, sans-serif";
  ctx.fillText("BREMSPUNKT", cx, cy - 120);

  // Live-Physikwerte (Debug, bis Schritt 4 das Rendering uebernimmt)
  ctx.font = "20px ui-monospace, monospace";
  const kmh = Math.round(state.speed * 3.6);
  const lines = [
    `Phase:    ${state.phase}`,
    `Runde:    ${state.round}`,
    `Tempo:    ${state.speed.toFixed(1)} m/s  (${kmh} km/h)`,
    `Distanz:  ${Math.max(0, state.distance).toFixed(1)} m`,
  ];
  ctx.fillStyle = "#8aa0c0";
  lines.forEach((t, i) => ctx.fillText(t, cx, cy - 60 + i * 28));

  // Ergebnis der letzten Runde
  if (state.phase === PHASE.RESULT) {
    if (state.outcome === "squish") {
      ctx.fillStyle = "#ff5b5b";
      ctx.font = "600 24px system-ui, sans-serif";
      ctx.fillText("SQUISH! Ente plattgefahren", cx, cy + 70);
    } else {
      ctx.fillStyle = "#ffd84d";
      ctx.font = "600 24px system-ui, sans-serif";
      ctx.fillText(`Gestoppt - Abstand: ${state.gap.toFixed(2)} m`, cx, cy + 70);
    }
  }

  // Kontext-Hinweis je Phase
  ctx.fillStyle = "#5a6678";
  ctx.font = "15px system-ui, sans-serif";
  ctx.fillText(hintForPhase(), cx, view.h - 40);

  ctx.fillStyle = "#3a4456";
  ctx.font = "12px ui-monospace, monospace";
  ctx.fillText(`FPS ${Math.round(state.fps)}`, cx, view.h - 16);
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
