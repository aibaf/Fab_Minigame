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

  // Wandernde Ente (Gameplay-Variante): sanfte Vor-/Zurueck-Bewegung
  duckMoveFreq: 1.5, // rad/s der Oszillation
  duckMoveAmp: 6, // max. Eigengeschwindigkeit der Ente (m/s)
  duckMoveFromRound: 4, // erst ab dieser Runde moeglich (Onboarding)
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
    "Millimeterarbeit. Knapper geht es nur mit dem Lineal.",
    "Punktlandung. Die Ente sucht noch nach Worten.",
    "So nah dran, da wird sogar mir kurz mulmig.",
    "Perfekt. Mach das nochmal, dann glaube ich es dir.",
    "Haargenau. Ihr zwei habt jetzt eine gemeinsame Geschichte.",
    "Das war knapp genug, um es Kunst zu nennen.",
    "Ich hätte gebremst. Du brauchst mich ja gar nicht.",
    "Lehrbuchreif. In welchem Lehrbuch, frage ich lieber nicht.",
    "Optimal. Mir bleibt kurz die Luft weg.",
    "Genau so. Das schreibe ich mir hinter die Ohren.",
    "Beeindruckend. Ein schöner Zufall, geben wir es zu.",
    "Wahnsinn. Ein Fingerbreit weiter und wir reden ganz anders.",
  ],
  ok: [
    "Geht in Ordnung. Keiner verletzt, keine Ente platt.",
    "Etwas früh, aber die Ente nimmt es dir nicht übel.",
    "Solide. Darüber schreibt keiner ein Lied, aber solide.",
    "Sicherheitsabstand wie aus der Fahrschule. Gähn.",
    "Funktioniert. Schön ist etwas anderes.",
    "Du lebst, die Ente lebt. Ein ganz normaler Tag.",
    "Nicht falsch. Nur nicht besonders mutig.",
    "Brav gebremst. Die Ente nickt höflich.",
    "Bestanden. Mit Sternchen, wenn ich großzügig bin.",
    "Ordentlich. Ich runde mal nach oben.",
    "Kein Drama. Drama mag ich ohnehin nicht.",
    "Passt schon. Begeistert klingt anders, aber passt.",
  ],
  coward: [
    "So viel Abstand, da passt locker noch ein Auto rein.",
    "Drei Meter vor einer Badeente. Mutig, mutig.",
    "Du stehst. Die Ente winkt dir von weitem zu.",
    "So früh gebremst, die Ente ist eingeschlafen.",
    "Sicherheit zuerst. Punkte ganz, ganz zuletzt.",
    "Das war kein Bremsen, das war eine Entschuldigung.",
    "Vorsichtig. Sehr vorsichtig. Langweilig vorsichtig.",
    "Du hättest in Ruhe noch einen Kaffee geholt.",
    "Die Ente fragt, ob bei dir alles in Ordnung ist.",
    "Mutlos, aber lebendig. Damit lässt sich leben.",
    "Bremsweg für drei. Erwartest du noch Gäste?",
    "So zaghaft, da wird die Ente alt dabei.",
  ],
  squish: [
    "Ich sagte bremsen, nicht plätten.",
    "Federn überall. Das wird teuer.",
    "Das war mal eine Ente. Jetzt ist es Geschichte.",
    "Null Punkte, dafür ein lautes Geräusch.",
    "Du hattest genau eine Aufgabe.",
    "Ich habe innerlich gebremst. Hat nur leider nichts gebracht.",
    "Die Ente hat es kommen sehen. Du leider nicht.",
    "Quietschen war gestern. Heute herrscht Stille.",
    "Glückwunsch, du hast eine Ente endgültig erschreckt.",
    "Das gibt Punktabzug. Und einen Fleck.",
    "Bremse gefunden? Wäre jetzt ein guter Moment gewesen.",
    "Aua. Das hat sogar mir wehgetan.",
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

// Neon-Palette (Synthwave). Feste Akzente; die Himmels-/Sonnenstimmung
// variiert pro Runde ueber MOODS.
const COLORS = {
  road: "#0b0a18", // dunkler Asphalt
  stripe: "#fdf3ff", // Mittelstreifen
  neonCyan: "#19e6ff",
  neonPink: "#ff2e97",
  neonPurple: "#a86bff",
  duckBody: "#FFD23E",
  duckBeak: "#FF8A1F",
  dash: "#0a0913",
  text: "#f3ecff",
  textDim: "#9a8fc7",
};

// Schriftarten: Orbitron (Retro) fuer HUD/Titel/Zahlen, System-Font fuer Fliesstext.
const FONT = "'Orbitron', system-ui, sans-serif";
const FONT_BODY = "system-ui, -apple-system, sans-serif";

// Strecken-Stimmungen wechseln ueber die Runden -> Optik bleibt frisch.
// Jede Mood liefert Himmelsverlauf, Sonnen- und Gridfarben + Sternintensitaet.
const MOODS = [
  { name: "sunset", skyTop: "#2a1a55", skyMid: "#8a2a8c", skyBottom: "#ff8a4d",
    sunTop: "#ffe24d", sunBottom: "#ff3d8b", grid: "#ff2e97", stars: 0.0 },
  { name: "night", skyTop: "#050414", skyMid: "#221a55", skyBottom: "#5a2e9e",
    sunTop: "#9a6bff", sunBottom: "#2a1a6b", grid: "#19e6ff", stars: 1.0 },
  { name: "dusk", skyTop: "#0d1740", skyMid: "#3a4a9c", skyBottom: "#ff9e7a",
    sunTop: "#fff0a6", sunBottom: "#ff6a8b", grid: "#a86bff", stars: 0.45 },
];

function moodForRound(round) {
  return MOODS[(round - 1) % MOODS.length];
}

// Strassenbedingungen variieren pro Runde das Bremsverhalten bzw. die Sicht.
// decelMul < 1 = laengerer Bremsweg (nass); fog = Ente erst spaet sichtbar.
const CONDITIONS = {
  dry: { label: "TROCKEN", decelMul: 1.0 },
  wet: { label: "NASS", decelMul: 0.6, rain: true },
  fog: { label: "NEBEL", decelMul: 1.0, fog: true },
};

// Runde 1-2 immer trocken (Onboarding), danach gewichtet zufaellig.
function conditionForRound(round) {
  if (round <= 2) return "dry";
  const r = Math.random();
  if (r < 0.45) return "dry";
  if (r < 0.75) return "wet";
  return "fog";
}

// Regentropfen (seedbasiert), fallen ueber die Zeit -> kein Springen.
const RAIN = (() => {
  let s = 4242;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  return Array.from({ length: 110 }, () => ({
    x: rnd(),
    y: rnd(),
    len: 10 + rnd() * 14,
    sp: 0.6 + rnd() * 0.6,
  }));
})();

// Feste Sternpositionen (seedbasiert, einmal erzeugt) -> kein Flackern.
const STARS = (() => {
  let s = 1234567;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  return Array.from({ length: 80 }, () => ({
    x: rnd(),
    y: rnd() * 0.78,
    r: 0.4 + rnd() * 1.3,
    a: 0.25 + rnd() * 0.7,
  }));
})();

// Ferne Bergsilhouette (seedbasiert) als statische Parallax-Schicht.
const SKYLINE = (() => {
  let s = 99887766;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  return Array.from({ length: 15 }, () => 0.25 + rnd() * 0.75);
})();

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
  mood: MOODS[0], // aktuelle Strecken-Stimmung (wechselt pro Runde)
  condition: "dry", // Strassenbedingung der Runde (dry/wet/fog)
  decel: CONFIG.decel, // effektive Bremsverzoegerung (haengt an der Bedingung)
  duckMoving: false, // wandert die Ziel-Ente in dieser Runde vor/zurueck?
  speed: 0, // aktuelles Tempo (m/s)
  distance: 0, // Restdistanz zur Ente (m)
  traveled: 0, // in dieser Runde zurueckgelegte Strecke (m), fuer scrollende Marker
  gap: 0, // Restdistanz beim Stillstand (m), Ergebnis der Runde
  outcome: null, // "stop" | "squish" | null

  score: 0,
  best: loadBest(),
  lives: CONFIG.lives,
  streak: 0,

  // Ergebnis der letzten Runde (fuer Result-Screen)
  lastLabel: "",
  lastPoints: 0,
  lastQuip: "", // Co-Pilot-Kommentar

  // Maskottchen auf dem Armaturenbrett (Feder-gedaempfter Lurch)
  mascotLean: 0,
  mascotLeanVel: 0,

  // Juice-Effekte
  shake: 0, // Screenshake-Staerke (px), klingt ab
  flash: 0, // Tier-Flash-Staerke (0..1), klingt ab
  flashColor: "#ffffff",
  particles: [], // Federn/Funken
  popups: [], // aufsteigende Punkte-Texte

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
  state.mood = moodForRound(state.round);
  state.condition = conditionForRound(state.round);
  state.decel = CONFIG.decel * CONDITIONS[state.condition].decelMul;
  // Wandernde Ente nicht bei Nebel kombinieren (waere unfair, da spaet sichtbar).
  state.duckMoving =
    state.round >= CONFIG.duckMoveFromRound &&
    state.condition !== "fog" &&
    Math.random() < 0.45;
  setPhase(PHASE.CRUISE);
}

