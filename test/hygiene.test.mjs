// Invisible or combining characters inside source code (for example a
// zero-width space pasted into a regex) are indistinguishable when reading
// the code; they must always be written as \u escapes.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), "..");
const invisible = (cp) => (cp >= 0x300 && cp < 0x370) || (cp >= 0x200b && cp <= 0x200f) || cp === 0x2028 || cp === 0x2029 || cp === 0xfeff;

test("source files contain no invisible or combining characters", () => {
  const files = ["server.js"];
  for (const dir of ["src", "public", "scripts", "test"]) {
    for (const f of fs.readdirSync(path.join(root, dir))) if (/\.(m?js|css|html)$/.test(f)) files.push(path.join(dir, f));
  }
  const offenders = [];
  for (const f of files) {
    const lines = fs.readFileSync(path.join(root, f), "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const ch of line) if (invisible(ch.codePointAt(0))) offenders.push(`${f}:${i + 1} U+${ch.codePointAt(0).toString(16)}`);
    });
  }
  assert.deepEqual(offenders, []);
});
