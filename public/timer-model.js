// Timer del round per i tornei: logica pura, senza DOM (testabile in Node).
// Si salva l'istante di fine, non i secondi rimasti: il conto resta giusto
// anche se la pagina si ricarica o il telefono va in standby.

export const DEFAULT_MINUTES = 50;
export const MIN_MINUTES = 5;
export const MAX_MINUTES = 180;
const WARN_MS = 5 * 60_000; // "5 minutes left"

const clampMinutes = (m) => Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(Number(m)) || DEFAULT_MINUTES));

/**
 * { minutes, endsAt, left, alerted }: `endsAt` (a timestamp) while running,
 * `left` (milliseconds) while paused, both null before the start.
 * `alerted`: 0 nothing yet, 1 "5 minutes left" given, 2 "time is up" given.
 */
export const newTimer = (minutes = DEFAULT_MINUTES) => ({ minutes: clampMinutes(minutes), endsAt: null, left: null, alerted: 0 });

export const isRunning = (t) => t.endsAt !== null;
export const isIdle = (t) => t.endsAt === null && t.left === null;

/** Milliseconds left: negative once the time is up (the overtime). */
export function timeLeft(t, now = Date.now()) {
  if (t.endsAt !== null) return t.endsAt - now;
  if (t.left !== null) return t.left;
  return t.minutes * 60_000;
}

export const startTimer = (t, now = Date.now()) => (isRunning(t) ? t : { ...t, endsAt: now + timeLeft(t, now), left: null });
export const pauseTimer = (t, now = Date.now()) => (isRunning(t) ? { ...t, endsAt: null, left: timeLeft(t, now) } : t);
export const resetTimer = (t) => newTimer(t.minutes);
/** The round length can change only before the start. */
export const setMinutes = (t, minutes) => (isIdle(t) ? { ...t, minutes: clampMinutes(minutes) } : t);

/**
 * The alert due now, if any: "warn" once 5 minutes are left (for rounds longer
 * than that), "end" once the time is up. Returns { alert, timer } with the
 * alert marked as given, so a reload does not repeat it.
 */
export function dueAlert(t, now = Date.now()) {
  if (isIdle(t)) return { alert: null, timer: t };
  const left = timeLeft(t, now);
  if (left <= 0 && t.alerted < 2) return { alert: "end", timer: { ...t, alerted: 2 } };
  if (left <= WARN_MS && left > 0 && t.alerted < 1 && t.minutes * 60_000 > WARN_MS) return { alert: "warn", timer: { ...t, alerted: 1 } };
  return { alert: null, timer: t };
}

/** "47:05", "1:05:00" over an hour; the overtime counts up as "+1:23". */
export function formatClock(ms) {
  const over = ms < 0;
  // Counting down, the display changes when a second has fully gone (50:00 at the start, 0:00 at the end).
  const total = over ? Math.floor(-ms / 1000) : Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  const text = h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
  return over && total ? `+${text}` : text;
}

/** A saved timer, checked (it may be old or tampered with). */
export function restoreTimer(raw) {
  if (!raw || typeof raw !== "object") return newTimer();
  const t = newTimer(raw.minutes);
  const endsAt = Number(raw.endsAt);
  const left = Number(raw.left);
  if (raw.endsAt !== null && Number.isFinite(endsAt)) t.endsAt = endsAt;
  else if (raw.left !== null && Number.isFinite(left)) t.left = Math.min(left, t.minutes * 60_000);
  t.alerted = [0, 1, 2].includes(raw.alerted) ? raw.alerted : 0;
  return t;
}
