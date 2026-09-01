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
   AUDIO ENGINE — TRIPLE-STRIKE BOXING BELL
   ========================================================= */
let audioCtx = null;

function playBoxingBell() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();

  const strikeTimes = [0, 0.25, 0.5];
  strikeTimes.forEach((delay) => {
    const startTime = audioCtx.currentTime + delay;

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
   STATE
   ========================================================= */
const state = {
  sessions: {},
  streak: { current: 0, longest: 0, lastDate: null },
  selectedDate: null,
  calendarMonth: new Date(),
  draftEntries: [],
  voiceReviewDrafts: [],
  editingEntryId: null,
  presets: [],
  weighIns: [],
  competition: null,
  geminiApiKey: null,
  timer: {
    status: "stopped",
    phase: "READY",
    currentRound: 1,
    secondsRemaining: 0,
    intervalId: null,
  },
};

function todayStr() { return localDateStr(new Date()); }
function localDateStr(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return localDateStr(d);
}
function uid() { return Math.random().toString(36).slice(2, 10); }

/* =========================================================
   PERSISTENCE & STREAKS
   ========================================================= */
async function loadSessions() {
  const saved = await idbGet("sessions");
  state.sessions = saved || {};
}
async function saveSessions() { await idbSet("sessions", state.sessions); }

function recomputeStreak() {
  const dates = Object.keys(state.sessions).filter((d) => (state.sessions[d].entries || []).length > 0).sort();
  if (dates.length === 0) { state.streak = { current: 0, longest: 0, lastDate: null }; return; }
  const dateSet = new Set(dates);
  let longest = 1, run = 1;
  for (let i = 1; i < dates.length; i++) {
    run = addDays(dates[i - 1], 1) === dates[i] ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  let cursor = dateSet.has(todayStr()) ? todayStr() : addDays(todayStr(), -1);
  let current = 0;
  while (dateSet.has(cursor)) { current++; cursor = addDays(cursor, -1); }
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
  document.getElementById("currentStreakStat").textContent = state.streak.current;
  document.getElementById("longestStreakStat").textContent = state.streak.longest;
  const total = Object.values(state.sessions).filter((s) => (s.entries || []).length > 0).length;
  document.getElementById("totalSessionsStat").textContent = total;
}

/* =========================================================
   TOAST
   ========================================================= */
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2600);
}

// Safe listener attachment: if index.html and app.js ever fall out of sync
// (e.g. only one file gets updated during a deploy), a missing element here
// is skipped instead of throwing and silently killing the rest of the script.
function on(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
  else console.warn(`Rounds: expected element #${id} but it wasn't found in the page — that feature is disabled until index.html and app.js match.`);
}

/* =========================================================
   ROUND TIMER
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
  const nameInput = timerExerciseInput ? timerExerciseInput.value.trim() : "";
  return {
    exerciseName: nameInput !== "" ? nameInput : "Boxing session",
    prepSec: parseInt(document.getElementById("prepTime").value, 10) || 0,
    workSec: (parseFloat(document.getElementById("workTime").value) || 3) * 60,
    restSec: (parseFloat(document.getElementById("restTime").value) || 1) * 60,
    totalRounds: parseInt(document.getElementById("totalRounds").value, 10) || 1,
  };
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function updateTimerDisplay() {
  timerClock.textContent = formatTime(state.timer.secondsRemaining);
  timerPhase.textContent = state.timer.phase;
  const config = getTimerInputs();
  timerRoundInfo.textContent = `Round ${state.timer.currentRound} / ${config.totalRounds} — ${config.exerciseName}`;

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
  pauseTimerBtn.disabled = true;
  timerPanel.classList.remove("phase-prep", "phase-work", "phase-rest");
  timerPhase.textContent = "READY";
  timerClock.textContent = "00:00";
  const config = getTimerInputs();
  timerRoundInfo.textContent = `Round 1 / ${config.totalRounds}`;
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
      toast("Session complete — logged to today's round. 🔔");
      autoLogTimerSession(config);
      resetTimer();
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
  const wasClosed = document.getElementById("logEditor").classList.contains("hidden");
  if (state.selectedDate !== dateStr) selectDate(dateStr);

  const entry = {
    id: uid(),
    type: "boxing",
    name: config.exerciseName,
    rounds: config.totalRounds,
    roundLength: config.workSec / 60,
  };
  state.draftEntries.push(entry);
  renderEntriesList();

  state.sessions[dateStr] = {
    entries: state.draftEntries,
    notes: document.getElementById("sessionNotes")?.value || "",
    updatedAt: Date.now(),
  };

  recomputeStreak();
  await saveSessions();
  updateStreakUI();
  renderCalendar();

  // If the log panel was closed before the timer finished, close it again so we don't
  // yank the person into an editor they didn't open — the toast already told them it saved.
  if (wasClosed) closeLogEditor();
}

if (timerVoiceMicBtn) {
  timerVoiceMicBtn.addEventListener("click", () => {
    if (!voiceSupported()) { toast("Voice recognition isn't available in this browser."); return; }
    const rec = initRecognizer();
    rec.continuous = false;
    timerVoiceMicBtn.classList.add("listening");
    toast("Say the exercise name…");
    rec.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      if (timerExerciseInput) timerExerciseInput.value = transcript;
    };
    rec.onerror = () => toast("Didn't catch that.");
    rec.onend = () => timerVoiceMicBtn.classList.remove("listening");
    rec.start();
  });
}

startTimerBtn.addEventListener("click", startTimer);
pauseTimerBtn.addEventListener("click", pauseTimer);
resetTimerBtn.addEventListener("click", resetTimer);

/* =========================================================
   CALENDAR
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

on("prevMonth", "click", () => {
  state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() - 1, 1);
  renderCalendar();
});
on("nextMonth", "click", () => {
  state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1, 1);
  renderCalendar();
});

/* =========================================================
   LOG EDITOR
   ========================================================= */
function formatDateLong(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

function selectDate(dateStr) {
  state.selectedDate = dateStr;
  const session = state.sessions[dateStr];
  state.draftEntries = session ? JSON.parse(JSON.stringify(session.entries || [])) : [];
  cancelEditEntry();
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
  cancelEditEntry();
  document.getElementById("logEditor").classList.add("hidden");
  document.getElementById("logEmpty").classList.remove("hidden");
  renderCalendar();
}

on("logTodayBtn", "click", () => selectDate(todayStr()));
on("closeLogBtn", "click", closeLogEditor);

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
  if (e.type === "custom") {
    const parts = [];
    if (e.sets || e.reps) parts.push(`${e.sets || "?"}×${e.reps || "?"}`);
    if (e.duration) parts.push(`${e.duration} min`);
    if (e.distance) parts.push(`${e.distance}${e.distanceUnit || ""}`);
    if (e.note && parts.length === 0) parts.push(e.note);
    return `${e.name || "Entry"} — ${parts.join(", ") || "logged"}`;
  }
  return e.name || "Entry";
}

function renderEntriesList() {
  const list = document.getElementById("entriesList");
  list.innerHTML = "";
  state.draftEntries.forEach((e) => {
    const row = document.createElement("div");
    row.className = `entry-row ${e.type}`;
    const tag = document.createElement("span");
    tag.className = `entry-tag ${e.type}`;
    tag.textContent = e.type;
    const detail = document.createElement("span");
    detail.className = "entry-detail";
    detail.textContent = entrySummaryText(e);
    const edit = document.createElement("button");
    edit.className = "entry-remove";
    edit.textContent = "✎";
    edit.title = "Edit this entry";
    edit.addEventListener("click", () => startEditEntry(e));
    const remove = document.createElement("button");
    remove.className = "entry-remove";
    remove.textContent = "✕";
    remove.addEventListener("click", () => {
      state.draftEntries = state.draftEntries.filter((x) => x.id !== e.id);
      if (state.editingEntryId === e.id) cancelEditEntry();
      renderEntriesList();
    });
    row.append(tag, detail, edit, remove);
    list.appendChild(row);
  });
}

/* ---- editable entries: reuse the manual-add form as an edit form ---- */
function startEditEntry(e) {
  state.editingEntryId = e.id;
  typeSelect.value = e.type;
  typeSelect.dispatchEvent(new Event("change"));
  document.getElementById("manualName").value = e.name || "";
  document.getElementById("manualNote").value = e.note || "";
  if (e.type === "strength") {
    document.getElementById("manualSets").value = e.sets ?? "";
    document.getElementById("manualReps").value = e.reps ?? "";
    document.getElementById("manualWeight").value = e.weight ?? "";
    document.getElementById("manualWeightUnit").value = e.weightUnit || "kg";
  } else if (e.type === "cardio") {
    document.getElementById("manualDistance").value = e.distance ?? "";
    document.getElementById("manualDistanceUnit").value = e.distanceUnit || "km";
    document.getElementById("manualDuration").value = e.duration ?? "";
  } else if (e.type === "boxing") {
    document.getElementById("manualRounds").value = e.rounds ?? "";
    document.getElementById("manualRoundLength").value = e.roundLength ?? "";
  } else if (e.type === "custom") {
    const useSR = e.sets != null || e.reps != null;
    const useDur = e.duration != null;
    const useDist = e.distance != null;
    document.getElementById("customUseSetsReps").checked = useSR;
    document.getElementById("customUseDuration").checked = useDur;
    document.getElementById("customUseDistance").checked = useDist;
    document.getElementById("manualCustomSetsRepsRow").classList.toggle("hidden", !useSR);
    document.getElementById("manualCustomDurationRow").classList.toggle("hidden", !useDur);
    document.getElementById("manualCustomDistanceRow").classList.toggle("hidden", !useDist);
    document.getElementById("customSets").value = e.sets ?? "";
    document.getElementById("customReps").value = e.reps ?? "";
    document.getElementById("customDuration").value = e.duration ?? "";
    document.getElementById("customDistance").value = e.distance ?? "";
    document.getElementById("customDistanceUnit").value = e.distanceUnit || "km";
  }
  document.getElementById("manualAddBtn").textContent = "Update entry";
  document.getElementById("cancelEditBtn").classList.remove("hidden");
  document.getElementById("manualName").scrollIntoView({ behavior: "smooth", block: "center" });
}

function cancelEditEntry() {
  state.editingEntryId = null;
  document.getElementById("manualAddBtn").textContent = "Add entry";
  document.getElementById("cancelEditBtn").classList.add("hidden");
  ["manualName","manualSets","manualReps","manualWeight","manualDistance","manualDuration","manualRounds","manualRoundLength","manualNote","customSets","customReps","customDuration","customDistance"]
    .forEach((id) => { const el = document.getElementById(id); if (el) el.value = ""; });
  ["customUseSetsReps","customUseDuration","customUseDistance"].forEach((id) => { const el = document.getElementById(id); if (el) el.checked = false; });
  document.getElementById("manualCustomSetsRepsRow")?.classList.add("hidden");
  document.getElementById("manualCustomDurationRow")?.classList.add("hidden");
  document.getElementById("manualCustomDistanceRow")?.classList.add("hidden");
}
on("cancelEditBtn", "click", cancelEditEntry);

const typeSelect = document.getElementById("manualType");
if (typeSelect) {
  typeSelect.addEventListener("change", () => {
    document.getElementById("manualStrengthRow").classList.toggle("hidden", typeSelect.value !== "strength");
    document.getElementById("manualCardioRow").classList.toggle("hidden", typeSelect.value !== "cardio");
    document.getElementById("manualBoxingRow").classList.toggle("hidden", typeSelect.value !== "boxing");
    document.getElementById("manualCustomRow").classList.toggle("hidden", typeSelect.value !== "custom");
    if (typeSelect.value !== "custom") {
      document.getElementById("manualCustomSetsRepsRow")?.classList.add("hidden");
      document.getElementById("manualCustomDurationRow")?.classList.add("hidden");
      document.getElementById("manualCustomDistanceRow")?.classList.add("hidden");
    }
  });
}

["customUseSetsReps","customUseDuration","customUseDistance"].forEach((id) => {
  const checkbox = document.getElementById(id);
  if (!checkbox) return;
  checkbox.addEventListener("change", () => {
    const rowMap = { customUseSetsReps: "manualCustomSetsRepsRow", customUseDuration: "manualCustomDurationRow", customUseDistance: "manualCustomDistanceRow" };
    document.getElementById(rowMap[id]).classList.toggle("hidden", !checkbox.checked);
  });
});

on("manualAddBtn", "click", () => {
  const type = typeSelect.value;
  const name = document.getElementById("manualName").value.trim();
  if (!name) { toast("Give it a name first."); return; }

  const entry = { id: state.editingEntryId || uid(), type, name, note: document.getElementById("manualNote").value.trim() };
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
  } else if (type === "custom") {
    if (document.getElementById("customUseSetsReps").checked) {
      entry.sets = Number(document.getElementById("customSets").value) || null;
      entry.reps = Number(document.getElementById("customReps").value) || null;
    }
    if (document.getElementById("customUseDuration").checked) {
      entry.duration = Number(document.getElementById("customDuration").value) || null;
    }
    if (document.getElementById("customUseDistance").checked) {
      entry.distance = Number(document.getElementById("customDistance").value) || null;
      entry.distanceUnit = document.getElementById("customDistanceUnit").value;
    }
  }

  if (state.editingEntryId) {
    const idx = state.draftEntries.findIndex((x) => x.id === state.editingEntryId);
    if (idx !== -1) state.draftEntries[idx] = entry;
    cancelEditEntry();
  } else {
    state.draftEntries.push(entry);
  }
  renderEntriesList();
  ["manualName","manualSets","manualReps","manualWeight","manualDistance","manualDuration","manualRounds","manualRoundLength","manualNote","customSets","customReps","customDuration","customDistance"]
    .forEach((id) => { const el = document.getElementById(id); if (el) el.value = ""; });
});

