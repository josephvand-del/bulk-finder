// Bulk Finder — all-sets suggestion helpers (pure, no I/O).
// Shared by the suggest-sets Edge Function. Testable in plain Node:
//   node test-suggest.mjs
// (Node 24 strips the erasable TS types on import.)
//
// How suggestions work: the bulk list's parts are looked up on
// Rebrickable (parts/{part}/colors/{color}/sets/ — the only
// parts-in-sets endpoint; there is no colour-less one), and the sets
// that come back are aggregated into candidates. The endpoint's set
// entries carry num_parts but NO per-set quantity for the part, so
// coverage is counted in distinct lots (part+colour), not pieces:
//   lotsCovered = distinct bulk lots the set contains
//   missingUpper = num_parts - lotsCovered (an upper bound on the
//     pieces still missing — each shared lot covers at least one)
// Exact piece counts appear once the set is imported (one tap),
// when the tracked optimizer takes over with its real inventory.
//
// Colour resolution: a bulk part's colour is a display name ("Dark
// Grey", "Trans-Blue"). The function resolves it to a Rebrickable
// colour id in three steps — BrickLink external id, exact
// Rebrickable name, then the display -> LEGO -> Rebrickable name
// chain. The two name maps are copied from import-set/transform.ts;
// keep them in sync with that file.

export interface RbColorRow {
  id: number;
  name: string;
  blIds: string[];
}

export interface SetHit {
  set_num: string;
  name: string;
  year: number | null;
  num_parts: number;
  set_img_url: string | null;
}

export interface PartSets {
  part: string;
  colour: string;
  qty: number;
  sets: SetHit[];
}

export interface Candidate {
  set_num: string;
  name: string;
  year: number | null;
  num_parts: number;
  set_img_url: string | null;
  lotsCovered: number;
  missingUpper: number;
}

