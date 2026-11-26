// Node test for pricing.ts — run: node test-pricing.mjs
// (Node 24 strips the erasable TS types on import.)
import {
  boidColour,
  buildBlColourMap,
  cheapestAcrossBoids,
  cheapestUsdLot,
  pickBoids,
  priceKey,
} from "./pricing.ts";

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.log("FAIL " + label + "\n  actual:   " + JSON.stringify(actual) + "\n  expected: " + JSON.stringify(expected));
  } else {
    console.log("ok   " + label);
  }
}

// BOID colour segment (verified live: 771344-79 is Olive Green 3001).
check("boid: suffix is the colour", boidColour("771344-79"), "79");
check("boid: no dash is null", boidColour("771344"), null);
check("boid: empty is null", boidColour(""), null);

// BrickLink -> BrickOwl colour map, from a color_list slice.
const COLORS = {
  "79": { name: "Olive Green", bl_ids: ["155"], lego_colors: [{ lego_id: "330" }] },
  "81": { name: "Red", bl_ids: ["5"], lego_colors: [{ lego_id: "21" }] },
  "38": { name: "Black", bl_ids: ["11"], lego_colors: [{ lego_id: "26" }] },
};
check("colormap: BL 155 is BrickOwl 79", buildBlColourMap(COLORS)["155"], "79");
check("colormap: BL 5 is BrickOwl 81", buildBlColourMap(COLORS)["5"], "81");
check("colormap: unknown BL id is absent", buildBlColourMap(COLORS)["999"], undefined);

// BOID picking: exact colour vs colour-doesn't-matter.
const BOIDS = ["771344-79", "771344-81", "771344-38"];
check("pick: exact colour keeps one BOID", pickBoids(BOIDS, "81", false), ["771344-81"]);
check("pick: exact colour with no match is empty", pickBoids(BOIDS, "999", false), []);
check("pick: blind keeps every BOID", pickBoids(BOIDS, "81", true), BOIDS);
check("pick: exact with no colour id is empty", pickBoids(BOIDS, null, false), []);

// Cheapest USD lot: only USD lots count, other currencies ignored.
const LOTS = {
  "1": { price: "0.750", base_currency: "USD" },
  "2": { price: "0.250", base_currency: "USD" },
  "3": { price: "0.050", base_currency: "GBP" },
  "4": { price: "2.990", base_currency: "USD" },
  "5": { price: "bad", base_currency: "USD" },
};
check("usd: cheapest USD lot wins", cheapestUsdLot(LOTS), 0.25);
check("usd: a cheaper GBP lot never counts", cheapestUsdLot({ "3": { price: "0.050", base_currency: "GBP" } }), null);
check("usd: no lots is null", cheapestUsdLot({}), null);
check("usd: null input is null", cheapestUsdLot(null), null);

// Cheapest across BOIDs, skipping nulls.
check("across: min over BOIDs", cheapestAcrossBoids({ a: 0.5, b: null, c: 0.25 }), 0.25);
check("across: all null is null", cheapestAcrossBoids({ a: null, b: null }), null);

// Cache keys: exact keys on colour, blind keys on the part alone.
check("key: exact", priceKey("3001", 5, false), "3001|5");
check("key: blind", priceKey("3001", 5, true), "3001|any");
check("key: exact and blind differ", priceKey("3001", 5, false) !== priceKey("3001", 5, true), true);

console.log(failures === 0 ? "\nALL PASS" : "\n" + failures + " FAILURES");
process.exit(failures === 0 ? 0 : 1);
