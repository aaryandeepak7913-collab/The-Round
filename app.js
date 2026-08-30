"use strict";

/* =========================================================
   INDEXEDDB STORAGE HELPER
   ========================================================= */
const DB_NAME = "rounds-tracker";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readonly");
    const req = tx.objectStore("kv").get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* =========================================================
   AUDIO ENGINE (TRIPLE-STRIKE BOXING BELL)
   ========================================================= */
let audioCtx = null;

function playBoxingBell() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }

  const strikeTimes = [0, 0.25, 0.5]; // 3 rapid bell strikes

  strikeTimes.forEach((delay) => {
    const startTime = audioCtx.currentTime + delay;

    // Fundamental metal tone
    const primaryOsc = audioCtx.createOscillator();
    const primaryGain = audioCtx.createGain();
    primaryOsc.type = "sine";
    primaryOsc.frequency.setValueAtTime(850, startTime);
    primaryOsc.frequency.exponentialRampToValueAtTime(420, startTime + 1.2);

    primaryGain.gain.setValueAtTime(0.7, startTime);
    primaryGain.gain.exponentialRampToValueAtTime(0.001, startTime + 1.2);

    primaryOsc.connect(primaryGain);
    primaryGain.connect(audioCtx.destination);
    primaryOsc.start(startTime);
    primaryOsc.stop(startTime + 1.2);

    // High harmonic ring
    const overtoneOsc = audioCtx.createOscillator();
    const overtoneGain = audioCtx.createGain();
    overtoneOsc.type = "sine";
    overtoneOsc.frequency.setValueAtTime(2150, startTime);
    overtoneOsc.frequency.exponentialRampToValueAtTime(1100, startTime + 0.6);

    overtoneGain.gain.setValueAtTime(0.3, startTime);
    overtoneGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.6);

    overtoneOsc.connect(overtoneGain);
    overtoneGain.connect(audioCtx.destination);
    overtoneOsc.start(startTime);
    overtoneOsc.stop(startTime + 0.6);
  });
}

/* =========================================================
   STATE MANAGEMENT & HELPERS
   ========================================================= */
const state = {
  sessions: {},         // { "YYYY-MM-DD": { entries: [...], notes: "", updatedAt } }
  streak: { current: 0, longest: 0, lastDate: null },
  selectedDate: null,
  calendarMonth: new Date(),
  draftEntries: [],
  voiceReviewDrafts: [],
  timer: {
    status: "stopped",  // "stopped" | "running" | "paused"
    phase: "READY",      // "READY" | "PREP" | "WORK" | "REST"
    currentRound: 1,
    secondsRemaining: 0,
    intervalId: null
  }
};

function todayStr() { return localDateStr(new Date()); }

function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return localDateStr(d);
}

function uid() { return Math.random().toString(36).slice(2, 10); }

/* =========================================================
   PERSISTENCE & STREAK SYSTEM
   ========================================================= */
async function loadSessions() {
  const saved = await idbGet("sessions");
  state.sessions = saved || {};
}

async function saveSessions() {
  await idbSet("sessions", state.sessions);
}

