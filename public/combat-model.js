// Calcolatore di combattimento: le regole, senza interfaccia (così si possono
// testare). Might effettivo di ogni unità, danni del Combat Damage Step (460),
// esito del combattimento (461) e quanto manca per eliminare le unità avversarie.

/** Token units a combat often involves (rule 184). */
export const TOKENS = [
  { name: "Recruit", base: 1 },
  { name: "Sand Soldier", base: 2 },
  { name: "Mech", base: 3 },
  { name: "Sprite", base: 3 },
  { name: "Bird", base: 1 },
];

const int = (v, min, max) => Math.min(max, Math.max(min, Math.trunc(Number(v)) || 0));

/** A unit with every modifier at its default; unknown fields are dropped and numbers kept in range. */
export function makeUnit(data = {}) {
  return {
    id: String(data.id ?? Math.random().toString(36).slice(2, 10)),
    name: String(data.name ?? "Unità").slice(0, 60),
    base: int(data.base, 0, 30), // printed Might
    assault: int(data.assault, 0, 20), // +X while attacking (807)
    shield: int(data.shield, 0, 20), // +X while defending (814)
    tank: Boolean(data.tank), // assigned lethal damage first (815)
    backline: Boolean(data.backline), // assigned lethal damage last (826)
    buff: Boolean(data.buff), // at most one buff, +1 (702.3, 703)
    temp: int(data.temp, -30, 30), // "+X this turn" and similar
    gear: int(data.gear, -10, 10), // Might Bonus of attached gear (137)
    damage: int(data.damage, 0, 30), // already marked on it
    stunned: Boolean(data.stunned), // deals no combat damage (423.1.b)
    first: Boolean(data.first), // the assigning player wants it dealt with first
    check: Boolean(data.check), // its text may change the numbers: worth a look
  };
}

/** Current Might as attacker ("attack") or defender ("defend"): can be negative (143.2.b.1). */
export const mightOf = (u, role) =>
  u.base + (u.buff ? 1 : 0) + u.temp + u.gear + (role === "attack" ? u.assault : u.shield);

/** What the unit adds to its side's combat damage: stunned units add nothing, negative Might counts as 0. */
export const dealtBy = (u, role) => (u.stunned ? 0 : Math.max(0, mightOf(u, role)));

/** Damage still needed to kill it: lethal is non-zero and at least its full Might (143.2.a, 423.1.c). */
export const lethalFor = (u, role) => Math.max(1, mightOf(u, role) - u.damage);

export const totalMight = (units, role) => units.reduce((sum, u) => sum + dealtBy(u, role), 0);

/**
 * The order the opposing player assigns damage in: Tank first, Backline last
 * (a unit with both counts as Tank, 460.2.c.7). Within the same priority the
 * player chooses (460.2.c.6): units marked "first", then the ones cheapest to
 * kill, so the suggestion kills as many units as possible.
 */
export function damageOrder(units, role) {
  const rank = (u) => (u.tank ? 0 : u.backline ? 2 : 1);
  return units
    .map((u, i) => ({ u, i }))
    .sort((a, b) => rank(a.u) - rank(b.u) || b.u.first - a.u.first || lethalFor(a.u, role) - lethalFor(b.u, role) || a.i - b.i)
    .map(({ u }) => u);
}

/**
 * Assign `amount` damage to `units` (460.2.c): each one gets lethal damage in
 * full before the next, and no more than lethal while others remain.
 * Returns { byId: Map(id -> { assigned, dies }), order, left } where `left` is the unused damage.
 */
export function assignDamage(units, role, amount) {
  const order = damageOrder(units, role);
  const byId = new Map();
  let left = amount;
  for (const u of order) {
    const need = lethalFor(u, role);
    const assigned = Math.min(need, left);
    left -= assigned;
    byId.set(u.id, { assigned, dies: assigned >= need });
  }
  return { byId, order, left };
}

