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
 * The app's version and its service worker source for `publicDir`. `dataFiles`
 * also change the version, because cached rule and card lookups depend on them.
 * The server stamps every file with the version (X-App-Version), so the phone
 * never stores files of two versions together (e.g. during a deploy).
 */
export function buildOffline(publicDir, dataFiles = []) {
  const template = fs.readFileSync(new URL("./service-worker.js", import.meta.url), "utf8");
  const files = listFiles(publicDir).filter((f) => !SKIP.test(f));
  const hash = crypto.createHash("sha256");
  for (const f of files) hash.update(f).update(fs.readFileSync(path.join(publicDir, f)));
  for (const f of dataFiles) if (fs.existsSync(f)) hash.update(fs.readFileSync(f));
  hash.update(template);
  const version = hash.digest("hex").slice(0, 12);
  const assets = files.map((f) => (f === "index.html" ? "/" : `/${f}`));
  return { version, script: template.replace("__VERSION__", version).replace('["__ASSETS__"]', JSON.stringify(assets)) };
}

/** Just the service worker source (see buildOffline). */
export const buildServiceWorker = (publicDir, dataFiles) => buildOffline(publicDir, dataFiles).script;