// Highscore in localStorage (uebersteht Reloads). Defensiv, falls Storage blockiert.
function loadBest() {
  try {
    return parseInt(localStorage.getItem("bremspunkt_best"), 10) || 0;
  } catch (e) {
    return 0;
  }
}

function saveBest() {
  try {
    localStorage.setItem("bremspunkt_best", String(state.best));
  } catch (e) {
    /* Storage nicht verfuegbar (z.B. Privatmodus) - ignorieren */
  }
}

// ============================================================
// INPUT
// ============================================================
// Genau ein Input. Der ganze Screen ist der Brems-Button.
function handleTap() {
  state.taps++;
  initAudio(); // erste User-Geste schaltet Audio frei

  switch (state.phase) {
    case PHASE.READY:
      startRound();
      break;
    case PHASE.CRUISE:
      setPhase(PHASE.BRAKE); // Bremsen einleiten
      playBrake();
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
    } else if (e.code === "KeyM") {
      setMuted(!audio.muted);
    }
  });
}

// ============================================================
// CANVAS
// ============================================================
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const view = { w: 0, h: 0, dpr: 1, ui: 0 };

function resize() {
  view.dpr = Math.min(window.devicePixelRatio || 1, 2);
  // Sichtbare Flaeche nutzen: auf iOS Safari schliesst innerHeight den Bereich
  // hinter der unteren Toolbar ein -> Cockpit-Elemente landen sonst dahinter.
  const vv = window.visualViewport;
  view.w = (vv && vv.width) || window.innerWidth;
  view.h = (vv && vv.height) || window.innerHeight;
  // Bezugsgroesse fuer Cockpit-Elemente: im Hochformat nicht an die grosse Hoehe
  // koppeln (sonst werden Lenkrad/Tacho/Maskottchen zu gross und ueberlappen).
  view.ui = Math.min(view.h, view.w * 1.2);
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
  updateEffects(dt); // Partikel/Popups/Shake laufen immer weiter
  updateEngine(); // Motor-Ton an Tempo koppeln
  if (state.paused) return;

  if (state.phase === PHASE.CRUISE) {
    // Konstantes Tempo, Distanz schrumpft. Nicht bremsen = Ente ueberfahren.
    const step = state.speed * dt;
    state.distance -= step;
    state.traveled += step;
    applyDuckDrift(dt);
    if (state.distance <= 0) squish();
  } else if (state.phase === PHASE.BRAKE) {
    // Konstante Verzoegerung bis Stillstand.
    state.speed = Math.max(0, state.speed - state.decel * dt);
    const step = state.speed * dt;
    state.distance -= step;
    state.traveled += step;
    applyDuckDrift(dt);
    if (state.distance <= 0) {
      squish();
    } else if (state.speed <= CONFIG.stopEpsilon) {
      stop();
    }
  }
}

// Wandernde Ente: sanfte Vor-/Zurueck-Bewegung -> Rest-Distanz oszilliert.
function applyDuckDrift(dt) {
  if (!state.duckMoving) return;
  const v = Math.cos(state.time * CONFIG.duckMoveFreq) * CONFIG.duckMoveAmp;
  state.distance = Math.max(0, state.distance + v * dt);
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
  if (state.score > state.best) {
    state.best = state.score;
    saveBest();
  }
  state.streak = tier.keepStreak ? state.streak + 1 : 0;

  state.lastLabel = tier.label;
  state.lastPoints = points;
  state.lastQuip = pickQuip(tier.quip);

  const p = project(Math.max(state.gap, 0));
  const popupY = p.y - view.h * 0.12;
  if (tier.quip === "perfect") {
    spawnSparks(p.cx, p.y - view.h * 0.04, 28, COLORS.neonCyan);
    triggerFlash(COLORS.neonCyan, 0.7);
    addShake(6);
    addPopup(p.cx, popupY, "+" + points, COLORS.neonCyan);
    playDing(880);
  } else if (tier.quip === "ok") {
    spawnSparks(p.cx, p.y - view.h * 0.04, 12, "#ffe14d");
    addShake(2);
    addPopup(p.cx, popupY, "+" + points, COLORS.text);
    playDing(587);
  } else {
    addPopup(p.cx, popupY, "+" + points, COLORS.textDim);
  }

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

  const p = project(0);
  spawnFeathers(p.cx, p.y - view.h * 0.05, 34);
  triggerFlash("#ff3d4d", 0.9);
  addShake(13);
  addPopup(p.cx, p.y - view.h * 0.12, "0", "#ff6a7a");
  playNoise(0.3, "squish");

  setPhase(PHASE.RESULT);
}

