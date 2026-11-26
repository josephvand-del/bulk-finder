// Bulk Finder — suggest-sets Edge Function.
// POST { parts: [{ part, colour, bl_colour, qty }], blind: false }
// with the caller's JWT (supabase-js functions.invoke sends it
// automatically). Finds sets in the full Rebrickable catalog that
// share parts with a bulk list, so the optimizer can suggest sets
// Joseph hasn't tracked yet.
//
// Flow: resolve each part's colour to a Rebrickable colour id
// (lego/colors, cached per cold start) -> parts/{part}/colors/
// {color}/sets/?page_size=100, first page only, one call per part
// at Rebrickable's ~1 call/second -> aggregate the set lists into
// candidates (see suggest.ts). Tracked sets are filtered out by the
// app, which knows its own list.
//
// Rebrickable notes (verified live 2026-11-25):
//   - parts/{part}/colors/{color}/sets/ is the ONLY parts-in-sets
//     endpoint; there is no colour-less one. Colour-doesn't-matter
//     mode therefore discovers through the bulk list's own colours
//     and aggregates by part number — a set holding the part only in
//     another colour is not discovered, and the app says so.
//   - A set entry carries num_parts but NO per-set quantity for the
//     part, so coverage is counted in distinct lots, not pieces, and
//     "missing" is the upper bound num_parts - lotsCovered. Exact
//     piece counts appear once the set is imported (one tap).
//   - Only the first 100 sets per part are read. A very common part
//     (a 2x4 brick is in 1,000+ sets) is truncated to its first
//     page; rarer parts surface the high-coverage candidates.
//   - Free-tier limit is about 1 call a second; this function waits
//     1.1s between calls like import-set does. A 429 ends the run
//     with partial results instead of waiting 60s — suggestions are
//     best-effort, and the app can ask for the rest later.
//
// Secrets (dashboard > Edge Functions > Secrets; the Rebrickable key
// is Joseph's own — it never goes in chat or in this code):
//   REBRICKABLE_API_KEY — the SAME secret import-set uses. No new
//   key is needed for this function.
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected by the runtime.

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  aggregateCandidates,
  colorTableFromList,
  resolveRbColourId,
} from "./suggest.ts";

const RB = "https://rebrickable.com/api/v3";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Twelve parts per call keeps one invocation near 15 seconds
// (12 x 1.1s spacing plus the colours call). The app sends the
// next batch when the user asks for more.
const MAX_PARTS_PER_REQUEST = 12;
// The first page only: the sets most likely to be buildable are the
// ones sharing the rarer parts, and those lists are short.
const SETS_PAGE_SIZE = 100;
// The app shows the top few; returning more would only bloat the
// response — the rest rank below the cut anyway.
const MAX_CANDIDATES = 100;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class RateLimited extends Error {}
async function rbFetch(url: string, key: string): Promise<Response> {
  await sleep(1100);
  const headers = { Authorization: "key " + key, Accept: "application/json" };
  const res = await fetch(url, { headers });
  if (res.status === 429) throw new RateLimited("Rebrickable rate limit");
  return res;
}

interface SuggestPart {
  part?: unknown;
  colour?: unknown;
  bl_colour?: unknown;
  qty?: unknown;
}

let colorTable: { id: number; name: string; blIds: string[] }[] | null = null;

