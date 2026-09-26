import test from "node:test";
import assert from "node:assert/strict";
import { newTimer, startTimer, pauseTimer, resetTimer, setMinutes, timeLeft, dueAlert, formatClock, restoreTimer, isIdle, isRunning } from "../public/timer-model.js";

const MIN = 60_000;

test("start, pause and resume keep the right time", () => {
  let t = newTimer(50);
  assert.ok(isIdle(t));
  assert.equal(timeLeft(t, 0), 50 * MIN);
  t = startTimer(t, 1000);
  assert.ok(isRunning(t));
  assert.equal(timeLeft(t, 1000 + 10 * MIN), 40 * MIN);
  t = pauseTimer(t, 1000 + 10 * MIN);
  assert.equal(timeLeft(t, 9e12), 40 * MIN); // paused: time does not pass
  t = startTimer(t, 5_000_000);
  assert.equal(timeLeft(t, 5_000_000 + MIN), 39 * MIN);
  assert.deepEqual(resetTimer(t), newTimer(50));
});

test("the length changes only before the start, within 5-180 minutes", () => {
  assert.equal(setMinutes(newTimer(50), 55).minutes, 55);
  assert.equal(setMinutes(newTimer(50), 1).minutes, 5);
  assert.equal(setMinutes(newTimer(50), 999).minutes, 180);
  assert.equal(setMinutes(startTimer(newTimer(50), 0), 30).minutes, 50);
});

test("alerts: 5 minutes left, then time is up, each once", () => {
  let t = startTimer(newTimer(50), 0);
  assert.equal(dueAlert(t, 10 * MIN).alert, null);
  let r = dueAlert(t, 45 * MIN + 1);
  assert.equal(r.alert, "warn");
  t = r.timer;
  assert.equal(dueAlert(t, 46 * MIN).alert, null);
  r = dueAlert(t, 50 * MIN);
  assert.equal(r.alert, "end");
  assert.equal(dueAlert(r.timer, 60 * MIN).alert, null);
  // Opened after the end: straight to "time is up", no stale warning.
  assert.equal(dueAlert(startTimer(newTimer(50), 0), 70 * MIN).alert, "end");
  // A 5-minute round has no "5 minutes left".
  assert.equal(dueAlert(startTimer(newTimer(5), 0), MIN).alert, null);
});

test("the clock reads like a countdown, then counts the overtime", () => {
  assert.equal(formatClock(50 * MIN), "50:00");
  assert.equal(formatClock(50 * MIN - 400), "50:00");
  assert.equal(formatClock(65_000), "1:05");
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(-83_000), "+1:23");
  assert.equal(formatClock(65 * MIN), "1:05:00");
});

test("a saved timer is checked", () => {
  assert.deepEqual(restoreTimer(null), newTimer());
  assert.deepEqual(restoreTimer({ minutes: 55, endsAt: 123, left: null, alerted: 1 }), { minutes: 55, endsAt: 123, left: null, alerted: 1 });
  assert.equal(restoreTimer({ minutes: 50, endsAt: null, left: 9e12 }).left, 50 * MIN);
  assert.deepEqual(restoreTimer({ minutes: "x", endsAt: "soon", alerted: 7 }), newTimer());
});
