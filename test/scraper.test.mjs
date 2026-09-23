import test from "node:test";
import assert from "node:assert/strict";
import { rscPayload, variantsFrom, toRecord, cleanText } from "../scripts/fetch-cards.mjs";

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
