// Bulk Finder — BrickOwl pricing helpers (pure, no I/O).
// Shared by the get-prices Edge Function. Testable in plain Node:
//   node test-pricing.mjs
// (Node 24 strips the erasable TS types on import.)
//
// BrickOwl facts (verified live 2026-11-25, see the connector doc):
//   - A part's BOIDs come from catalog/id_lookup by design_id, one
//     BOID per colour, shaped "<base>-<brickowl colour id>" — e.g.
//     771344-79 is the Olive Green Brick 2 x 4 (colour id 79).
//   - catalog/availability with country=US, store_country=US,
//     condition=new returns the lots for sale; each lot carries
//     price (a string) and base_currency — US stores list in USD.
//   - catalog/availability_basic and price_history return GBP.
//     This module only ever prices in USD, from availability lots.

export interface BoLot {
  price?: string | number;
  base_currency?: string;
  [key: string]: unknown;
}

export interface BoColorEntry {
  name?: string;
  bl_ids?: (string | number)[];
  lego_colors?: { lego_id?: string | number }[];
  [key: string]: unknown;
}

// The BOID's colour segment: "771344-79" -> "79". Null when the
// BOID has no dash (a set BOID, or a shape we don't recognise).
export function boidColour(boid: string): string | null {
  const i = String(boid || "").lastIndexOf("-");
  if (i < 0) return null;
  const seg = String(boid).slice(i + 1);
  return seg ? seg : null;
}

// BrickLink colour id -> BrickOwl colour id, from a catalog/color_list
// response (keys are BrickOwl colour ids, values carry bl_ids).
// A BrickLink id that maps to no BrickOwl colour is left out — the
// caller reports that lot unpriced, never guesses a colour.
export function buildBlColourMap(
  colorList: Record<string, BoColorEntry>,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const boId of Object.keys(colorList || {})) {
    const entry = colorList[boId] || {};
    for (const bl of entry.bl_ids || []) {
      const key = String(bl);
      if (!(key in map)) map[key] = boId;
    }
  }
  return map;
}

// The BOIDs for one part that match the wanted colour (exact mode),
// or every BOID (colour-doesn't-matter mode). Exact mode returns []
// when no BOID carries that colour — the caller reports unpriced.
export function pickBoids(
  boids: string[],
  boColourId: string | null,
  blind: boolean,
): string[] {
  if (blind) return (boids || []).slice();
  if (!boColourId) return [];
  return (boids || []).filter((b) => boidColour(b) === boColourId);
}

// Cheapest lot price in USD from an availability response (a map of
// lot id -> lot). Only lots whose base_currency is USD count — a
// store listing in another currency must never be read as dollars.
// Returns null when no USD lot is present.
export function cheapestUsdLot(
  lots: Record<string, BoLot> | null | undefined,
): number | null {
  let best: number | null = null;
  for (const lot of Object.values(lots || {})) {
    if (!lot || lot.base_currency !== "USD") continue;
    const p = Number(lot.price);
    if (!isFinite(p) || p < 0) continue;
    if (best === null || p < best) best = p;
  }
  return best;
}

// Cache key for one priced lot: exact mode keys on design + BrickLink
// colour, colour-doesn't-matter mode keys on the design alone.
export function priceKey(
  designId: string,
  blColour: string | number | null | undefined,
  blind: boolean,
): string {
  return blind
    ? String(designId) + "|any"
    : String(designId) + "|" + String(blColour ?? "");
}

// Cheapest unit price across BOIDs, from a map of BOID -> cheapest
// USD lot price (null where that BOID had no USD lot). Null when
// no BOID produced a price.
export function cheapestAcrossBoids(
  perBoid: Record<string, number | null>,
): number | null {
  let best: number | null = null;
  for (const v of Object.values(perBoid || {})) {
    if (typeof v !== "number" || !isFinite(v) || v < 0) continue;
    if (best === null || v < best) best = v;
  }
  return best;
}
