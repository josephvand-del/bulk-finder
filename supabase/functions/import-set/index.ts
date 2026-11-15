// Bulk Finder — import-set Edge Function.
// POST { set_num: "10294-1" } (or "10294" — "-1" is assumed) with the
// caller's JWT (supabase-js functions.invoke sends it automatically).
// POST { q: "Crystal King" } searches Rebrickable by name and returns up
// to 8 matches — the app shows them and the user picks one, which then
// goes through the normal set_num lookup above.
//
// Flow: normalize the number -> check the set_inventories cache -> on a
// miss, fetch the set from Rebrickable (set meta, part categories, parts
// pages, one call per ~1.1s — Rebrickable's limit is ~1 call/second and
// they temp-ban IPs that ignore 429s), convert it with transformSet,
// store it in set_inventories, and return the inventory. A set is only
// ever fetched from Rebrickable once; every later import reads the cache.
//
// Secrets (dashboard > Edge Functions > Secrets; the Rebrickable key is
// Joseph's own — it never goes in chat or in this code):
//   REBRICKABLE_API_KEY — free key from rebrickable.com (his account).
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected by the runtime.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { transformSet } from "./transform.ts";

const RB = "https://rebrickable.com/api/v3";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// One Rebrickable call, rate-limit aware: 1.1s spacing, and on a 429 one
// retry after 60s. Throws RateLimited if the retry is also a 429.
class RateLimited extends Error {}
async function rbFetch(url: string, key: string): Promise<Response> {
  await sleep(1100);
  const headers = { Authorization: "key " + key, Accept: "application/json" };
  let res = await fetch(url, { headers });
  if (res.status === 429) {
    await sleep(60000);
    res = await fetch(url, { headers });
    if (res.status === 429) throw new RateLimited("Rebrickable rate limit");
  }
  return res;
}