on("saveLogBtn", "click", async () => {
  if (!state.selectedDate) return;
  const notes = document.getElementById("sessionNotes").value;
  if (state.draftEntries.length === 0 && notes.trim() === "") {
    delete state.sessions[state.selectedDate];
  } else {
    state.sessions[state.selectedDate] = { entries: state.draftEntries, notes, updatedAt: Date.now() };
  }
  recomputeStreak();
  await saveSessions();
  updateStreakUI();
  renderCalendar();
  document.getElementById("saveStatus").textContent =
    "Saved " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
});

/* =========================================================
   VOICE PARSING
   ========================================================= */
const BOXING_WORDS = ["spar","sparring","pads","pad work","bag work","heavy bag","shadow box","shadow boxing","roadwork","road work","skip","skipping","jump rope","mitts","drill","drills","speedbag","speed bag"];
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

  // "reps" gets misheard often (rebs/raps/wraps/repps) — accept those as the same word.
  // Longer/more specific variants must come first, or "repps" partially matches "reps?" and leaves "ps" behind.
  const REPS_WORD = "(?:repps?|wraps?|rebs?|raps?|reps?)";
  m = t.match(new RegExp(`(\\d+)\\s*(?:x|sets?\\s*(?:of)?)\\s*(\\d+)\\s*(?:${REPS_WORD}\\b)?`));
  if (m) { entry.sets = parseInt(m[1]); entry.reps = parseInt(m[2]); t = t.replace(m[0], " "); }
  else {
    m = t.match(/(\d+)\s*sets?\b/);
    if (m) { entry.sets = parseInt(m[1]); t = t.replace(m[0], " "); }
    m = t.match(new RegExp(`(\\d+)\\s*${REPS_WORD}\\b`));
    if (m) { entry.reps = parseInt(m[1]); t = t.replace(m[0], " "); }
  }

  m = t.match(/(\d+)\s*rounds?\b/);
  if (m) { entry.rounds = parseInt(m[1]); t = t.replace(m[0], " "); }
  m = t.match(/(\d+(?:\.\d+)?)\s*min(?:ute)?s?\s*(?:round|rounds|each)/);
  if (m) { entry.roundLength = parseFloat(m[1]); t = t.replace(m[0], " "); }

  m = t.match(/(\d+(?:\.\d+)?)\s*k(?:m|ilometers?)?\b/);
  if (m) { entry.distance = parseFloat(m[1]); entry.distanceUnit = "km"; t = t.replace(m[0], " "); }
  else {
    m = t.match(/(\d+(?:\.\d+)?)\s*mi(?:les?)?\b/);
    if (m) { entry.distance = parseFloat(m[1]); entry.distanceUnit = "mi"; t = t.replace(m[0], " "); }
  }

  m = t.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?)\b/);
  if (m) { entry.duration = parseFloat(m[1]); t = t.replace(m[0], " "); }

  const lower = original.toLowerCase();
  if (BOXING_WORDS.some((w) => lower.includes(w))) entry.type = "boxing";
  else if (CARDIO_WORDS.some((w) => lower.includes(w)) || entry.distance) entry.type = "cardio";
  else if (entry.rounds || entry.roundLength) entry.type = "boxing";
  else entry.type = "strength";

  let name = t.replace(/\b(at|of|for|and|then|a|an|the|with|did|do|done)\b/g, " ").replace(/\d+/g, " ").replace(/\s+/g, " ").trim();
  entry.name = name ? name.replace(/\b\w/g, (c) => c.toUpperCase()) : (entry.type === "boxing" ? "Boxing" : entry.type === "cardio" ? "Cardio" : "Exercise");
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
function setVoiceStatus(text) { document.getElementById("voiceStatus").textContent = text; }

