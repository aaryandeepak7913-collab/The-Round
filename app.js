"use strict";

/* =========================================================
   INDEXEDDB HELPER
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
   STATE
   ========================================================= */
const state = {
  sessions: {},         // { "YYYY-MM-DD": { entries: [...], notes: "", updatedAt } }
  streak: { current: 0, longest: 0, lastDate: null },
  selectedDate: null,
  calendarMonth: new Date(),
  draftEntries: [],     // entries being built for the currently open day, before save
  voiceReviewDrafts: [],
};

function todayStr() { return localDateStr(new Date()); }
function localDateStr(d) {
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0"), day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return localDateStr(d);
}
function uid() { return Math.random().toString(36).slice(2, 10); }

/* =========================================================
   PERSISTENCE
   ========================================================= */
async function loadSessions() {
  const saved = await idbGet("sessions");
  state.sessions = saved || {};
}
async function saveSessions() {
  await idbSet("sessions", state.sessions);
}

/* =========================================================
   STREAK CALC
   ========================================================= */
function recomputeStreak() {
  const dates = Object.keys(state.sessions).filter(d => (state.sessions[d].entries || []).length > 0).sort();
  if (dates.length === 0) {
    state.streak = { current: 0, longest: 0, lastDate: null };
    return;
  }
  const dateSet = new Set(dates);
  let longest = 1, run = 1;
  for (let i = 1; i < dates.length; i++) {
    run = addDays(dates[i-1], 1) === dates[i] ? run + 1 : 1;
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
  const daysInMonth = new Date(m.getFullYear(), m.getMonth()+1, 0).getDate();
  const today = todayStr();

  for (let i = 0; i < startOffset; i++) {
    const filler = document.createElement("div");
    filler.className = "cal-day empty";
    grid.appendChild(filler);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${m.getFullYear()}-${String(m.getMonth()+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
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
  state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth()-1, 1);
  renderCalendar();
});
document.getElementById("nextMonth").addEventListener("click", () => {
  state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth()+1, 1);
  renderCalendar();
});

function updateStreakUI() {
  document.getElementById("streakCount").textContent = state.streak.current;
  document.getElementById("currentStreakStat").textContent = state.streak.current;
  document.getElementById("longestStreakStat").textContent = state.streak.longest;
  const total = Object.values(state.sessions).filter(s => (s.entries||[]).length > 0).length;
  document.getElementById("totalSessionsStat").textContent = total;
}

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

/* ---- manual entry form ---- */
const typeSelect = document.getElementById("manualType");
typeSelect.addEventListener("change", () => {
  document.getElementById("manualStrengthRow").classList.toggle("hidden", typeSelect.value !== "strength");
  document.getElementById("manualCardioRow").classList.toggle("hidden", typeSelect.value !== "cardio");
  document.getElementById("manualBoxingRow").classList.toggle("hidden", typeSelect.value !== "boxing");
});

document.getElementById("manualAddBtn").addEventListener("click", () => {
  const type = typeSelect.value;
  const name = document.getElementById("manualName").value.trim();
  if (!name) { toast("Give it a name first."); return; }

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
   VOICE PARSING
   ========================================================= */
const BOXING_WORDS = ["spar","sparring","pads","pad work","bag work","heavy bag","shadow box","shadow boxing","roadwork","road work","skip","skipping","jump rope","mitts","drill","drills"];
const CARDIO_WORDS = ["run","ran","running","jog","jogging","cycle","cycling","bike","biking","swim","swimming","row","rowing","walk","walking"];

function parseWorkoutPhrase(text) {
  const original = text.trim();
  let t = " " + original.toLowerCase() + " ";

  const entry = { id: uid(), type: "strength", name: null, note: null, transcript: original };

  // weight: "60 kg" / "60 kilos" / "135 lbs" / "135 pounds"
  let m = t.match(/(\d+(?:\.\d+)?)\s*(kg|kilo|kilos|kilogram|kilograms)\b/);
  if (m) { entry.weight = parseFloat(m[1]); entry.weightUnit = "kg"; t = t.replace(m[0], " "); }
  else {
    m = t.match(/(\d+(?:\.\d+)?)\s*(lb|lbs|pound|pounds)\b/);
    if (m) { entry.weight = parseFloat(m[1]); entry.weightUnit = "lb"; t = t.replace(m[0], " "); }
  }

  // sets x reps: "3x10", "3 sets of 10", "3 sets 10 reps"
  m = t.match(/(\d+)\s*(?:x|sets?\s*(?:of)?)\s*(\d+)\s*(?:reps?)?/);
  if (m) { entry.sets = parseInt(m[1]); entry.reps = parseInt(m[2]); t = t.replace(m[0], " "); }
  else {
    m = t.match(/(\d+)\s*sets?\b/);
    if (m) { entry.sets = parseInt(m[1]); t = t.replace(m[0], " "); }
    m = t.match(/(\d+)\s*reps?\b/);
    if (m) { entry.reps = parseInt(m[1]); t = t.replace(m[0], " "); }
  }

  // rounds: "6 rounds" / "6 round"
  m = t.match(/(\d+)\s*rounds?\b/);
  if (m) { entry.rounds = parseInt(m[1]); t = t.replace(m[0], " "); }
  m = t.match(/(\d+(?:\.\d+)?)\s*min(?:ute)?s?\s*(?:round|rounds|each)/);
  if (m) { entry.roundLength = parseFloat(m[1]); t = t.replace(m[0], " "); }

  // distance: "5k", "5 km", "2 miles"
  m = t.match(/(\d+(?:\.\d+)?)\s*k(?:m|ilometers?)?\b/);
  if (m) { entry.distance = parseFloat(m[1]); entry.distanceUnit = "km"; t = t.replace(m[0], " "); }
  else {
    m = t.match(/(\d+(?:\.\d+)?)\s*mi(?:les?)?\b/);
    if (m) { entry.distance = parseFloat(m[1]); entry.distanceUnit = "mi"; t = t.replace(m[0], " "); }
  }

  // duration: "20 minutes" / "5 mins" / "30 seconds"
  m = t.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?)\b/);
  if (m) { entry.duration = parseFloat(m[1]); t = t.replace(m[0], " "); }

  // classify type
  const lower = original.toLowerCase();
  if (BOXING_WORDS.some((w) => lower.includes(w))) entry.type = "boxing";
  else if (CARDIO_WORDS.some((w) => lower.includes(w)) || entry.distance) entry.type = "cardio";
  else if (entry.rounds || entry.roundLength) entry.type = "boxing";
  else entry.type = "strength";

  // whatever text remains (minus filler words/numbers) becomes the name
  let name = t.replace(/\b(at|of|for|and|then|a|an|the|with|did|do|done)\b/g, " ")
               .replace(/\d+/g, " ")
               .replace(/\s+/g, " ")
               .trim();
  entry.name = name ? name.replace(/\b\w/g, (c) => c.toUpperCase()) : (entry.type === "boxing" ? "Boxing" : entry.type === "cardio" ? "Cardio" : "Exercise");

  return entry;
}

function splitIntoPhrases(text) {
  return text
    .split(/\b(?:then|and then|,)\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
}

/* ---- speech recognition setup ---- */
const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;
let voiceMode = null; // 'summary' | 'live'

function voiceSupported() { return !!SpeechRecognitionAPI; }

function initRecognizer() {
  if (!voiceSupported()) return null;
  const r = new SpeechRecognitionAPI();
  r.lang = "en-US";
  r.interimResults = true;
  r.maxAlternatives = 1;
  return r;
}

function setVoiceStatus(text) {
  document.getElementById("voiceStatus").textContent = text;
}

function startSummaryMode() {
  if (!voiceSupported()) { toast("Voice recognition isn't available in this browser."); return; }
  recognizer = initRecognizer();
  recognizer.continuous = false;
  voiceMode = "summary";
  const btn = document.getElementById("voiceSummaryBtn");
  btn.classList.add("listening");
  setVoiceStatus("Listening… say your whole session, then pause.");

  recognizer.onresult = (event) => {
    const transcript = Array.from(event.results).map((r) => r[0].transcript).join(" ");
    if (event.results[event.results.length - 1].isFinal) {
      const phrases = splitIntoPhrases(transcript);
      state.voiceReviewDrafts = phrases.map(parseWorkoutPhrase);
      openVoiceReview();
    }
  };
  recognizer.onerror = (e) => { console.error(e); toast("Didn't catch that — try again."); };
  recognizer.onend = () => { btn.classList.remove("listening"); setVoiceStatus(""); };
  recognizer.start();
}

function stopLiveMode() {
  if (recognizer) { try { recognizer.stop(); } catch {} }
  document.getElementById("voiceLiveBtn").classList.remove("listening");
  document.getElementById("voiceLiveBtn").textContent = "";
  const dot = document.createElement("span"); dot.className = "mic-dot";
  document.getElementById("voiceLiveBtn").append(dot, document.createTextNode(" Log live"));
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
  btn.textContent = "";
  const dot = document.createElement("span"); dot.className = "mic-dot";
  btn.append(dot, document.createTextNode(" Stop"));
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
  recognizer.onerror = (e) => { console.error(e); if (e.error !== "no-speech") toast("Voice recognition hiccuped."); };
  recognizer.onend = () => { if (voiceMode === "live") { try { recognizer.start(); } catch {} } };
  recognizer.start();
}

document.getElementById("voiceSummaryBtn").addEventListener("click", startSummaryMode);
document.getElementById("voiceLiveBtn").addEventListener("click", startLiveMode);

document.getElementById("voiceQuickBtn").addEventListener("click", () => {
  selectDate(todayStr());
  startSummaryMode();
});

/* ---- voice review modal ---- */
function openVoiceReview() {
  const list = document.getElementById("voiceReviewList");
  list.innerHTML = "";
  state.voiceReviewDrafts.forEach((e, idx) => {
    const card = document.createElement("div");
    card.className = "voice-review-item";

    const transcript = document.createElement("div");
    transcript.className = "vr-transcript";
    transcript.textContent = `"${e.transcript}"`;

    const fields = document.createElement("div");
    fields.className = "vr-fields";

    const typeSel = document.createElement("select");
    ["strength","cardio","boxing"].forEach((t) => {
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

    if (e.sets || e.reps) {
      const setsInput = document.createElement("input");
      setsInput.type = "number"; setsInput.placeholder = "Sets"; setsInput.value = e.sets || "";
      setsInput.addEventListener("input", () => { e.sets = Number(setsInput.value) || null; });
      const repsInput = document.createElement("input");
      repsInput.type = "number"; repsInput.placeholder = "Reps"; repsInput.value = e.reps || "";
      repsInput.addEventListener("input", () => { e.reps = Number(repsInput.value) || null; });
      fields.append(setsInput, repsInput);
    }
    if (e.weight) {
      const weightInput = document.createElement("input");
      weightInput.type = "number"; weightInput.placeholder = "Weight"; weightInput.value = e.weight;
      weightInput.addEventListener("input", () => { e.weight = Number(weightInput.value) || null; });
      fields.appendChild(weightInput);
    }
    if (e.distance) {
      const distInput = document.createElement("input");
      distInput.type = "number"; distInput.placeholder = "Distance"; distInput.value = e.distance;
      distInput.addEventListener("input", () => { e.distance = Number(distInput.value) || null; });
      fields.appendChild(distInput);
    }
    if (e.duration) {
      const durInput = document.createElement("input");
      durInput.type = "number"; durInput.placeholder = "Minutes"; durInput.value = e.duration;
      durInput.addEventListener("input", () => { e.duration = Number(durInput.value) || null; });
      fields.appendChild(durInput);
    }
    if (e.rounds) {
      const roundsInput = document.createElement("input");
      roundsInput.type = "number"; roundsInput.placeholder = "Rounds"; roundsInput.value = e.rounds;
      roundsInput.addEventListener("input", () => { e.rounds = Number(roundsInput.value) || null; });
      fields.appendChild(roundsInput);
    }

    card.append(transcript, fields);
    list.appendChild(card);
  });
  document.getElementById("voiceReview").classList.remove("hidden");
}

document.getElementById("closeVoiceReviewBtn").addEventListener("click", () => {
  document.getElementById("voiceReview").classList.add("hidden");
  state.voiceReviewDrafts = [];
});

document.getElementById("confirmVoiceEntriesBtn").addEventListener("click", () => {
  if (!state.selectedDate) selectDate(todayStr());
  state.draftEntries.push(...state.voiceReviewDrafts);
  renderEntriesList();
  document.getElementById("voiceReview").classList.add("hidden");
  state.voiceReviewDrafts = [];
  toast("Added — review below, then save the round.");
});

/* =========================================================
   SETTINGS
   ========================================================= */
document.getElementById("settingsBtn").addEventListener("click", () => {
  document.getElementById("settingsDrawer").classList.remove("hidden");
  document.getElementById("voiceSupportStatus").textContent = voiceSupported()
    ? "Available in this browser."
    : "Not supported in this browser — try Chrome or Edge.";
});
document.getElementById("closeSettingsBtn").addEventListener("click", () => {
  document.getElementById("settingsDrawer").classList.add("hidden");
});
document.getElementById("wipeDataBtn").addEventListener("click", async () => {
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
  recomputeStreak();
  renderCalendar();
  updateStreakUI();
})();