function recomputeStreak() {
  const dates = Object.keys(state.sessions)
    .filter(d => (state.sessions[d].entries || []).length > 0)
    .sort();

  if (dates.length === 0) {
    state.streak = { current: 0, longest: 0, lastDate: null };
    return;
  }

  const dateSet = new Set(dates);
  let longest = 1, run = 1;

  for (let i = 1; i < dates.length; i++) {
    run = addDays(dates[i - 1], 1) === dates[i] ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  let cursor = dateSet.has(todayStr()) ? todayStr() : addDays(todayStr(), -1);
  let current = 0;
  while (dateSet.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  state.streak = { current, longest, lastDate: dates[dates.length - 1] };
}

function isWithinCurrentStreak(dateStr) {
  if (state.streak.current === 0) return false;
  const anchor = (state.sessions[todayStr()]?.entries?.length > 0) ? todayStr() : addDays(todayStr(), -1);
  let cursor = anchor;
  for (let i = 0; i < state.streak.current; i++) {
    if (cursor === dateStr) return true;
    cursor = addDays(cursor, -1);
  }
  return false;
}

function updateStreakUI() {
  document.getElementById("streakCount").textContent = state.streak.current;
  document.getElementById("longestStreakStat").textContent = state.streak.longest;
  const total = Object.values(state.sessions).filter(s => (s.entries || []).length > 0).length;
  document.getElementById("totalSessionsStat").textContent = total;
}

/* =========================================================
   BOXING POMODORO TIMER LOGIC
   ========================================================= */
const timerPanel = document.getElementById("timerPanel");
const timerClock = document.getElementById("timerClock");
const timerPhase = document.getElementById("timerPhase");
const timerRoundInfo = document.getElementById("timerRoundInfo");
const startTimerBtn = document.getElementById("startTimerBtn");
const pauseTimerBtn = document.getElementById("pauseTimerBtn");
const resetTimerBtn = document.getElementById("resetTimerBtn");
const timerExerciseInput = document.getElementById("timerExerciseName");
const timerVoiceMicBtn = document.getElementById("timerVoiceMicBtn");

function getTimerInputs() {
  return {
    exerciseName: timerExerciseInput ? timerExerciseInput.value.trim() : "",
    prepSec: parseInt(document.getElementById("prepTime").value, 10) || 0,
    workSec: (parseFloat(document.getElementById("workTime").value) || 3) * 60,
    restSec: (parseFloat(document.getElementById("restTime").value) || 1) * 60,
    totalRounds: parseInt(document.getElementById("totalRounds").value, 10) || 1
  };
}

// Voice mic helper specifically for naming timer drills
if (timerVoiceMicBtn) {
  timerVoiceMicBtn.addEventListener("click", () => {
    if (!voiceSupported()) { toast("Voice recognition isn't available in this browser."); return; }
    const rec = initRecognizer();
    timerVoiceMicBtn.classList.add("listening");
    toast("Say your planned exercise name...");
    rec.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      if (timerExerciseInput) timerExerciseInput.value = transcript;
      toast(`Exercise set: "${transcript}"`);
    };
    rec.onend = () => timerVoiceMicBtn.classList.remove("listening");
    rec.start();
  });
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function updateTimerDisplay() {
  timerClock.textContent = formatTime(state.timer.secondsRemaining);
  timerPhase.textContent = state.timer.phase;
  const config = getTimerInputs();
  const nameLabel = config.exerciseName ? ` (${config.exerciseName})` : "";
  timerRoundInfo.textContent = `Round ${state.timer.currentRound} / ${config.totalRounds}${nameLabel}`;

  timerPanel.classList.remove("phase-prep", "phase-work", "phase-rest");
  if (state.timer.status !== "stopped") {
    timerPanel.classList.add(`phase-${state.timer.phase.toLowerCase()}`);
  }
}

function startTimer() {
  const config = getTimerInputs();
  if (state.timer.status === "stopped") {
    state.timer.currentRound = 1;
    if (config.prepSec > 0) {
      state.timer.phase = "PREP";
      state.timer.secondsRemaining = config.prepSec;
    } else {
      state.timer.phase = "WORK";
      state.timer.secondsRemaining = config.workSec;
    }
    playBoxingBell();
  }
  
  state.timer.status = "running";
  startTimerBtn.textContent = "RESUME";
  startTimerBtn.disabled = true;
  pauseTimerBtn.disabled = false;

  clearInterval(state.timer.intervalId);
  state.timer.intervalId = setInterval(tickTimer, 1000);
  updateTimerDisplay();
}

function pauseTimer() {
  state.timer.status = "paused";
  clearInterval(state.timer.intervalId);
  startTimerBtn.disabled = false;
  pauseTimerBtn.disabled = true;
}

function resetTimer() {
  clearInterval(state.timer.intervalId);
  state.timer.status = "stopped";
  state.timer.phase = "READY";
  state.timer.currentRound = 1;
  state.timer.secondsRemaining = 0;
  
  startTimerBtn.textContent = "START ROUND";
  startTimerBtn.disabled = false;
  pauseTimerBtn.disabled = false;
  
  updateTimerDisplay();
  timerClock.textContent = "00:00";
}

function tickTimer() {
  if (state.timer.secondsRemaining > 0) {
    state.timer.secondsRemaining--;
    updateTimerDisplay();
    return;
  }

  playBoxingBell();
  const config = getTimerInputs();

  if (state.timer.phase === "PREP") {
    state.timer.phase = "WORK";
    state.timer.secondsRemaining = config.workSec;
  } else if (state.timer.phase === "WORK") {
    if (state.timer.currentRound < config.totalRounds) {
      state.timer.phase = "REST";
      state.timer.secondsRemaining = config.restSec;
    } else {
      resetTimer();
      toast("Session Complete! Great fight!");
      autoLogTimerSession(config);
      return;
    }
  } else if (state.timer.phase === "REST") {
    state.timer.currentRound++;
    state.timer.phase = "WORK";
    state.timer.secondsRemaining = config.workSec;
  }
  updateTimerDisplay();
}

async function autoLogTimerSession(config) {
  const dateStr = todayStr();
  if (state.selectedDate !== dateStr) selectDate(dateStr);
  
  const entry = {
    id: uid(),
    type: "boxing",
    name: config.exerciseName || "Boxing Pomodoro Session",
    rounds: config.totalRounds,
    roundLength: config.workSec / 60
  };

  state.draftEntries.push(entry);
  renderEntriesList();

  // Commit immediately to local storage and update streak
  state.sessions[dateStr] = {
    entries: state.draftEntries,
    notes: document.getElementById("sessionNotes")?.value || "",
    updatedAt: Date.now()
  };

  recomputeStreak();
  await saveSessions();
  updateStreakUI();
  renderCalendar();
  toast(`Auto-logged "${entry.name}" & updated streak! 🔥`);
}

startTimerBtn.addEventListener("click", startTimer);
pauseTimerBtn.addEventListener("click", pauseTimer);
resetTimerBtn.addEventListener("click", resetTimer);

/* =========================================================
   CALENDAR UI
   ========================================================= */
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function renderCalendar() {
  const grid = document.getElementById("calendarGrid");
  const label = document.getElementById("monthLabel");
  const m = state.calendarMonth;
  label.textContent = `${MONTH_NAMES[m.getMonth()]} ${m.getFullYear()}`;
  grid.innerHTML = "";

  const firstOfMonth = new Date(m.getFullYear(), m.getMonth(), 1);
  const startOffset = firstOfMonth.getDay();
  const daysInMonth = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const today = todayStr();

  for (let i = 0; i < startOffset; i++) {
    const filler = document.createElement("div");
    filler.className = "cal-day empty";
    grid.appendChild(filler);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const hasEntry = (state.sessions[dateStr]?.entries?.length || 0) > 0;
    const cell = document.createElement("button");
    cell.className = "cal-day";
    cell.type = "button";
    if (dateStr === today) cell.classList.add("today");
    if (hasEntry) cell.classList.add("has-entry");
    if (dateStr === state.selectedDate) cell.classList.add("selected");
    if (isWithinCurrentStreak(dateStr)) cell.classList.add("streak-day");

    const num = document.createElement("span");
    num.textContent = day;
    cell.appendChild(num);

    if (hasEntry) {
      const dot = document.createElement("span");
      dot.className = "dot";
      cell.appendChild(dot);
    }
    cell.addEventListener("click", () => selectDate(dateStr));
    grid.appendChild(cell);
  }
}

document.getElementById("prevMonth").addEventListener("click", () => {
  state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() - 1, 1);
  renderCalendar();
});
document.getElementById("nextMonth").addEventListener("click", () => {
  state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1, 1);
  renderCalendar();
});