/* ---- Gemini-powered parsing (optional — falls back to local regex parsing) ---- */
// Model names on Google's side change often; if this stops working, swap the string below
// for whatever current fast/free model Google's docs list at ai.google.dev/api.
const GEMINI_MODEL = "gemini-2.5-flash";

async function loadGeminiKey() {
  state.geminiApiKey = await idbGet("geminiApiKey");
}

async function parseWithGemini(fullTranscript) {
  const prompt = `You are extracting structured workout data from a spoken training log. The person spoke this entire session in one go, describing multiple exercises back to back.

Transcript: "${fullTranscript}"

Split it into separate exercises/activities. For each one, classify it as exactly one of: "boxing", "strength", "cardio". Extract whatever numeric details were mentioned.

Respond with ONLY a raw JSON array (no markdown fences, no explanation, no surrounding text), where each item has this shape — omit any field that wasn't mentioned:
[{"type":"strength"|"cardio"|"boxing","name":"string","sets":number,"reps":number,"weight":number,"weightUnit":"kg"|"lb","distance":number,"distanceUnit":"km"|"mi","duration":number,"rounds":number,"roundLength":number}]`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": state.geminiApiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  );
  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
  const data = await res.json();
  let text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  text = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error("Gemini didn't return a list");

  return parsed.map((item) => ({
    id: uid(),
    type: ["boxing", "strength", "cardio"].includes(item.type) ? item.type : "strength",
    name: item.name || null,
    note: null,
    sets: item.sets ?? null,
    reps: item.reps ?? null,
    weight: item.weight ?? null,
    weightUnit: item.weightUnit || "kg",
    distance: item.distance ?? null,
    distanceUnit: item.distanceUnit || "km",
    duration: item.duration ?? null,
    rounds: item.rounds ?? null,
    roundLength: item.roundLength ?? null,
    transcript: fullTranscript,
  }));
}

