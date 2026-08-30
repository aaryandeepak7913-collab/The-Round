# Rounds — training log

A voice-logged workout tracker with a streak system, built the same way as Keep: a PWA that installs on Windows and Android, works fully offline, no accounts or servers involved. Everything lives on your device.

## What it tracks

- **Strength**: exercise, sets, reps, weight
- **Cardio**: activity, distance, duration
- **Boxing**: activity (sparring, pads, bag work, roadwork, shadow boxing, skipping), rounds, round length
- A free-text note per session for how it felt

## Voice logging — two modes

**Speak a summary** — say your whole session in one go after you're done, e.g. *"Bench press 3 sets of 10 at 60 kilos, then 20 minutes roadwork, then 6 rounds sparring."* It splits on "then"/"and"/commas, guesses the type, numbers, and exercise name for each part, and shows you an editable review card before anything saves. Nothing is saved without you confirming it.

**Log live** — tap it once, then speak each set as you finish it: *"bench press 10 reps 60 kilos"* → appears in the list right away. Tap again to stop. Good for between-set logging without touching your phone.

Voice parsing is pattern-based, not true AI — it looks for numbers next to words like "kg," "reps," "rounds," "minutes," "km," and known boxing terms. It's decent at typical phrasing but won't be perfect, which is exactly why every voice entry is editable before it's saved, and everything can also be typed in manually below the voice buttons.

**Browser support**: voice recognition needs Chrome or Edge (desktop or Android). It won't appear as an option in browsers that don't support it — manual entry always works everywhere.

## Streaks

A day counts the moment it has at least one logged entry. Current streak, longest streak, and total rounds logged are shown at the bottom of the calendar panel.

## Installing

Same as Keep:

1. Host the files somewhere with HTTPS (GitHub Pages, same as before, or a new repo).
2. Open the URL in Chrome/Edge → install icon in the address bar (Windows) or "Add to Home screen" (Android).

No Google Cloud setup needed this time — there's no cloud sync in this version, so nothing to configure before it works.

## What's not in yet

This is the first pass. Not included yet, on purpose, so the core (voice logging + streaks + calendar) shipped fast and workable:

- Cloud sync between devices (can be added the same way Keep's Drive sync was, if wanted)
- Editing a saved entry's details after adding it (right now: remove and re-add)
- Charts/progress graphs over time
- Exporting your log

## Files

| File | Purpose |
|---|---|
| `index.html` | App shell |
| `style.css` | Visual design |
| `app.js` | Storage, calendar, streaks, voice parsing |
| `manifest.json` | Makes it installable |
| `sw.js` | Offline support — bump `CACHE_NAME` here after any future update, same as with Keep |
| `icons/` | App icons |
