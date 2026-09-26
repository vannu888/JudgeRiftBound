// Timer del round nel segnapunti: il riquadro in cima, l'orologio al centro
// della modalità tavolo e i minuti rimasti nel pulsante in alto. Avvisa a 5
// minuti dalla fine e allo scadere (vibrazione e suono, dove il telefono lo consente).

import { startTimer, pauseTimer, resetTimer, setMinutes, timeLeft, dueAlert, formatClock, restoreTimer, isIdle, isRunning } from "./timer-model.js";
import { load, store } from "./storage.js";
import { icon } from "./icons.js";
import { toast } from "./chat.js";

const KEY = "jrb.timer.v1";
const chip = document.querySelector("#openScore .timer-chip");

let timer = restoreTimer(load(KEY));
let ticker = 0;
let onChange = () => {};
let audio = null;

/** "idle" | "running" | "paused" | "over" */
function stateOf(now = Date.now()) {
  if (isIdle(timer)) return "idle";
  if (timeLeft(timer, now) <= 0) return "over";
  return isRunning(timer) ? "running" : "paused";
}

const LABEL = { idle: "Timer del round", running: "Tempo del round", paused: "In pausa", over: "Tempo scaduto" };

/** The block at the top of the scoreboard. */
export function timerView() {
  const state = stateOf();
  let controls = "";
  if (state === "idle") {
    controls = `
      <div class="stepper" role="group" aria-label="Durata del round">
        <button type="button" data-timer="less" aria-label="5 minuti in meno">−</button>
        <output>${timer.minutes}'</output>
        <button type="button" data-timer="more" aria-label="5 minuti in più">+</button>
      </div>
      <button type="button" class="primary-btn small" data-timer="start">${icon("play")}Avvia</button>`;
  } else {
    if (state === "running") controls = `<button type="button" class="chip-btn" data-timer="pause">${icon("pause")}Pausa</button>`;
    if (state === "paused") controls = `<button type="button" class="primary-btn small" data-timer="start">${icon("play")}Riprendi</button>`;
    controls += `<button type="button" class="icon-btn" data-timer="reset" aria-label="Azzera il timer" title="Azzera">${icon("refresh")}</button>`;
  }
  return `
    <div class="timer ${state}">
      ${icon("timer", "timer-icon")}
      <p class="timer-main"><span class="timer-label">${LABEL[state]}</span><span class="timer-clock" data-clock>${formatClock(timeLeft(timer))}</span></p>
      <div class="timer-ctrl">${controls}</div>
    </div>`;
}

/** The clock in table mode's middle strip, tap to pause or resume (nothing before the start). */
export function tableClock() {
  if (isIdle(timer)) return "";
  const state = stateOf();
  const label = state === "running" ? "Metti in pausa il timer" : "Fai ripartire il timer";
  return `<button type="button" class="tm-clock ${state}" data-timer="toggle" aria-label="${label}" data-clock>${formatClock(timeLeft(timer))}</button>`;
}

// iOS only plays sound from an audio context unlocked by a tap: the "Avvia" button does it.
function unlockAudio() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    audio.resume?.();
  } catch {
    audio = null;
  }
}

function beep(times) {
  if (!audio) return;
  for (let i = 0; i < times; i++) {
    const t = audio.currentTime + i * 0.35;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 880;
    osc.connect(gain).connect(audio.destination);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    osc.start(t);
    osc.stop(t + 0.3);
  }
}

function announce(alert) {
  if (alert === "warn") {
    toast("⏱ Mancano 5 minuti alla fine del round");
    navigator.vibrate?.(250);
    beep(1);
  } else {
    toast("⏱ Tempo scaduto!");
    navigator.vibrate?.([300, 150, 300, 150, 300]);
    beep(3);
  }
}

/** Minutes left in the header button, so the time shows while asking the judge. */
function updateChip(now) {
  if (!chip) return;
  chip.hidden = isIdle(timer);
  const left = timeLeft(timer, now);
  chip.textContent = left <= 0 ? "Tempo!" : `${Math.ceil(left / 60_000)}'`;
  chip.classList.toggle("over", left <= 0);
}

function tick() {
  const now = Date.now();
  const text = formatClock(timeLeft(timer, now));
  for (const el of document.querySelectorAll("[data-clock]")) el.textContent = text;
  updateChip(now);
  const { alert, timer: next } = dueAlert(timer, now);
  if (alert) {
    timer = next;
    store(KEY, timer);
    announce(alert);
    onChange(); // redraw: "Tempo scaduto" and the red clock
  }
}

/** Tick every second only while the timer runs. */
function schedule() {
  clearInterval(ticker);
  ticker = isRunning(timer) ? setInterval(tick, 1000) : 0;
  tick();
}

/** A tap on a [data-timer] button. */
export function timerAction(action) {
  const now = Date.now();
  if (action === "start") {
    unlockAudio();
    timer = startTimer(timer, now);
  } else if (action === "pause") timer = pauseTimer(timer, now);
  else if (action === "toggle") {
    unlockAudio();
    timer = isRunning(timer) ? pauseTimer(timer, now) : startTimer(timer, now);
  } else if (action === "reset") {
    if (!confirm("Azzerare il timer del round?")) return;
    timer = resetTimer(timer);
  } else if (action === "less" || action === "more") timer = setMinutes(timer, timer.minutes + (action === "more" ? 5 : -5));
  store(KEY, timer);
  schedule();
  onChange();
}

/** `redraw()` repaints the scoreboard when the timer changes state. */
export function initTimer(redraw) {
  onChange = redraw;
  schedule();
  // Timers sleep while the phone is locked: catch up (and alert) on return.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tick();
  });
}