/* ---- Continuous one-shot dictation: keeps listening across pauses until the
   person taps stop, instead of cutting off after the first silence. ---- */
let summaryTranscriptParts = [];

function startSummaryMode() {
  if (!voiceSupported()) { toast("Voice recognition isn't available in this browser."); return; }
  if (voiceMode === "summary") { stopSummaryMode(); return; }

  recognizer = initRecognizer();
  recognizer.continuous = true;
  voiceMode = "summary";
  summaryTranscriptParts = [];
  const btn = document.getElementById("voiceSummaryBtn");
  btn.classList.add("listening");
  btn.innerHTML = '<span class="mic-dot"></span> Stop &amp; parse';
  setVoiceStatus("Recording your whole session — talk through every exercise, then tap Stop & parse.");

  let finalizedUpTo = 0;
  recognizer.onresult = (event) => {
    for (let i = finalizedUpTo; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        summaryTranscriptParts.push(event.results[i][0].transcript.trim());
        finalizedUpTo = i + 1;
      }
    }
  };
  recognizer.onerror = (e) => { if (e.error !== "no-speech") toast("Voice recognition hiccuped."); };
  recognizer.onend = () => { if (voiceMode === "summary") { try { recognizer.start(); } catch {} } };
  recognizer.start();
}

async function stopSummaryMode() {
  if (recognizer) { try { recognizer.stop(); } catch {} }
  voiceMode = null;
  const btn = document.getElementById("voiceSummaryBtn");
  btn.classList.remove("listening");
  btn.innerHTML = '<span class="mic-dot"></span> Record whole session';

  const fullTranscript = summaryTranscriptParts.join(" ").trim();
  if (!fullTranscript) { setVoiceStatus(""); return; }

  const sourceLabel = document.getElementById("voiceReviewSource");
  if (state.geminiApiKey) {
    setVoiceStatus("Parsing with Gemini…");
    try {
      state.voiceReviewDrafts = await parseWithGemini(fullTranscript);
      if (sourceLabel) sourceLabel.textContent = "Parsed with Gemini — check these before saving, then tap any field to fix it.";
      openVoiceReview();
      setVoiceStatus("");
      return;
    } catch (err) {
      console.error(err);
      toast("Gemini parsing failed — falling back to local parsing.");
    }
  }
  const phrases = splitIntoPhrases(fullTranscript);
  state.voiceReviewDrafts = phrases.map(parseWorkoutPhrase);
  if (sourceLabel) sourceLabel.textContent = "Check these before saving — voice parsing isn't perfect. Tap any field to fix it.";
  openVoiceReview();
  setVoiceStatus("");
}

