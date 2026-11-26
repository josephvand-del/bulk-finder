// Node test for suggest.ts — run: node test-suggest.mjs
// (Node 24 strips the erasable TS types on import.)
import {
  aggregateCandidates,
  colorTableFromList,
  partColoursFromList,
  rankSuggestions,
  resolveRbColourId,
  suggestCacheKey,
  topPartColours,
} from "./suggest.ts";

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

// Colour table: Rebrickable ids with BrickLink external ids.
const COLORS = colorTableFromList([
  { id: 0, name: "Black", external_ids: { BrickLink: { ext_ids: [11] } } },
  { id: 4, name: "Red", external_ids: { BrickLink: { ext_ids: [5] } } },
  { id: 1, name: "Blue", external_ids: { BrickLink: { ext_ids: [7] } } },
  { id: 5, name: "Dark Pink", external_ids: { BrickLink: { ext_ids: [47] } } },
  { id: 62, name: "Dark Bluish Gray", external_ids: { BrickLink: { ext_ids: [85] } } },
  { id: 63, name: "Light Bluish Gray", external_ids: { BrickLink: { ext_ids: [86] } } },
  { id: 28, name: "Lime", external_ids: { BrickLink: { ext_ids: [34] } } },
  { id: 15, name: "Trans-Blue", external_ids: { BrickLink: { ext_ids: [14] } } },
  { id: 20, name: "Trans-Clear", external_ids: { BrickLink: { ext_ids: [12] } } },
]);
check("colors: table flattens BrickLink ids", COLORS[0], { id: 0, name: "Black", blIds: ["11"] });

// Colour resolution: BrickLink id first, then exact name, then the
// display -> LEGO -> Rebrickable chain.
check("resolve: BL 11 is Black", resolveRbColourId("Black", 11, COLORS), 0);
check("resolve: BL 5 is Red", resolveRbColourId("Red", 5, COLORS), 4);
check("resolve: name match without BL id", resolveRbColourId("Red", null, COLORS), 4);
check("resolve: Trans-Blue by name", resolveRbColourId("Trans-Blue", null, COLORS), 15);
check("resolve: Dark Grey chains to Dark Bluish Gray", resolveRbColourId("Dark Grey", null, COLORS), 62);
check("resolve: Light Grey chains to Light Bluish Gray", resolveRbColourId("Light Grey", null, COLORS), 63);
check("resolve: Lime Green chains to Lime", resolveRbColourId("Lime Green", null, COLORS), 28);
check("resolve: Clear chains to Trans-Clear", resolveRbColourId("Clear", null, COLORS), 20);
check("resolve: unknown colour is null", resolveRbColourId("Not A Colour", null, COLORS), null);
check("resolve: Bright Purple has no Rebrickable name match", resolveRbColourId("Bright Purple", null, COLORS), null);

// Aggregation: two bulk lots, three sets. A shares both lots, B
// shares one, C shares the other; a set listed twice for one lot
// still counts once.
const SET_A = { set_num: "1000-1", name: "Alpha", year: 2020, num_parts: 10, set_img_url: null };
const SET_B = { set_num: "2000-1", name: "Beta", year: 2021, num_parts: 8, set_img_url: null };
const SET_C = { set_num: "3000-1", name: "Gamma", year: 2019, num_parts: 50, set_img_url: null };
const PART_RESULTS = [
  { part: "3001", colour: "Black", qty: 6, sets: [SET_A, SET_B] },
  { part: "3001", colour: "Black", qty: 6, sets: [SET_A] },
  { part: "3747", colour: "Dark Grey", qty: 2, sets: [SET_A, SET_C] },
];
const cands = aggregateCandidates(PART_RESULTS, false);
check("agg: three candidates", cands.map((c) => c.set_num), ["1000-1", "2000-1", "3000-1"]);
check("agg: A covers 2 lots", cands[0].lotsCovered, 2);
check("agg: A missing upper is 8", cands[0].missingUpper, 8);
check("agg: B covers 1 lot, missing 7", [cands[1].lotsCovered, cands[1].missingUpper], [1, 7]);
check("agg: C covers 1 lot, missing 49", [cands[2].lotsCovered, cands[2].missingUpper], [1, 49]);
check("agg: duplicate listing does not double count", cands[0].lotsCovered, 2);

