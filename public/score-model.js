// Regole del segnapunti, dalle Core Rules: modalità di gioco (479-484),
// come si segna (464-466) e quando si vince (467). Logica pura, senza DOM:
// ogni funzione restituisce un nuovo stato ed è testabile anche in Node.

export const MODES = {
  duel: { label: "1v1 · Duello", players: 2, victory: 8, bestOf: 1, rule: "480" },
  match: { label: "1v1 · Al meglio di 3", players: 2, victory: 8, bestOf: 3, rule: "481" },
  ffa3: { label: "Tutti contro tutti · 3", players: 3, victory: 8, bestOf: 1, rule: "482" },
  ffa4: { label: "Tutti contro tutti · 4", players: 4, victory: 8, bestOf: 1, rule: "483" },
  team: { label: "2v2 · Squadre", players: 2, victory: 11, bestOf: 1, rule: "484", teams: true },
};

export const KIND_LABEL = { conquer: "Conquista", hold: "Tenuta", other: "Altra fonte", minus: "Correzione" };

export function defaultNames(mode) {
  const m = MODES[mode] ?? MODES.duel;
  if (m.teams) return ["La tua squadra", "Avversari"];
  if (m.players === 2) return ["Tu", "Avversario"];
  return ["Tu", ...Array.from({ length: m.players - 1 }, (_, i) => `Avversario ${i + 1}`)];
}

export function newGame(mode, names = [], victory) {
  const key = Object.hasOwn(MODES, mode) ? mode : "duel";
  return {
    mode: key,
    victory: victory ?? MODES[key].victory,
    players: defaultNames(key).map((d, i) => ({ name: String(names[i] ?? "").trim() || d, points: 0, wins: 0 })),
    log: [], // { player, kind, delta, drew? } — newest last
    winner: null, // index of this game's winner
    matchWinner: null, // index of the best-of-3 winner
    round: 1,
  };
}

/** One point (or more) from the Victory Score: the Winning Point rules apply (466.1.b). */
export const atMatchPoint = (g, i) => g.players[i].points >= g.victory - 1;

/** 467: at least the Victory Score and strictly more points than every opponent. */
export function winnerOf(g) {
  const i = g.players.findIndex(
    (p, j) => p.points >= g.victory && g.players.every((o, k) => k === j || p.points > o.points),
  );
  return i === -1 ? null : i;
}

function apply(g, entry) {
  const players = g.players.map((p, j) => (j === entry.player ? { ...p, points: p.points + entry.delta } : p));
  const next = { ...g, players, log: [...g.log, entry] };
  return { ...next, winner: winnerOf(next) };
}

/**
 * Record a point for player `i`. `kind`: "conquer" | "hold" | "other" | "minus".
 * A Conquer at match point needs `allBattlefields` (did the player score every
 * battlefield this turn?): without it the result asks for it; if false the
 * player gets no point and draws a card instead (466.1.b.2). Hold always
 * scores the Winning Point (466.1.b.1); other sources are not restricted (466.1.a.1).
 */
export function score(g, i, kind, { allBattlefields } = {}) {
  if (g.winner !== null || !g.players[i] || !Object.hasOwn(KIND_LABEL, kind)) return { game: g };
  if (kind === "minus") {
    return g.players[i].points > 0 ? { game: apply(g, { player: i, kind, delta: -1 }) } : { game: g };
  }
  if (kind === "conquer" && atMatchPoint(g, i)) {
    if (allBattlefields === undefined) return { game: g, needsAllBattlefields: true };
    if (!allBattlefields) return { game: apply(g, { player: i, kind, delta: 0, drew: true }), drew: true };
  }
  return { game: apply(g, { player: i, kind, delta: 1 }) };
}

/** Undo the last recorded action. */
export function undo(g) {
  const last = g.log.at(-1);
  if (!last) return g;
  const players = g.players.map((p, j) => (j === last.player ? { ...p, points: p.points - last.delta } : p));
  const next = { ...g, players, log: g.log.slice(0, -1) };
  return { ...next, winner: winnerOf(next) };
}

/** Best of 3: bank the game win and start the next game, or declare the match winner. */
export function nextRound(g) {
  if (g.winner === null || g.matchWinner !== null) return g;
  const players = g.players.map((p, j) => ({ ...p, wins: p.wins + (j === g.winner ? 1 : 0) }));
  const needed = Math.ceil(MODES[g.mode].bestOf / 2);
  const champion = players.findIndex((p) => p.wins >= needed);
  if (champion !== -1) return { ...g, players, matchWinner: champion };
  return { ...g, players: players.map((p) => ({ ...p, points: 0 })), log: [], winner: null, round: g.round + 1 };
}

/** "6–7" for duels, "6 · 7 · 3" with more players. */
export const summary = (g) => g.players.map((p) => p.points).join(g.players.length === 2 ? "–" : " · ");

/** What the judge is told about the game (see sanitizeGame on the server). */
export const toContext = (g) => ({
  mode: g.mode,
  victory: g.victory,
  players: g.players.map(({ name, points, wins }) => ({ name, points, wins })),
});

/** Validate a game restored from storage (it may be old or tampered with). */
export function restoreGame(raw) {
  try {
    if (!raw || !Object.hasOwn(MODES, raw.mode) || !Array.isArray(raw.players) || raw.players.length < 2) return null;
    // Same bounds as the setup screen: a huge value would draw a huge row of pips.
    const victory = Math.min(30, Math.max(1, Math.trunc(Number(raw.victory)) || MODES[raw.mode].victory));
    const g = newGame(raw.mode, raw.players.map((p) => p?.name), victory);
    g.players = g.players.map((p, i) => ({
      ...p,
      points: Math.max(0, Math.trunc(Number(raw.players[i]?.points) || 0)),
      wins: Math.max(0, Math.trunc(Number(raw.players[i]?.wins) || 0)),
    }));
    const valid = (e) => g.players[e?.player] && Object.hasOwn(KIND_LABEL, e.kind) && [-1, 0, 1].includes(e.delta);
    g.log = Array.isArray(raw.log) ? raw.log.filter(valid) : [];
    g.round = Math.max(1, Math.trunc(Number(raw.round) || 1));
    g.winner = winnerOf(g);
    g.matchWinner = Number.isInteger(raw.matchWinner) && g.players[raw.matchWinner] ? raw.matchWinner : null;
    return g;
  } catch {
    return null;
  }
}