function stopLiveMode() {
  if (recognizer) { try { recognizer.stop(); } catch {} }
  document.getElementById("voiceLiveBtn").classList.remove("listening");
  document.getElementById("voiceLiveBtn").innerHTML = '<span class="mic-dot"></span> Log live';
  setVoiceStatus("");
  voiceMode = null;
}

function startLiveMode() {
  if (!voiceSupported()) { toast("Voice recognition isn't available in this browser."); return; }
  if (voiceMode === "live") { stopLiveMode(); return; }
  recognizer = initRecognizer();
  recognizer.continuous = true;
  voiceMode = "live";
  const btn = document.getElementById("voiceLiveBtn");
  btn.classList.add("listening");
  btn.innerHTML = '<span class="mic-dot"></span> Stop';
  setVoiceStatus("Listening — speak each set as you finish it.");

  let finalizedUpTo = 0;
  recognizer.onresult = (event) => {
    for (let i = finalizedUpTo; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        const phrase = event.results[i][0].transcript.trim();
        if (phrase.length > 2) {
          const parsed = parseWorkoutPhrase(phrase);
          state.draftEntries.push(parsed);
          renderEntriesList();
          setVoiceStatus(`Added: ${entrySummaryText(parsed)}`);
        }
        finalizedUpTo = i + 1;
      }
    }
  };
  recognizer.onerror = (e) => { if (e.error !== "no-speech") toast("Voice recognition hiccuped."); };
  recognizer.onend = () => { if (voiceMode === "live") { try { recognizer.start(); } catch {} } };
  recognizer.start();
}

on("voiceSummaryBtn", "click", startSummaryMode);
on("voiceLiveBtn", "click", startLiveMode);

function quickVoiceLog() {
  selectDate(todayStr());
  startSummaryMode();
}
on("voiceQuickBtn", "click", quickVoiceLog);
on("voiceQuickBtnInline", "click", quickVoiceLog);

