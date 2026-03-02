// ===== Defaults =====
const DEFAULTS = {
  focusMin: 25,
  shortMin: 5,
  longMin: 15,
  autoStart: true,
  tickSound: true,
  focusBeforeLong: 4,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem("pomo_settings");
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(s) {
  localStorage.setItem("pomo_settings", JSON.stringify(s));
}

// ===== Settings (mutable) =====
let settings = loadSettings();

const MODES = {
  focus: {
    label: "Focus",
    get minutes() {
      return settings.focusMin;
    },
    color: "#34C759",
  },
  short: {
    label: "Short Break",
    get minutes() {
      return settings.shortMin;
    },
    color: "#7c5cff",
  },
  long: {
    label: "Long Break",
    get minutes() {
      return settings.longMin;
    },
    color: "#ff9f0a",
  },
};

// ===== Elements =====
const timeText = document.getElementById("timeText");
const modeText = document.getElementById("modeText");
const startBtn = document.getElementById("startBtn");
const resetBtn = document.getElementById("resetBtn");
const statusText = document.getElementById("statusText");
const sessionCountEl = document.getElementById("sessionCount");
const modeBtns = document.querySelectorAll(".mode-btn");

const phone = document.getElementById("phone");
const startLabel = startBtn.querySelector(".circle-label");

// Ring elements
const ringFg = document.querySelector(".ringFg");
const ringSvg = document.querySelector(".ringSvg");

// Sheet elements
const settingsBtn = document.getElementById("settingsBtn");
const sheet = document.getElementById("sheet");
const sheetOverlay = document.getElementById("sheetOverlay");
const closeSheetBtn = document.getElementById("closeSheetBtn");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");

const focusInput = document.getElementById("focusInput");
const shortInput = document.getElementById("shortInput");
const longInput = document.getElementById("longInput");
const autoStartToggle = document.getElementById("autoStartToggle");
const tickToggle = document.getElementById("tickToggle");

// ===== State =====
let mode = "focus";
let totalSeconds = MODES[mode].minutes * 60;
let remainingSeconds = totalSeconds;
let timerId = null;
let isRunning = false;
let sessions = 0;

// ===== Ring math =====
const RADIUS = 52;
const CIRC = 2 * Math.PI * RADIUS; // ~326.7
if (ringFg) ringFg.style.strokeDasharray = `${CIRC}`;

// ===== Tick sound =====
let tickCtx = null;
let tickOsc = null;
let tickGain = null;

function startTickSound() {
  if (tickOsc) return;

  try {
    tickCtx = new (window.AudioContext || window.webkitAudioContext)();

    tickOsc = tickCtx.createOscillator();
    tickGain = tickCtx.createGain();

    tickOsc.type = "square";
    tickOsc.frequency.value = 1200;
    tickGain.gain.value = 0.0;

    tickOsc.connect(tickGain);
    tickGain.connect(tickCtx.destination);
    tickOsc.start();

    const pulse = () => {
      if (!tickGain) return;
      tickGain.gain.setValueAtTime(0.0, tickCtx.currentTime);
      tickGain.gain.linearRampToValueAtTime(0.02, tickCtx.currentTime + 0.01);
      tickGain.gain.linearRampToValueAtTime(0.0, tickCtx.currentTime + 0.06);
    };

    tickOsc._tickInterval = setInterval(pulse, 1000);
    pulse();
  } catch {
    stopTickSound();
  }
}

function stopTickSound() {
  try {
    if (tickOsc?._tickInterval) clearInterval(tickOsc._tickInterval);
    if (tickOsc) tickOsc.stop();
    tickOsc = null;

    if (tickCtx) tickCtx.close();
    tickCtx = null;

    tickGain = null;
  } catch {}
}

// ===== Helpers =====
function pad(n) {
  return String(n).padStart(2, "0");
}

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${pad(m)}:${pad(s)}`;
}

function setStatus(text) {
  statusText.textContent = text;
}

function setButtonText(text) {
  startLabel.textContent = text;
}

function updateRing() {
  if (!ringFg) return;
  const progress = remainingSeconds / totalSeconds; // 1 -> full, 0 -> empty
  const offset = CIRC * (1 - progress);
  ringFg.style.strokeDashoffset = `${offset}`;
  ringFg.style.stroke = MODES[mode].color;
}

function ringFinishFX() {
  if (ringSvg) {
    ringSvg.classList.remove("finish");
    void ringSvg.offsetWidth;
    ringSvg.classList.add("finish");
    setTimeout(() => ringSvg.classList.remove("finish"), 600);
  }

  if (ringFg) {
    ringFg.classList.remove("finishGlow");
    void ringFg.offsetWidth;
    ringFg.classList.add("finishGlow");
    setTimeout(() => ringFg.classList.remove("finishGlow"), 700);
  }
}

function setMode(nextMode, { keepRunning = false } = {}) {
  mode = nextMode;
  totalSeconds = MODES[mode].minutes * 60;
  remainingSeconds = totalSeconds;

  modeText.textContent = MODES[mode].label;
  timeText.textContent = formatTime(remainingSeconds);

  modeBtns.forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === mode),
  );

  updateRing();

  if (!keepRunning) {
    stopTimer(true);
    setStatus("Ready");
  }
}

function tick() {
  remainingSeconds -= 1;
  if (remainingSeconds < 0) remainingSeconds = 0;

  timeText.textContent = formatTime(remainingSeconds);
  updateRing();

  if (remainingSeconds === 0) {
    onFinish();
  }
}

function startTimer() {
  if (isRunning) return;
  isRunning = true;
  setStatus("Running");
  setButtonText("Pause");

  timerId = window.setInterval(tick, 1000);

  if (settings.tickSound) startTickSound();
}

function stopTimer(silent = false) {
  if (timerId) window.clearInterval(timerId);
  timerId = null;
  isRunning = false;
  setButtonText("Start");
  stopTickSound();
  if (!silent) setStatus("Paused");
}

function resetTimer() {
  stopTimer(true);
  remainingSeconds = totalSeconds;
  timeText.textContent = formatTime(remainingSeconds);
  updateRing();
  setStatus("Ready");
}

// ===== Finish logic (auto-switch) =====
function onFinish() {
  stopTickSound();
  stopTimer(true);

  setStatus("Done ✓");
  tryBeep();
  hapticFeel();
  ringFinishFX();

  if (mode === "focus") {
    sessions += 1;
    sessionCountEl.textContent = String(sessions);
  }

  const next =
    mode === "focus"
      ? sessions % settings.focusBeforeLong === 0
        ? "long"
        : "short"
      : "focus";

  setMode(next, { keepRunning: false });

  if (settings.autoStart) {
    startTimer();
  } else {
    setStatus("Ready");
  }
}

// ===== Effects =====
function tryBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.value = 0.03;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    setTimeout(() => {
      o.stop();
      ctx.close();
    }, 180);
  } catch {}
}

function hapticFeel() {
  if (phone) {
    phone.classList.remove("buzz", "doneGlow");
    void phone.offsetWidth;
    phone.classList.add("buzz", "doneGlow");
    setTimeout(() => phone.classList.remove("buzz", "doneGlow"), 700);
  }
  if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
}

// ===== Settings sheet =====
function openSheet() {
  focusInput.value = settings.focusMin;
  shortInput.value = settings.shortMin;
  longInput.value = settings.longMin;
  autoStartToggle.checked = !!settings.autoStart;
  tickToggle.checked = !!settings.tickSound;

  sheet.hidden = false;
  sheetOverlay.hidden = false;
}

function closeSheet() {
  sheet.hidden = true;
  sheetOverlay.hidden = true;
}

function clampInt(val, min, max) {
  const n = parseInt(val, 10);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function applySettingsFromUI() {
  const next = {
    ...settings,
    focusMin: clampInt(focusInput.value, 1, 180),
    shortMin: clampInt(shortInput.value, 1, 60),
    longMin: clampInt(longInput.value, 1, 120),
    autoStart: !!autoStartToggle.checked,
    tickSound: !!tickToggle.checked,
  };

  settings = next;
  saveSettings(settings);

  if (!settings.tickSound) stopTickSound();

  // Reset current mode with new durations
  setMode(mode);
  closeSheet();
}

// ===== Events =====
modeBtns.forEach((btn) => {
  btn.addEventListener("click", () => setMode(btn.dataset.mode));
});

startBtn.addEventListener("click", () => {
  if (!isRunning) startTimer();
  else stopTimer();
});

resetBtn.addEventListener("click", resetTimer);

// Sheet open/close
settingsBtn.addEventListener("click", openSheet);
closeSheetBtn.addEventListener("click", closeSheet);
sheetOverlay.addEventListener("click", closeSheet);
saveSettingsBtn.addEventListener("click", applySettingsFromUI);

// ===== Init =====
setMode("focus");
sessionCountEl.textContent = String(sessions);
setStatus("Ready");
updateRing();