/* =========================================================
   LOG EDITOR & EXERCISE ENTRIES
   ========================================================= */
function formatDateLong(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

function selectDate(dateStr) {
  state.selectedDate = dateStr;
  const session = state.sessions[dateStr];
  state.draftEntries = session ? JSON.parse(JSON.stringify(session.entries || [])) : [];
  renderCalendar();

  document.getElementById("logEmpty").classList.add("hidden");
  document.getElementById("logEditor").classList.remove("hidden");
  document.getElementById("logDateLabel").textContent = formatDateLong(dateStr);
  document.getElementById("sessionNotes").value = session?.notes || "";
  document.getElementById("saveStatus").textContent = "";
  renderEntriesList();
}

function closeLogEditor() {
  state.selectedDate = null;
  state.draftEntries = [];
  document.getElementById("logEditor").classList.add("hidden");
  document.getElementById("logEmpty").classList.remove("hidden");
  renderCalendar();
}

document.getElementById("logTodayBtn").addEventListener("click", () => selectDate(todayStr()));
document.getElementById("closeLogBtn").addEventListener("click", closeLogEditor);

function entrySummaryText(e) {
  if (e.type === "strength") {
    const parts = [];
    if (e.sets) parts.push(`${e.sets}×${e.reps || "?"}`);
    else if (e.reps) parts.push(`${e.reps} reps`);
    if (e.weight) parts.push(`${e.weight}${e.weightUnit || "kg"}`);
    return `${e.name || "Exercise"} — ${parts.join(" @ ") || "logged"}`;
  }
  if (e.type === "cardio") {
    const parts = [];
    if (e.distance) parts.push(`${e.distance}${e.distanceUnit || "km"}`);
    if (e.duration) parts.push(`${e.duration} min`);
    return `${e.name || "Cardio"} — ${parts.join(", ") || "logged"}`;
  }
  if (e.type === "boxing") {
    const parts = [];
    if (e.rounds) parts.push(`${e.rounds} rounds`);
    if (e.roundLength) parts.push(`${e.roundLength} min each`);
    return `${e.name || "Boxing"} — ${parts.join(", ") || "logged"}`;
  }
  return e.name || "Entry";
}

function renderEntriesList() {
  const list = document.getElementById("entriesList");
  list.innerHTML = "";
  state.draftEntries.forEach((e) => {
    const row = document.createElement("div");
    row.className = "entry-row";
    const tag = document.createElement("span");
    tag.className = `entry-tag ${e.type}`;
    tag.textContent = e.type;
    const detail = document.createElement("span");
    detail.className = "entry-detail";
    detail.textContent = entrySummaryText(e);
    const remove = document.createElement("button");
    remove.className = "entry-remove";
    remove.textContent = "✕";
    remove.addEventListener("click", () => {
      state.draftEntries = state.draftEntries.filter((x) => x.id !== e.id);
      renderEntriesList();
    });
    row.append(tag, detail, remove);
    list.appendChild(row);
  });
}

// Form Switcher logic
const typeSelect = document.getElementById("manualType");
typeSelect.addEventListener("change", () => {
  document.getElementById("manualStrengthRow").classList.toggle("hidden", typeSelect.value !== "strength");
  document.getElementById("manualCardioRow").classList.toggle("hidden", typeSelect.value !== "cardio");
  document.getElementById("manualBoxingRow").classList.toggle("hidden", typeSelect.value !== "boxing");
});

document.getElementById("manualAddBtn").addEventListener("click", () => {
  const type = typeSelect.value;
  const name = document.getElementById("manualName").value.trim();
  if (!name) { toast("Give your exercise a name first."); return; }

  const entry = { id: uid(), type, name, note: document.getElementById("manualNote").value.trim() };
  if (type === "strength") {
    entry.sets = Number(document.getElementById("manualSets").value) || null;
    entry.reps = Number(document.getElementById("manualReps").value) || null;
    entry.weight = Number(document.getElementById("manualWeight").value) || null;
    entry.weightUnit = document.getElementById("manualWeightUnit").value;
  } else if (type === "cardio") {
    entry.distance = Number(document.getElementById("manualDistance").value) || null;
    entry.distanceUnit = document.getElementById("manualDistanceUnit").value;
    entry.duration = Number(document.getElementById("manualDuration").value) || null;
  } else if (type === "boxing") {
    entry.rounds = Number(document.getElementById("manualRounds").value) || null;
    entry.roundLength = Number(document.getElementById("manualRoundLength").value) || null;
  }

  state.draftEntries.push(entry);
  renderEntriesList();

  ["manualName","manualSets","manualReps","manualWeight","manualDistance","manualDuration","manualRounds","manualRoundLength","manualNote"]
    .forEach((id) => { document.getElementById(id).value = ""; });
});

document.getElementById("saveLogBtn").addEventListener("click", async () => {
  if (!state.selectedDate) return;
  const notes = document.getElementById("sessionNotes").value;
  if (state.draftEntries.length === 0 && notes.trim() === "") {
    delete state.sessions[state.selectedDate];
  } else {
    state.sessions[state.selectedDate] = {
      entries: state.draftEntries,
      notes,
      updatedAt: Date.now(),
    };
  }
  recomputeStreak();
  await saveSessions();
  updateStreakUI();
  renderCalendar();
  document.getElementById("saveStatus").textContent =
    "Saved " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
});

/* =========================================================
   VOICE PARSER & HANDLERS
   ========================================================= */
const BOXING_WORDS = ["spar","sparring","pads","pad work","bag work","heavy bag","shadow box","shadow boxing","roadwork","skipping","jump rope","mitts","drill"];
const CARDIO_WORDS = ["run","ran","running","jog","jogging","cycle","cycling","bike","biking","swim","swimming","row","rowing","walk","walking"];

function parseWorkoutPhrase(text) {
  const original = text.trim();
  let t = " " + original.toLowerCase() + " ";

  const entry = { id: uid(), type: "strength", name: null, note: null, transcript: original };

  let m = t.match(/(\d+(?:\.\d+)?)\s*(kg|kilo|kilos|kilogram|kilograms)\b/);
  if (m) { entry.weight = parseFloat(m[1]); entry.weightUnit = "kg"; t = t.replace(m[0], " "); }
  else {
    m = t.match(/(\d+(?:\.\d+)?)\s*(lb|lbs|pound|pounds)\b/);
    if (m) { entry.weight = parseFloat(m[1]); entry.weightUnit = "lb"; t = t.replace(m[0], " "); }
  }

  m = t.match(/(\d+)\s*(?:x|sets?\s*(?:of)?)\s*(\d+)\s*(?:reps?)?/);
  if (m) { entry.sets = parseInt(m[1]); entry.reps = parseInt(m[2]); t = t.replace(m[0], " "); }
  else {
    m = t.match(/(\d+)\s*sets?\b/);
    if (m) { entry.sets = parseInt(m[1]); t = t.replace(m[0], " "); }
    m = t.match(/(\d+)\s*reps?\b/);
    if (m) { entry.reps = parseInt(m[1]); t = t.replace(m[0], " "); }
  }

  m = t.match(/(\d+)\s*rounds?\b/);
  if (m) { entry.rounds = parseInt(m[1]); t = t.replace(m[0], " "); }

  m = t.match(/(\d+(?:\.\d+)?)\s*k(?:m|ilometers?)?\b/);
  if (m) { entry.distance = parseFloat(m[1]); entry.distanceUnit = "km"; t = t.replace(m[0], " "); }

  m = t.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?)\b/);
  if (m) { entry.duration = parseFloat(m[1]); t = t.replace(m[0], " "); }

  const lower = original.toLowerCase();
  if (BOXING_WORDS.some((w) => lower.includes(w))) entry.type = "boxing";
  else if (CARDIO_WORDS.some((w) => lower.includes(w)) || entry.distance) entry.type = "cardio";
  else if (entry.rounds) entry.type = "boxing";

  let name = t.replace(/\b(at|of|for|and|then|a|an|the|with|did|do|done)\b/g, " ")
               .replace(/\d+/g, " ")
               .replace(/\s+/g, " ")
               .trim();
  entry.name = name ? name.replace(/\b\w/g, (c) => c.toUpperCase()) : (entry.type === "boxing" ? "Boxing" : "Exercise");

  return entry;
}

