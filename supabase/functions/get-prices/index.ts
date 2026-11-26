// Bulk Finder — get-prices Edge Function.
// POST { items: [{ key, design_id, bl_colour, qty, blind }], country: "US" }
// with the caller's JWT (supabase-js functions.invoke sends it
// automatically). Prices the remaining parts of a set through BrickOwl
// and returns USD totals the optimizer can rank on.
//
// Flow: resolve each item's BrickOwl colour from the BrickLink colour
// id (catalog/color_list, cached per cold start) -> catalog/id_lookup
// by design id gives the BOIDs, one per colour -> catalog/availability
// for the matching BOID (US stores, new condition, limit 100) gives
// the cheapest USD lot. Colour-doesn't-matter mode prices every BOID
// of the part and takes the cheapest. The app caches results on the
// device for 7 days, so a repeat ranking costs no BrickOwl calls.
//
// BrickOwl notes (verified live 2026-11-25, see the connector doc):
//   - GET endpoints take the key as a query parameter; POST endpoints
//     (catalog/cart_basic) read it from the form body and answer 403
//     Invalid key to the connector's query-param placement, so this
//     function uses the GET path only. cart_basic is a possible
//     future optimisation, not a fallback — it is untested.
//   - availability_basic and price_history return GBP. This function
//     only uses availability lots whose base_currency is USD, so no
//     exchange rate is ever guessed.
//   - Quotas: 600 requests/min, plus per-endpoint daily quotas
//     (id_lookup 10,000, availability 2,000, color_list 500).
//     The app only asks for uncached items, and this function caps
//     itself at 400 BrickOwl calls per invocation — items past the
//     cap come back unpriced and the app prices them next time.
//
// Secrets (dashboard > Edge Functions > Secrets; the BrickOwl key is
// Joseph's own — it never goes in chat or in this code):
//   BRICKOWL_API_KEY — free key from brickowl.com (his account).
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected by the runtime.

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  buildBlColourMap,
  cheapestAcrossBoids,
  cheapestUsdLot,
  pickBoids,
} from "./pricing.ts";

const BO = "https://api.brickowl.com/v1";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Daily quotas are generous, but one ranking must never eat them:
// 400 BrickOwl calls per invocation, then the rest go unpriced.
const MAX_CALLS_PER_REQUEST = 400;
// Eight BrickOwl calls in flight at once stays far under the
// 600-requests-per-minute rate limit.
const CONCURRENCY = 8;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

interface PriceItem {
  key?: unknown;
  design_id?: unknown;
  bl_colour?: unknown;
  qty?: unknown;
  blind?: unknown;
}

let callsUsed = 0;
let colorMap: Record<string, string> | null = null;
let boidCache: Record<string, string[]> = {};

// One BrickOwl GET. Throws BrickOwlError on a non-200 answer, and
// RateLimited on a 429 (the caller stops and returns partial).
class BrickOwlError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
class RateLimited extends Error {}
async function boGet(
  key: string,
  path: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  if (callsUsed >= MAX_CALLS_PER_REQUEST) throw new RateLimited("call budget");
  callsUsed++;
  const q = new URLSearchParams({ ...params, key });
  const res = await fetch(BO + path + "?" + q.toString(), {
    headers: { Accept: "application/json", "User-Agent": "bulk-finder-get-prices/1.0" },
  });
  if (res.status === 429) throw new RateLimited("BrickOwl rate limit");
  if (!res.ok) throw new BrickOwlError(res.status, "BrickOwl answered " + res.status + " on " + path);
  return (await res.json()) as Record<string, unknown>;
}

async function getColorMap(key: string): Promise<Record<string, string>> {
  if (colorMap) return colorMap;
  const data = await boGet(key, "/catalog/color_list", {});
  colorMap = buildBlColourMap(data as never);
  return colorMap;
}

async function getBoids(key: string, designId: string): Promise<string[]> {
  if (boidCache[designId]) return boidCache[designId];
  const data = await boGet(key, "/catalog/id_lookup", { id: designId, type: "Part", id_type: "design_id" });
  const list = Array.isArray(data.boids) ? (data.boids as unknown[]).map(String) : [];
  boidCache[designId] = list;
  return list;
}

