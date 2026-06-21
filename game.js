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
};

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
  // Debug/Diagnose
  fps: 0,
  taps: 0,
};

function setPhase(next) {
  state.phase = next;
}

// ============================================================
// INPUT
// ============================================================
// Genau ein Input. Der ganze Screen ist der Brems-Button.
function handleTap() {
  state.taps++;

  switch (state.phase) {
    case PHASE.READY:
      setPhase(PHASE.CRUISE);
      break;
    case PHASE.CRUISE:
      setPhase(PHASE.BRAKE);
      break;
    case PHASE.BRAKE:
      // bremst bereits, Tipp ignorieren
      break;
    case PHASE.RESULT:
      setPhase(PHASE.CRUISE); // naechste Runde (Platzhalter)
      break;
    case PHASE.OVER:
      setPhase(PHASE.READY); // Neustart (Platzhalter)
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
  // Fahr-/Bremsphysik folgt in Schritt 2.
}

// ============================================================
// RENDER (Schritt 1: Debug-Overlay)
// ============================================================
function render() {
  ctx.clearRect(0, 0, view.w, view.h);
  ctx.fillStyle = "#15171c";
  ctx.fillRect(0, 0, view.w, view.h);

  ctx.fillStyle = "#f5f5f5";
  ctx.textAlign = "center";
  ctx.font = "600 28px system-ui, sans-serif";
  ctx.fillText("BREMSPUNKT", view.w / 2, view.h / 2 - 40);

  ctx.font = "16px ui-monospace, monospace";
  ctx.fillStyle = "#8aa0c0";
  ctx.fillText(`Phase: ${state.phase}`, view.w / 2, view.h / 2);
  ctx.fillText(`Tipps: ${state.taps}`, view.w / 2, view.h / 2 + 24);
  ctx.fillText(`FPS: ${Math.round(state.fps)}`, view.w / 2, view.h / 2 + 48);

  ctx.fillStyle = "#5a6678";
  ctx.font = "14px system-ui, sans-serif";
  ctx.fillText("Tippen / Klicken / Leertaste", view.w / 2, view.h - 40);
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