/** How much more damage kills one more unit, and how much kills them all. */
function missing(order, byId, role) {
  const next = order.find((u) => !byId.get(u.id).dies);
  if (!next) return null;
  const all = order.reduce((sum, u) => sum + lethalFor(u, role) - byId.get(u.id).assigned, 0);
  return { next: next.name, forNext: lethalFor(next, role) - byId.get(next.id).assigned, forAll: all };
}

/**
 * Resolve a combat between `attackers` and `defenders`.
 * outcome (461): "conquer" only attackers remain; "defended" only defenders
 * remain; "recalled" both remain, so the attackers go back to base and the
 * defender keeps the battlefield; "none" nobody remains. null until both sides have units.
 */
export function resolveCombat(attackers, defenders) {
  const attack = totalMight(attackers, "attack");
  const defense = totalMight(defenders, "defend");
  const toDefenders = assignDamage(defenders, "defend", attack);
  const toAttackers = assignDamage(attackers, "attack", defense);
  const attackersLeft = attackers.filter((u) => !toAttackers.byId.get(u.id).dies).length;
  const defendersLeft = defenders.filter((u) => !toDefenders.byId.get(u.id).dies).length;
  let outcome = null;
  if (attackers.length && defenders.length) {
    if (attackersLeft && !defendersLeft) outcome = "conquer";
    else if (!attackersLeft && defendersLeft) outcome = "defended";
    else if (attackersLeft && defendersLeft) outcome = "recalled";
    else outcome = "none";
  }
  return {
    attack,
    defense,
    toDefenders: toDefenders.byId,
    toAttackers: toAttackers.byId,
    attackersLeft,
    defendersLeft,
    outcome,
    attackMissing: missing(toDefenders.order, toDefenders.byId, "defend"),
    defenseMissing: missing(toAttackers.order, toAttackers.byId, "attack"),
  };
}

/** One unit for the judge: "Chemtech Enforcer: Might 4 (base 2, Assault 2), Tank, 1 danno già subito". */
function describeUnit(u, role) {
  const parts = [];
  if (u.buff) parts.push("buff +1");
  if (u.temp) parts.push(`${u.temp > 0 ? "+" : ""}${u.temp} questo turno`);
  if (u.gear) parts.push(`equipaggiamento ${u.gear > 0 ? "+" : ""}${u.gear}`);
  if (role === "attack" && u.assault) parts.push(`Assault ${u.assault}`);
  if (role === "defend" && u.shield) parts.push(`Shield ${u.shield}`);
  const might = mightOf(u, role);
  let s = `${u.name}: Might ${might}${parts.length ? ` (base ${u.base}, ${parts.join(", ")})` : ""}`;
  if (u.tank) s += ", Tank";
  if (u.backline) s += ", Backline";
  if (u.stunned) s += ", stordita";
  if (u.damage) s += `, ${u.damage} ${u.damage === 1 ? "danno" : "danni"} già subiti`;
  return s;
}

/** The combat as a question for the judge; names are the two players, attackers first. */
export function describeCombat(attackers, defenders, [attackerName, defenderName]) {
  const list = (units, role) => units.map((u) => `- ${describeUnit(u, role)}`).join("\n");
  return (
    `Combattimento su un battlefield.\n` +
    `Attaccanti (${attackerName}):\n${list(attackers, "attack")}\n` +
    `Difensori (${defenderName}):\n${list(defenders, "defend")}\n` +
    `Come si risolve questo combattimento?`
  );
}

/** A saved combat, checked: { attacker: "bottom" | "top", bottom: [units], top: [units] }. */
export function restoreCombat(raw) {
  const units = (list) => (Array.isArray(list) ? list.slice(0, 30).map(makeUnit) : []);
  return {
    attacker: raw?.attacker === "top" ? "top" : "bottom",
    bottom: units(raw?.bottom),
    top: units(raw?.top),
  };
}