/* ---- voice review modal — fully editable before anything saves ---- */
function openVoiceReview() {
  const list = document.getElementById("voiceReviewList");
  list.innerHTML = "";
  state.voiceReviewDrafts.forEach((e) => {
    const card = document.createElement("div");
    card.className = "voice-review-item";

    const transcript = document.createElement("div");
    transcript.className = "vr-transcript";
    transcript.textContent = `"${e.transcript}"`;

    const fields = document.createElement("div");
    fields.className = "vr-fields";

    const typeSel = document.createElement("select");
    ["strength","cardio","boxing","custom"].forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t; opt.textContent = t;
      if (t === e.type) opt.selected = true;
      typeSel.appendChild(opt);
    });
    typeSel.addEventListener("change", () => { e.type = typeSel.value; });

    const nameInput = document.createElement("input");
    nameInput.type = "text"; nameInput.value = e.name || "";
    nameInput.addEventListener("input", () => { e.name = nameInput.value; });
    fields.append(typeSel, nameInput);

    const addNumField = (key, placeholder) => {
      const input = document.createElement("input");
      input.type = "number"; input.placeholder = placeholder; input.value = e[key] ?? "";
      input.addEventListener("input", () => { e[key] = Number(input.value) || null; });
      fields.appendChild(input);
    };
    if (e.sets != null || e.reps != null) { addNumField("sets", "Sets"); addNumField("reps", "Reps"); }
    if (e.weight != null) addNumField("weight", "Weight");
    if (e.distance != null) addNumField("distance", "Distance");
    if (e.duration != null) addNumField("duration", "Minutes");
    if (e.rounds != null) addNumField("rounds", "Rounds");
    if (e.roundLength != null) addNumField("roundLength", "Min/round");

    card.append(transcript, fields);
    list.appendChild(card);
  });
  document.getElementById("voiceReview").classList.remove("hidden");
}

on("closeVoiceReviewBtn", "click", () => {
  document.getElementById("voiceReview").classList.add("hidden");
  state.voiceReviewDrafts = [];
});

on("confirmVoiceEntriesBtn", "click", async () => {
  if (!state.selectedDate) selectDate(todayStr());
  state.draftEntries.push(...state.voiceReviewDrafts);
  renderEntriesList();
  document.getElementById("voiceReview").classList.add("hidden");
  state.voiceReviewDrafts = [];

  // Persist immediately so a quick voice log (from the header mic) sticks even if
  // the person doesn't open the log panel and tap "Save round" themselves.
  const notes = document.getElementById("sessionNotes")?.value || "";
  state.sessions[state.selectedDate] = { entries: state.draftEntries, notes, updatedAt: Date.now() };
  recomputeStreak();
  await saveSessions();
  updateStreakUI();
  renderCalendar();
  toast("Added and saved.");
});

/* =========================================================
   COMPETITION COUNTDOWN
   ========================================================= */
async function loadCompetition() {
  state.competition = await idbGet("competition");
}
async function saveCompetition() { await idbSet("competition", state.competition); }

function renderCountdown() {
  const numEl = document.getElementById("countdownNum");
  const nameEl = document.getElementById("countdownName");
  if (!state.competition || !state.competition.date) {
    numEl.textContent = "—";
    nameEl.textContent = "no competition set";
    return;
  }
  const today = new Date(todayStr() + "T00:00:00");
  const target = new Date(state.competition.date + "T00:00:00");
  const diffDays = Math.ceil((target - today) / 86400000);
  numEl.textContent = diffDays >= 0 ? diffDays : "0";
  nameEl.textContent = diffDays >= 0
    ? (state.competition.name || "competition")
    : `${state.competition.name || "competition"} has passed`;
}

on("editCountdownBtn", "click", () => {
  const editPanel = document.getElementById("countdownEdit");
  editPanel.classList.toggle("hidden");
  document.getElementById("countdownNameInput").value = state.competition?.name || "CBSE South Zone";
  document.getElementById("countdownDateInput").value = state.competition?.date || "";
});
on("saveCountdownBtn", "click", async () => {
  const name = document.getElementById("countdownNameInput").value.trim() || "CBSE South Zone";
  const date = document.getElementById("countdownDateInput").value;
  if (!date) { toast("Pick a date first."); return; }
  state.competition = { name, date };
  await saveCompetition();
  renderCountdown();
  document.getElementById("countdownEdit").classList.add("hidden");
});
on("clearCountdownBtn", "click", async () => {
  state.competition = null;
  await saveCompetition();
  renderCountdown();
  document.getElementById("countdownEdit").classList.add("hidden");
});

/* =========================================================
   ROUND PRESETS
   ========================================================= */
async function loadPresets() {
  state.presets = (await idbGet("presets")) || [];
}
async function savePresets() { await idbSet("presets", state.presets); }

function renderPresets() {
  const select = document.getElementById("presetSelect");
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">Load a preset…</option>';
  state.presets.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id; opt.textContent = p.name;
    select.appendChild(opt);
  });
  select.value = state.presets.some((p) => p.id === current) ? current : "";
}

