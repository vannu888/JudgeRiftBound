// Prepara il service worker (/sw.js): la versione è un'impronta dei file
// dell'app, del regolamento e delle carte, quindi il telefono riscarica tutto
// solo quando qualcosa cambia davvero (es. dopo un `git pull`).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Needed only when the app is added to the Home Screen, or not at all.
const SKIP = /^(?:icons\/icon-(?:192|512|maskable-512)\.png|fonts\/OFL\.txt)$/;

function listFiles(dir, prefix = "") {
  return fs
    .readdirSync(path.join(dir, prefix), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? listFiles(dir, `${prefix}${e.name}/`) : [`${prefix}${e.name}`]))
    .sort();
}

/**
 * The service worker source for `publicDir`. `dataFiles` also change the
 * version, because cached rule and card lookups depend on them.
 */
export function buildServiceWorker(publicDir, dataFiles = []) {
  const template = fs.readFileSync(new URL("./service-worker.js", import.meta.url), "utf8");
  const files = listFiles(publicDir).filter((f) => !SKIP.test(f));
  const hash = crypto.createHash("sha256");
  for (const f of files) hash.update(f).update(fs.readFileSync(path.join(publicDir, f)));
  for (const f of dataFiles) if (fs.existsSync(f)) hash.update(fs.readFileSync(f));
  hash.update(template);
  const assets = files.map((f) => (f === "index.html" ? "/" : `/${f}`));
  return template
    .replace("__VERSION__", hash.digest("hex").slice(0, 12))
    .replace('["__ASSETS__"]', JSON.stringify(assets));
}
