// Diario delle partite: logica pura, senza DOM (testabile in Node). Ogni voce
// è una partita 1v1 con le due Leggende e il risultato; le statistiche dicono
// come va contro ogni Leggenda avversaria e con ognuna delle tue.

export const MAX_ENTRIES = 500;

const text = (v, max = 60) => String(v ?? "").replace(/[\r\n]/g, " ").trim().slice(0, max);

/** One game: { id, at, mine, opp, won, score }. Legends may be "" (not given). */
export function makeEntry(data, now = Date.now()) {
  const at = Number(data.at);
  return {
    id: text(data.id, 20) || `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    at: Number.isFinite(at) && at > 0 ? at : now,
    mine: text(data.mine),
    opp: text(data.opp),
    won: data.won === true,
    score: text(data.score, 12),
  };
}

/** Newest first, at most MAX_ENTRIES. */
export const addEntry = (list, data, now = Date.now()) => [makeEntry(data, now), ...list].slice(0, MAX_ENTRIES);

export const removeEntry = (list, id) => list.filter((e) => e.id !== id);

/** A saved diary, checked. */
export function restoreDiary(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e) => e && typeof e === "object" && typeof e.won === "boolean")
    .map((e) => makeEntry(e))
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_ENTRIES);
}

export const winRate = (wins, games) => (games ? Math.round((wins * 100) / games) : 0);

/** Games and wins grouped by a legend field, most played first; games without the legend last. */
function byLegend(list, field) {
  const groups = new Map();
  for (const e of list) {
    const g = groups.get(e[field]) ?? { legend: e[field], games: 0, wins: 0 };
    g.games++;
    if (e.won) g.wins++;
    groups.set(e[field], g);
  }
  return [...groups.values()].sort((a, b) => !a.legend - !b.legend || b.games - a.games || a.legend.localeCompare(b.legend));
}

/**
 * Totals, the current streak (same result in a row, from the latest game) and
 * the record against each opposing legend and with each of yours.
 */
export function diaryStats(list) {
  const wins = list.filter((e) => e.won).length;
  let streak = 0;
  while (streak < list.length && list[streak].won === list[0].won) streak++;
  return {
    games: list.length,
    wins,
    losses: list.length - wins,
    rate: winRate(wins, list.length),
    streak: list.length ? { won: list[0].won, count: streak } : null,
    byOpp: byLegend(list, "opp"),
    byMine: byLegend(list, "mine"),
  };
}