// Rebrickable colour name -> LEGO colour name (copied from
// import-set/transform.ts — the id segment, underscores).
const RB_TO_LEGO: Record<string, string> = {
  "Black": "Black",
  "White": "White",
  "Dark Bluish Gray": "Dark_Stone_Grey",
  "Light Bluish Gray": "Medium_Stone_Grey",
  "Dark Gray": "Dark_Grey",
  "Light Gray": "Light_Grey",
  "Very Light Bluish Gray": "Very_Light_Bluish_Grey",
  "Red": "Bright_Red",
  "Blue": "Bright_Blue",
  "Yellow": "Bright_Yellow",
  "Orange": "Bright_Orange",
  "Bright Light Orange": "Bright_Light_Orange",
  "Tan": "Brick_Yellow",
  "Brown": "Reddish_Brown",
  "Dark Brown": "Dark_Brown",
  "Green": "Green",
  "Dark Green": "Dark_Green",
  "Bright Green": "Bright_Green",
  "Lime": "Bright_Yellowish_Green",
  "Medium Lime": "Medium_Lime",
  "Yellowish Green": "Yellowish_Green",
  "Olive Green": "Olive_Green",
  "Sand Green": "Sand_Green",
  "Sand Blue": "Sand_Blue",
  "Medium Azure": "Medium_Azure",
  "Dark Azure": "Dark_Azure",
  "Bright Light Blue": "Bright_Light_Blue",
  "Medium Blue": "Medium_Blue",
  "Dark Blue": "Dark_Blue",
  "Violet": "Bright_Violet",
  "Dark Purple": "Dark_Purple",
  "Medium Lavender": "Medium_Lavender",
  "Magenta": "Magenta",
  "Pink": "Bright_Pink",
  "Light Pink": "Light_Pink",
  "Pearl Gold": "Warm_Gold",
  "Chrome Silver": "Chrome_Silver",
  "Flat Silver": "Flat_Silver",
  "Metallic Silver": "Metallic_Silver",
  "Pearl Light Gray": "Pearl_Light_Grey",
  "Glow In Dark White": "Glow_In_Dark_White",
  "Trans-Clear": "Transparent",
  "Trans-Red": "Transparent_Red",
  "Trans-Orange": "Transparent_Bright_Orange",
  "Trans-Yellow": "Transparent_Yellow",
  "Trans-Green": "Transparent_Green",
  "Trans-Blue": "Transparent_Blue",
  "Trans-Dark Blue": "Transparent_Dark_Blue",
  "Trans-Light Blue": "Transparent_Light_Blue",
  "Trans-Bright Green": "Transparent_Bright_Green",
  "Trans-Neon Green": "Transparent_Fluorescent_Green",
  "Trans-Pink": "Transparent_Pink",
  "Trans-Purple": "Transparent_Medium_Red_Violet",
  "Trans-Black": "Transparent_Black",
  "Trans-Brown": "Transparent_Brown",
  "Trans-Neon Orange": "Transparent_Fluorescent_Red_Orange",
  "Trans-Neon Yellow": "Transparent_Neon_Yellow",
  "Chrome Gold": "Chrome_Gold",
  "Pearl Dark Gray": "Pearl_Dark_Grey",
  "Metallic Gold": "Metallic_Gold",
  "Copper": "Copper",
  "Dark Turquoise": "Dark_Turquoise",
  "Turquoise": "Dark_Turquoise",
  "Medium Turquoise": "Medium_Turquoise",
  "Bright Light Yellow": "Bright_Light_Yellow",
  "Light Yellow": "Light_Yellow",
  "Dark Orange": "Dark_Orange",
  "Reddish Orange": "Reddish_Orange",
  "Coral": "Coral",
  "Medium Nougat": "Medium_Nougat",
  "Nougat": "Nougat",
  "Light Nougat": "Light_Nougat",
  "Dark Nougat": "Dark_Nougat",
  "Light Aqua": "Light_Aqua",
  "Aqua": "Aqua",
  "Dark Pink": "Dark_Pink",
  "Lavender": "Lavender",
  "Bright Purple": "Bright_Purple",
  "Sand Red": "Sand_Red",
  "Dark Red": "Dark_Red",
  "Fabuland Brown": "Fabuland_Brown",
  "Maersk Blue": "Maersk_Blue",
  "Chrome Blue": "Chrome_Blue",
  "Chrome Green": "Chrome_Green",
  "Chrome Pink": "Chrome_Pink",
  "Chrome Black": "Chrome_Black",
  "Speckle Black-Silver": "Speckle_Black_Silver",
  "Speckle Black-Copper": "Speckle_Black_Copper",
  "Speckle Black-Gold": "Speckle_Black_Gold",
  "Speckle DBGray-Silver": "Speckle_Dark_Bluish_Grey_Silver",
};