// ============================================================
// EFFECTS (Juice: Shake, Partikel, Popups, Flash)
// ============================================================

// Kamera-Wackeln verstaerken (Maximum, damit ein Squish nicht uebertoent wird).
function addShake(amount) {
  state.shake = Math.max(state.shake, amount);
}

// Kurzer farbiger Vollbild-Flash als Ergebnis-Feedback.
function triggerFlash(color, strength) {
  state.flashColor = color;
  state.flash = strength;
}

// Federn-Explosion (Squish) am Punkt (x,y).
function spawnFeathers(x, y, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 40 + Math.random() * 190;
    state.particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 90,
      life: 0.8 + Math.random() * 0.8,
      maxLife: 1.6,
      size: 3 + Math.random() * 4,
      color: Math.random() < 0.85 ? COLORS.duckBody : COLORS.duckBeak,
      rot: Math.random() * Math.PI,
      vrot: (Math.random() - 0.5) * 10,
    });
  }
}

// Funken (guter Treffer) am Punkt (x,y), nach oben gerichtet.
function spawnSparks(x, y, n, color) {
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
    const sp = 90 + Math.random() * 230;
    state.particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 0.4 + Math.random() * 0.5,
      maxLife: 0.9,
      size: 2 + Math.random() * 3,
      color,
      rot: 0,
      vrot: 0,
    });
  }
}

// Aufsteigender Punkte-Text am Trefferort.
function addPopup(x, y, text, color) {
  state.popups.push({ x, y, text, color, life: 1.2, maxLife: 1.2 });
}

// Shake/Flash abklingen, Partikel und Popups bewegen.
function updateEffects(dt) {
  state.shake = Math.max(0, state.shake - dt * 55);
  state.flash = Math.max(0, state.flash - dt * 2.2);

  for (const p of state.particles) {
    p.vy += 520 * dt; // Schwerkraft
    p.vx *= 1 - 1.2 * dt; // Luftwiderstand
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vrot * dt;
    p.life -= dt;
  }
  if (state.particles.length) {
    state.particles = state.particles.filter((p) => p.life > 0);
  }

  for (const u of state.popups) {
    u.y -= 38 * dt;
    u.life -= dt;
  }
  if (state.popups.length) {
    state.popups = state.popups.filter((u) => u.life > 0);
  }
}