function splitIntoPhrases(text) {
  return text.split(/\b(?:then|and then|,)\b/i).map((s) => s.trim()).filter((s) => s.length > 2);
}

const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;
let voiceMode = null; 

function voiceSupported() { return !!SpeechRecognitionAPI; }

function initRecognizer() {
  if (!voiceSupported()) return null;
  const r = new SpeechRecognitionAPI();
  r.lang = "en-US";
  r.interimResults = true;
  r.maxAlternatives = 1;
  return r;
}

function startSummaryMode() {
  if (!voiceSupported()) { toast("Voice recognition isn't available in this browser."); return; }
  recognizer = initRecognizer();
  recognizer.continuous = false;
  voiceMode = "summary";
  const btn = document.getElementById("voiceSummaryBtn");
  btn.classList.add("listening");
  document.getElementById("voiceStatus").textContent = "Listening… say your full workout, then pause.";

  recognizer.onresult = (event) => {
    const transcript = Array.from(event.results).map((r) => r[0].transcript).join(" ");
    if (event.results[event.results.length - 1].isFinal) {
      const phrases = splitIntoPhrases(transcript);
      state.voiceReviewDrafts = phrases.map(parseWorkoutPhrase);
      openVoiceReview();
    }
  };
  recognizer.onerror = () => toast("Didn't catch that — try again.");
  recognizer.onend = () => { btn.classList.remove("listening"); document.getElementById("voiceStatus").textContent = ""; };
  recognizer.start();
}

