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

  // Maskottchen-Lurch (Feder-Daempfer)
  mascotStiffness: 140,
  mascotDamping: 13,
  mascotBrakeLean: 0.5, // rad nach vorn beim Bremsen
  mascotCruiseLean: -0.05, // leicht zurueck waehrend der Fahrt
};

// Score-Stufen nach gap (Restabstand beim Stillstand), erste passende gewinnt.
// streakBonus addiert sich pro aktuellem Streak; keepStreak haelt/erhoeht den Streak.
const TIERS = [
  { maxGap: 0.7, label: "Punktlandung", base: 1000, streakBonus: 100, keepStreak: true, quip: "perfect" },
  { maxGap: 1.6, label: "Stark", base: 700, streakBonus: 60, keepStreak: true, quip: "perfect" },
  { maxGap: 4, label: "Sauber", base: 400, streakBonus: 0, keepStreak: false, quip: "ok" },
  { maxGap: 10, label: "Okay", base: 150, streakBonus: 0, keepStreak: false, quip: "ok" },
  { maxGap: Infinity, label: "Feigling", base: 50, streakBonus: 0, keepStreak: false, quip: "coward" },
];

function tierForGap(gap) {
  return TIERS.find((t) => gap <= t.maxGap);
}

// ============================================================
// DUCKS - Co-Pilot-Sprueche (trocken, Dev-affin, Rubber-Duck-Gags)
// ============================================================
const QUIPS = {
  perfect: [
    "Millimeterarbeit. Fast hätte ich dir vertraut.",
    "Perfekt. Notiere ich für deine Akte.",
    "So nah dran, die Ente hat kurz an alles geglaubt.",
    "Sauber. Ich deaktiviere vorsorglich den Notbremsassistenten.",
    "Präzise wie ein Unit-Test, der zur Abwechslung grün ist.",
    "Das war knapp genug, um es Kunst zu nennen.",
    "Ich hätte nicht gebremst. Aber gut, du bist der Mensch.",
    "Punktlandung. Die Ente möchte deine Nummer.",
    "Wenn du das reproduzieren kannst, reden wir über eine Beförderung.",
    "Lehrbuchhaft. Welches Lehrbuch, frage ich lieber nicht.",
    "Optimal. Ich war kurz davor zu übernehmen. Nur kurz.",
    "Beeindruckend. Statistisch gesehen ein Ausrutscher nach oben.",
  ],
  ok: [
    "Akzeptabel. Für einen Menschen.",
    "Etwas früh, aber die Ente verzeiht dir.",
    "Solide. Niemand schreibt darüber ein Gedicht, aber solide.",
    "Sicherheitsabstand wie im Fahrschulvideo. Gähn.",
    "Funktioniert. Schön ist anders.",
    "Du lebst, die Ente lebt. Ein durchschnittlicher Tag.",
    "Nicht falsch. Nur nicht mutig.",
    "Das würde durch den Code-Review gehen. Gerade so.",
    "Brav. Die Ente nickt höflich.",
    "Gilt als bestanden. Mit Sternchen.",
    "Ordentlich. Ich runde großzügig auf.",
    "Kein Drama. Ich mag kein Drama.",
  ],
  coward: [
    "Drei Meter Abstand zu einer Badeente. Mutig.",
    "Du stehst. Beide Spurassistenten weinen.",
    "So früh gebremst, die Ente ist eingeschlafen.",
    "Sicherheit zuerst. Punkte zuletzt.",
    "Die Ente winkt dir aus der Ferne zu.",
    "Das war kein Bremsen, das war eine Entschuldigung.",
    "Ich habe schon Standbilder gesehen, die schneller waren.",
    "Vorsichtig. Sehr vorsichtig. Langweilig vorsichtig.",
    "Du hättest noch einen Kaffee holen können.",
    "Die Versicherung freut sich. Sonst niemand.",
    "Mutlos, aber am Leben. Wie die meisten Meetings.",
    "So viel Abstand, da passt noch ein zweites Auto rein.",
  ],
  squish: [
    "Ich sagte bremsen, nicht pürieren.",
    "Federn überall. Ich melde das der Versicherung.",
    "Das war eine Ente. Vergangenheitsform.",
    "Null Punkte, aber immerhin ein Geräusch.",
    "Rubber-Duck-Debugging fällt heute aus.",
    "Ich habe innerlich gebremst. Sehr innerlich.",
    "Das gibt einen Eintrag im Logbuch. Rot markiert.",
    "Quietschen war gestern. Heute: Stille.",
    "Du hattest genau eine Aufgabe.",
    "Die Ente hat es kommen sehen. Du nicht.",
    "Crash. Im wörtlichsten Sinne.",
    "Ich starte den Trauerprozess. PID egal.",
  ],
};