async function getColorTable(key: string) {
  if (colorTable) return colorTable;
  const res = await rbFetch(RB + "/lego/colors/?page_size=1000", key);
  if (!res.ok) throw new Error("Rebrickable answered " + res.status + " on colors.");
  const data = await res.json();
  colorTable = colorTableFromList((data.results || []) as never);
  return colorTable;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return json({ ok: false, error: "method", message: "POST only." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: "server", message: "Supabase is not configured for this function." }, 500);
  }
  const sb = createClient(supabaseUrl, serviceKey);

  // The caller must be logged in: the Rebrickable key is a shared
  // secret, so anonymous calls are refused.
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) {
    return json({ ok: false, error: "unauthorized", message: "Log in first — suggestions need an account." }, 401);
  }
  const { data: { user }, error: authErr } = await sb.auth.getUser(jwt);
  if (authErr || !user) {
    return json({ ok: false, error: "unauthorized", message: "Log in first — suggestions need an account." }, 401);
  }

  let body: { parts?: unknown; blind?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "bad_request", message: "Send JSON: { parts: [{ part, colour, bl_colour, qty }], blind }." }, 400);
  }
  const rawParts = Array.isArray(body.parts) ? (body.parts as SuggestPart[]) : [];
  if (!rawParts.length || rawParts.length > 100) {
    return json({ ok: false, error: "bad_request", message: "Send 1 to 100 parts to check." }, 400);
  }
  const blind = body.blind === true;

  const key = Deno.env.get("REBRICKABLE_API_KEY") || "";
  if (!key) {
    return json({ ok: false, error: "no_api_key", message: "The Rebrickable key isn't set yet — add REBRICKABLE_API_KEY in the Supabase dashboard (Edge Functions > Secrets)." }, 503);
  }

  const parts = rawParts
    .map((p) => ({
      part: String(p.part || "").trim(),
      colour: String(p.colour || ""),
      bl_colour: p.bl_colour === undefined || p.bl_colour === null ? null : p.bl_colour,
      qty: Math.max(1, Number(p.qty) || 1),
    }))
    .filter((p) => /^[A-Za-z0-9]+$/.test(p.part));
  if (!parts.length) {
    return json({ ok: false, error: "bad_request", message: "No usable part numbers in the request." }, 400);
  }

  let colors;
  try {
    colors = await getColorTable(key);
  } catch (e) {
    if (e instanceof RateLimited) {
      return json({ ok: false, error: "rate_limited", message: "Rebrickable is busy right now (its limit is about 1 call a second). Wait a minute and try again." }, 429);
    }
    return json({ ok: false, error: "rebrickable_unreachable", message: "Couldn't reach Rebrickable: " + (e instanceof Error ? e.message : String(e)) }, 502);
  }

  const queried: string[] = [];
  const unmapped: { part: string; colour: string; reason: string }[] = [];
  const partResults: { part: string; colour: string; qty: number; sets: never[] }[] = [];
  let partial = false;
  let calls = 1; // the colours call above

  const batch = parts.slice(0, MAX_PARTS_PER_REQUEST);
  if (parts.length > MAX_PARTS_PER_REQUEST) partial = true;
  for (const p of batch) {
    const rbColor = resolveRbColourId(p.colour, p.bl_colour, colors);
    if (rbColor === null) {
      unmapped.push({ part: p.part, colour: p.colour, reason: "no Rebrickable colour for " + p.colour });
      continue;
    }
    let page;
    try {
      const res = await rbFetch(
        RB + "/lego/parts/" + encodeURIComponent(p.part) + "/colors/" + rbColor + "/sets/?page_size=" + SETS_PAGE_SIZE,
        key,
      );
      calls++;
      if (res.status === 404) {
        unmapped.push({ part: p.part, colour: p.colour, reason: "Rebrickable has no such part in this colour" });
        continue;
      }
      if (!res.ok) {
        return json({ ok: false, error: "rebrickable_error", message: "Rebrickable answered " + res.status + " on parts. Try again in a minute." }, 502);
      }
      page = await res.json();
    } catch (e) {
      if (e instanceof RateLimited) {
        partial = true;
        break;
      }
      return json({ ok: false, error: "rebrickable_unreachable", message: "Couldn't reach Rebrickable: " + (e instanceof Error ? e.message : String(e)) }, 502);
    }
    const sets = ((page.results || []) as Record<string, unknown>[]).map((s) => ({
      set_num: String(s.set_num || ""),
      name: String(s.name || ""),
      year: typeof s.year === "number" ? s.year : null,
      num_parts: typeof s.num_parts === "number" ? s.num_parts : 0,
      set_img_url: (typeof s.set_img_url === "string" && s.set_img_url) || null,
    }));
    queried.push(p.part + "|" + p.colour);
    partResults.push({ part: p.part, colour: p.colour, qty: p.qty, sets: sets as never[] });
  }

  const candidates = aggregateCandidates(partResults, blind).slice(0, MAX_CANDIDATES);
  return json({
    ok: true,
    candidates,
    queried,
    partial,
    unmapped,
    calls,
  });
});
