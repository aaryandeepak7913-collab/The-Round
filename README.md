
🥊 Rounds — Boxing & Pomodoro Tracker
A lightweight, local-first Progressive Web App (PWA) that combines a customizable Boxing Pomodoro Timer with an automated workout logger, streak tracker, and voice input support.
✨ Features
 * Customizable Boxing Timer
   * Set custom work intervals, rest periods, prep countdowns, and total rounds.
   * Custom Exercise Naming: Name your drill directly in the timer (e.g., Skipping, Heavy Bag, Shadowboxing, Speedbag) via text or voice input.
   * Audio Cues: Custom triple-strike boxing bell synthesizes in real-time via the Web Audio API (no external sound files required).
 * Automated Workout Logging
   * Completing all timer rounds automatically logs the completed session straight to your daily log under your specified exercise name.
 * Streak & Activity Tracking
   * Tracks active day streaks, best overall streaks, and total workout days.
   * Interactive month calendar with daily activity markers and streak highlights.
 * Voice-Enabled Logging
   * Quick Exercise Name: Tap the microphone next to the timer input to set your drill name hands-free.
   * Summary Mode: Speak your full workout at the end of a session to auto-parse exercises, sets, reps, weight, and distance.
   * Live Mode: Keep the mic open to log sets continuously as you perform them.
 * Local-First & Offline Ready
   * Built using native IndexedDB for persistent offline storage.
   * Zero external API dependencies or backend servers required.
🚀 Quick Start
1. Running Locally
Simply clone the repository and open index.html in any modern web browser:
git clone https://github.com/aaryandeepak7913-collab/The-Round.git
cd The-Round

Open index.html directly or serve it using a simple local server:
# Using Python
python3 -m http.server 8000

Navigate to http://localhost:8000 in your browser.
2. Live Demo
Visit the live GitHub Pages app: Rounds — Boxing & Pomodoro
🛠️ Project Structure
├── index.html     # App layout, CSS variables, modal drawers, and main UI panels
├── app.js         # Core logic: Audio engine, timer tick, IndexedDB, streak system, voice parser
├── sw.js          # Service worker for offline asset caching
└── manifest.json  # Web App Manifest for PWA installation

📖 How to Use
 * Set Up Your Round:
   * Enter your drill name in the EXERCISE NAME field (e.g., Heavy Bag).
   * Adjust your PREP (SEC), WORK (MIN), REST (MIN), and ROUNDS.
 * Start Training: Click START ROUND. The bell will sound, and the card will switch between PREP, WORK, and REST states.
 * Auto-Save: Once the final round finishes, the app automatically adds the entry to your selected date's log and updates your active streak.
 * Manual & Voice Logging: Click Open Today's Log to manually add strength, cardio, or boxing drills, or use Summary Voice / Log Live to speak your stats.