function normalizeSetNum(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  if (!/^[A-Za-z0-9]+(-\d+)?$/.test(s)) return null;
  return s.includes("-") ? s : s + "-1";
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

  // The caller must be logged in: the key is a shared secret, so anonymous
  // calls are refused (guests import nothing — they log in first).
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) {
    return json({ ok: false, error: "unauthorized", message: "Log in first — importing a set needs an account." }, 401);
  }
  const { data: { user }, error: authErr } = await sb.auth.getUser(jwt);
  if (authErr || !user) {
    return json({ ok: false, error: "unauthorized", message: "Log in first — importing a set needs an account." }, 401);
  }

  let body: { set_num?: unknown; q?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "bad_request", message: "Send JSON: { set_num: \"10294-1\" } or { q: \"Crystal King\" }." }, 400);
  }

  // Name search: no cache — a search is one cheap Rebrickable call.
  if (typeof body.q === "string" && body.q.trim()) {
    const key = Deno.env.get("REBRICKABLE_API_KEY") || "";
    if (!key) {
      return json({ ok: false, error: "no_api_key", message: "The Rebrickable key isn't set yet — add REBRICKABLE_API_KEY in the Supabase dashboard (Edge Functions > Secrets)." }, 503);
    }
    try {
      const searchRes = await rbFetch(RB + "/lego/sets/?search=" + encodeURIComponent(body.q.trim()) + "&page_size=8", key);
      if (!searchRes.ok) {
        return json({ ok: false, error: "rebrickable_error", message: "Rebrickable answered " + searchRes.status + ". Try again in a minute." }, 502);
      }
      const searchJson = await searchRes.json();
      const results = (searchJson.results || []).map((r: { set_num: string; name: string; year?: number | null; num_parts?: number; set_img_url?: string | null }) => ({
        set_num: r.set_num,
        name: r.name,
        year: r.year ?? null,
        num_parts: r.num_parts ?? 0,
        set_img_url: r.set_img_url || null,
      }));
      return json({ ok: true, results });
    } catch (e) {
      if (e instanceof RateLimited) {
        return json({ ok: false, error: "rate_limited", message: "Rebrickable is busy right now (its limit is about 1 call a second). Wait a minute and try again." }, 429);
      }
      return json({ ok: false, error: "rebrickable_unreachable", message: "Couldn't reach Rebrickable: " + (e instanceof Error ? e.message : String(e)) }, 502);
    }
  }

  const setNum = normalizeSetNum(body.set_num);
  if (!setNum) {
    return json({ ok: false, error: "bad_set_num", message: "Set numbers look like 10294-1. Check the number and try again." }, 400);
  }

  // Cache first: a set that was imported before comes straight back.
  const { data: cached } = await sb
    .from("set_inventories")
    .select("set_name, year, num_parts, set_img_url, inventory")
    .eq("set_num", setNum)
    .maybeSingle();
  if (cached) {
    const inv = cached.inventory as { lots?: number; pieces?: number };
    return json({
      ok: true,
      cached: true,
      set: { set_num: setNum, name: cached.set_name, year: cached.year, num_parts: cached.num_parts, set_img_url: cached.set_img_url },
      inventory: cached.inventory,
      lots: inv.lots ?? 0,
      pieces: inv.pieces ?? 0,
    });
  }

  const key = Deno.env.get("REBRICKABLE_API_KEY") || "";
  if (!key) {
    return json({ ok: false, error: "no_api_key", message: "The Rebrickable key isn't set yet — add REBRICKABLE_API_KEY in the Supabase dashboard (Edge Functions > Secrets)." }, 503);
  }

  try {
    // 1. Set metadata (also the existence check: a 404 means a bad number).
    const metaRes = await rbFetch(RB + "/lego/sets/" + setNum + "/", key);
    if (metaRes.status === 404) {
      return json({ ok: false, error: "set_not_found", message: "Rebrickable has no set " + setNum + ". Check the number — it usually ends in -1." }, 404);
    }
    if (!metaRes.ok) {
      return json({ ok: false, error: "rebrickable_error", message: "Rebrickable answered " + metaRes.status + ". Try again in a minute." }, 502);
    }
    const meta = await metaRes.json();

    // 2. Part categories (id -> name), so the transform can apply Joseph's rules.
    const catRes = await rbFetch(RB + "/lego/part_categories/?page_size=1000", key);
    if (!catRes.ok) {
      return json({ ok: false, error: "rebrickable_error", message: "Rebrickable answered " + catRes.status + " on categories. Try again in a minute." }, 502);
    }
    const catJson = await catRes.json();
    const catById: Record<number, string> = {};
    for (const c of catJson.results || []) catById[Number(c.id)] = String(c.name || "");

    // 3. Parts, page by page (page_size caps at 1000; a big set needs a few).
    const parts: unknown[] = [];
    let next: string | null = RB + "/lego/sets/" + setNum + "/parts/?page_size=1000&inc_part_details=1&inc_color_details=1";
    let pages = 0;
    while (next && pages < 20) {
      pages++;
      const pageRes = await rbFetch(next, key);
      if (!pageRes.ok) {
        return json({ ok: false, error: "rebrickable_error", message: "Rebrickable answered " + pageRes.status + " on parts. Try again in a minute." }, 502);
      }
      const pageJson = await pageRes.json();
      parts.push(...(pageJson.results || []));
      next = pageJson.next || null;
    }

    const inventory = transformSet(meta, parts as never, catById);

    const { error: upErr } = await sb.from("set_inventories").upsert({
      set_num: setNum,
      set_name: meta.name || setNum,
      year: meta.year ?? null,
      num_parts: meta.num_parts ?? inventory.pieces,
      set_img_url: meta.set_img_url || null,
      inventory,
      source: "rebrickable",
    });
    if (upErr) {
      return json({ ok: false, error: "cache_write_failed", message: "Fetched the set but couldn't save it: " + upErr.message }, 500);
    }

    return json({
      ok: true,
      cached: false,
      set: { set_num: setNum, name: meta.name, year: meta.year, num_parts: meta.num_parts, set_img_url: meta.set_img_url },
      inventory,
      lots: inventory.lots,
      pieces: inventory.pieces,
    });
  } catch (e) {
    if (e instanceof RateLimited) {
      return json({ ok: false, error: "rate_limited", message: "Rebrickable is busy right now (its limit is about 1 call a second). Wait a minute and try again — the set is cached after the first good fetch, so this only ever happens once per set." }, 429);
    }
    return json({ ok: false, error: "rebrickable_unreachable", message: "Couldn't reach Rebrickable: " + (e instanceof Error ? e.message : String(e)) }, 502);
  }
});