function drawParticles() {
  for (const p of state.particles) {
    const a = Math.max(0, Math.min(1, p.life / p.maxLife));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.ellipse(0, 0, p.size, p.size * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawPopups() {
  ctx.textAlign = "center";
  for (const u of state.popups) {
    const a = Math.max(0, Math.min(1, u.life / u.maxLife));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = u.color;
    ctx.shadowColor = u.color;
    ctx.shadowBlur = 12;
    ctx.font = "900 26px " + FONT;
    ctx.fillText(u.text, u.x, u.y);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

// Vollbild-Flash (kurzes Ergebnis-Feedback).
function drawFlash() {
  if (state.flash <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(0.45, state.flash * 0.45);
  ctx.fillStyle = state.flashColor;
  ctx.fillRect(0, 0, view.w, view.h);
  ctx.restore();
}

// Seitliche Speed-Lines: bei hohem Tempo nach unten rasende Neon-Striche.
function drawSpeedLines() {
  const frac = Math.min(1, (state.speed - 20) / (CONFIG.startSpeedMax - 20));
  if (frac <= 0.08) return;
  const horizonY = view.h * SCENE.horizonFrac;
  const lanes = 4;
  ctx.save();
  ctx.strokeStyle = "#bfe9ff";
  ctx.lineWidth = 2;
  ctx.shadowColor = COLORS.neonCyan;
  ctx.shadowBlur = 6;
  for (let side = -1; side <= 1; side += 2) {
    for (let lane = 0; lane < lanes; lane++) {
      const t = (state.time * (1.2 + frac * 2) + lane * 0.31 + (side < 0 ? 0 : 0.5)) % 1;
      const x = view.w / 2 + side * view.w * (0.34 + lane * 0.05);
      const y = horizonY + (view.h - horizonY) * t;
      const len = 12 + 42 * t * frac;
      ctx.globalAlpha = Math.sin(t * Math.PI) * 0.4 * frac;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + len);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ============================================================
// AUDIO (synthetisch, ohne Assets, abschaltbar mit Taste M)
// ============================================================
const audio = {
  ctx: null,
  master: null,
  engineBuffer: null, // dekodiertes Motor-Sample (CC0)
  engineSrc: null,
  engineGain: null,
  brakeBuffer: null, // dekodiertes Bremsquietschen (CC0)
  muted: false,
};

// Erst nach einer User-Geste erlaubt (Autoplay-Regel) -> aus handleTap.
function initAudio() {
  if (audio.ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  audio.ctx = new AC();
  audio.master = audio.ctx.createGain();
  audio.master.gain.value = audio.muted ? 0 : 0.5;
  audio.master.connect(audio.ctx.destination);

  // Motor- und Brems-Sample (beide CC0, siehe CREDITS.md) laden und dekodieren
  loadSample("assets/engine.wav", (buf) => (audio.engineBuffer = buf));
  loadSample("assets/brake.mp3", (buf) => (audio.brakeBuffer = buf));
}

// Laedt eine Audiodatei und legt das dekodierte Buffer ueber den Callback ab.
function loadSample(url, onReady) {
  fetch(url)
    .then((r) => r.arrayBuffer())
    .then((b) => audio.ctx.decodeAudioData(b))
    .then(onReady)
    .catch(() => {});
}

function setMuted(m) {
  audio.muted = m;
  if (audio.master) audio.master.gain.value = m ? 0 : 0.5;
}

// Motor: CC0-Loop-Sample, dessen Tonhoehe (playbackRate) mit dem Tempo steigt
// (= Drehzahl). Quelle und Lizenz siehe CREDITS.md.
function updateEngine() {
  if (!audio.ctx || !audio.engineBuffer) return; // wartet, bis das Sample geladen ist
  if (!audio.engineSrc) {
    audio.engineSrc = audio.ctx.createBufferSource();
    audio.engineSrc.buffer = audio.engineBuffer;
    audio.engineSrc.loop = true;
    audio.engineGain = audio.ctx.createGain();
    audio.engineGain.gain.value = 0;
    audio.engineSrc.connect(audio.engineGain).connect(audio.master);
    audio.engineSrc.start();
  }
  const t = audio.ctx.currentTime;
  if (isDriving()) {
    const frac = Math.min(1, state.speed / CONFIG.startSpeedMax);
    audio.engineSrc.playbackRate.setTargetAtTime(0.75 + frac * 1.5, t, 0.08);
    audio.engineGain.gain.setTargetAtTime(0.6, t, 0.1);
  } else {
    audio.engineGain.gain.setTargetAtTime(0, t, 0.15);
  }
}

// Kurzer Zweiklang (Grundton + Quinte) als Treffer-Bestaetigung.
function playDing(freq) {
  if (!audio.ctx) return;
  const t = audio.ctx.currentTime;
  const voices = [
    { f: freq, peak: 0.32, delay: 0 },
    { f: freq * 1.5, peak: 0.18, delay: 0.04 },
  ];
  for (const v of voices) {
    const o = audio.ctx.createOscillator();
    const g = audio.ctx.createGain();
    o.type = "triangle";
    o.frequency.value = v.f;
    const s = t + v.delay;
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(v.peak, s + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, s + 0.45);
    o.connect(g).connect(audio.master);
    o.start(s);
    o.stop(s + 0.47);
  }
}

// Bremsquietschen: echtes CC0-Sample. Fallback auf synthetisch, falls noch nicht geladen.
function playBrake() {
  if (!audio.ctx) return;
  if (audio.brakeBuffer) {
    const src = audio.ctx.createBufferSource();
    src.buffer = audio.brakeBuffer;
    const g = audio.ctx.createGain();
    g.gain.value = 0.7;
    src.connect(g).connect(audio.master);
    src.start();
  } else {
    playNoise(0.4, "squeal");
  }
}

// Rausch-basierter Effekt: "squish" (dumpf) oder "squeal" (Bremsquietschen, Fallback).
function playNoise(dur, kind) {
  if (!audio.ctx) return;
  const t = audio.ctx.currentTime;
  const buf = audio.ctx.createBuffer(1, Math.ceil(audio.ctx.sampleRate * dur), audio.ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = audio.ctx.createBufferSource();
  src.buffer = buf;
  const filter = audio.ctx.createBiquadFilter();
  const g = audio.ctx.createGain();
  if (kind === "squish") {
    filter.type = "lowpass";
    filter.frequency.value = 700;
    g.gain.setValueAtTime(0.6, t);
  } else {
    filter.type = "bandpass";
    filter.frequency.value = 1900;
    g.gain.setValueAtTime(0.16, t);
  }
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(g).connect(audio.master);
  src.start();
}

// ============================================================
// RENDER (Schritt 1: Debug-Overlay)
// ============================================================
function render() {
  drawSky();
  drawStars();
  drawSun();
  drawSkyline();
  drawGround();
  drawFog();
  if (isDriving()) drawSpeedLines();
  if (isDriving() && !CONDITIONS[state.condition].fog) drawBrakeHint();
  drawTargetDuck();
  drawParticles();
  drawDashboard();
  drawSteeringWheel();
  drawTacho();
  drawMascot();
  drawRain();
  drawFlash();
  drawPopups();
  drawOverlays();
  drawHud();
  drawHint();
}

function isDriving() {
  return state.phase === PHASE.CRUISE || state.phase === PHASE.BRAKE;
}

// Fuehrt fn mit aktivem Neon-Glow (Schatten) aus und raeumt sauber auf.
function withGlow(color, blur, fn) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  fn();
  ctx.restore();
}

// Himmel: mehrstufiger Sonnenuntergang-Verlauf je nach Stimmung.
function drawSky() {
  const m = state.mood;
  const horizonY = view.h * SCENE.horizonFrac;
  const grad = ctx.createLinearGradient(0, 0, 0, horizonY);
  grad.addColorStop(0, m.skyTop);
  grad.addColorStop(0.62, m.skyMid);
  grad.addColorStop(1, m.skyBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, view.w, horizonY);
}

// Sterne im oberen Himmel (nur bei dunkleren Stimmungen sichtbar).
function drawStars() {
  const m = state.mood;
  if (m.stars <= 0) return;
  const horizonY = view.h * SCENE.horizonFrac;
  ctx.fillStyle = "#ffffff";
  for (const st of STARS) {
    ctx.globalAlpha = st.a * m.stars;
    ctx.beginPath();
    ctx.arc(st.x * view.w, st.y * horizonY, st.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Grosse Retro-Sonne am Horizont mit horizontalen Schlitzen.
function drawSun() {
  const m = state.mood;
  const horizonY = view.h * SCENE.horizonFrac;
  const cx = view.w / 2;
  const r = Math.min(view.w, view.h) * 0.17;
  const cy = horizonY - r * 0.22;

  const grad = ctx.createLinearGradient(0, cy - r, 0, cy + r);
  grad.addColorStop(0, m.sunTop);
  grad.addColorStop(1, m.sunBottom);

  withGlow(m.sunBottom, 55, () => {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = grad;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
  });

  // horizontale Schlitze in der unteren Haelfte (werden nach unten breiter)
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = m.skyBottom;
  let gap = 3;
  for (let y = cy + r * 0.1; y < cy + r; ) {
    ctx.fillRect(cx - r, y, r * 2, gap);
    y += gap + Math.max(4, gap * 1.6);
    gap += 1.5;
  }
  ctx.restore();
}

// Ferne Bergsilhouette knapp ueber dem Horizont, mit Neon-Kontur.
function drawSkyline() {
  const m = state.mood;
  const horizonY = view.h * SCENE.horizonFrac;
  const maxH = view.h * 0.1;
  const seg = view.w / (SKYLINE.length - 1);

  ctx.fillStyle = "rgba(7,5,18,0.85)";
  ctx.beginPath();
  ctx.moveTo(0, horizonY);
  for (let i = 0; i < SKYLINE.length; i++) {
    ctx.lineTo(i * seg, horizonY - SKYLINE[i] * maxH);
  }
  ctx.lineTo(view.w, horizonY);
  ctx.closePath();
  ctx.fill();

  withGlow(m.grid, 8, () => {
    ctx.strokeStyle = m.grid;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    for (let i = 0; i < SKYLINE.length; i++) {
      const x = i * seg;
      const y = horizonY - SKYLINE[i] * maxH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  });
}

// Dunkle Bodenebene + Neon-Perspektiv-Gitter + Horizont-Glow, dann die Strasse.
function drawGround() {
  const m = state.mood;
  const horizonY = view.h * SCENE.horizonFrac;

  // Dunkle Bodenebene mit leichtem Schimmer zum Horizont
  const g = ctx.createLinearGradient(0, horizonY, 0, view.h);
  g.addColorStop(0, "#1a0f3a");
  g.addColorStop(0.28, "#0c0820");
  g.addColorStop(1, "#060410");
  ctx.fillStyle = g;
  ctx.fillRect(0, horizonY, view.w, view.h - horizonY);

  // Leuchtende Horizont-Linie
  withGlow(m.grid, 16, () => {
    ctx.strokeStyle = m.grid;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    ctx.lineTo(view.w, horizonY);
    ctx.stroke();
  });

  drawGrid(m);
  drawRoad(m);
}

// Neon-Perspektiv-Gitter: Faecher-Laengslinien + scrollende Querlinien.
function drawGrid(m) {
  const horizonY = view.h * SCENE.horizonFrac;
  const cx = view.w / 2;
  ctx.save();
  ctx.strokeStyle = m.grid;
  ctx.lineWidth = 1;
  ctx.shadowColor = m.grid;
  ctx.shadowBlur = 6;

  // Laengslinien faechern vom Fluchtpunkt nach unten
  const N = 7;
  const spread = view.w * 0.95;
  for (let i = -N; i <= N; i++) {
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.moveTo(cx, horizonY);
    ctx.lineTo(cx + (i / N) * spread, view.h);
    ctx.stroke();
  }

  // Querlinien scrollen mit traveled (Tempo-Anker)
  const spacing = SCENE.stripeSpacing;
  const offset = state.traveled % spacing;
  for (let k = 1; ; k++) {
    const z = k * spacing - offset;
    if (z <= 0) continue;
    if (z > SCENE.maxRenderDist) break;
    const p = project(z);
    ctx.globalAlpha = 0.1 + 0.4 * p.s;
    ctx.beginPath();
    ctx.moveTo(0, p.y);
    ctx.lineTo(view.w, p.y);
    ctx.stroke();
  }
  ctx.restore();
}

// Strasse als dunkles Band mit Neon-Raendern und gestricheltem Mittelstreifen.
function drawRoad(m) {
  const horizonY = view.h * SCENE.horizonFrac;
  const cx = view.w / 2;
  const base = project(0);

  // Asphalt-Band
  ctx.fillStyle = COLORS.road;
  ctx.beginPath();
  ctx.moveTo(cx - base.halfW, base.y);
  ctx.lineTo(cx + base.halfW, base.y);
  ctx.lineTo(cx + 1.5, horizonY);
  ctx.lineTo(cx - 1.5, horizonY);
  ctx.closePath();
  ctx.fill();

  // Neon-Raender: links Cyan, rechts Pink
  withGlow(COLORS.neonCyan, 14, () => {
    ctx.strokeStyle = COLORS.neonCyan;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - base.halfW, base.y);
    ctx.lineTo(cx - 1.5, horizonY);
    ctx.stroke();
  });
  withGlow(COLORS.neonPink, 14, () => {
    ctx.strokeStyle = COLORS.neonPink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx + base.halfW, base.y);
    ctx.lineTo(cx + 1.5, horizonY);
    ctx.stroke();
  });

  // Gestrichelter Mittelstreifen, scrollt mit traveled
  const offset = state.traveled % SCENE.stripeSpacing;
  withGlow(COLORS.stripe, 8, () => {
    ctx.fillStyle = COLORS.stripe;
    for (let k = 1; ; k++) {
      const z = k * SCENE.stripeSpacing - offset;
      if (z <= 0) continue;
      if (z > SCENE.maxRenderDist) break;
      const p = project(z);
      const h = Math.max(1, p.s * 9);
      const w = Math.max(1, p.halfW * 0.06);
      ctx.globalAlpha = 0.25 + 0.65 * p.s;
      ctx.fillRect(p.cx - w, p.y - h / 2, w * 2, h);
    }
    ctx.globalAlpha = 1;
  });
}

// Nebel-Schicht ueber der Ferne (nur bei fog) - die Ente erscheint erst spaet.
function drawFog() {
  if (!CONDITIONS[state.condition].fog) return;
  const horizonY = view.h * SCENE.horizonFrac;
  const top = horizonY - view.h * 0.12;
  const bottom = view.h * 0.74;
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, "rgba(188,190,214,0.55)");
  g.addColorStop(1, "rgba(188,190,214,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, top, view.w, bottom - top);
}

// Regen im Vordergrund (nur bei wet), faellt leicht schraeg.
function drawRain() {
  if (!CONDITIONS[state.condition].rain) return;
  ctx.save();
  ctx.strokeStyle = "rgba(170,210,255,0.4)";
  ctx.lineWidth = 1.4;
  for (const d of RAIN) {
    const y = ((d.y + state.time * d.sp) % 1) * view.h;
    const x = d.x * view.w;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 5, y + d.len);
    ctx.stroke();
  }
  ctx.restore();
}

// Dezente Andeutung, wo das Auto bei sofortigem Bremsen zum Stehen kaeme.
// Weicher, farbcodierter Schatten (gruen sicher -> rot Squish), bewusst unscharf,
// damit das Bauchgefuehl beim "so spaet wie moeglich" erhalten bleibt.
function drawBrakeHint() {
  const brakingDist = (state.speed * state.speed) / (2 * state.decel);
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

  // Bei Nebel erscheint die Ente erst spaet (voll ab ~30 m, unsichtbar ab ~55 m).
  // Im Ergebnis-Screen immer voll sichtbar.
  let alpha = 1;
  if (CONDITIONS[state.condition].fog && state.phase !== PHASE.RESULT) {
    alpha = Math.max(0, Math.min(1, (55 - state.distance) / 25));
    if (alpha <= 0) return;
  }
  // Wandernde Ente: leichtes seitliches Watscheln als sichtbarer Hinweis
  let cx = p.cx;
  if (state.duckMoving && state.phase !== PHASE.RESULT) {
    cx += Math.sin(state.time * 6) * h * 0.12;
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  drawDuck(cx, p.y, h, flat);
  ctx.restore();
}

// Zeichnet eine Gummiente, frontal (Blick zum Spieler), Fuesse bei groundY.
// flat=true -> plattgedrueckt (Squish). accessory=true -> Co-Pilot-Look (Brille + Muetze).
function drawDuck(cx, groundY, h, flat, accessory) {
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

  const bodyCy = groundY - h * 0.3;
  const headR = h * 0.26;
  const headCy = groundY - h * 0.66;

  // Sanfter Glow-Schein um die grossen Formen (passt zum Neon-Theme)
  ctx.save();
  ctx.shadowColor = "rgba(255,210,62,0.6)";
  ctx.shadowBlur = h * 0.18;

  // Koerper mit Volumen (radialer Verlauf: Highlight oben links)
  const bodyGrad = ctx.createRadialGradient(
    cx - w * 0.14, bodyCy - h * 0.12, h * 0.04,
    cx, bodyCy, w * 0.52
  );
  bodyGrad.addColorStop(0, "#FFE99A");
  bodyGrad.addColorStop(0.55, COLORS.duckBody);
  bodyGrad.addColorStop(1, "#E8A41E");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.ellipse(cx, bodyCy, w * 0.46, h * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Kopf mit Volumen
  const headGrad = ctx.createRadialGradient(
    cx - headR * 0.35, headCy - headR * 0.4, headR * 0.1,
    cx, headCy, headR
  );
  headGrad.addColorStop(0, "#FFE99A");
  headGrad.addColorStop(0.6, COLORS.duckBody);
  headGrad.addColorStop(1, "#E8A41E");
  ctx.fillStyle = headGrad;
  ctx.beginPath();
  ctx.arc(cx, headCy, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Bauch-Highlight
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  ctx.beginPath();
  ctx.ellipse(cx - w * 0.08, bodyCy + h * 0.06, w * 0.22, h * 0.15, -0.3, 0, Math.PI * 2);
  ctx.fill();

  // Fluegel-Andeutung (dezent)
  ctx.fillStyle = "rgba(170,115,10,0.2)";
  ctx.beginPath();
  ctx.ellipse(cx + w * 0.3, bodyCy + h * 0.02, w * 0.13, h * 0.2, 0.2, 0, Math.PI * 2);
  ctx.fill();

  // Schnabel mit kleinem Schatten
  const beakY = headCy + headR * 0.52;
  ctx.fillStyle = COLORS.duckBeak;
  ctx.beginPath();
  ctx.ellipse(cx, beakY, headR * 0.58, headR * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(150,60,10,0.32)";
  ctx.beginPath();
  ctx.ellipse(cx, beakY + headR * 0.12, headR * 0.5, headR * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();

  // Augen (gross, lebendig, mit Glanz)
  const eyeDx = headR * 0.4;
  const eyeY = headCy - headR * 0.12;
  const eyeR = Math.max(1.2, headR * 0.2);
  ctx.fillStyle = "#15131c";
  ctx.beginPath();
  ctx.arc(cx - eyeDx, eyeY, eyeR, 0, Math.PI * 2);
  ctx.arc(cx + eyeDx, eyeY, eyeR, 0, Math.PI * 2);
  ctx.fill();
  if (eyeR > 2) {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(cx - eyeDx + eyeR * 0.32, eyeY - eyeR * 0.34, eyeR * 0.42, 0, Math.PI * 2);
    ctx.arc(cx + eyeDx + eyeR * 0.32, eyeY - eyeR * 0.34, eyeR * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }

  if (accessory) drawDuckAccessory(cx, headCy, headR, eyeDx, eyeY);
}

// Co-Pilot-Accessoire: Schirmmuetze + Sonnenbrille (nur fuers Maskottchen).
function drawDuckAccessory(cx, headCy, headR, eyeDx, eyeY) {
  const capCol = "#241a55"; // dunkelviolett, hebt sich vom Gelb ab

  // --- Schirmmuetze (Baseball-Cap) ---
  const brimY = headCy - headR * 0.24; // knapp ueber der Brille
  // Schirm: breite flache Platte, ragt nach vorne
  ctx.fillStyle = capCol;
  ctx.beginPath();
  ctx.ellipse(cx, brimY, headR * 1.05, headR * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  // Krone: Kuppel, deckt den oberen Kopf bis knapp ueber die Augen
  ctx.beginPath();
  ctx.ellipse(cx, headCy - headR * 0.6, headR * 0.96, headR * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  // Highlight auf der Krone (Volumen)
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.beginPath();
  ctx.ellipse(cx - headR * 0.3, headCy - headR * 0.78, headR * 0.35, headR * 0.16, -0.4, 0, Math.PI * 2);
  ctx.fill();
  // Durchgehende Neon-Kontur (Krone oben + Schirmkante)
  withGlow(COLORS.neonPink, 8, () => {
    ctx.strokeStyle = COLORS.neonPink;
    ctx.lineWidth = Math.max(1.4, headR * 0.06);
    ctx.beginPath();
    ctx.ellipse(cx, headCy - headR * 0.6, headR * 0.96, headR * 0.42, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, brimY, headR * 1.05, headR * 0.16, 0, 0, Math.PI);
    ctx.stroke();
  });

  // --- Sonnenbrille ---
  const lensW = headR * 0.44;
  const lensH = headR * 0.36;
  const gY = eyeY + headR * 0.03;
  withGlow(COLORS.neonCyan, 6, () => {
    // Linsen (dunkel)
    ctx.fillStyle = "rgba(10,8,24,0.92)";
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + sx * eyeDx, gY, lensW, lensH, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Steg + Neon-Raender
    ctx.strokeStyle = COLORS.neonCyan;
    ctx.lineWidth = Math.max(1.4, headR * 0.06);
    ctx.beginPath();
    ctx.moveTo(cx - eyeDx + lensW * 0.72, gY);
    ctx.lineTo(cx + eyeDx - lensW * 0.72, gY);
    ctx.stroke();
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + sx * eyeDx, gY, lensW, lensH, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
  // dezenter Glanz auf den Linsen
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 1;
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + sx * eyeDx - lensW * 0.2, gY - lensH * 0.2, lensW * 0.45, Math.PI * 1.1, Math.PI * 1.5);
    ctx.stroke();
  }
}

// Armaturenbrett im Vordergrund (gewoelbte Oberkante).
function drawDashboard() {
  const topY = view.h - view.ui * 0.13;
  const lip = view.ui * 0.03;
  const bow = view.ui * 0.05;
  ctx.fillStyle = COLORS.dash;
  ctx.beginPath();
  ctx.moveTo(0, view.h);
  ctx.lineTo(0, topY + lip);
  ctx.quadraticCurveTo(view.w / 2, topY - bow, view.w, topY + lip);
  ctx.lineTo(view.w, view.h);
  ctx.closePath();
  ctx.fill();

  // dezente Glanzkante
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, topY + lip);
  ctx.quadraticCurveTo(view.w / 2, topY - bow, view.w, topY + lip);
  ctx.stroke();
}

// Maskottchen-Ente auf dem Armaturenbrett (unten rechts), kippt beim Bremsen
// nach vorn (Richtung Bildmitte = Fahrtrichtung).
function drawMascot() {
  const h = view.ui * 0.12;
  const baseX = view.w - h * 1.35;
  const dashY = view.h - view.ui * 0.02; // Federfuss auf dem Armaturenbrett
  const springH = h * 0.72; // Federhoehe -> Ente sitzt hoeher
  const topY = dashY - springH;

  // kontinuierliches seitliches Wackeln + zusaetzlicher Ausschlag beim Bremsen
  const swayPhase = Math.sin(state.time * 2.7);
  const swayX = swayPhase * h * 0.16 + state.mascotLean * h * 0.5;
  const tilt = swayPhase * 0.13 - state.mascotLean; // Neigung: Wackeln + Brems-Lurch

  drawSpring(baseX, dashY, baseX + swayX, topY, h);

  ctx.save();
  ctx.translate(baseX + swayX, topY);
  ctx.rotate(tilt);
  drawDuck(0, 0, h, false, true); // Co-Pilot-Look: Brille + Muetze
  ctx.restore();
}

// Sprungfeder als seitlich oszillierende Spirale: unten fix (x0,y0), Spitze folgt
// dem Wackeln (x1,y1).
function drawSpring(x0, y0, x1, y1, w) {
  const coils = 5;
  const rx = w * 0.24;
  const steps = coils * 14;
  ctx.save();
  ctx.lineCap = "round";
  ctx.shadowColor = COLORS.neonCyan;
  ctx.shadowBlur = 8;
  ctx.strokeStyle = "#aeb8d0"; // metallisch
  ctx.lineWidth = Math.max(2, w * 0.06);
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const midX = x0 + (x1 - x0) * t; // geneigter Mittelpfad
    const x = midX + Math.sin(t * coils * Math.PI * 2) * rx;
    const y = y0 + (y1 - y0) * t;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
  // Federteller unten (verankert am Dashboard)
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#8a93ad";
  ctx.beginPath();
  ctx.ellipse(x0, y0, w * 0.3, w * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Lenkrad-Andeutung unten mittig: nur der obere Kranz + Speichen ragen ueber die
// Dashboard-Kante. Ruckt beim Bremsen (gekoppelt an mascotLean).
function drawSteeringWheel() {
  const cx = view.w / 2;
  const r = view.ui * 0.32;
  const cy = view.h + view.ui * 0.13; // Nabe unter dem Bildrand -> nur Oberteil sichtbar
  const a0 = Math.PI * 1.18;
  const a1 = Math.PI * 1.82;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(state.mascotLean * 0.28); // Brems-Ruck

  // Kranz: dunkler dicker Bogen
  ctx.lineCap = "round";
  ctx.strokeStyle = "#0b0918";
  ctx.lineWidth = view.ui * 0.055;
  ctx.beginPath();
  ctx.arc(0, 0, r, a0, a1);
  ctx.stroke();

  // Neon-Kanten (innen + aussen)
  withGlow(COLORS.neonCyan, 10, () => {
    ctx.strokeStyle = COLORS.neonCyan;
    ctx.lineWidth = 2;
    for (const rr of [r - view.ui * 0.027, r + view.ui * 0.027]) {
      ctx.beginPath();
      ctx.arc(0, 0, rr, a0, a1);
      ctx.stroke();
    }
  });

  // Speichen
  ctx.strokeStyle = "#0b0918";
  ctx.lineWidth = view.ui * 0.03;
  for (const a of [Math.PI * 1.27, Math.PI * 1.5, Math.PI * 1.73]) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    ctx.stroke();
  }
  ctx.restore();
}

// Neon-Rund-Tacho unten links: Skalenbogen + Nadel (Tempo) + km/h-Zahl.
function drawTacho() {
  const r = view.ui * 0.072;
  const cx = view.ui * 0.11;
  const cy = view.h - view.ui * 0.09;
  const a0 = Math.PI * 0.75; // unten links
  const a1 = Math.PI * 2.25; // unten rechts (270deg)

  ctx.save();
  // dunkle Scheibe
  ctx.fillStyle = "rgba(8,6,20,0.72)";
  ctx.beginPath();
  ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
  ctx.fill();

  // Skalenbogen
  withGlow(COLORS.neonCyan, 6, () => {
    ctx.strokeStyle = "rgba(120,160,200,0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a1);
    ctx.stroke();
  });

  // Tick-Marken
  ctx.strokeStyle = COLORS.textDim;
  ctx.lineWidth = 1.5;
  for (let i = 0; i <= 8; i++) {
    const a = a0 + (a1 - a0) * (i / 8);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.stroke();
  }

  // Nadel (Tempo)
  const frac = Math.min(1, Math.max(0, state.speed / CONFIG.startSpeedMax));
  const na = a0 + (a1 - a0) * frac;
  withGlow(COLORS.neonPink, 8, () => {
    ctx.strokeStyle = COLORS.neonPink;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(na) * (r - 3), cy + Math.sin(na) * (r - 3));
    ctx.stroke();
  });
  ctx.fillStyle = COLORS.neonPink;
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fill();

  // km/h-Zahl
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.text;
  ctx.font = "700 14px " + FONT;
  ctx.fillText(`${Math.round(state.speed * 3.6)}`, cx, cy + r * 0.5);
  ctx.fillStyle = COLORS.textDim;
  ctx.font = "500 8px " + FONT;
  ctx.fillText("km/h", cx, cy + r * 0.85);
  ctx.restore();
}

// Text-Overlays je nach Phase (Start, Ergebnis, Game Over)
function drawOverlays() {
  const cx = view.w / 2;
  const cy = view.h * 0.34; // oben, damit die nahe Ziel-Ente sichtbar bleibt
  ctx.textAlign = "center";

  if (state.phase === PHASE.READY) {
    panel(cx, cy, 390, 130, COLORS.neonCyan);
    withGlow(COLORS.neonCyan, 16, () => {
      ctx.fillStyle = COLORS.text;
      ctx.font = "900 38px " + FONT;
      ctx.fillText("BREMSPUNKT", cx, cy - 2);
    });
    ctx.fillStyle = COLORS.textDim;
    ctx.font = "15px " + FONT_BODY;
    ctx.fillText("Bremse so spät wie möglich vor der Ente", cx, cy + 32);
  }

  if (state.phase === PHASE.RESULT) {
    const squish = state.outcome === "squish";
    const accent = squish ? "#ff5b6e" : COLORS.neonCyan;
    const pw = Math.min(480, view.w * 0.9);
    ctx.font = "italic 16px " + FONT_BODY;
    const quipLines = wrapText(`„${state.lastQuip}“`, pw - 56);
    const ph = 122 + quipLines.length * 22;
    panel(cx, cy, pw, ph, accent);
    let y = cy - ph / 2 + 46;

    if (squish) {
      withGlow("#ff5b6e", 16, () => {
        ctx.fillStyle = "#ff5b6e";
        ctx.font = "900 30px " + FONT;
        ctx.fillText("SQUISH!", cx, y);
      });
      y += 30;
      ctx.fillStyle = COLORS.textDim;
      ctx.font = "15px " + FONT_BODY;
      ctx.fillText(`Ente plattgefahren  ·  Leben übrig: ${state.lives}`, cx, y);
      y += 26;
    } else {
      withGlow("#ffe14d", 14, () => {
        ctx.fillStyle = "#ffe14d";
        ctx.font = "900 27px " + FONT;
        ctx.fillText(state.lastLabel.toUpperCase(), cx, y);
      });
      y += 30;
      ctx.fillStyle = COLORS.text;
      ctx.font = "16px " + FONT_BODY;
      ctx.fillText(`Abstand ${state.gap.toFixed(2)} m  ·  +${state.lastPoints} Punkte`, cx, y);
      y += 26;
    }

    // Trennlinie
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - pw / 2 + 28, y - 6);
    ctx.lineTo(cx + pw / 2 - 28, y - 6);
    ctx.stroke();
    y += 16;

    // Co-Pilot-Spruch
    ctx.fillStyle = "#bfe0ff";
    ctx.font = "italic 16px " + FONT_BODY;
    for (const line of quipLines) {
      ctx.fillText(line, cx, y);
      y += 22;
    }
  }

  if (state.phase === PHASE.OVER) {
    panel(cx, cy, 390, 130, "#ff5b6e");
    withGlow("#ff5b6e", 16, () => {
      ctx.fillStyle = "#ff5b6e";
      ctx.font = "900 40px " + FONT;
      ctx.fillText("GAME OVER", cx, cy - 2);
    });
    ctx.fillStyle = COLORS.text;
    ctx.font = "700 16px " + FONT;
    ctx.fillText(`Punkte ${state.score}   ·   Best ${state.best}`, cx, cy + 32);
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

// Baut einen abgerundeten Rechteck-Pfad (fill/stroke danach getrennt).
function roundRectPath(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Dunkles Panel mit Neon-Rahmen + Glow hinter Overlay-Text.
function panel(cx, cy, w, h, accent) {
  const x = cx - w / 2;
  const y = cy - h / 2;
  accent = accent || COLORS.neonPink;
  ctx.save();
  roundRectPath(x, y, w, h, 16);
  ctx.fillStyle = "rgba(9, 6, 22, 0.85)";
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 18;
  ctx.stroke();
  ctx.restore();
}

// Kontext-Hinweis unten
function drawHint() {
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(243,236,255,0.78)";
  ctx.font = "600 13px " + FONT_BODY;
  ctx.fillText(hintForPhase(), view.w / 2, view.h - 24);
}

// HUD: Score/Best/Streak links, Runde/Multiplikator/Leben rechts, Tempo/Distanz unten.
function drawHud() {
  const mult = 1 + (state.round - 1) * CONFIG.roundMultiplierPerRound;

  // Score oben links (mit Glow)
  ctx.textAlign = "left";
  withGlow(COLORS.neonCyan, 10, () => {
    ctx.fillStyle = COLORS.text;
    ctx.font = "900 30px " + FONT;
    ctx.fillText(`${state.score}`, 22, 42);
  });
  ctx.fillStyle = COLORS.textDim;
  ctx.font = "500 12px " + FONT;
  ctx.fillText(`BEST ${state.best}`, 23, 62);

  if (state.streak > 0) {
    // Streak eskaliert farblich (gelb -> orange -> pink)
    const col =
      state.streak >= 5 ? COLORS.neonPink : state.streak >= 3 ? "#ff9a3d" : "#ffe14d";
    withGlow(col, 12, () => {
      ctx.fillStyle = col;
      ctx.font = "700 18px " + FONT;
      ctx.fillText(`STREAK x${state.streak}`, 22, 88);
    });
  }

  // Rechte Spalte: Runde, Multiplikator, Leben, (Distanz)
  ctx.textAlign = "right";
  let ry = 24;
  ctx.fillStyle = COLORS.textDim;
  ctx.font = "500 12px " + FONT;
  ctx.fillText(`RUNDE ${state.round}`, view.w - 22, ry);
  ry += 24;

  if (mult > 1.0001) {
    withGlow(COLORS.neonPink, 10, () => {
      ctx.fillStyle = COLORS.neonPink;
      ctx.font = "700 17px " + FONT;
      ctx.fillText(`x${mult.toFixed(1)}`, view.w - 22, ry);
    });
    ry += 24;
  }

  ctx.fillStyle = COLORS.text;
  ctx.font = "18px system-ui, sans-serif";
  ctx.fillText("\u{1F986}".repeat(Math.max(0, state.lives)), view.w - 22, ry);
  ry += 30;

  if (isDriving()) {
    // Restdistanz oben rechts; das Tempo zeigt jetzt der Cockpit-Tacho (drawTacho).
    withGlow(COLORS.neonCyan, 8, () => {
      ctx.fillStyle = COLORS.text;
      ctx.font = "700 22px " + FONT;
      ctx.fillText(`${Math.max(0, state.distance).toFixed(0)} m`, view.w - 22, ry);
    });
  }

  drawConditionBadge();
  drawMuteIcon();
  ctx.textAlign = "center";
}

// Zeigt aktive Runden-Modifikatoren oben mittig an (Wetter + wandernde Ente).
function drawConditionBadge() {
  const badges = [];
  if (state.condition !== "dry") {
    badges.push({
      text: CONDITIONS[state.condition].label,
      col: state.condition === "wet" ? COLORS.neonCyan : "#cdd0ea",
    });
  }
  if (state.duckMoving) {
    badges.push({ text: "WANDERNDE ENTE", col: "#ffe14d" });
  }
  if (!badges.length) return;
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = "700 14px " + FONT;
  let y = 46;
  for (const b of badges) {
    ctx.fillStyle = b.col;
    ctx.shadowColor = b.col;
    ctx.shadowBlur = 10;
    ctx.fillText(b.text, view.w / 2, y);
    y += 20;
  }
  ctx.restore();
}

// Kleines Lautsprecher-Symbol oben mittig (Status + Hinweis auf Taste M).
function drawMuteIcon() {
  const y = 20;
  const s = 6;
  const x = view.w / 2 - 14;
  ctx.save();
  const col = audio.muted ? COLORS.textDim : COLORS.neonCyan;
  ctx.fillStyle = col;
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(x - s, y - s * 0.5);
  ctx.lineTo(x - s * 0.3, y - s * 0.5);
  ctx.lineTo(x + s * 0.4, y - s);
  ctx.lineTo(x + s * 0.4, y + s);
  ctx.lineTo(x - s * 0.3, y + s * 0.5);
  ctx.lineTo(x - s, y + s * 0.5);
  ctx.closePath();
  ctx.fill();
  if (audio.muted) {
    ctx.beginPath();
    ctx.moveTo(x + s * 0.9, y - s * 0.7);
    ctx.lineTo(x + s * 1.9, y + s * 0.7);
    ctx.moveTo(x + s * 1.9, y - s * 0.7);
    ctx.lineTo(x + s * 0.9, y + s * 0.7);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(x + s * 0.5, y, s * 1.1, -0.7, 0.7);
    ctx.stroke();
  }
  ctx.fillStyle = COLORS.textDim;
  ctx.font = "500 10px " + FONT;
  ctx.textAlign = "left";
  ctx.fillText("M", x + s * 2.6, y + 3.5);
  ctx.restore();
}

function hintForPhase() {
  switch (state.phase) {
    case PHASE.READY:
      return "Tippen zum Losfahren";
    case PHASE.CRUISE:
      return "Tippen zum Bremsen - so spät wie möglich!";
    case PHASE.BRAKE:
      return "Bremst...";
    case PHASE.RESULT:
      return "Tippen für die nächste Runde";
    case PHASE.OVER:
      return "Tippen für Neustart";
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

  // Screenshake: ganze Szene leicht versetzt zeichnen
  ctx.save();
  if (state.shake > 0.2) {
    ctx.translate(
      (Math.random() * 2 - 1) * state.shake,
      (Math.random() * 2 - 1) * state.shake
    );
  }
  render();
  ctx.restore();

  requestAnimationFrame(frame);
}

// ============================================================
// BOOT
// ============================================================
function boot() {
  resize();
  window.addEventListener("resize", resize);
  // iOS Safari: auf das Ein-/Ausblenden der Toolbar reagieren
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", resize);
    window.visualViewport.addEventListener("scroll", resize);
  }
  initInput(canvas);
  requestAnimationFrame((t) => {
    lastTime = t / 1000;
    requestAnimationFrame(frame);
  });
}

boot();