on("presetSelect", "change", () => {
  const select = document.getElementById("presetSelect");
  const preset = state.presets.find((p) => p.id === select.value);
  if (!preset) return;
  document.getElementById("prepTime").value = preset.prepSec;
  document.getElementById("workTime").value = preset.workMin;
  document.getElementById("restTime").value = preset.restMin;
  document.getElementById("totalRounds").value = preset.rounds;
  toast(`Loaded "${preset.name}".`);
});

on("savePresetBtn", "click", async () => {
  const name = prompt("Name this preset (e.g. \"Comp prep\"):");
  if (!name) return;
  const preset = {
    id: uid(),
    name: name.trim(),
    prepSec: parseInt(document.getElementById("prepTime").value, 10) || 0,
    workMin: parseFloat(document.getElementById("workTime").value) || 3,
    restMin: parseFloat(document.getElementById("restTime").value) || 1,
    rounds: parseInt(document.getElementById("totalRounds").value, 10) || 1,
  };
  state.presets.push(preset);
  await savePresets();
  renderPresets();
  document.getElementById("presetSelect").value = preset.id;
  toast(`Saved "${preset.name}".`);
});

on("deletePresetBtn", "click", async () => {
  const select = document.getElementById("presetSelect");
  if (!select.value) { toast("Pick a preset to delete first."); return; }
  const preset = state.presets.find((p) => p.id === select.value);
  if (!preset || !confirm(`Delete preset "${preset.name}"?`)) return;
  state.presets = state.presets.filter((p) => p.id !== select.value);
  await savePresets();
  renderPresets();
});

/* =========================================================
   WEIGH-IN TRACKER
   ========================================================= */
async function loadWeighIns() {
  state.weighIns = (await idbGet("weighIns")) || [];
}
async function saveWeighIns() { await idbSet("weighIns", state.weighIns); }

function renderWeightChart() {
  const svg = document.getElementById("weightChart");
  if (!svg) return;
  svg.innerHTML = "";
  const sorted = [...state.weighIns].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2) return;

  const weights = sorted.map((w) => w.weight);
  const min = Math.min(...weights), max = Math.max(...weights);
  const range = max - min || 1;
  const padY = 14, w = 400, h = 140;

  const points = sorted.map((pt, i) => {
    const x = (i / (sorted.length - 1)) * (w - 20) + 10;
    const y = h - padY - ((pt.weight - min) / range) * (h - padY * 2);
    return `${x},${y}`;
  });

  const ns = "http://www.w3.org/2000/svg";
  const polyline = document.createElementNS(ns, "polyline");
  polyline.setAttribute("points", points.join(" "));
  polyline.setAttribute("fill", "none");
  polyline.setAttribute("stroke", "#FFD700");
  polyline.setAttribute("stroke-width", "2");
  svg.appendChild(polyline);

  points.forEach((p) => {
    const [x, y] = p.split(",");
    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("cx", x); circle.setAttribute("cy", y); circle.setAttribute("r", "3");
    circle.setAttribute("fill", "#FF3B3B");
    svg.appendChild(circle);
  });
}

function renderWeightList() {
  const list = document.getElementById("weightList");
  if (!list) return;
  list.innerHTML = "";
  const sorted = [...state.weighIns].sort((a, b) => b.date.localeCompare(a.date));
  sorted.forEach((w) => {
    const row = document.createElement("div");
    row.className = "weight-row";
    const label = document.createElement("span");
    label.textContent = `${w.date} — ${w.weight}${w.unit}`;
    const remove = document.createElement("button");
    remove.className = "weight-remove";
    remove.textContent = "✕";
    remove.addEventListener("click", async () => {
      state.weighIns = state.weighIns.filter((x) => x.id !== w.id);
      await saveWeighIns();
      renderWeightList();
      renderWeightChart();
    });
    row.append(label, remove);
    list.appendChild(row);
  });
}

on("addWeightBtn", "click", async () => {
  const date = document.getElementById("weightDate").value || todayStr();
  const weight = Number(document.getElementById("weightValue").value);
  const unit = document.getElementById("weightUnit").value;
  if (!weight) { toast("Enter a weight first."); return; }
  state.weighIns.push({ id: uid(), date, weight, unit });
  await saveWeighIns();
  document.getElementById("weightValue").value = "";
  renderWeightList();
  renderWeightChart();
  toast("Logged.");
});

/* =========================================================
   MONTHLY RECAP
   ========================================================= */