// LEGO colour name -> the app's display colour (copied from
// import-set/transform.ts). Inverted here: display -> LEGO.
const LEGO_TO_DISPLAY: Record<string, string> = {
  "Black": "Black",
  "White": "White",
  "Dark_Stone_Grey": "Dark Grey",
  "Medium_Stone_Grey": "Light Grey",
  "Dark_Grey": "Dark Grey",
  "Light_Grey": "Light Grey",
  "Very_Light_Bluish_Grey": "Very Light Grey",
  "Bright_Red": "Red",
  "Bright_Blue": "Blue",
  "Bright_Yellow": "Yellow",
  "Bright_Orange": "Orange",
  "Bright_Light_Orange": "Bright Light Orange",
  "Brick_Yellow": "Tan",
  "Reddish_Brown": "Brown",
  "Dark_Brown": "Dark Brown",
  "Green": "Green",
  "Dark_Green": "Dark Green",
  "Bright_Green": "Bright Green",
  "Bright_Yellowish_Green": "Lime Green",
  "Yellowish_Green": "Yellowish Green",
  "Olive_Green": "Olive Green",
  "Sand_Green": "Sand Green",
  "Sand_Blue": "Sand Blue",
  "Medium_Azure": "Medium Azure",
  "Dark_Azure": "Dark Azure",
  "Bright_Light_Blue": "Bright Light Blue",
  "Medium_Blue": "Medium Blue",
  "Dark_Blue": "Dark Blue",
  "Bright_Violet": "Violet",
  "Dark_Purple": "Dark Purple",
  "Medium_Lavender": "Medium Lavender",
  "Magenta": "Magenta",
  "Bright_Pink": "Pink",
  "Light_Pink": "Light Pink",
  "Warm_Gold": "Pearl Gold",
  "Chrome_Silver": "Chrome Silver",
  "Flat_Silver": "Flat Silver",
  "Metallic_Silver": "Metallic Silver",
  "Pearl_Light_Grey": "Pearl Light Grey",
  "Glow_In_Dark_White": "Glow In Dark White",
  "Transparent": "Clear",
  "Transparent_Red": "Trans-Red",
  "Transparent_Bright_Orange": "Trans-Orange",
  "Transparent_Yellow": "Trans-Yellow",
  "Transparent_Green": "Trans-Green",
  "Transparent_Blue": "Trans-Blue",
  "Transparent_Dark_Blue": "Trans-Dark Blue",
  "Transparent_Light_Blue": "Trans-Light Blue",
  "Transparent_Bright_Green": "Trans-Bright Green",
  "Transparent_Fluorescent_Green": "Trans-Green",
  "Transparent_Pink": "Trans-Pink",
  "Transparent_Medium_Red_Violet": "Trans-Purple",
  "Transparent_Black": "Trans-Black",
  "Transparent_Brown": "Trans-Brown",
  "Transparent_Fluorescent_Red_Orange": "Trans-Neon Orange",
  "Transparent_Neon_Yellow": "Trans-Neon Yellow",
};

function norm(s: string): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// First LEGO name for a display colour (definition order wins the
// two collisions: Dark Grey -> Dark_Stone_Grey, Trans-Green ->
// Transparent_Green — the same modern-colour choice the export makes).
function legoForDisplay(display: string): string | null {
  for (const lego of Object.keys(LEGO_TO_DISPLAY)) {
    if (LEGO_TO_DISPLAY[lego] === display) return lego;
  }
  return null;
}

// First Rebrickable name for a LEGO name (definition order wins the
// Dark Turquoise / Turquoise collision).
function rbForLego(lego: string): string | null {
  for (const rb of Object.keys(RB_TO_LEGO)) {
    if (RB_TO_LEGO[rb] === lego) return rb;
  }
  return null;
}

// The raw /lego/colors/ response (results with id, name and
// external_ids.BrickLink.ext_ids) flattened for resolution.
export function colorTableFromList(
  results: { id?: unknown; name?: unknown; external_ids?: { BrickLink?: { ext_ids?: unknown[] } } }[],
): RbColorRow[] {
  return (results || []).map((c) => ({
    id: Number(c.id),
    name: String(c.name || ""),
    blIds: ((c.external_ids && c.external_ids.BrickLink && c.external_ids.BrickLink.ext_ids) || []).map(String),
  })).filter((c) => isFinite(c.id));
}

// Resolve a bulk part's display colour to a Rebrickable colour id.
// Returns null when nothing matches — the caller skips that part
// and reports it, never guesses a colour.
export function resolveRbColourId(
  display: string,
  blColour: string | number | null | undefined,
  colors: RbColorRow[],
): number | null {
  const list = colors || [];
  if (blColour !== undefined && blColour !== null && String(blColour) !== "") {
    const bl = String(blColour);
    for (const c of list) {
      if (c.blIds.indexOf(bl) >= 0) return c.id;
    }
  }
  const want = norm(display);
  if (want) {
    for (const c of list) {
      if (norm(c.name) === want) return c.id;
    }
    const lego = legoForDisplay(display);
    if (lego) {
      const rb = rbForLego(lego);
      if (rb) {
        for (const c of list) {
          if (norm(c.name) === norm(rb)) return c.id;
        }
      }
    }
  }
  return null;
}

