import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildServiceWorker } from "../src/offline.js";
import { withServer } from "./helpers.mjs";

const versionOf = (source) => /const VERSION = "([0-9a-f]{12})"/.exec(source)?.[1];

test("the service worker lists the app files and is never cached stale", async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/sw.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /javascript/);
    assert.equal(res.headers.get("cache-control"), "no-cache");
    const source = await res.text();
    assert.ok(versionOf(source));
    const assets = JSON.parse(/const ASSETS = (\[.*\]);/.exec(source)[1]);
    for (const file of ["/", "/app.js", "/styles.css", "/fonts/cinzel-latin.woff2"]) assert.ok(assets.includes(file), file);
    assert.ok(!assets.includes("/index.html"));
    assert.ok(!assets.some((a) => a.includes("icon-512")));
    // Every listed file really exists (a 404 would make the install fail).
    for (const a of assets) assert.equal((await fetch(base + a)).status, 200, a);
  });
});

test("the version changes only when a file changes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jrb-sw-"));
  try {
    fs.writeFileSync(path.join(dir, "index.html"), "<p>v1</p>");
    fs.writeFileSync(path.join(dir, "app.js"), "1");
    const data = path.join(dir, "rules.txt");
    fs.writeFileSync(data, "rules v1");
    const v1 = versionOf(buildServiceWorker(dir, [data]));
    assert.equal(versionOf(buildServiceWorker(dir, [data])), v1);
    fs.writeFileSync(path.join(dir, "app.js"), "2");
    const v2 = versionOf(buildServiceWorker(dir, [data]));
    assert.notEqual(v2, v1);
    fs.writeFileSync(data, "rules v2");
    assert.notEqual(versionOf(buildServiceWorker(dir, [data])), v2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fonts and icons are cached by the browser, the rest is revalidated", async () => {
  await withServer({}, async (base) => {
    assert.match((await fetch(`${base}/fonts/cinzel-latin.woff2`)).headers.get("cache-control"), /max-age=604800/);
    assert.match((await fetch(`${base}/app.js`)).headers.get("cache-control"), /max-age=0/);
  });
});
