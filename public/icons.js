// Icone dell'app: disegnate una volta sola nello sprite SVG di index.html e
// riusate ovunque. Sono decorative: il testo accanto (o aria-label) dice cosa fanno.

/** Markup for icon `name` (e.g. "trophy"); `cls` adds extra classes. */
export const icon = (name, cls = "") =>
  `<svg class="i${cls ? ` ${cls}` : ""}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