// Blind mode: the same part in two colours counts once per set.
const BLIND_RESULTS = [
  { part: "3001", colour: "Black", qty: 6, sets: [SET_A] },
  { part: "3001", colour: "Red", qty: 2, sets: [SET_A] },
];
check("agg blind: one part in two colours is one lot", aggregateCandidates(BLIND_RESULTS, true)[0].lotsCovered, 1);
check("agg exact: one part in two colours is two lots", aggregateCandidates(BLIND_RESULTS, false)[0].lotsCovered, 2);

// Ranking: pieces by lots covered, fewest by missing upper,
// newest by year, price like fewest.
check("rank: pieces puts A first", rankSuggestions(cands, "pieces")[0].set_num, "1000-1");
check("rank: fewest puts B first (7 missing)", rankSuggestions(cands, "fewest")[0].set_num, "2000-1");
check("rank: price ranks like fewest", rankSuggestions(cands, "price")[0].set_num, "2000-1");
check("rank: newest puts B first (2021)", rankSuggestions(cands, "newest")[0].set_num, "2000-1");

// Cache key: order-independent, blind-sensitive.
const PARTS = [{ part: "3001", colour: "Black", qty: 6 }, { part: "3747", colour: "Dark Grey", qty: 2 }];
check("key: stable across part order", suggestCacheKey(PARTS, false), suggestCacheKey([PARTS[1], PARTS[0]], false));
check("key: blind differs from exact", suggestCacheKey(PARTS, true) !== suggestCacheKey(PARTS, false), true);
check("key: different qty differs", suggestCacheKey(PARTS, false) !== suggestCacheKey([{ part: "3001", colour: "Black", qty: 5 }, PARTS[1]], false), true);

// v3.42 — the aggregation output carries the shared lot keys, so the
// app can show the bulk pieces used per suggestion (tweak D).
const aggA = aggregateCandidates(PART_RESULTS, false).find((c) => c.set_num === "1000-1");
check("agg shared lists the bulk lots", aggA.shared, ["3001|Black", "3747|Dark Grey"]);
const aggB = aggregateCandidates(PART_RESULTS, false).find((c) => c.set_num === "2000-1");
check("agg shared has one lot for B", aggB.shared, ["3001|Black"]);
const aggBlind = aggregateCandidates(BLIND_RESULTS, true);
check("agg blind shared keys by part number", aggBlind[0].shared, ["3001"]);
check("agg blind lotsCovered counts parts not lots", aggBlind[0].lotsCovered, 1);

// v3.42 — blind mode colour picking (tweak E): the colours endpoint
// rows flatten to {id, name, numSets} and the top picks by num_sets
// skip the bulk colour itself.
const pc = partColoursFromList([
  { color_id: 0, color_name: "Black", num_sets: 500 },
  { color_id: 11, color_name: "Trans-Black", num_sets: 12 },
  { color_id: 85, color_name: "Dark Bluish Gray", num_sets: 300 },
  { color_id: "x", color_name: "Junk", num_sets: 9 },
  { color_id: 1, color_name: "Blue", num_sets: 200 },
]);
check("partColoursFromList flattens rows", pc.length, 4);
check("partColoursFromList keeps numSets", pc.find((c) => c.id === 0), { id: 0, name: "Black", numSets: 500 });
check("partColoursFromList drops non-numeric ids", pc.some((c) => c.name === "Junk"), false);
check("topPartColours picks most sets first", topPartColours(pc, 0, 2).map((c) => c.id), [85, 1]);
check("topPartColours excludes the bulk colour", topPartColours(pc, 85, 5).some((c) => c.id === 85), false);
check("topPartColours returns empty for one-colour parts", topPartColours([{ id: 0, name: "Black", numSets: 3 }], 0, 2).length, 0);
check("topPartColours honours n", topPartColours(pc, null, 1).length, 1);

console.log(failures === 0 ? "\nALL PASS" : "\n" + failures + " FAILURES");
process.exit(failures === 0 ? 0 : 1);