let lastQuipText = "";

// Zieht einen Spruch aus einer Kategorie, ohne ihn sofort zu wiederholen.
function pickQuip(category) {
  const arr = QUIPS[category] || QUIPS.ok;
  let q = arr[Math.floor(Math.random() * arr.length)];
  let guard = 0;
  while (arr.length > 1 && q === lastQuipText && guard++ < 8) {
    q = arr[Math.floor(Math.random() * arr.length)];
  }
  lastQuipText = q;
  return q;
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
  paused: false, // friert die Simulation ein (Loop laeuft weiter)
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
  lastQuip: "", // Co-Pilot-Kommentar

  // Maskottchen auf dem Armaturenbrett (Feder-gedaempfter Lurch)
  mascotLean: 0,
  mascotLeanVel: 0,

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
  updateMascot(dt); // laeuft auch bei Pause weiter (lebendig)
  if (state.paused) return;

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

// Maskottchen-Lurch: kippt beim Bremsen nach vorn, wackelt sonst sanft.
function updateMascot(dt) {
  let target;
  switch (state.phase) {
    case PHASE.BRAKE:
      target = CONFIG.mascotBrakeLean;
      break;
    case PHASE.CRUISE:
      target = CONFIG.mascotCruiseLean;
      break;
    default:
      target = Math.sin(state.time * 2.2) * 0.05; // Leerlauf-Wackeln
  }
  const accel =
    (target - state.mascotLean) * CONFIG.mascotStiffness -
    state.mascotLeanVel * CONFIG.mascotDamping;
  state.mascotLeanVel += accel * dt;
  state.mascotLean += state.mascotLeanVel * dt;
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
  state.lastQuip = pickQuip(tier.quip);
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
  state.lastQuip = pickQuip("squish");
  setPhase(PHASE.RESULT);
}

// ============================================================
// RENDER (Schritt 1: Debug-Overlay)
// ============================================================
function render() {
  drawSky();
  drawGround();
  if (isDriving()) drawBrakeHint();
  drawTargetDuck();
  drawDashboard();
  drawMascot();
  drawOverlays();
  drawHud();
  drawHint();
}

function isDriving() {
  return state.phase === PHASE.CRUISE || state.phase === PHASE.BRAKE;
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

// Dezente Andeutung, wo das Auto bei sofortigem Bremsen zum Stehen kaeme.
// Weicher, farbcodierter Schatten (gruen sicher -> rot Squish), bewusst unscharf,
// damit das Bauchgefuehl beim "so spaet wie moeglich" erhalten bleibt.
function drawBrakeHint() {
  const brakingDist = (state.speed * state.speed) / (2 * CONFIG.decel);
  if (brakingDist <= 0.5) return;
  const z = Math.min(brakingDist, SCENE.maxRenderDist);
  const p = project(z);
  const margin = state.distance - brakingDist; // >0 sicher, <0 wuerde ueberfahren

  let rgb;
  if (margin > 4) rgb = "120, 230, 150";
  else if (margin > 0) rgb = "245, 215, 90";
  else rgb = "240, 90, 80";

  const w = p.halfW * 0.92;
  const h = Math.max(6, p.s * 26);
  const grad = ctx.createLinearGradient(0, p.y - h, 0, p.y + h);
  grad.addColorStop(0, `rgba(${rgb}, 0)`);
  grad.addColorStop(0.5, `rgba(${rgb}, 0.4)`);
  grad.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(p.cx - w, p.y - h, w * 2, h * 2);
}

// Die Ziel-Ente auf der Strasse, perspektivisch heranskaliert.
function drawTargetDuck() {
  if (state.phase === PHASE.READY) return;
  const p = project(Math.max(state.distance, 0));
  const h = view.h * 0.46 * p.s;
  if (h < 3) return;
  const flat = state.outcome === "squish" && state.phase === PHASE.RESULT;
  drawDuck(p.cx, p.y, h, flat);
}

// Zeichnet eine Gummiente, frontal (Blick zum Spieler), Fuesse bei groundY.
// flat=true -> plattgedrueckt (Squish, wird in Schritt 6 mit Federn ergaenzt).
function drawDuck(cx, groundY, h, flat) {
  const w = h * 1.05;

  // Bodenschatten
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(cx, groundY, w * 0.5, Math.max(2, h * 0.1), 0, 0, Math.PI * 2);
  ctx.fill();

  if (flat) {
    // Plattgedrueckte Ente: flache Ellipse
    ctx.fillStyle = COLORS.duckBody;
    ctx.beginPath();
    ctx.ellipse(cx, groundY - h * 0.06, w * 0.62, h * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.duckBeak;
    ctx.beginPath();
    ctx.ellipse(cx + w * 0.4, groundY - h * 0.05, w * 0.12, h * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // Koerper
  const bodyCy = groundY - h * 0.3;
  ctx.fillStyle = COLORS.duckBody;
  ctx.beginPath();
  ctx.ellipse(cx, bodyCy, w * 0.46, h * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Fluegel-Andeutungen seitlich am Koerper
  ctx.fillStyle = "rgba(0,0,0,0.06)";
  ctx.beginPath();
  ctx.ellipse(cx - w * 0.34, bodyCy, w * 0.12, h * 0.2, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + w * 0.34, bodyCy, w * 0.12, h * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Kopf
  const headR = h * 0.25;
  const headCy = groundY - h * 0.66;
  ctx.fillStyle = COLORS.duckBody;
  ctx.beginPath();
  ctx.arc(cx, headCy, headR, 0, Math.PI * 2);
  ctx.fill();

  // Augen
  const eyeDx = headR * 0.42;
  const eyeY = headCy - headR * 0.08;
  const eyeR = Math.max(1, headR * 0.16);
  ctx.fillStyle = "#1a1a1a";
  ctx.beginPath();
  ctx.arc(cx - eyeDx, eyeY, eyeR, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + eyeDx, eyeY, eyeR, 0, Math.PI * 2);
  ctx.fill();
  if (eyeR > 2) {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(cx - eyeDx + eyeR * 0.3, eyeY - eyeR * 0.3, eyeR * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + eyeDx + eyeR * 0.3, eyeY - eyeR * 0.3, eyeR * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Schnabel
  ctx.fillStyle = COLORS.duckBeak;
  ctx.beginPath();
  ctx.ellipse(cx, headCy + headR * 0.5, headR * 0.55, headR * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
}

// Armaturenbrett im Vordergrund (gewoelbte Oberkante).
function drawDashboard() {
  const topY = view.h * 0.88;
  ctx.fillStyle = COLORS.dash;
  ctx.beginPath();
  ctx.moveTo(0, view.h);
  ctx.lineTo(0, topY + view.h * 0.03);
  ctx.quadraticCurveTo(view.w / 2, topY - view.h * 0.05, view.w, topY + view.h * 0.03);
  ctx.lineTo(view.w, view.h);
  ctx.closePath();
  ctx.fill();

  // dezente Glanzkante
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, topY + view.h * 0.03);
  ctx.quadraticCurveTo(view.w / 2, topY - view.h * 0.05, view.w, topY + view.h * 0.03);
  ctx.stroke();
}

// Maskottchen-Ente auf dem Armaturenbrett (unten rechts), kippt beim Bremsen
// nach vorn (Richtung Bildmitte = Fahrtrichtung).
function drawMascot() {
  const h = view.h * 0.13;
  const baseX = view.w - h * 1.35;
  const baseY = view.h - h * 0.08;
  ctx.save();
  ctx.translate(baseX, baseY);
  ctx.rotate(-state.mascotLean);
  drawDuck(0, 0, h, false);
  ctx.restore();
}

// Text-Overlays je nach Phase (Start, Ergebnis, Game Over)
function drawOverlays() {
  const cx = view.w / 2;
  const cy = view.h * 0.34; // oben, damit die nahe Ziel-Ente sichtbar bleibt
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
    const pw = Math.min(480, view.w * 0.9);
    ctx.font = "italic 16px system-ui, sans-serif";
    const quipLines = wrapText(`„${state.lastQuip}“`, pw - 56);
    const ph = 118 + quipLines.length * 22;
    panel(cx, cy, pw, ph);
    let y = cy - ph / 2 + 42;

    if (state.outcome === "squish") {
      ctx.fillStyle = "#ff5b5b";
      ctx.font = "700 30px system-ui, sans-serif";
      ctx.fillText("SQUISH!", cx, y);
      y += 28;
      ctx.fillStyle = "#cdd8ea";
      ctx.font = "15px system-ui, sans-serif";
      ctx.fillText(`Ente plattgefahren  ·  Leben übrig: ${state.lives}`, cx, y);
      y += 26;
    } else {
      ctx.fillStyle = "#ffd84d";
      ctx.font = "700 30px system-ui, sans-serif";
      ctx.fillText(`${state.lastLabel}`, cx, y);
      y += 28;
      ctx.fillStyle = "#f5f5f5";
      ctx.font = "16px system-ui, sans-serif";
      ctx.fillText(`Abstand ${state.gap.toFixed(2)} m  ·  +${state.lastPoints} Punkte`, cx, y);
      y += 26;
    }

    // Trennlinie
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - pw / 2 + 28, y - 6);
    ctx.lineTo(cx + pw / 2 - 28, y - 6);
    ctx.stroke();
    y += 16;

    // Co-Pilot-Spruch
    ctx.fillStyle = "#9fd0ff";
    ctx.font = "italic 16px system-ui, sans-serif";
    for (const line of quipLines) {
      ctx.fillText(line, cx, y);
      y += 22;
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

// Bricht Text auf maxWidth um (nutzt die aktuell gesetzte ctx.font).
function wrapText(text, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
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

// HUD: Score/Best/Streak links, Runde/Leben rechts, Tempo/Distanz unten.
function drawHud() {
  // Score-Block oben links
  ctx.textAlign = "left";
  ctx.fillStyle = "#f3f6fb";
  ctx.font = "700 26px system-ui, sans-serif";
  ctx.fillText(`${state.score}`, 22, 38);
  ctx.fillStyle = "#9fb0c8";
  ctx.font = "13px system-ui, sans-serif";
  ctx.fillText(`BEST ${state.best}`, 22, 58);
  if (state.streak > 0) {
    ctx.fillStyle = "#ffd84d";
    ctx.font = "700 16px system-ui, sans-serif";
    ctx.fillText(`STREAK x${state.streak}`, 22, 82);
  }

  // Runde + Leben oben rechts
  ctx.textAlign = "right";
  ctx.fillStyle = "#9fb0c8";
  ctx.font = "13px system-ui, sans-serif";
  ctx.fillText(`RUNDE ${state.round}`, view.w - 22, 26);
  ctx.font = "20px system-ui, sans-serif";
  ctx.fillText("\u{1F986}".repeat(Math.max(0, state.lives)), view.w - 22, 52);

  // Restdistanz oben rechts (unter Leben), Tempo unten links auf dem Dashboard
  if (isDriving()) {
    ctx.textAlign = "right";
    ctx.fillStyle = "#f3f6fb";
    ctx.font = "700 24px system-ui, sans-serif";
    ctx.fillText(`${Math.max(0, state.distance).toFixed(0)} m`, view.w - 22, 84);

    const kmh = Math.round(state.speed * 3.6);
    ctx.textAlign = "left";
    ctx.fillStyle = "#f3f6fb";
    ctx.font = "700 32px system-ui, sans-serif";
    ctx.fillText(`${kmh}`, 28, view.h - 26);
    ctx.fillStyle = "#9fb0c8";
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillText("km/h", 28, view.h - 10);
  }

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