function computeMonthRecap(monthDate) {
  const year = monthDate.getFullYear(), month = monthDate.getMonth();
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const monthSessions = Object.entries(state.sessions).filter(([date]) => date.startsWith(prefix));

  let daysTrained = 0, boxingRounds = 0, cardioDistanceKm = 0, strengthSets = 0;
  monthSessions.forEach(([, session]) => {
    const entries = session.entries || [];
    if (entries.length > 0) daysTrained++;
    entries.forEach((e) => {
      if (e.type === "boxing" && e.rounds) boxingRounds += e.rounds;
      if (e.type === "cardio" && e.distance) cardioDistanceKm += e.distanceUnit === "mi" ? e.distance * 1.609 : e.distance;
      if (e.type === "strength" && e.sets) strengthSets += e.sets;
    });
  });

  return { daysTrained, boxingRounds, cardioDistanceKm: Math.round(cardioDistanceKm * 10) / 10, strengthSets, longestStreak: state.streak.longest };
}

function renderRecap() {
  const stats = computeMonthRecap(state.calendarMonth);
  document.getElementById("recapMonth").textContent = `${MONTH_NAMES[state.calendarMonth.getMonth()]} ${state.calendarMonth.getFullYear()}`;
  const grid = document.getElementById("recapGrid");
  grid.innerHTML = "";
  const items = [
    { num: stats.daysTrained, label: "days trained" },
    { num: stats.boxingRounds, label: "boxing rounds" },
    { num: stats.cardioDistanceKm, label: "km covered" },
    { num: stats.strengthSets, label: "strength sets" },
  ];
  items.forEach((it) => {
    const div = document.createElement("div");
    div.className = "recap-stat";
    div.innerHTML = `<span class="recap-num">${it.num}</span><span class="recap-label">${it.label}</span>`;
    grid.appendChild(div);
  });
}

on("recapBtn", "click", () => {
  renderRecap();
  document.getElementById("recapDrawer").classList.remove("hidden");
});
on("closeRecapBtn", "click", () => document.getElementById("recapDrawer").classList.add("hidden"));
on("downloadRecapBtn", "click", () => {
  if (typeof html2canvas === "undefined") { toast("Image export isn't available right now."); return; }
  html2canvas(document.getElementById("recapCard"), { backgroundColor: "#0D0E0F" }).then((canvas) => {
    const link = document.createElement("a");
    link.download = `rounds-recap-${todayStr()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  });
});

/* =========================================================
   BACKUP & RESTORE
   ========================================================= */
on("downloadBackupBtn", "click", async () => {
  const backup = {
    exportedAt: new Date().toISOString(),
    sessions: state.sessions,
    presets: state.presets,
    weighIns: state.weighIns,
    competition: state.competition,
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `rounds-backup-${todayStr()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  toast("Backup downloaded. Your Gemini key isn't included — re-enter it on the new device.");
});

on("restoreFileInput", "change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.sessions) throw new Error("Not a Rounds backup file");
    if (!confirm("This replaces everything currently on this device with the backup. Continue?")) return;
    await idbSet("sessions", data.sessions || {});
    await idbSet("presets", data.presets || []);
    await idbSet("weighIns", data.weighIns || []);
    await idbSet("competition", data.competition || null);
    toast("Restored — reloading…");
    setTimeout(() => location.reload(), 800);
  } catch (err) {
    console.error(err);
    toast("Couldn't read that backup file.");
  }
});

/* =========================================================
   SETTINGS
   ========================================================= */
on("settingsBtn", "click", () => {
  document.getElementById("settingsDrawer").classList.remove("hidden");
  document.getElementById("voiceSupportStatus").textContent = voiceSupported()
    ? "Available in this browser."
    : "Not supported in this browser — try Chrome or Edge.";
  document.getElementById("geminiKeyStatus").textContent = state.geminiApiKey
    ? "A key is saved on this device."
    : "No key saved — using local parsing only.";
});
on("closeSettingsBtn", "click", () => {
  document.getElementById("settingsDrawer").classList.add("hidden");
});
on("saveGeminiKeyBtn", "click", async () => {
  const key = document.getElementById("geminiKeyInput").value.trim();
  if (!key) { toast("Paste a key first."); return; }
  state.geminiApiKey = key;
  await idbSet("geminiApiKey", key);
  document.getElementById("geminiKeyInput").value = "";
  document.getElementById("geminiKeyStatus").textContent = "A key is saved on this device.";
  toast("Gemini key saved.");
});
on("wipeDataBtn", "click", async () => {
  if (!confirm("This erases every logged round on this device. Continue?")) return;
  await idbDelete("sessions");
  location.reload();
});

/* =========================================================
   SERVICE WORKER + BOOT
   ========================================================= */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

(async function boot() {
  await loadSessions();
  await loadPresets();
  await loadWeighIns();
  await loadCompetition();
  await loadGeminiKey();
  recomputeStreak();
  renderCalendar();
  updateStreakUI();
  resetTimer();
  renderPresets();
  renderWeightList();
  renderWeightChart();
  renderCountdown();
  setInterval(renderCountdown, 60 * 60 * 1000); // refresh once an hour, cheap and enough for a day-granularity countdown
})();