// Aggregate per-part set lists into candidates. In
// colour-doesn't-matter mode a set counts once per part number,
// however many colours of it the bulk holds; in exact mode it
// counts once per part+colour.
export function aggregateCandidates(
  partResults: PartSets[],
  blind: boolean,
): Candidate[] {
  const bySet: Record<string, Candidate & { keys: Record<string, number> }> = {};
  for (const pr of partResults || []) {
    const key = blind ? pr.part : pr.part + "|" + pr.colour;
    for (const s of pr.sets || []) {
      if (!s || !s.set_num) continue;
      let c = bySet[s.set_num];
      if (!c) {
        c = {
          set_num: s.set_num,
          name: s.name || s.set_num,
          year: typeof s.year === "number" ? s.year : null,
          num_parts: typeof s.num_parts === "number" ? s.num_parts : 0,
          set_img_url: s.set_img_url || null,
          lotsCovered: 0,
          missingUpper: 0,
          keys: {},
        };
        bySet[s.set_num] = c;
      }
      if (!c.keys[key]) {
        c.keys[key] = 1;
        c.lotsCovered++;
      }
    }
  }
  const out = Object.keys(bySet).map((k) => {
    const c = bySet[k];
    const missing = Math.max(0, c.num_parts - c.lotsCovered);
    const { keys: _keys, ...rest } = c as Candidate & { keys: Record<string, number> };
    return { ...rest, missingUpper: missing };
  });
  out.sort((a, b) => {
    if (b.lotsCovered !== a.lotsCovered) return b.lotsCovered - a.lotsCovered;
    if (a.num_parts !== b.num_parts) return a.num_parts - b.num_parts;
    return a.name < b.name ? -1 : 1;
  });
  return out;
}

// Rank candidates for the optimizer's sort modes. Price mode has no
// per-part prices before import (the missing parts aren't known),
// so it ranks like fewest-missing: the closest to complete is the
// cheapest to finish. The app says so on the row.
export function rankSuggestions(
  cands: Candidate[],
  mode: string,
): Candidate[] {
  const list = (cands || []).slice();
  if (mode === "newest") {
    list.sort((a, b) => {
      const ya = a.year === null ? -1 : a.year;
      const yb = b.year === null ? -1 : b.year;
      if (yb !== ya) return yb - ya;
      if (b.lotsCovered !== a.lotsCovered) return b.lotsCovered - a.lotsCovered;
      return a.name < b.name ? -1 : 1;
    });
  } else if (mode === "fewest" || mode === "price") {
    list.sort((a, b) => {
      if (a.missingUpper !== b.missingUpper) return a.missingUpper - b.missingUpper;
      if (b.lotsCovered !== a.lotsCovered) return b.lotsCovered - a.lotsCovered;
      return a.name < b.name ? -1 : 1;
    });
  } else {
    list.sort((a, b) => {
      if (b.lotsCovered !== a.lotsCovered) return b.lotsCovered - a.lotsCovered;
      if (a.num_parts !== b.num_parts) return a.num_parts - b.num_parts;
      return a.name < b.name ? -1 : 1;
    });
  }
  return list;
}

// Stable cache key for one bulk list's parts + the blind flag, so a
// repeat ranking reuses the cached candidates instead of calling
// Rebrickable again.
export function suggestCacheKey(
  parts: { part: string; colour: string; qty: number }[],
  blind: boolean,
): string {
  const keys = (parts || [])
    .map((p) => p.part + "|" + p.colour + "|" + p.qty)
    .sort();
  return keys.join(";") + (blind ? "|blind" : "|exact");
}