function startLiveMode() {
  if (!voiceSupported()) { toast("Voice recognition isn't available in this browser."); return; }
  if (voiceMode === "live") {
    if (recognizer) recognizer.stop();
    document.getElementById("voiceLiveBtn").classList.remove("listening");
    voiceMode = null;
    return;
  }
  recognizer = initRecognizer();
  recognizer.continuous = true;
  voiceMode = "live";
  const btn = document.getElementById("voiceLiveBtn");
  btn.classList.add("listening");
  document.getElementById("voiceStatus").textContent = "Listening — speak each set as you complete it.";

  let finalizedUpTo = 0;
  recognizer.onresult = (event) => {
    for (let i = finalizedUpTo; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        const phrase = event.results[i][0].transcript.trim();
        if (phrase.length > 2) {
          const parsed = parseWorkoutPhrase(phrase);
          state.draftEntries.push(parsed);
          renderEntriesList();
        }
        finalizedUpTo = i + 1;
      }
    }
  };
  recognizer.start();
}

document.getElementById("voiceSummaryBtn").addEventListener("click", startSummaryMode);
document.getElementById("voiceLiveBtn").addEventListener("click", startLiveMode);

document.getElementById("voiceQuickBtn").addEventListener("click", () => {
  selectDate(todayStr());
  startSummaryMode();
});