// Cheapest USD unit price for one BOID, or null when no US store
// lists it new in dollars.
async function cheapestForBoid(key: string, boid: string): Promise<number | null> {
  const data = await boGet(key, "/catalog/availability", {
    boid,
    country: "US",
    store_country: "US",
    condition: "new",
    limit: "100",
  });
  return cheapestUsdLot(data as never);
}

// Price one item. Returns { usd } or { unpriced, reason }.
async function priceItem(
  key: string,
  item: PriceItem,
): Promise<{ usd?: number; unpriced?: string }> {
  const designId = String(item.design_id || "");
  if (!designId) return { unpriced: "no part number" };
  const blind = item.blind === true;
  let boColour: string | null = null;
  if (!blind) {
    const map = await getColorMap(key);
    const bl = item.bl_colour === undefined || item.bl_colour === null ? "" : String(item.bl_colour);
    boColour = map[bl] || null;
    if (!boColour) return { unpriced: "no BrickOwl colour for this colour" };
  }
  const boids = await getBoids(key, designId);
  if (!boids.length) return { unpriced: "BrickOwl has no listing for this part" };
  const wanted = pickBoids(boids, boColour, blind);
  if (!wanted.length) return { unpriced: "BrickOwl has no listing in this colour" };
  // Colour-doesn't-matter mode checks every BOID of the part; the
  // call budget above bounds how many that can be in one request.
  const perBoid: Record<string, number | null> = {};
  for (const b of wanted) {
    perBoid[b] = await cheapestForBoid(key, b);
  }
  const best = cheapestAcrossBoids(perBoid);
  if (best === null) return { unpriced: "no US store lists it new in dollars" };
  return { usd: best };
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

  // The caller must be logged in: the BrickOwl key is a shared
  // secret, so anonymous calls are refused (guests price nothing —
  // they log in first).
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) {
    return json({ ok: false, error: "unauthorized", message: "Log in first — pricing needs an account." }, 401);
  }
  const { data: { user }, error: authErr } = await sb.auth.getUser(jwt);
  if (authErr || !user) {
    return json({ ok: false, error: "unauthorized", message: "Log in first — pricing needs an account." }, 401);
  }

  let body: { items?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "bad_request", message: "Send JSON: { items: [{ key, design_id, bl_colour, qty, blind }] }." }, 400);
  }
  const items = Array.isArray(body.items) ? (body.items as PriceItem[]) : [];
  if (!items.length || items.length > 200) {
    return json({ ok: false, error: "bad_request", message: "Send 1 to 200 items to price." }, 400);
  }

  const key = Deno.env.get("BRICKOWL_API_KEY") || "";
  if (!key) {
    return json({ ok: false, error: "no_api_key", message: "The BrickOwl key isn't set yet — add BRICKOWL_API_KEY in the Supabase dashboard (Edge Functions > Secrets)." }, 503);
  }

  callsUsed = 0;
  const prices: { key: unknown; usd: number }[] = [];
  const unpriced: { key: unknown; reason: string }[] = [];
  let hitBudget = false;

  // A small worker pool: items price in parallel, eight BrickOwl
  // calls in flight at once. A 429 or an exhausted call budget
  // stops the pool and the rest go unpriced — the app retries them
  // on the next ranking, when the cached ones cost nothing.
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next++];
      try {
        const r = await priceItem(key, item);
        if (r.usd !== undefined) prices.push({ key: item.key, usd: r.usd });
        else unpriced.push({ key: item.key, reason: r.unpriced || "unpriced" });
      } catch (e) {
        if (e instanceof RateLimited) {
          hitBudget = true;
          unpriced.push({ key: item.key, reason: "BrickOwl is busy — try again in a bit" });
        } else {
          unpriced.push({ key: item.key, reason: "BrickOwl error: " + (e instanceof Error ? e.message : String(e)) });
        }
      }
    }
  }
  const workers: Promise<void>[] = [];
  for (let i = 0; i < CONCURRENCY; i++) workers.push(worker());
  await Promise.all(workers);

  return json({
    ok: true,
    prices,
    unpriced,
    partial: hitBudget,
    calls: callsUsed,
  });
});
