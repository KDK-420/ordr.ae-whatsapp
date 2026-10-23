/** A short two-note chime from the Web Audio API, so no audio file ships with the dashboard. */

const MUTE_KEY = "ordr.inbox.mute";
let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  context ??= new Ctor();
  return context;
}

/**
 * Browsers only let a page make sound after the person has clicked or typed. Call this from the
 * first interaction (or on every one, it is idempotent) so a later chime is allowed to play.
 */
export function unlockChime(): void {
  const ctx = audioContext();
  if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => undefined);
}

/** Plays the chime unless muted or the page never had an interaction (then the browser keeps it silent). */
export function playChime(): void {
  if (isMuted()) return;
  const ctx = audioContext();
  if (!ctx || ctx.state !== "running") return;
  const notes = [
    { freq: 880, at: 0 },
    { freq: 1318.5, at: 0.16 },
  ];
  for (const n of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = n.freq;
    const start = ctx.currentTime + n.at;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.4);
  }
}

export function isMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean): void {
  try {
    if (muted) window.localStorage.setItem(MUTE_KEY, "1");
    else window.localStorage.removeItem(MUTE_KEY);
  } catch {
    // Private mode or storage blocked: the choice lasts for this page only.
  }
}