/* Voice Review Modal Logic */
function openVoiceReview() {
  const list = document.getElementById("voiceReviewList");
  list.innerHTML = "";
  state.voiceReviewDrafts.forEach((e) => {
    const card = document.createElement("div");
    card.className = "voice-review-item";
    card.innerHTML = `<div style="font-size:0.85rem; font-style:italic;">"${e.transcript}"</div>`;
    list.appendChild(card);
  });
  document.getElementById("voiceReview").classList.remove("hidden");
}

document.getElementById("closeVoiceReviewBtn").addEventListener("click", () => {
  document.getElementById("voiceReview").classList.add("hidden");
});

document.getElementById("confirmVoiceEntriesBtn").addEventListener("click", () => {
  if (!state.selectedDate) selectDate(todayStr());
  state.draftEntries.push(...state.voiceReviewDrafts);
  renderEntriesList();
  document.getElementById("voiceReview").classList.add("hidden");
  toast("Voice entries added!");
});

/* =========================================================
   SETTINGS & INITIALIZATION
   ========================================================= */
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2600);
}

document.getElementById("settingsBtn").addEventListener("click", () => {
  document.getElementById("settingsDrawer").classList.remove("hidden");
  document.getElementById("voiceSupportStatus").textContent = voiceSupported()
    ? "Supported" : "Not supported in this browser.";
});
document.getElementById("closeSettingsBtn").addEventListener("click", () => {
  document.getElementById("settingsDrawer").classList.add("hidden");
});
document.getElementById("wipeDataBtn").addEventListener("click", async () => {
  if (!confirm("Wipe all app data?")) return;
  await idbDelete("sessions");
  location.reload();
});

(async function boot() {
  await loadSessions();
  recomputeStreak();
  renderCalendar();
  updateStreakUI();
})();
