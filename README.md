# Rounds — training log

A voice-logged boxing/strength/cardio tracker with a round timer, streaks, and a bunch of training-specific extras. It's a PWA — installs on Windows and Android, works fully offline, no accounts or servers. Everything lives on your device unless you explicitly export or connect something.

## Core features

- **Round timer** — prep/work/rest phases, configurable rounds, a real triple-strike bell (Web Audio, no sound file needed), auto-logs the session as a boxing entry when it finishes.
- **Streaks** — a day counts the moment it has one logged entry. Current streak, longest streak, and total days trained are always visible.
- **Calendar** — month view, dots on days you trained, a gold ring around your current streak.
- **Voice logging, two ways**:
  - **Record whole session** — tap once to start, talk through your entire workout without stopping between exercises, tap "Stop & parse" when done.
  - **Log live** — tap once, speak each set as you finish it, entries appear one by one in real time. Tap again to stop.
- **Manual entry** — four types: Boxing, Strength, Cardio, and **Custom** (pick any mix of sets/reps, duration, distance, or just a free-text note — for exercises that don't fit the other three).
- **Editable entries** — pencil icon on any logged entry lets you fix it in place instead of deleting and re-adding.

## Smarter voice parsing (optional)

By default, voice transcripts are split and classified by a local pattern-matcher — no internet needed, works instantly, but it's just regex, not real understanding.

Add a free **Gemini API key** in Settings (get one at [Google AI Studio](https://aistudio.google.com)) and instead your full spoken session gets sent to Gemini, which splits it into separate exercises, classifies each one, and pulls out the numbers more reliably — especially useful for run-on sentences describing several exercises back to back. If no key is set, or the Gemini call fails for any reason (offline, rate limit, bad key), it silently falls back to local parsing — voice logging never just breaks.

Either way, **nothing saves without you reviewing it first** — every voice pass shows an editable card per detected exercise before anything touches your log.

Your key is stored only in this device's local storage. It's never bundled into a backup export (see below) — you'll re-enter it if you set up a new device.

**A heads-up on the model name**: Google renames and retires Gemini models fairly often — I confirmed multiple retirements happened in just the first half of 2026. The app currently points at `gemini-2.5-flash`. If Gemini parsing ever stops working out of nowhere, that's the most likely reason — open `app.js`, find the line `const GEMINI_MODEL = "gemini-2.5-flash";` near the voice parsing section, and swap in whatever current fast/free model Google's docs list at ai.google.dev/api.

## Round presets

Save your current prep/work/rest/round settings under a name (e.g. "Comp prep," "Light day") and reload them instantly from the dropdown next to the timer settings. Delete ones you don't need anymore.

## Pre-competition countdown

Top of the page — shows days remaining until a competition you set (defaults to "CBSE South Zone," edit the pencil icon to rename or change the date, or clear it entirely).

## Weigh-in tracker

A simple date + weight + unit log with a line chart underneath, for keeping an eye on weight class ahead of a competition. Nothing fancy — just enough to see the trend.

## Monthly recap

Tap 📊 in the header. Shows days trained, total boxing rounds, kilometers covered, and strength sets for whichever month the calendar is currently showing. "Download as image" saves it as a PNG you can screenshot-share, styled to actually look decent rather than like a raw stats dump.

## Backup & restore

In Settings: **Download backup** saves everything (sessions, presets, weigh-ins, competition date — not your Gemini key) as a `.json` file. **Restore from file** loads one back in, replacing whatever's on the current device. This is how a streak survives a phone switch — download on the old device, restore on the new one.

## Installing

1. Host the files somewhere with HTTPS (GitHub Pages is what we've been using).
2. Open the URL in Chrome or Edge (desktop or Android) → install icon in the address bar, or "Add to Home screen" on Android.

No Google Cloud OAuth setup needed for this app (that was Keep's thing, for Drive sync) — Rounds has no cloud sync built in. The Gemini key is the only external service involved, and it's entirely optional.

**Voice recognition** needs Chrome or Edge. It won't appear as an option in unsupported browsers — manual entry always works everywhere.

## A note on deploying updates

This app is now genuinely large — five files that all depend on each other (`index.html`, `style.css`, `app.js`, `manifest.json`, `sw.js`). When any of them changes:

1. Replace **every file that changed** on GitHub, not just the one you think matters — `index.html` and `app.js` in particular reference each other by element ID, and updating only one has broken things before.
2. Bump `CACHE_NAME` in `sw.js` (e.g. `"rounds-tracker-v3"` → `"rounds-tracker-v4"`) — browsers cache these files aggressively for offline use, and without a version bump a device can keep running old code indefinitely even after GitHub shows the new commit live.
3. After deploying, clear site data on any device you're testing on (DevTools → Application → Clear site data, or Chrome's site settings → Clear & reset) rather than just refreshing — a plain refresh often isn't enough to drop the old cached service worker.

`app.js` is written defensively — if an element it expects is missing from `index.html` (a partial file swap, a typo), it logs a warning to the console and skips that one feature instead of crashing the whole app. Still, matching files is the goal; the defensiveness is a safety net, not a substitute for it.

## Files

| File | Purpose |
|---|---|
| `index.html` | App shell — every panel described above |
| `style.css` | Visual design — boxing/ring theme, circular round-timer dial |
| `app.js` | All logic: storage, calendar, streaks, timer, voice parsing (local + Gemini), presets, weigh-ins, recap, backup/restore |
| `manifest.json` | Makes it installable |
| `sw.js` | Offline support — bump `CACHE_NAME` here after any update |
| `icons/` | App icons |
