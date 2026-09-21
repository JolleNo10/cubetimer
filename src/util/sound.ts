/** Short beeps for inspection warnings and solve completion. */
let context: AudioContext | null = null;

export function beep(frequency: number, durationMs = 120, volume = 0.12): void {
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = frequency;
    oscillator.type = "sine";
    gain.gain.value = volume;
    // Fade out, otherwise the abrupt stop clicks.
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      context.currentTime + durationMs / 1000,
    );
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + durationMs / 1000);
  } catch {
    // Audio is a nicety; never let it break the timer.
  }
}
