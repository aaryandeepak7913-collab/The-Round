/* =========================================================
   AUDIO (BOXING BELL SYNTHESIZER - TRIPLE CHIME)
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

  // Ring the bell 3 times with rapid strikes (0ms, 250ms, 500ms)
  const strikeTimes = [0, 0.25, 0.5];

  strikeTimes.forEach((delay) => {
    const startTime = audioCtx.currentTime + delay;

    // Primary metallic bell tone
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

    // High metallic harmonic for dynamic realism
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
