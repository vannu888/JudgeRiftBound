import test from "node:test";
import assert from "node:assert/strict";
import { rscPayload, variantsFrom, toRecord, cleanText, richText, baseName, fromOfficial, fromRiftcodex, mergeCards } from "../scripts/fetch-cards.mjs";

// A page shaped like piltoverarchive.com's Next.js output: the data is split
// across several self.__next_f.push([1,"<js string>"]) chunks.
const variant = {
  id: "11111111-1111-1111-1111-111111111111",
  variantNumber: "OGN-001",
  flavorText: "should not be kept",
  card: {
    id: "22222222-2222-2222-2222-222222222222",
    name: "Test Unit",
    type: "Unit",
    super: "Champion",
    description: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮: [Tank]   \nDeal 2.",
    energy: 3,
    power: 1,
    might: 4,
    mightBonus: 0,
    tags: ["Test"],
    effect: null,
    colors: [{ name: "Fury", hexCode: "#CB222D" }],
  },
};
const json = `9:["$","div",null,{"cards":[${JSON.stringify(variant)}]}]`;
const half = Math.floor(json.length / 2);
const html = [json.slice(0, half), json.slice(half)]
  .map((part) => `<script>self.__next_f.push([1,${JSON.stringify(part)}])</script>`)
  .join("");

test("the RSC payload is reassembled and variants are found", () => {
  const payload = rscPayload(html);
  assert.equal(payload, json);
  const found = variantsFrom(payload);
  assert.equal(found.length, 1);
  assert.equal(found[0].card.name, "Test Unit");
});

test("records keep only functional fields and clean the text", () => {
  const rec = toRecord(variant.card);
  assert.deepEqual(rec.domains, ["Fury"]);
  assert.equal(rec.supertype, "Champion");
  assert.equal(rec.text, "Card Errata: [Tank]\nDeal 2.");
  assert.equal(rec.mightBonus, undefined);
  assert.equal("flavorText" in rec, false);
});

test("cleanText handles empty values", () => {
  assert.equal(cleanText("   "), undefined);
  assert.equal(cleanText(null), undefined);
});

test("Riot's rich text becomes this app's card text", () => {
  assert.equal(
    richText("<p>[Equip] :rb_energy_1::rb_rune_fury: (Attach.)<br />Give +2 :rb_might: &amp; draw.</p>"),
    "[Equip] [1][Fury] (Attach.)\nGive +2 [Might] & draw.",
  );
  assert.equal(richText("<p>Choose one —</p><ul><li>Ready 2 runes.</li><li>Buff.</li></ul>"), "Choose one —\n- Ready 2 runes.\n- Buff.");
  assert.equal(richText("<p>[Empowered][&gt;] I have +1 :rb_might:. :rb_exhaust:: go. :rb_rune_rainbow:</p>"), "[Empowered] I have +1 [Might]. [Tap]: go. [Rune]");
  assert.equal(richText(undefined), undefined);
});

test("names from the other sources are normalized", () => {
  assert.equal(baseName("Vi - Piltover Enforcer (Signature)"), "Vi, Piltover Enforcer");
  assert.equal(baseName("Recruit (273) // Buff"), "Recruit");
  const legend = fromOfficial({
    name: "Heart of the Tempest",
    cardType: { type: [{ label: "Legend" }] },
    tags: { tags: ["Kennen"] },
    publicCode: "VEN-155/166",
    rarity: { value: { label: "Rare" } },
    set: { value: { label: "Vendetta" } },
    text: { richText: { body: "<p>Hi :rb_might:</p>" } },
  });
  assert.equal(legend.name, "Kennen, Heart of the Tempest");
  assert.deepEqual(legend.codes, ["VEN-155"]);
  assert.equal(legend.text, "Hi [Might]");
  const unit = fromOfficial({ name: "Ahri", subtitle: "Inquisitive", cardType: { type: [{ label: "Unit" }], superType: [{ label: "Champion" }] }, energy: { value: { id: 3 } }, publicCode: "OGN-001/298" });
  assert.equal(unit.name, "Ahri, Inquisitive");
  assert.equal(unit.supertype, "Champion");
  assert.equal(unit.energy, 3);
  assert.deepEqual(fromRiftcodex({ name: "Sky Cruiser", riftbound_id: "ven-060-166", classification: { type: "Unit" }, text: {} }).codes, ["VEN-060"]);
});

test("sources are merged: majority name, aliases, errata kept, new cards added", () => {
  const base = [
    { id: "1", name: "Stagazer", type: "Unit", text: "Draw 1.", codes: ["VEN-098"] },
    { id: "2", name: "Blighted Battleaxe", type: "Gear", text: "[Equip][1][Rune]", codes: ["UNL-019"] },
    { id: "3", name: "Arise!", type: "Spell", text: "Card Errata: Then ready up to two of them.", codes: ["SFD-100"] },
    { id: "4", name: "Sky Cruiser", type: "Unit", text: "Fly.", codes: ["VEN-060"] },
  ];
  const official = [
    { name: "Stargazer", type: "Unit", text: "Draw 1.", codes: ["VEN-098"], rarity: "Common" },
    { name: "Blighted Battleaxe", type: "Gear", text: "[Equip] [1][Fury]", codes: ["UNL-019"] },
    { name: "Arise!", type: "Spell", text: "Then ready two of them.", codes: ["SFD-100"] },
    { name: "Sky Crusier", type: "Unit", text: "Fly.", codes: ["VEN-060"] },
    { name: "Ekko, Radiant", type: "Unit", text: "New!", codes: ["RAD-001"] },
  ];
  const riftcodex = [
    { name: "Stargazer", type: "Unit", codes: ["VEN-098"] },
    { name: "Sky Cruiser", type: "Unit", codes: ["VEN-060"] },
    { name: "Totally Different", type: "Unit", codes: ["VEN-060"] }, // a variant under another name
  ];
  const out = mergeCards(base, [
    { source: "official", cards: official },
    { source: "riftcodex", cards: riftcodex },
  ]);
  const by = Object.fromEntries(out.map((c) => [c.name, c]));
  assert.ok(by.Stargazer, "two sources out of three say Stargazer");
  assert.deepEqual(by.Stargazer.aliases, ["Stagazer"]);
  assert.equal(by.Stargazer.rarity, "Common");
  assert.deepEqual(by["Sky Cruiser"].aliases, ["Sky Crusier"]);
  assert.equal(by["Blighted Battleaxe"].text, "[Equip] [1][Fury]", "the official text fixes the typo");
  assert.match(by["Arise!"].text, /Errata/, "an errata is never replaced by the printed text");
  assert.equal(by["Ekko, Radiant"].source, "official");
  assert.equal(out.length, 5);
  assert.ok(!("spellings" in by.Stargazer));
});
