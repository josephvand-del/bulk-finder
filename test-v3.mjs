// v3.0 app tests — runtime inventories + Add Set (Rebrickable) flow.
// Run: node test-v3.mjs
// Loads the real app.js in a vm with a stub DOM + a mock Supabase client
// and drives lookupSet / addImportedSet end to end.
import fs from "node:fs";
import vm from "node:vm";

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

/* ---------- DOM stub ---------- */
class StubEl {
  constructor(tag) {
    this.tagName = (tag || "div").toUpperCase();
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.className = "";
    this.textContent = "";
    this.value = "";
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.listeners = {};
    this.attributes = {};
    this._html = "";
    const self = this;
    this.classList = {
      add(c) { if (!self.className.split(" ").includes(c)) self.className = (self.className + " " + c).trim(); },
      remove(c) { self.className = self.className.split(" ").filter((x) => x !== c).join(" "); },
      toggle(c, f) { if (f === undefined) f = !self.className.split(" ").includes(c); if (f) self.classList.add(c); else self.classList.remove(c); },
      contains(c) { return self.className.split(" ").includes(c); },
    };
  }
  appendChild(n) { this.children.push(n); return n; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  setAttribute(k, v) { this.attributes[k] = v; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  set innerHTML(v) { this.children = []; this._html = v; }
  get innerHTML() { return this._html; }
}

class StubDocument {
  constructor() { this.byId = {}; this.listeners = {}; this.body = new StubEl("body"); }
  getElementById(id) { if (!this.byId[id]) this.byId[id] = new StubEl("div"); return this.byId[id]; }
  createElement(tag) { return new StubEl(tag); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
}

class LSStub {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

/* ---------- Fixtures ---------- */
const fixtureInv10294 = {
  set: "10294-1 Test Ship", lots: 3, pieces: 10,
  tiers: { 1: "MOST LIKELY IN BULK", 2: "MEDIUM — WORTH A DIG", 3: "LEAST LIKELY IN BULK" },
  items: [
    { id: "300126-3001-Black", qty: 6, dim: "2 × 4 studs", colour: "Black", any: false, tier: 1, cat: "Bricks", img: "https://example.test/300126.jpg", name: "Brick 2 x 4" },
    { id: "4211064-3747-Dark_Stone_Grey", qty: 2, dim: "2 × 3 studs", colour: "Dark Grey", any: false, tier: 2, cat: "Sloped Bricks", img: "https://example.test/4211064.jpg", name: "Slope, Inverted 33 3 x 2" },
    { id: "4541538-30385-Transparent_Blue", qty: 2, dim: "1 × 1 stud", colour: "Trans-Blue", any: false, tier: 2, cat: "Minifig Accessories", img: "https://example.test/4541538.jpg", name: "Rock 1 x 1 Crystal 5 Point" },
  ],
};
const fixtureInv10305 = {
  set: "10305-1 Test Set 2", lots: 2, pieces: 5,
  tiers: { 1: "MOST LIKELY IN BULK", 2: "MEDIUM — WORTH A DIG", 3: "LEAST LIKELY IN BULK" },
  items: [
    { id: "300126-3001-Black", qty: 3, dim: "2 × 4 studs", colour: "Black", any: false, tier: 1, cat: "Bricks", img: "https://example.test/300126.jpg", name: "Brick 2 x 4" },
    { id: "614126-6141-White", qty: 2, dim: "1 × 1 studs", colour: "White", any: false, tier: 1, cat: "Small pieces", img: "https://example.test/614126.jpg", name: "Tile 1 x 1" },
  ],
};

/* ---------- Mock Supabase ---------- */
const dbCalls = [];
let invokeHandler = null;
let replacedUrl = null; // last URL history.replaceState was called with
let setPartsRows = []; // cloud rows fetchCloudParts returns in tests
let cloudSetRows = null; // cloud rows fetchCloudSets returns in tests
const mockChannels = [];
function fireParts(payload) {
  for (const ch of mockChannels) for (const h of ch.handlers) if (h.filter.table === "set_parts") h.cb(payload);
}

class MockQuery {
  constructor(table) { this.table = table; this.filters = {}; }
  select() { return this; }
  eq(col, val) { this.filters[col] = val; return this; }
  order() { return this; }
  insert(row) { this._insert = row; return this; }
  delete() { this._delete = true; return this; }
  upsert(rows) { this._upsert = rows; dbCalls.push({ table: this.table, op: "upsert", rows }); return this; }
  async single() {
    if (this.table === "user_sets" && (this._insert || this._upsert)) {
      const row = this._insert || (Array.isArray(this._upsert) ? this._upsert[0] : this._upsert);
      const id = "us-" + row.set_num;
      return { data: { id, ...row }, error: null };
    }
    return { data: null, error: null };
  }
  async maybeSingle() {
    if (this.table === "set_inventories") {
      dbCalls.push({ table: "set_inventories", op: "select", set_num: this.filters["set_num"] });
      if (this.filters["set_num"] === "10305-1") return { data: { inventory: fixtureInv10305 }, error: null };
      return { data: null, error: null };
    }
    return { data: null, error: null };
  }
  then(resolve, reject) {
    if (this._delete) { dbCalls.push({ table: this.table, op: "delete", filters: { ...this.filters } }); return Promise.resolve({ data: null, error: mockSb._deleteError || null }).then(resolve, reject); }
    if (this.table === "set_parts") return Promise.resolve({ data: setPartsRows, error: null }).then(resolve, reject);
    if (this.table === "user_sets" && cloudSetRows) return Promise.resolve({ data: cloudSetRows, error: null }).then(resolve, reject);
    return Promise.resolve({ data: [], error: null }).then(resolve, reject);
  }
}

const mockSb = {
  auth: {
    getSession: async () => ({ data: { session: { user: { id: "u-1", email: "josephvand@gmail.com" } } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signInWithPassword: async (creds) => {
      mockSb._lastSignIn = creds;
      if (mockSb._signInError) return { data: {}, error: mockSb._signInError };
      return { data: { user: { id: "u-1", email: creds.email } }, error: null };
    },
    signUp: async (creds) => {
      mockSb._lastSignUp = creds;
      return { data: { session: { user: { id: "u-1", email: creds.email } } }, error: null };
    },
    signOut: async (opts) => { mockSb._lastSignOut = opts || {}; return { error: null }; },
    resetPasswordForEmail: async (email, opts) => { mockSb._lastResetEmail = email; mockSb._lastResetOpts = opts; return { error: null }; },
    updateUser: async (attrs) => { mockSb._lastUpdateUser = attrs; return { data: {}, error: null }; },
  },
  channel(name) {
    const ch = {
      name,
      handlers: [],
      on(event, filter, cb) { this.handlers.push({ event, filter, cb }); return this; },
      subscribe() { mockSb._subscribed = (mockSb._subscribed || 0) + 1; return this; },
    };
    mockChannels.push(ch);
    return ch;
  },
  removeChannel(ch) { mockSb._removedChannels = (mockSb._removedChannels || 0) + 1; return Promise.resolve({ error: null }); },
  from: (table) => new MockQuery(table),
  functions: {
    invoke: async (name, opts) => {
      dbCalls.push({ fn: name, body: opts && opts.body });
      if (invokeHandler) return invokeHandler(name, opts);
      return { data: null, error: { message: "no handler" } };
    },
  },
};

/* ---------- Load the app ---------- */
class StubAudio {
  constructor(src) { this.src = src; this.currentTime = 0; this.playCount = 0; this.preload = ""; }
  play() { this.playCount++; return Promise.resolve(); }
  load() {}
}

const doc = new StubDocument();
// <html> stub with a CSS-variable store, so applyCols() (v3.24) can be verified.
doc.documentElement = new StubEl("html");
doc.documentElement.style.setProperty = function (k, v) { this[k] = v; };
doc.documentElement.style.getPropertyValue = function (k) { return this[k] || ""; };
const sandbox = {
  console,
  setInterval: () => 0,
  setTimeout,
  clearTimeout,
  navigator: { onLine: true },
  location: { hash: "", href: "https://josephvand-del.github.io/bulk-finder/", pathname: "/bulk-finder/", search: "" },
  history: { replaceState(state, title, url) { replacedUrl = url; } },
  CSS: { escape: (s) => s },
  localStorage: new LSStub(),
  document: doc,
  Audio: StubAudio,
};
sandbox.window = sandbox;
sandbox.addEventListener = (t, fn) => { ((sandbox._winListeners = sandbox._winListeners || {}))[t] = fn; };
sandbox.supabase = { createClient: () => mockSb };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("app.js", "utf8"), sandbox, { filename: "app.js" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => doc.getElementById(id);

async function main() {
  // Boot: logged-in session, no sets yet.
  await doc.listeners["DOMContentLoaded"][0]();
  check("boot: user logged in", sandbox.user && sandbox.user.email, "josephvand@gmail.com");
  check("boot: 8961-1 inventory embedded", sandbox.getInventory("8961-1").lots, 138);

  // v3.24 "Displayed" columns control: desktop default 5, phone default 2,
  // each saved separately on this device, resize switches bands.
  check("cols: desktop default 5", sandbox.applyCols(), 5);
  check("cols: --bf-cols is 5 on desktop", doc.documentElement.style["--bf-cols"], "5");
  check("cols: input shows 5", $("colsInput").value, "5");
  sandbox.setCols(3);
  check("cols: set to 3", sandbox.getCols(sandbox.COLS_DESKTOP), 3);
  check("cols: --bf-cols is 3", doc.documentElement.style["--bf-cols"], "3");
  check("cols: saved to localStorage", JSON.parse(sandbox.localStorage.getItem("bf:cols:desktop")), 3);
  sandbox.setCols(9);
  check("cols: clamps to max 5", sandbox.getCols(sandbox.COLS_DESKTOP), 5);
  sandbox.setCols(1);
  check("cols: clamps to min 2", sandbox.getCols(sandbox.COLS_DESKTOP), 2);
  $("colsPlusBtn").listeners.click[0]();
  check("cols: + button steps 2 -> 3", doc.documentElement.style["--bf-cols"], "3");
  $("colsMinusBtn").listeners.click[0]();
  check("cols: - button steps 3 -> 2", doc.documentElement.style["--bf-cols"], "2");
  $("colsInput").value = "4";
  $("colsInput").listeners.change[0]({ target: $("colsInput") });
  check("cols: typing 4 sets 4", doc.documentElement.style["--bf-cols"], "4");
  sandbox.innerWidth = 390;
  sandbox.applyCols();
  check("cols: phone default 2", doc.documentElement.style["--bf-cols"], "2");
  sandbox.setCols(3);
  check("cols: phone set to 3", doc.documentElement.style["--bf-cols"], "3");
  sandbox.setCols(9);
  check("cols: phone clamps to max 4", doc.documentElement.style["--bf-cols"], "4");
  sandbox.innerWidth = 1280;
  sandbox._winListeners.resize();
  check("cols: resize back to desktop restores 4", doc.documentElement.style["--bf-cols"], "4");
  check("cols: phone value kept separately", JSON.parse(sandbox.localStorage.getItem("bf:cols:phone")), 4);
  check("cols: desktop value kept separately", JSON.parse(sandbox.localStorage.getItem("bf:cols:desktop")), 4);
  sandbox.innerWidth = undefined;

  // Seed the starter set (as the sidebar button does).
  await sandbox.addSeedSet();
  check("seed: sets has 8961-1", sandbox.sets.map((s) => s.key), ["8961-1"]);
  check("seed: 138 lots loaded", sandbox.items.length, 138);

  // v3.1 type merges: the dropdown is built from the real app code.
  sandbox.rebuildTypeSelect();
  check("types: v3.28 dropdown (15 cats)", sandbox.document.getElementById("typeSelect").children.map((o) => o.value), ["all", "Small pieces", "Plates", "Bricks", "Sloped Bricks", "Minifig / Accessories", "Technic Axles", "Miscellaneous", "Wheels and Tyres", "Technic Beams", "Technic Bricks", "Plates Special", "Technic Special", "Bars, Ladders and Fences", "Windows and Doors", "Transportation - Land"]);
  check("types: Minifig / Accessories never folds", sandbox.displayCat({ setKey: "8961-1", cat: "Minifig / Accessories" }), "Minifig / Accessories");
  check("types: 2-lot raw cat keeps its section", sandbox.displayCat({ setKey: "8961-1", cat: "Technic Special" }), "Technic Special");
  const catOf = (design) => sandbox.items.find((it) => it.id.split("-")[1] === design).cat;
  check("types: gear 3648 is Technic Bricks", catOf("3648"), "Technic Bricks");
  check("types: rock monster 64786 is Minifig / Accessories", catOf("64786"), "Minifig / Accessories");
  check("types: bow brick 61678 is Sloped Bricks", catOf("61678"), "Sloped Bricks");
  check("types: no Random / Minifigs / Technic Pins left", sandbox.items.some((it) => ["Random", "Minifigs", "Minifig Accessories", "Technic Pins", "Technic Bushes"].includes(it.cat)), false);

  // Pure helpers.
  check("normalize: bare number gets -1", sandbox.normalizeSetNumInput("10294"), "10294-1");
  check("normalize: number with variant kept", sandbox.normalizeSetNumInput("10294-1"), "10294-1");

  // Lookup success -> preview.
  invokeHandler = async () => ({
    data: {
      ok: true, cached: false,
      set: { set_num: "10294-1", name: "Test Ship", year: 2021, num_parts: 10, set_img_url: "https://example.test/set.jpg" },
      inventory: fixtureInv10294, lots: 3, pieces: 10,
    },
    error: null,
  });
  $("setNumInput").value = "10294";
  await sandbox.lookupSet();
  check("lookup: pendingImport set", sandbox.pendingImport && sandbox.pendingImport.set_num, "10294-1");
  check("lookup: preview shown", $("addSetPreview").hidden, false);
  check("lookup: preview name", $("addSetPreviewName").textContent, "10294-1 — Test Ship");
  check("lookup: preview meta", $("addSetPreviewMeta").textContent, "2021 · 3 lots, 10 pieces");
  check("lookup: message", $("addSetMsg").textContent.includes("Found it"), true);

  // Confirm -> set added, counts at full qty, cloud rows written, view opens it.
  await sandbox.addImportedSet();
  await sleep(10); // let openSet's background cloud merge land
  check("add: sets has both", sandbox.sets.map((s) => s.key), ["8961-1", "10294-1"]);
  check("add: meta totals from inventory", [sandbox.findSet("10294-1").total_parts, sandbox.findSet("10294-1").total_lots], [10, 3]);
  check("add: inventory registered", sandbox.getInventory("10294-1").lots, 3);
  check("add: counts start at full qty", JSON.parse(sandbox.localStorage.getItem("bf:counts:10294-1")), { "300126-3001-Black": 6, "4211064-3747-Dark_Stone_Grey": 2, "4541538-30385-Transparent_Blue": 2 });
  const insert10294 = dbCalls.filter((c) => c.table === "user_sets" && c.op === "upsert" && c.rows && c.rows.set_num === "10294-1");
  check("add: user_sets row created", insert10294.length, 1);
  const upserts10294 = dbCalls.filter((c) => c.table === "set_parts" && c.op === "upsert" && c.rows[0] && c.rows[0].user_set_id === "us-10294-1");
  check("add: set_parts upserted (3 rows)", upserts10294.length >= 1 && upserts10294[0].rows.length, 3);
  check("add: view opens the new set", sandbox.selectedKeys, ["10294-1"]);
  check("add: items are the new lots", sandbox.items.length, 3);
  check("add: totals", [sandbox.totals().found, sandbox.totals().total, sandbox.totals().done, sandbox.totals().lots], [0, 10, 0, 3]);
  check("add: input cleared + preview hidden", [$("setNumInput").value, $("addSetPreview").hidden], ["", true]);

  // v3.5 — the user_id fix: the set row carries the owner's id, or
  // Supabase refuses it (NOT NULL + RLS) and the cloud stays empty.
  const id8962 = await sandbox.createCloudSet({ set_num: "8962-1", set_name: "Crystal King", total_parts: 100, total_lots: 10 });
  check("userid: set row created", id8962, "us-8962-1");
  const setRow8962 = dbCalls.filter((c) => c.table === "user_sets" && c.op === "upsert" && c.rows && c.rows.set_num === "8962-1").pop();
  check("userid: row carries the owner", setRow8962 && setRow8962.rows.user_id, "u-1");

  // v3.6 — search by name: "Crystal King" returns matches; tapping one
  // runs the normal number lookup for that set.
  invokeHandler = async (name, opts) => {
    if (opts.body.q) {
      return { data: { ok: true, results: [
        { set_num: "8962-1", name: "Crystal King", year: 2010, num_parts: 100, set_img_url: "https://example.test/8962.jpg" },
        { set_num: "8960-1", name: "Thunder Driller", year: 2010, num_parts: 80, set_img_url: "https://example.test/8960.jpg" },
      ] }, error: null };
    }
    if (opts.body.set_num === "8962-1") {
      return { data: { ok: true, cached: true, set: { set_num: "8962-1", name: "Crystal King", year: 2010, num_parts: 100, set_img_url: "https://example.test/8962.jpg" }, inventory: fixtureInv10294, lots: 3, pieces: 10 }, error: null };
    }
    return { data: null, error: { message: "no handler" } };
  };
  $("setNumInput").value = "Crystal King";
  await sandbox.lookupSet();
  check("search: results shown", $("addSetResults").hidden, false);
  check("search: two matches", $("addSetResults").children.length, 2);
  check("search: first match name", $("addSetResults").children[0].children[1].children[0].textContent, "Crystal King");
  check("search: first match number", $("addSetResults").children[0].children[1].children[1].textContent.includes("8962-1"), true);
  check("search: message counts matches", $("addSetMsg").textContent.includes("2 matches"), true);
  $("addSetResults").children[0].listeners.click[0]();
  await sleep(10);
  check("search: picking a match fills the number", $("setNumInput").value, "8962-1");
  check("search: picking a match opens the preview", $("addSetPreview").hidden, false);
  check("search: preview is the picked set", sandbox.pendingImport && sandbox.pendingImport.set_num, "8962-1");
  check("search: results hidden after pick", $("addSetResults").hidden, true);

  // A number still goes through the number path (no q in the call).
  invokeHandler = async (name, opts) => ({
    data: { ok: true, cached: false, set: { set_num: "10294-1", name: "Test Ship", year: 2021, num_parts: 10, set_img_url: "https://example.test/set.jpg" }, inventory: fixtureInv10294, lots: 3, pieces: 10 },
    error: null,
  });
  $("setNumInput").value = "10296";
  await sandbox.lookupSet();
  const numCall = dbCalls.filter((c) => c.fn === "import-set").pop();
  check("search: number lookup sends set_num, not q", numCall && numCall.body && numCall.body.set_num, "10296-1");

  // No matches says so plainly.
  invokeHandler = async () => ({ data: { ok: true, results: [] }, error: null });
  $("setNumInput").value = "Zzz No Such Set";
  await sandbox.lookupSet();
  check("search: no matches message", $("addSetMsg").textContent.includes("No sets matched"), true);
  check("search: no matches shows no list", $("addSetResults").hidden, true);

  // v3.6 — My sets rows: name / set number / % complete + thumbnail.
  check("rows: percent of a fresh set", sandbox.setPercent(sandbox.findSet("10294-1")), "0%");
  const counts8961 = sandbox.loadCounts("8961-1");
  counts8961["300126-3001-Black"] = 0; // 16 of 430 found
  sandbox.saveCounts("8961-1", counts8961);
  check("rows: percent after one lot found", sandbox.setPercent(sandbox.findSet("8961-1")), "3%"); // 16/430 = 3.72%, floored (v3.29): 100% only when complete
  sandbox.renderSets();
  const rows8961 = $("setList").children.filter((li) => li.children[1].children[1].textContent === "8961-1");
  check("rows: one row for 8961-1", rows8961.length, 1);
  const row8961 = rows8961[0];
  check("rows: name first", row8961.children[1].children[0].textContent, "Crystal Sweeper");
  check("rows: number second", row8961.children[1].children[1].textContent, "8961-1");
  check("rows: percent third", row8961.children[1].children[2].textContent, "3%");
  const thumb8961 = row8961.children.find((c) => c.className === "set-thumb");
  check("rows: thumbnail present", !!thumb8961, true);
  check("rows: thumbnail is the set image", thumb8961 && thumb8961.src, "https://cdn.rebrickable.com/media/sets/8961-1.jpg");
  check("rows: image fallback is the inventory image", sandbox.setImageUrl({ set_num: "8961-1" }), "https://cdn.rebrickable.com/media/sets/8961-1.jpg");
  // Restore the counts: later tests expect 8961-1 at full qty (0 found).
  const reset8961 = {};
  sandbox.getInventory("8961-1").items.forEach((it) => { reset8961[it.id] = it.qty; });
  sandbox.saveCounts("8961-1", reset8961);
  check("rows: counts restored", sandbox.setPercent(sandbox.findSet("8961-1")), "0%");

  // Card shows the part name for imported lots.
  const card = sandbox.buildCard(sandbox.items[2]);
  const nameDiv = card.children.find((n) => n.className === "partname");
  check("card: part name shown", nameDiv && nameDiv.textContent, "Rock 1 x 1 Crystal 5 Point");

  // Duplicate lookup is refused.
  $("setNumInput").value = "10294-1";
  await sandbox.lookupSet();
  check("dup: already in list", $("addSetMsg").textContent.includes("already in your list"), true);

  // set_not_found (error body in error.context, as supabase-js does on 404).
  invokeHandler = async () => ({
    data: null,
    error: { message: "FunctionsHttpError", context: { ok: false, error: "set_not_found", message: "Rebrickable has no set 99999-1. Check the number — it usually ends in -1." } },
  });
  $("setNumInput").value = "99999";
  await sandbox.lookupSet();
  check("err: set_not_found message", $("addSetMsg").textContent.includes("no set 99999-1"), true);

  // no_api_key (error body in data, as supabase-js does on some statuses).
  invokeHandler = async () => ({
    data: { ok: false, error: "no_api_key", message: "The Rebrickable key isn't set yet — add REBRICKABLE_API_KEY in the Supabase dashboard (Edge Functions > Secrets)." },
    error: { message: "FunctionsHttpError" },
  });
  $("setNumInput").value = "10295";
  await sandbox.lookupSet();
  check("err: no_api_key message", $("addSetMsg").textContent.includes("Rebrickable key"), true);

  // v3.25 — one automatic retry on a gateway failure (no error body):
  // the 75419-1 import died once at the edge after ~35s and worked on
  // a manual retry. First call 502s, second succeeds -> preview.
  let retryCalls = 0;
  invokeHandler = async () => {
    retryCalls++;
    if (retryCalls === 1) return { data: null, error: { message: "Edge Function returned a non-2xx status code" } };
    return { data: { ok: true, cached: false, set: { set_num: "10297-1", name: "Retry Ship", year: 2022, num_parts: 10, set_img_url: "https://example.test/set.jpg" }, inventory: fixtureInv10294, lots: 3, pieces: 10 }, error: null };
  };
  $("setNumInput").value = "10297";
  await sandbox.lookupSet();
  check("retry: gateway 502 retried once", retryCalls, 2);
  check("retry: preview shown after retry", $("addSetPreview").hidden, false);
  check("retry: preview is the retried set", sandbox.pendingImport && sandbox.pendingImport.set_num, "10297-1");

  // A thrown network error also retries once.
  retryCalls = 0;
  invokeHandler = async () => {
    retryCalls++;
    if (retryCalls === 1) throw new Error("network down");
    return { data: { ok: true, cached: false, set: { set_num: "10298-1", name: "Retry Ship 2", year: 2022, num_parts: 10, set_img_url: "https://example.test/set.jpg" }, inventory: fixtureInv10294, lots: 3, pieces: 10 }, error: null };
  };
  $("setNumInput").value = "10298";
  await sandbox.lookupSet();
  check("retry: thrown error retried once", retryCalls, 2);
  check("retry: preview shown after throw-retry", sandbox.pendingImport && sandbox.pendingImport.set_num, "10298-1");

  // Structured errors are NOT retried: set_not_found calls invoke once.
  retryCalls = 0;
  invokeHandler = async () => {
    retryCalls++;
    return { data: null, error: { message: "FunctionsHttpError", context: { ok: false, error: "set_not_found", message: "Rebrickable has no set 99998-1." } } };
  };
  $("setNumInput").value = "99998";
  await sandbox.lookupSet();
  check("retry: set_not_found not retried", retryCalls, 1);
  check("retry: set_not_found message kept", $("addSetMsg").textContent.includes("no set 99998-1"), true);

  // Guest cannot look up.
  sandbox.user = null;
  $("setNumInput").value = "10296";
  await sandbox.lookupSet();
  check("err: guest blocked", $("addSetMsg").textContent.includes("Log in first"), true);
  sandbox.user = { id: "u-1", email: "josephvand@gmail.com" };

  // Runtime inventory fetch: first call hits the cache table, second is local.
  const before = dbCalls.filter((c) => c.table === "set_inventories").length;
  const inv1 = await sandbox.fetchSetInventory("10305-1");
  check("fetch: inventory returned", inv1 && inv1.lots, 2);
  check("fetch: one table read", dbCalls.filter((c) => c.table === "set_inventories").length - before, 1);
  const inv2 = await sandbox.fetchSetInventory("10305-1");
  check("fetch: second call is cached locally", dbCalls.filter((c) => c.table === "set_inventories").length - before, 1);
  check("fetch: getInventory serves it", sandbox.getInventory("10305-1") === inv2, true);

  // A set known from the cloud (meta in the list) loads through loadSelected.
  sandbox.sets.push({ key: "10305-1", set_num: "10305-1", set_name: "Test Set 2", total_parts: 5, total_lots: 2, user_set_id: "us-10305" });
  sandbox.setSelected(["10305-1"]);
  check("loadSelected: runtime inventory lots shown", sandbox.items.length, 2);
  check("loadSelected: totals", [sandbox.totals().found, sandbox.totals().total], [0, 5]);

  // Combined view across the embedded set and an imported set (v2.0 regression).
  sandbox.setSelected(["8961-1", "10294-1"]);
  check("combined: both sets' lots", sandbox.items.length, 141);
  check("combined: totals", [sandbox.totals().found, sandbox.totals().total, sandbox.totals().lots], [0, 440, 141]);
  check("combined: picker label", doc.getElementById("setPickerBtn").textContent, "Sets: 2 of 3");

  // v3.3 — multi-device login + live sync.
  check("live: channel subscribed on boot", (mockSb._subscribed || 0) >= 1, true);
  check("live: liveChannel set", sandbox.liveChannel !== null, true);

  // Login normalises the email: stray spaces + capitals must not fail it.
  $("authEmail").value = "  JosephVand@Gmail.COM ";
  $("authPassword").value = "secret123";
  mockSb._signInError = null;
  await sandbox.doLogin();
  check("login: email trimmed + lowercased", mockSb._lastSignIn && mockSb._lastSignIn.email, "josephvand@gmail.com");

  // A wrong password says so in plain words — and says a second device is not the cause.
  mockSb._signInError = { message: "Invalid login credentials" };
  await sandbox.doLogin();
  check("login: invalid creds in plain words", $("authMsg").textContent.includes("didn\u2019t match"), true);
  check("login: message clears second-device blame", $("authMsg").textContent.includes("second device"), true);
  mockSb._signInError = null;

  // Forgot password sends a reset link to the normalised email.
  $("authEmail").value = "  JosephVand@Gmail.com ";
  await sandbox.doForgotPassword();
  check("login: reset link to normalised email", mockSb._lastResetEmail, "josephvand@gmail.com");
  check("login: reset message shown", $("authMsg").textContent.includes("Reset link sent"), true);

  // Password-recovery link turns the log-in button into "Set new password".
  await sandbox.handleAuthChange("PASSWORD_RECOVERY", { user: { id: "u-1", email: "josephvand@gmail.com" } });
  check("login: recovery mode on", sandbox.pwSetMode, true);
  check("login: button becomes Set new password", $("loginBtn").textContent, "Set new password");
  $("authPassword").value = "newpass123";
  await sandbox.doLogin();
  check("login: recovery sets new password", mockSb._lastUpdateUser && mockSb._lastUpdateUser.password, "newpass123");
  check("login: recovery mode off after set", sandbox.pwSetMode, false);

  // Show-password toggle flips the field type.
  $("authPassword").type = "password";
  $("pwToggleBtn").listeners.click[0]();
  check("login: show password flips type", $("authPassword").type, "text");
  check("login: toggle button says Hide", $("pwToggleBtn").textContent, "Hide");

  // v3.27 — stay signed in: a saved login restores itself when the app
  // comes back, without asking for the password again.
  // (user is cleared directly, not via applyLoggedOutUI — logging out
  // rebuilds the view around the active set, and these checks must
  // leave the combined view exactly as the later tests expect it.)
  sandbox.user = null;
  sandbox.renderAuth();
  check("stayin: logged-out toggle says Log in / Sign up", $("authToggleBtn").textContent, "Log in / Sign up");
  await sandbox.refreshSessionIfLoggedOut();
  check("stayin: saved session restores the user", sandbox.user && sandbox.user.email, "josephvand@gmail.com");
  check("stayin: restore hides the login button", $("authToggleBtn").hidden, true);
  // No session saved: the re-check leaves the app logged out.
  const realGetSession = mockSb.auth.getSession;
  mockSb.auth.getSession = async () => ({ data: { session: null }, error: null });
  sandbox.user = null;
  sandbox.renderAuth();
  await sandbox.refreshSessionIfLoggedOut();
  check("stayin: no saved session stays logged out", sandbox.user, null);
  mockSb.auth.getSession = realGetSession;
  // Already logged in: the re-check is a no-op and never asks again.
  sandbox.user = { id: "u-1", email: "josephvand@gmail.com" };
  let getSessionCalls = 0;
  mockSb.auth.getSession = async () => { getSessionCalls++; return realGetSession(); };
  await sandbox.refreshSessionIfLoggedOut();
  check("stayin: re-check skipped while logged in", getSessionCalls, 0);
  mockSb.auth.getSession = realGetSession;
  // Coming back online re-checks the session when logged out.
  sandbox.user = null;
  sandbox.renderAuth();
  sandbox._winListeners.online();
  await sleep(20);
  check("stayin: online event restores the session", sandbox.user && sandbox.user.email, "josephvand@gmail.com");
  // Coming back to the app re-checks it too.
  sandbox.user = null;
  sandbox.renderAuth();
  doc.listeners["visibilitychange"][0]();
  await sleep(20);
  check("stayin: returning to the app restores the session", sandbox.user && sandbox.user.email, "josephvand@gmail.com");

  // Live sync: a tap on another device arrives without a refresh.
  const meta8961 = sandbox.sets.find((s) => s.key === "8961-1");
  meta8961.user_set_id = "us-8961-1";
  sandbox.user = { id: "u-1", email: "josephvand@gmail.com" };
  const foundBefore = sandbox.totals().found;
  setPartsRows = [{ part_key: "300126-3001-Black", qty_remaining: 0 }];
  fireParts({ new: { user_set_id: "us-8961-1", part_key: "300126-3001-Black", qty_remaining: 0 } });
  await sleep(20);
  check("live: remote tap adopted without refresh", sandbox.totals().found - foundBefore, 16);

  // A lot this device changed but hasn't synced yet is never overwritten by a pull.
  const map8961 = sandbox.remainingBySet["8961-1"];
  map8961["4121715-2780-Black"] = 3;
  sandbox.saveCounts("8961-1", map8961);
  sandbox.LS.set("bf:outbox", [{ kind: "part", user_set_id: "us-8961-1", row: { part_key: "4121715-2780-Black", qty_remaining: 3 } }]);
  setPartsRows = [
    { part_key: "300126-3001-Black", qty_remaining: 0 },
    { part_key: "4121715-2780-Black", qty_remaining: 0 },
  ];
  await sandbox.pullRemoteCounts(meta8961);
  check("live: pull keeps pending local lot", sandbox.remainingBySet["8961-1"]["4121715-2780-Black"], 3);
  check("live: pull adopts other lots", sandbox.remainingBySet["8961-1"]["300126-3001-Black"], 0);
  sandbox.LS.set("bf:outbox", []);

  // v3.5 — first contact with cloud rows merges best-of-both per lot
  // (the backfill after the user_id fix): neither device's progress is
  // lost when both hold local-only counts.
  sandbox.mergedThisSession = {};
  sandbox.LS.set("bf:cloudIds", {}); // this device never saved a set row
  const mergeLocal = sandbox.remainingBySet["8961-1"];
  mergeLocal["300126-3001-Black"] = 0; // found here
  mergeLocal["4121715-2780-Black"] = 8; // not found here (full qty)
  sandbox.saveCounts("8961-1", mergeLocal);
  setPartsRows = [
    { part_key: "300126-3001-Black", qty_remaining: 6 }, // cloud: not found
    { part_key: "4121715-2780-Black", qty_remaining: 0 }, // cloud: found
  ];
  const upsertsBefore = dbCalls.filter((c) => c.table === "set_parts" && c.op === "upsert").length;
  await sandbox.ensureCloudSet(meta8961);
  check("merge: keeps local find", sandbox.remainingBySet["8961-1"]["300126-3001-Black"], 0);
  check("merge: adopts cloud find", sandbox.remainingBySet["8961-1"]["4121715-2780-Black"], 0);
  check("merge: merged counts pushed back up", dbCalls.filter((c) => c.table === "set_parts" && c.op === "upsert").length - upsertsBefore >= 1, true);
  check("merge: cloud id recorded", JSON.parse(sandbox.localStorage.getItem("bf:cloudIds"))["8961-1"], "us-8961-1");

  // Already-synced devices keep cloud-wins (so Reset still propagates).
  sandbox.mergedThisSession = {};
  sandbox.LS.set("bf:cloudIds", { "8961-1": "us-8961-1" });
  const mergeLocal2 = sandbox.remainingBySet["8961-1"];
  mergeLocal2["300126-3001-Black"] = 0;
  sandbox.saveCounts("8961-1", mergeLocal2);
  setPartsRows = [{ part_key: "300126-3001-Black", qty_remaining: 6 }];
  const upsertsBefore2 = dbCalls.filter((c) => c.table === "set_parts" && c.op === "upsert").length;
  await sandbox.ensureCloudSet(meta8961);
  check("merge: synced device takes cloud", sandbox.remainingBySet["8961-1"]["300126-3001-Black"], 6);
  check("merge: no push-back when cloud wins", dbCalls.filter((c) => c.table === "set_parts" && c.op === "upsert").length - upsertsBefore2, 0);

  // Log out is local-only: the other device stays signed in.
  await sandbox.doLogout();
  check("login: logout scope is local", mockSb._lastSignOut && mockSb._lastSignOut.scope, "local");
  check("live: channel removed on logout", (mockSb._removedChannels || 0) >= 1, true);

  // v3.3.1 BUG REPRO: clicking a password-reset link opens the app, but
  // no "Set new password" form appears. The PASSWORD_RECOVERY event fires
  // during client init, before init() registers its listener — so the
  // app must spot the recovery token in the URL itself at startup.
  sandbox.location.hash = "#access_token=x&refresh_token=y&token_type=bearer&type=recovery";
  sandbox.pwSetMode = false;
  await doc.listeners["DOMContentLoaded"][0](); // boot again, as the reset link does
  check("reset: recovery link opens the reset form", sandbox.pwSetMode, true);
  check("reset: button becomes Set new password", $("loginBtn").textContent, "Set new password");
  $("authPassword").value = "brandnewpass";
  await sandbox.doLogin();
  check("reset: new password set via recovery", mockSb._lastUpdateUser && mockSb._lastUpdateUser.password, "brandnewpass");
  check("reset: hash cleared after password set", replacedUrl, "/bulk-finder/");
  sandbox.location.hash = "";

  // v3.3.2 — Change password while logged in (no email needed): the
  // bypass when Supabase's 2-emails-per-hour budget is spent.
  sandbox.user = { id: "u-1", email: "josephvand@gmail.com" };
  sandbox.renderAuth();
  check("changepw: button visible when logged in", $("changePwBtn").hidden, false);
  $("changePwBtn").listeners.click[0]();
  check("changepw: opens set-new-password form", sandbox.pwSetMode, true);
  check("changepw: button becomes Set new password", $("loginBtn").textContent, "Set new password");
  $("authPassword").value = "computer-set-pass";
  mockSb._lastUpdateUser = null;
  await sandbox.doLogin();
  check("changepw: new password set", mockSb._lastUpdateUser && mockSb._lastUpdateUser.password, "computer-set-pass");
  check("changepw: mode off after set", sandbox.pwSetMode, false);
  check("changepw: button visible again after set", $("changePwBtn").hidden, false);

  // v3.4 — mobile drawer: hamburger toggles body.drawer-open; picking a
  // set, the backdrop, or Escape closes it.
  check("drawer: closed at boot", sandbox.document.body.classList.contains("drawer-open"), false);
  $("menuBtn").listeners.click[0]();
  check("drawer: hamburger opens it", sandbox.document.body.classList.contains("drawer-open"), true);
  check("drawer: aria-expanded true", $("menuBtn").attributes["aria-expanded"], "true");
  $("menuBtn").listeners.click[0]();
  check("drawer: hamburger closes it", sandbox.document.body.classList.contains("drawer-open"), false);
  $("menuBtn").listeners.click[0]();
  $("drawerBackdrop").listeners.click[0]();
  check("drawer: backdrop closes it", sandbox.document.body.classList.contains("drawer-open"), false);
  $("menuBtn").listeners.click[0]();
  sandbox.openSet("8961-1");
  check("drawer: picking a set closes it", sandbox.document.body.classList.contains("drawer-open"), false);
  $("menuBtn").listeners.click[0]();
  sandbox.document.listeners.keydown[0]({ key: "Escape" });
  check("drawer: Escape closes it", sandbox.document.body.classList.contains("drawer-open"), false);

  // v3.7 — sidebar order: Add a set above My sets, account controls
  // in a footer at the very bottom. v3.18 — the Reset all button is
  // gone (nobody uses it; it only risked wiping found pieces).
  const html = fs.readFileSync("index.html", "utf8");
  const appJsEarly = fs.readFileSync("app.js", "utf8");
  const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
  check("layout: header holds no account controls", ["syncStatus", "logoutBtn", "changePwBtn", "userChip"].some((id) => header.includes(id)), false);
  check("layout: add-a-set above my sets", html.indexOf('id="addSetResults"') < html.indexOf('id="setList"'), true);
  check("layout: reset button is gone", html.includes('id="resetBtn"'), false);
  check("layout: no resetAll wiring left", appJsEarly.includes("resetAll"), false);
  check("layout: account footer at the very bottom", html.indexOf('id="setList"') < html.indexOf('sidebar-footer') && html.indexOf('sidebar-footer') < html.indexOf('id="syncStatus"'), true);
  // v3.18 — the sync pill stays in the DOM (hidden) so the status
  // writer keeps working, but nothing shows it in the sidebar.
  check("layout: sync pill is hidden, not removed", html.includes('id="syncStatus"') && html.includes('id="syncStatus" class="sync-status" hidden'), true);
  check("layout: sync still writes status", sandbox.updateSyncStatus(), undefined);
  const css = fs.readFileSync("styles.css", "utf8");
  check("layout: sidebar is a flex column", css.includes("display: flex;\n  flex-direction: column;"), true);
  check("layout: footer pins to the bottom", css.includes(".sidebar-footer") && css.includes("margin-top: auto;"), true);


  // v3.8 — stud-pickup sound: toggle in the header, plays on found only.
  check("sound: on by default", sandbox.soundOn, true);
  check("sound: button shows speaker", $("soundToggleBtn").textContent, "🔊");
  check("sound: clip is the bundled base64 audio", sandbox.studSound && sandbox.studSound.src.indexOf("data:audio/mpeg;base64,") === 0, true);
  const item0 = sandbox.items.find((it) => sandbox.remOf(it) > 0);
  const remBefore = sandbox.remOf(item0);
  const playedBefore = sandbox.studSound.playCount;
  sandbox.changeRemaining(item0, -1);
  check("sound: minus plays the clip", sandbox.studSound.playCount, playedBefore + 1);
  sandbox.changeRemaining(item0, +1);
  check("sound: undo plays nothing", sandbox.studSound.playCount, playedBefore + 1);
  $("soundToggleBtn").listeners.click[0]();
  check("sound: toggle mutes", sandbox.soundOn, false);
  check("sound: button shows muted speaker", $("soundToggleBtn").textContent, "🔇");
  check("sound: choice saved", sandbox.localStorage.getItem("bf:soundOn"), "false");
  sandbox.changeRemaining(item0, -1);
  check("sound: muted minus plays nothing", sandbox.studSound.playCount, playedBefore + 1);
  $("soundToggleBtn").listeners.click[0]();
  check("sound: toggle unmutes", sandbox.soundOn, true);
  sandbox.changeRemaining(item0, +1); // restore the lot to where it was
  check("sound: counts restored", sandbox.remOf(item0), remBefore);

  // v3.9 — combined view groups tiers across sets: one banner per tier.
  sandbox.setSelected(["8961-1", "10294-1"]);
  while (sandbox.viewPending.length) sandbox.renderNextChunk(); // v3.30: batches render on scroll, drain them to see every banner
  const banners = $("setView").children.filter((n) => n.className && n.className.indexOf("tier-banner") === 0).map((n) => n.textContent);
  check("tiers: one banner per tier across sets", banners, ["TIER 1 — MOST LIKELY IN BULK", "TIER 2 — MEDIUM — WORTH A DIG", "TIER 3 — LEAST LIKELY IN BULK"]);
  check("tiers: no per-set heading in the combined view", $("setView").children.some((n) => n.className === "set-heading"), false);
  const grids = $("setView").children.filter((n) => n.className === "card-grid");
  // A tier-2 card may be a merged card (dataset.key "merged|part|colour")
  // spanning both sets, or a single-set card — either way the grid must
  // hold pieces from both sets.
  const grid2Sets = {};
  grids[1].children.forEach((c) => {
    const key = c.dataset.key || "";
    if (key.indexOf("merged|") === 0) {
      const m = sandbox.viewList().find((it) => sandbox.partKeyOf(it) === key.slice("merged|".length));
      if (m) m.lots.forEach((l) => { grid2Sets[l.setKey] = true; });
    } else {
      grid2Sets[key.split("|")[0]] = true;
    }
  });
  check("tiers: tier 2 grid holds both sets", grid2Sets["8961-1"] && grid2Sets["10294-1"], true);
  // Single-set view is unchanged: three banners, no set tags.
  sandbox.setSelected(["8961-1"]);
  const singleBanners = $("setView").children.filter((n) => n.className && n.className.indexOf("tier-banner") === 0).map((n) => n.textContent);
  check("tiers: single set still shows all three tiers", singleBanners, ["TIER 1 — MOST LIKELY IN BULK", "TIER 2 — MEDIUM — WORTH A DIG", "TIER 3 — LEAST LIKELY IN BULK"]);
  check("tiers: single set cards carry no set tag", $("setView").children.filter((n) => n.className === "card-grid").some((g) => g.children.some((c) => c.children.some((d) => d.className === "set-tag"))), false);

  // v3.9 — the fold follows lots still left: 2+ open lots keeps a section.
  const inv8961 = sandbox.getInventory("8961-1");
  const foldMap = {};
  inv8961.items.forEach((it) => { foldMap[it.id] = it.qty; });
  const wheels = inv8961.items.filter((it) => it.cat === "Wheels and Tyres");
  wheels.slice(1).forEach((it) => { foldMap[it.id] = 0; }); // one lot left
  const plates = inv8961.items.filter((it) => it.cat === "Plates");
  plates.slice(2).forEach((it) => { foldMap[it.id] = 0; }); // two lots left
  inv8961.items.forEach((it) => {
    if (["Small pieces", "Technic Axles", "Technic Bricks", "Technic Pins / Bushes"].indexOf(it.cat) >= 0) foldMap[it.id] = 0;
  });
  sandbox.saveCounts("8961-1", foldMap);
  sandbox.setSelected(["8961-1"]); // reloads counts, rebuilds the fold and dropdowns
  const openWheels = sandbox.items.find((it) => it.cat === "Wheels and Tyres" && sandbox.remOf(it) > 0);
  check("fold: one lot left in Wheels and Tyres folds to Miscellaneous", sandbox.displayCat(openWheels), "Miscellaneous");
  const doors = sandbox.items.filter((it) => it.cat === "Windows and Doors");
  check("fold: three lots left in Windows and Doors keeps its section", doors.every((it) => sandbox.displayCat(it) === "Windows and Doors"), true);
  check("fold: two lots left in Plates keeps its section", sandbox.displayCat(sandbox.items.find((it) => it.cat === "Plates" && sandbox.remOf(it) > 0)), "Plates");
  check("fold: Bricks fully open keeps its section", sandbox.displayCat(sandbox.items.find((it) => it.cat === "Bricks")), "Bricks");
  const typeVals = $("typeSelect").children.map((o) => o.value);
  check("dropdown: fully found categories get no entry", ["Small pieces", "Technic Axles", "Technic Bricks", "Technic Pins / Bushes"].some((c) => typeVals.includes(c)), false);
  check("dropdown: folded Wheels and Tyres gets no entry", typeVals.includes("Wheels and Tyres"), false);
  check("dropdown: Windows and Doors still listed", typeVals.includes("Windows and Doors"), true);
  check("dropdown: no type shows 0 left", $("typeSelect").children.map((o) => o.textContent).some((t) => t.indexOf(" 0 left") >= 0), false);
  // Live fold: finding one of the three Windows and Doors lots keeps it
  // (two lots left); finding a second (one lot left) folds it.
  const doorLot = sandbox.items.find((it) => it.cat === "Windows and Doors" && sandbox.remOf(it) > 0);
  sandbox.changeRemaining(doorLot, -1);
  check("fold: live tap keeps Windows and Doors at two lots", sandbox.displayCat(doorLot), "Windows and Doors");
  sandbox.rebuildTypeSelect(); // the stub DOM has no card, so updateCardUI returns before rebuilding
  check("dropdown: live tap keeps Windows and Doors", $("typeSelect").children.map((o) => o.value).includes("Windows and Doors"), true);
  const doorLot2 = sandbox.items.find((it) => it.cat === "Windows and Doors" && sandbox.remOf(it) > 0);
  sandbox.changeRemaining(doorLot2, -1);
  check("fold: second live tap folds Windows and Doors", sandbox.displayCat(doorLot2), "Miscellaneous");
  sandbox.rebuildTypeSelect();
  check("dropdown: second live tap drops Windows and Doors", $("typeSelect").children.map((o) => o.value).includes("Windows and Doors"), false);
  // Colour dropdown: a family with nothing left gets no entry either.
  const colourMap = {};
  inv8961.items.forEach((it) => { colourMap[it.id] = it.qty; });
  const lastFam = $("colourSelect").children[$("colourSelect").children.length - 1].value;
  inv8961.items.forEach((it) => { if (sandbox.familyOf(it) === lastFam) colourMap[it.id] = 0; });
  sandbox.saveCounts("8961-1", colourMap);
  sandbox.setSelected(["8961-1"]);
  check("dropdown: fully found colour gets no entry", $("colourSelect").children.map((o) => o.value).includes(lastFam), false);
  // v3.9 — a dead photo shows the part number instead of a blank box
  // (Part 85418's plain-http Peeron photo is blocked as mixed content).
  const deadCard = sandbox.buildCard(sandbox.items.find((it) => it.id === "85418-85418-White"));
  const deadPhoto = deadCard.children.find((n) => n.className === "photo");
  const deadImg = deadPhoto.children[0];
  check("photo: no fallback while the image loads", deadPhoto.children.some((n) => n.className === "photo-fallback"), false);
  deadImg.listeners.error[0](); // primary (Peeron) dead: tries the BrickLink fallback
  check("photo: dead image tries the BrickLink fallback", deadImg.src, 'https://img.bricklink.com/ItemImage/PN/0/8961stk01.png');
  check("photo: no part-number text while the fallback loads", deadPhoto.children.some((n) => n.className === "photo-fallback"), false);
  deadImg.listeners.error[0](); // fallback dead too: hides + shows the part number
  check("photo: dead image hides", deadImg.style.display, "none");
  check("photo: fallback shows the part number", deadPhoto.children.some((n) => n.className === "photo-fallback" && n.textContent === "Part 85418"), true);
  check("layout: photo fallback styled", css.includes(".photo-fallback"), true);
  // Restore full counts and the combined selection.
  const fullMap = {};
  inv8961.items.forEach((it) => { fullMap[it.id] = it.qty; });
  sandbox.saveCounts("8961-1", fullMap);
  sandbox.setSelected(["8961-1", "10294-1"]);

  // v3.9 — no "Starter set" heading or blurb in the sidebar.
  check("layout: no Starter set heading", html.includes("<h3>Starter set</h3>"), false);
  check("layout: no starter-set blurb", html.includes("The full 138-lot, 430-piece list"), false);
  check("layout: noSetsMsg names no starter set", html.includes("or use the starter set"), false);
  check("layout: empty state names no starter set", html.includes("Add the starter set"), false);
  check("layout: seed button still present", html.includes('id="seedBtn"'), true);
  check("layout: old-progress button still present", html.includes('id="importSeedBtn"'), true);

  // v3.10 — grid columns use minmax(0, 1fr) so a 500px part photo can't
  // stretch its column and run the grid off the right edge (tier 2).
  check("grid: 5 columns use minmax(0, 1fr)", css.includes("repeat(var(--bf-cols, 5), minmax(0, 1fr))"), true);
  check("grid: 3 columns use minmax(0, 1fr)", css.includes("repeat(var(--bf-cols, 3), minmax(0, 1fr))"), true);
  check("grid: 2 columns use minmax(0, 1fr)", css.includes("repeat(var(--bf-cols, 2), minmax(0, 1fr))"), true);
  check("grid: no bare 5-column 1fr left", css.includes("repeat(5, 1fr)"), false);
  check("grid: no bare 3-column 1fr left", css.includes("repeat(3, 1fr)"), false);
  check("grid: no bare 2-column 1fr left", css.includes("repeat(2, 1fr)"), false);
  check("grid: card can shrink below its content", /\.card \{[^}]*min-width: 0/.test(css), true);
  check("grid: photo cap still 110px", css.includes("max-height: 110px"), true);

  // v3.11 — a refresh keeps the view; a new day resets to the defaults.
  // Custom view: Done + one set + a type + a colour, saved.
  sandbox.statusFilter = 'done';
  sandbox.typeFilter = 'Bricks';
  sandbox.colourFilter = 'Black';
  sandbox.setSelected(["8961-1"]);
  sandbox.saveViewState();
  const countsBefore = JSON.stringify(sandbox.loadCounts("8961-1"));
  // "Refresh": wipe the in-memory view, then restore it from storage.
  sandbox.statusFilter = 'needed'; sandbox.typeFilter = 'all'; sandbox.colourFilter = 'all';
  check("view: same-day restore returns true", sandbox.loadViewState(), true);
  check("view: refresh keeps the status", sandbox.statusFilter, 'done');
  check("view: refresh keeps the type", sandbox.typeFilter, 'Bricks');
  check("view: refresh keeps the colour", sandbox.colourFilter, 'Black');
  check("view: selection still saved", sandbox.LS.get('bf:selectedSets'), ["8961-1"]);
  check("view: refresh does not touch the counts", JSON.stringify(sandbox.loadCounts("8961-1")), countsBefore);
  // A new day: stamp the saved view with yesterday's date.
  const d0 = new Date(); d0.setDate(d0.getDate() - 1);
  const p0 = (n) => (n < 10 ? '0' : '') + n;
  const yesterday = d0.getFullYear() + '-' + p0(d0.getMonth() + 1) + '-' + p0(d0.getDate());
  sandbox.LS.set('bf:view', { date: yesterday, status: 'done', type: 'Bricks', colour: 'Black' });
  check("view: new-day restore returns false", sandbox.loadViewState(), false);
  check("view: new day resets the status", sandbox.statusFilter, 'needed');
  check("view: new day resets the type", sandbox.typeFilter, 'all');
  check("view: new day resets the colour", sandbox.colourFilter, 'all');
  check("view: new day does not touch the counts", JSON.stringify(sandbox.loadCounts("8961-1")), countsBefore);
  // The new-day selection reset: every set open, and the fresh view saved.
  sandbox.selectAllSets(true);
  check("view: new day selects all sets", sandbox.selectedKeys, ["8961-1", "10294-1"]);
  check("view: new-day view saved for today", sandbox.LS.get('bf:view').date, sandbox.todayStr());
  check("view: new-day view is the default", sandbox.LS.get('bf:view').status, 'needed');
  // Static: Still needed is the default button.
  check("view: Still needed is the default button", html.includes('<button class="filter-btn active" data-filter="needed">'), true);
  check("view: All is not the default button", html.includes('<button class="filter-btn active" data-filter="all">'), false);

  // v3.12 — dead photos fall back to BrickLink; the set tag is gone.
  // Why the photos were missing: LEGO's CDN has no 192x192 element
  // photo for those element ids (all 404), and 85418's Peeron photo is
  // plain http, blocked as mixed content. The fallback is BrickLink's
  // photo of the same part in the same colour (all verified 200).
  const fb = (setKey, cat, colour, id) => sandbox.fallbackImg({ setKey, cat, colour, id });
  check("photo: 2456 White falls back to BrickLink", fb('8960-1', 'Bricks', 'White', '6552122-2456-White'), 'https://img.bricklink.com/ItemImage/PN/1/2456.png');
  check("photo: 43093 Bright Blue falls back to BrickLink", fb('8960-1', 'Technic Pins', 'Blue', '4309323-43093-Bright_Blue'), 'https://img.bricklink.com/ItemImage/PN/7/43093.png');
  check("photo: 6587 Dark Grey falls back to BrickLink", fb('8960-1', 'Technic Axles', 'Dark Grey', '6587199-6587-Dark_Stone_Grey'), 'https://img.bricklink.com/ItemImage/PN/85/6587.png');
  check("photo: 3749 Tan falls back to BrickLink", fb('8962-1', 'Technic Pins', 'Tan', '65625-3749-Brick_Yellow'), 'https://img.bricklink.com/ItemImage/PN/2/3749.png');
  check("photo: 48183 Light Grey falls back to BrickLink", fb('8962-1', 'Plates', 'Light Grey', '48183-48183-Medium_Stone_Grey'), 'https://img.bricklink.com/ItemImage/PN/86/48183.png');
  check("photo: 84682 sticker sheet falls back to the set sheet", fb('8960-1', 'Stickers', 'No Color Any Color', '4542503-84682-No_Color_Any_Color'), 'https://img.bricklink.com/ItemImage/PN/0/8960stk01.png');
  const item85418 = sandbox.items.find((it) => sandbox.partNumOf(it) === '85418');
  check("photo: 85418 (real lot) falls back to the set sheet", sandbox.fallbackImg(item85418), 'https://img.bricklink.com/ItemImage/PN/0/8961stk01.png');
  check("photo: unknown colour has no fallback", fb('8961-1', 'Bricks', 'Magenta', 'x-1234-Unknown_Colour'), '');
  check("photo: Magenta now resolves via the LEGO colour", fb('8961-1', 'Bricks', 'Magenta', 'x-1234-Magenta'), 'https://img.bricklink.com/ItemImage/PN/71/1234.png');
  check("photo: fallback uses the exact colour, not the family", fb('8961-1', 'Bricks', 'Trans-Red', '3000841-30008-Transparent_Red'), 'https://img.bricklink.com/ItemImage/PN/17/30008.png');
  // The set tag is gone from combined-view cards.
  sandbox.setSelected(["8961-1", "10294-1"]);
  const card0 = sandbox.buildCard(sandbox.items[0]);
  check("tag: no set tag on a combined-view card", card0.children.some((c) => c.className && c.className.split(" ").includes("set-tag")), false);
  check("tag: set-tag code is gone", appJsEarly.includes("set-tag"), false);

  // v3.13 — a sign-in / session restore must not collapse the view.
  // This was the real refresh bug: init() restored the view, then the
  // Supabase session-restore event fired handleAuthChange, which called
  // openSet(activeSetKey) and collapsed a combined view to one set.
  check("auth: view is marked restored after init", sandbox.viewRestored, true);
  sandbox.setSelected(["8961-1", "10294-1"]);
  sandbox.statusFilter = 'done';
  sandbox.saveViewState();
  await sandbox.handleAuthChange('SIGNED_IN', { user: sandbox.user });
  check("auth: session restore keeps all sets open", sandbox.selectedKeys, ["8961-1", "10294-1"]);
  check("auth: session restore keeps the status filter", sandbox.statusFilter, 'done');
  check("auth: session restore does not rewrite the saved selection", sandbox.LS.get('bf:selectedSets'), ["8961-1", "10294-1"]);
  // And when nothing is open, a session restore opens the active set.
  sandbox.selectedKeys = [];
  await sandbox.handleAuthChange('SIGNED_IN', { user: sandbox.user });
  check("auth: session restore opens a set when none is open", sandbox.selectedKeys, [sandbox.activeSetKey]);

  // v3.15 — the popup is a 3D model, not a carousel. Tap a photo and
  // the part pops up as a live LDraw model (Three.js), most of the
  // screen, so a piece he doesn't recognise yet can be spun around
  // and studied. The photo on the card is the reference, the popup is
  // the model. The model itself lives in model3d.js — here the real
  // show3DModel runs (no WebGL in the harness: window is absent, so
  // it resolves the part + colour and stops), and the viewer state is
  // what the checks read.
  // The combined view is rebuilt by setSelected; the v3.13 test above
  // just left it on 8961-1 + 10294-1, so re-select 8961-1 first.
  sandbox.setSelected(["8961-1"]);
  const item2456 = { setKey: '8960-1', cat: 'Bricks', colour: 'White', dim: 'Brick 2 x 6', qty: 3, id: '6552122-2456-White', img: 'https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/6552122.jpg' };
  check("viewer: 2456 is Brick 2 x 6, not 1 x 6 x 5", item2456.dim, 'Brick 2 x 6');
  // Colour codes are LDraw's own (from ldcfgalt.ldr, the file the 3D
  // loader reads) — not the Rebrickable ids: Trans-Orange is 57, not
  // 182; the greys are the bluish greys, 71/72.
  check("viewer: LDraw colour White is 15", sandbox.LDRAW_COLOUR['White'], 15);
  check("viewer: LDraw colour Trans-Blue is 33", sandbox.LDRAW_COLOUR['Trans-Blue'], 33);
  check("viewer: LDraw colour Trans-Orange is 57, not Rebrickable 182", sandbox.LDRAW_COLOUR['Trans-Orange'], 57);
  check("viewer: LDraw colour Dark Grey is 72, the bluish grey", sandbox.LDRAW_COLOUR['Dark Grey'], 72);
  check("viewer: LDraw colour Trans-Brown is 40 (Trans_Black)", sandbox.LDRAW_COLOUR['Trans-Brown'], 40);
  sandbox.openViewer(item2456);
  check("viewer: opens with the part label", sandbox.$('lightboxLabel').textContent, 'Part 2456 — White');
  check("viewer: lightbox unhidden", sandbox.$('lightbox').hidden, false);
  check("viewer: model asked for part 2456", sandbox.viewerPart, '2456');
  check("viewer: model asked for in White (LDraw 15)", sandbox.viewerColourCode, 15);
  sandbox.closeViewer();
  check("viewer: close hides the lightbox", sandbox.$('lightbox').hidden, true);
  check("viewer: close clears the state", sandbox.viewerItem, null);
  check("viewer: close clears the part", sandbox.viewerPart, null);
  // An unknown colour falls back to dark grey (72) — shape, not shade.
  const itemUnknown = { setKey: '8961-1', cat: 'Bricks', colour: 'Magenta', dim: 'Brick 2 x 4', qty: 1, id: 'x-3001-Magenta', img: 'https://example.com/3001.jpg' };
  sandbox.openViewer(itemUnknown);
  check("viewer: unknown colour falls back to dark grey", sandbox.viewerColourCode, 72);
  sandbox.closeViewer();
  // The photo opens the viewer; the counter buttons do not.
  const card2456 = sandbox.buildCard(item2456);
  const photo2456 = card2456.children.find((n) => n.className === 'photo');
  check("viewer: card photo is clickable", photo2456.listeners.click && photo2456.listeners.click.length, 1);
  photo2456.listeners.click[0]();
  check("viewer: tapping the photo opens it", sandbox.$('lightbox').hidden, false);
  check("viewer: tapping the photo asked for part 2456", sandbox.viewerPart, '2456');
  sandbox.closeViewer();
  const counter2456 = card2456.children.find((n) => n.className === 'counter');
  const minus2456 = counter2456.children[0];
  check("viewer: counter minus still changes the count, not the viewer", sandbox.remOf(item2456), item2456.qty);
  minus2456.listeners.click[0]();
  check("viewer: minus tap did not open the viewer", sandbox.$('lightbox').hidden, true);
  check("viewer: minus tap found one piece", sandbox.remOf(item2456), item2456.qty - 1);
  sandbox.changeRemaining(item2456, +1); // restore

  // v3.16 — background 3D preload: after a set is added, every part's
  // geometry downloads behind the scenes so tapping a photo is instant
  // later. The parts list shows at once; the 3D catches up. A tap
  // while it's still downloading says so in the popup — that line lives
  // in model3d.js (no WebGL in this harness, verified by reading it).
  const preloadCalls = [];
  sandbox.BulkFinder3D = {
    queuePreload(items, cb) { preloadCalls.push({ items, cb }); return items.length; },
    preloadState() { return { running: true, done: 3, total: 10 }; },
  };
  sandbox.INVENTORIES['test-1'] = { items: [
    { id: '300126-3001-Black', qty: 2, colour: 'Black', cat: 'Bricks' },
    { id: '300127-3001-Black', qty: 1, colour: 'Black', cat: 'Bricks' }, // same part+colour: queued once
    { id: '300128-3001-Red', qty: 1, colour: 'Red', cat: 'Bricks' }, // same part, other colour: queued
    { id: '300129-3004-Magenta', qty: 1, colour: 'Magenta', cat: 'Bricks' }, // unknown colour -> 72
  ] };
  sandbox.start3DPreload('test-1');
  check("preload: queues one job per set", preloadCalls.length, 1);
  check("preload: dedupes the same part+colour", preloadCalls[0].items.length, 3);
  check("preload: same part in another colour is a second job", preloadCalls[0].items.filter((i) => i.part === '3001').length, 2);
  check("preload: unknown colour falls back to dark grey", preloadCalls[0].items.find((i) => i.part === '3004').colour, 72);
  // Progress marks the part ready and updates the sidebar line.
  preloadCalls[0].cb(3, 10, true, '3001:0', 'test-1');
  check("preload: progress marks the part ready", sandbox.ready3DKeys('test-1'), ['3001:0']);
  check("preload: sidebar shows the download count", sandbox.$('preloadStatus').textContent, '3D models downloading: 3/10');
  check("preload: sidebar line is visible while downloading", sandbox.$('preloadStatus').hidden, false);
  // A part already marked ready is skipped on the next run.
  preloadCalls.length = 0;
  sandbox.start3DPreload('test-1');
  check("preload: ready parts are not queued again", preloadCalls[0].items.length, 2);
  check("preload: ready part is not in the queue", preloadCalls[0].items.some((i) => i.part === '3001' && i.colour === 0), false);
  // When the 3D module is not loaded yet, the set waits instead of failing.
  delete sandbox.BulkFinder3D;
  preloadCalls.length = 0;
  sandbox.start3DPreload('test-1');
  check("preload: waits for the 3D module instead of failing", preloadCalls.length, 0);
  // Done state: the line says ready, and hides when there is nothing to show.
  sandbox.BulkFinder3D = { queuePreload(items, cb) { preloadCalls.push({ items, cb }); return items.length; }, preloadState() { return { running: false, done: 10, total: 10 }; } };
  sandbox.updatePreloadStatus();
  check("preload: sidebar says ready when done", sandbox.$('preloadStatus').textContent, '3D models ready: 10/10');
  sandbox.BulkFinder3D = { queuePreload(items, cb) { return 0; }, preloadState() { return { running: false, done: 0, total: 0 }; } };
  sandbox.updatePreloadStatus();
  check("preload: sidebar line hides with nothing to show", sandbox.$('preloadStatus').hidden, true);

  // v3.18 — tiers for imported sets: the import function stores
  // tier 2 on every lot, so 8960-1/8962-1 had no Tier 1 or Tier 3.
  // deriveTier re-tiers those sets at load; 8961-1's hand tiers stay.
  check("tiers: crystal 30385 is tier 2 (his audit call)", sandbox.deriveTier({ id: "x-30385-Trans-Blue", cat: "Minifig / Accessories", colour: "Trans-Blue" }), 2);
  check("tiers: rock monster 64786 is tier 3", sandbox.deriveTier({ id: "x-64786-Trans-Blue", cat: "Minifig / Accessories", colour: "Trans-Blue" }), 3);
  check("tiers: minifig head 64881 is tier 3", sandbox.deriveTier({ id: "x-64881-Yellow", cat: "Minifig / Accessories", colour: "Yellow" }), 3);
  check("tiers: drill-arm joint 48169 is tier 3", sandbox.deriveTier({ id: "x-48169-Dark_Stone_Grey", cat: "Technic Bricks", colour: "Dark Grey" }), 3);
  check("tiers: sticker sheet is tier 3", sandbox.deriveTier({ id: "x-84682-White", cat: "Stickers", colour: "" }), 3);
  check("tiers: plain brick in a bulk colour is tier 1", sandbox.deriveTier({ id: "x-3001-Black", cat: "Bricks", colour: "Black" }), 1);
  check("tiers: plate in a bulk colour is tier 1", sandbox.deriveTier({ id: "x-3020-White", cat: "Plates", colour: "White" }), 1);
  check("tiers: odd Technic part stays tier 2", sandbox.deriveTier({ id: "x-32018-Black", cat: "Technic Bricks", colour: "Black" }), 3);
  check("tiers: 8961-1 has real tiers, untouched", sandbox.inventoryHasRealTiers(sandbox.getInventory("8961-1")), true);
  const allTier2 = { set: "test-2", lots: 2, pieces: 3, items: [
    { id: "a-3001-Black", qty: 2, tier: 2, cat: "Bricks", colour: "Black" },
    { id: "b-64786-Trans-Blue", qty: 1, tier: 2, cat: "Minifig / Accessories", colour: "Trans-Blue" },
  ] };
  check("tiers: all-tier-2 set counts as un-tiered", sandbox.inventoryHasRealTiers(allTier2), false);
  sandbox.INVENTORIES["test-2"] = allTier2;
  sandbox.sets.push({ key: "test-2", set_num: "test-2", name: "Test 2", total_parts: 3, total_lots: 2 });
  sandbox.setSelected(["test-2"]);
  check("tiers: imported brick re-tiered to 1", sandbox.items.find((it) => it.id === "a-3001-Black").tier, 1);
  check("tiers: imported rock monster re-tiered to 3", sandbox.items.find((it) => it.id === "b-64786-Trans-Blue").tier, 3);
  sandbox.setSelected(["8961-1"]);
  check("tiers: 8961-1 hand tier kept (3001 stays 1)", sandbox.items.find((it) => it.id === "300126-3001-Black").tier, 1);
  check("tiers: 8961-1 hand tier kept (41669 stays 3)", sandbox.items.find((it) => it.id === "4281515-41669-Bright_Orange").tier, 3);

  // v3.18 — phone back button: opening the viewer pushes a history
  // entry; closing pops it; a popstate with the viewer open closes it.
  // The viewer calls BulkFinder3D.show, so stub it here (the v3.16
  // stubs above only carry queuePreload/preloadState).
  sandbox.BulkFinder3D = { show() {}, hide() {}, queuePreload(items, cb) { return 0; }, preloadState() { return { running: false, done: 0, total: 0 }; } };
  const histCalls = [];
  sandbox.window.history = { pushState(s) { histCalls.push(["push", s]); }, back() { histCalls.push(["back"]); }, replaceState(state, title, url) { replacedUrl = url; } };
  sandbox.openViewer(item2456);
  check("back: opening the viewer pushes a history entry", histCalls.some((c) => c[0] === "push" && c[1] && c[1].bf3d === true), true);
  sandbox.closeViewer();
  check("back: closing the viewer pops the entry", histCalls.some((c) => c[0] === "back"), true);
  sandbox.openViewer(item2456);
  const backsBeforePop = histCalls.filter((c) => c[0] === "back").length;
  sandbox._winListeners.popstate();
  check("back: popstate closes the viewer", sandbox.$("lightbox").hidden, true);
  check("back: popstate clears the viewer state", sandbox.viewerItem, null);
  check("back: popstate does not go back a second time", histCalls.filter((c) => c[0] === "back").length, backsBeforePop);

  // v3.18 — backdrop: a tap on the dark area closes the viewer, but
  // a tap on the model box (orbit) or on a button does not.
  const lb = sandbox.$("lightbox");
  const backdropHandler = lb.listeners.click[0];
  const modelBox = sandbox.$("model3d");
  const canvas = new StubEl("canvas");
  modelBox.children.push(canvas);
  // StubEl has no DOM contains(); the app guards on it, so stub it here.
  modelBox.contains = function (el) { return el === canvas; };
  sandbox.openViewer(item2456);
  backdropHandler({ target: lb });
  check("backdrop: tap on the dark frame closes", sandbox.$("lightbox").hidden, true);
  sandbox.openViewer(item2456);
  backdropHandler({ target: canvas });
  check("backdrop: tap on the model box stays open", sandbox.$("lightbox").hidden, false);
  const presetBtn = new StubEl("button");
  backdropHandler({ target: presetBtn });
  check("backdrop: tap on a preset button stays open", sandbox.$("lightbox").hidden, false);
  sandbox.closeViewer();
  // The X is red now, so it reads as the way out.
  const css2 = fs.readFileSync("styles.css", "utf8");
  check("backdrop: close button is red", css2.includes(".lightbox-close") && css2.includes("background: #d32f2f;"), true);

  // v3.18 — minifig fallback (model3d.js): the Power Miners heads /
  // torso / legs have no .dat of their own, so they render as the
  // standard minifig component in the lot's colour.
  const m3d = fs.readFileSync("model3d.js", "utf8");
  check("minifig: head 64881 falls back to standard head 3626", m3d.includes("'64881': '3626'"), true);
  check("minifig: torso 76382 falls back to standard torso 973", m3d.includes("'76382': '973'"), true);
  check("minifig: legs 85107 fall back to standard legs 970", m3d.includes("'85107': '970'"), true);
  check("minifig: rock monster 64786 has no fallback (no equivalent)", m3d.includes("'64786'"), false);
  check("minifig: jsDelivr-blocked files fall back to GitHub raw", m3d.includes("LIB_RAW"), true);

  // v3.19 — minikit jingle: the tap that finishes a lot (1 left -> 0)
  // plays the jingle instead of the stud tick; undo plays nothing;
  // the same header toggle silences it. Completion is per lot in its
  // own set — the same part need not be finished in the other sets.
  check("minikit: clip is the bundled base64 audio", sandbox.minikitSound && sandbox.minikitSound.src.indexOf("data:audio/mpeg;base64,") === 0, true);
  const lotA = sandbox.items.filter((it) => sandbox.remOf(it) > 1).sort((a, b) => sandbox.remOf(a) - sandbox.remOf(b))[0] || sandbox.items.find((it) => sandbox.remOf(it) === 1);
  check("minikit: a finishable lot exists", !!lotA, true);
  while (sandbox.remOf(lotA) > 1) sandbox.changeRemaining(lotA, -1); // stud ticks on the way down
  const studBefore = sandbox.studSound.playCount;
  const miniBefore = sandbox.minikitSound.playCount;
  sandbox.changeRemaining(lotA, -1); // the finishing tap: 1 -> 0
  check("minikit: finishing a lot plays the jingle", sandbox.minikitSound.playCount, miniBefore + 1);
  check("minikit: finishing tap skips the stud tick", sandbox.studSound.playCount, studBefore);
  check("minikit: lot is done", sandbox.remOf(lotA), 0);
  sandbox.changeRemaining(lotA, +1); // undo: back to 1 left
  check("minikit: undo plays no jingle", sandbox.minikitSound.playCount, miniBefore + 1);
  check("minikit: undo plays no stud either", sandbox.studSound.playCount, studBefore);
  sandbox.changeRemaining(lotA, -1); // finish it again
  check("minikit: finishing again plays the jingle again", sandbox.minikitSound.playCount, miniBefore + 2);
  // Muted: the same toggle silences the jingle too.
  $("soundToggleBtn").listeners.click[0]();
  const lotB = sandbox.items.filter((it) => it !== lotA && sandbox.remOf(it) > 1).sort((a, b) => sandbox.remOf(a) - sandbox.remOf(b))[0] || sandbox.items.find((it) => it !== lotA && sandbox.remOf(it) === 1);
  check("minikit: a second finishable lot exists", !!lotB, true);
  while (sandbox.remOf(lotB) > 1) sandbox.changeRemaining(lotB, -1);
  const miniMutedBefore = sandbox.minikitSound.playCount;
  sandbox.changeRemaining(lotB, -1);
  check("minikit: muted finishing tap plays nothing", sandbox.minikitSound.playCount, miniMutedBefore);
  $("soundToggleBtn").listeners.click[0]();
  check("minikit: toggle back on", sandbox.soundOn, true);

  // v3.20 — the set picker shows titles only; the number stays in
  // the My sets list below (see the v3.6 rows checks).
  sandbox.renderSetPicker();
  const pickerLabels = [...$("setPickerList").children].map((row) => row.children[1].textContent);
  check("picker: rows show their set's title", pickerLabels, sandbox.sets.map((s) => s.set_name || s.set_num));
  check("picker: no row shows a set number", pickerLabels.some((t) => /^\d{4,5}-\d$/.test(t)), false);
  sandbox.setSelected(["8961-1"]);
  check("picker: button shows the title for one set", $("setPickerBtn").textContent, "Sets: Crystal Sweeper");
  sandbox.setSelected(["8961-1", "10294-1", "10305-1", "test-2"]);
  check("picker: button still says All for all sets", $("setPickerBtn").textContent, "Sets: All");

  // v3.21 — no 3D model, no problem: the popup shows the part's photo
  // big instead of the "no model" text. The photo rides along with the
  // show() call (primary photo + BrickLink fallback), and with the
  // pending request when the 3D module hasn't loaded yet. The photo
  // itself lives in model3d.js (no WebGL in the harness), so the CSS
  // rule it relies on is asserted here and the module is syntax-
  // checked separately with node --check.
  let lastShow = null;
  sandbox.BulkFinder3D = { show(p, c, img, fb) { lastShow = [p, c, img, fb]; }, hide() {}, queuePreload(items, cb) { return 0; }, preloadState() { return { running: false, done: 0, total: 0 }; } };
  sandbox.openViewer(item2456);
  check("photo: show gets the part photo", lastShow, ["2456", 15, item2456.img, sandbox.fallbackImg(item2456)]);
  sandbox.closeViewer();
  sandbox.BulkFinder3D = undefined;
  sandbox.openViewer(item2456);
  check("photo: pending request carries the photo", [sandbox.__bfPending3D.img, sandbox.__bfPending3D.fallback], [item2456.img, sandbox.fallbackImg(item2456)]);
  sandbox.closeViewer();
  const css3 = fs.readFileSync("styles.css", "utf8");
  check("photo: big-photo CSS keeps the picture inside the box", css3.includes(".model3d-photo") && css3.includes("object-fit: contain"), true);

  // v3.22 — Instructions button on every My sets row; tapping it opens
  // the set's booklets in the viewer (pdf.js, one long scroll, resume).
  // The rendering itself lives in instructions.js (no pdf.js in the
  // harness) — here the button, the open call, the pending path, and
  // the URL/key helpers are asserted; the module is syntax-checked
  // separately with node --check, and the Edge Function's parser is
  // tested against real Brickset HTML with Deno.
  sandbox.renderSets();
  const row8961b = $("setList").children.filter((li) => li.children[1].children[1].textContent === "8961-1")[0];
  const instrBtn = row8961b.children[1].children.find((c) => c.className === "instr-btn");
  check("instr: button on the row", !!instrBtn, true);
  check("instr: button says Instructions", instrBtn.textContent, "Instructions");
  let lastInstr = null;
  sandbox.BulkFinderInstructions = { open(s, n) { lastInstr = [s, n]; }, close() {} };
  instrBtn.listeners.click[0]({ stopPropagation() {} });
  check("instr: tap opens the viewer for that set", lastInstr, ["8961-1", "Crystal Sweeper"]);
  sandbox.BulkFinderInstructions = undefined;
  sandbox.__bfPendingInstr = null;
  instrBtn.listeners.click[0]({ stopPropagation() {} });
  check("instr: pending request carries the set", [sandbox.__bfPendingInstr.set, sandbox.__bfPendingInstr.name], ["8961-1", "Crystal Sweeper"]);
  check("instr: resume key is per set", sandbox.instrPosKey("8961-1"), "bf:instrPos:8961-1");
  check("instr: PDF goes through the proxy", sandbox.instrPdfUrl("https://www.lego.com/cdn/product-assets/product.bi.core.pdf/4549565.pdf"), "https://xwekulsnfarjibawqqih.supabase.co/functions/v1/get-instructions?pdf=" + encodeURIComponent("https://www.lego.com/cdn/product-assets/product.bi.core.pdf/4549565.pdf"));
  check("instr: LEGO page fallback URL", sandbox.legoInstructionsUrl("8961-1"), "https://www.lego.com/en-us/service/building-instructions/8961-1");

  // v3.23 — printed minifig torsos: the print belongs to the element,
  // not the design number, so the element rides along to the 3D module
  // (show + pending + background preload). Rex (4542545) wears
  // 973pau, Brains (4542547) wears 973pas — both mirror 200, verified
  // by curl. The heads, legs and rock-monster body have no printed
  // LDraw file anywhere (full-library greps), so they keep the plain
  // component / photo. The printed-file lookup itself lives in
  // model3d.js (no WebGL in the harness) — here the element
  // passthrough is asserted; the module is syntax-checked separately.
  const torsoRex = sandbox.INVENTORY_8961.items.find((it) => it.id.indexOf('4542545-') === 0);
  const torsoBrains = sandbox.INVENTORY_8961.items.find((it) => it.id.indexOf('4542547-') === 0);
  check("prints: Rex torso is design 76382", torsoRex.id.split('-')[1], '76382');
  check("prints: Brains torso is design 76382 too", torsoBrains.id.split('-')[1], '76382');
  let lastShow3 = null;
  sandbox.BulkFinder3D = { show(p, c, img, fb, el) { lastShow3 = [p, c, img, fb, el]; }, hide() {}, queuePreload(items, cb) { return 0; }, preloadState() { return { running: false, done: 0, total: 0 }; } };
  sandbox.show3DModel(torsoRex);
  check("prints: show gets the element for the print lookup", lastShow3[4], '4542545');
  check("prints: show still asks for design 76382", lastShow3[0], '76382');
  check("prints: show asks for the lot colour", lastShow3[1], sandbox.LDRAW_COLOUR[torsoRex.colour]);
  sandbox.BulkFinder3D = undefined;
  sandbox.__bfPending3D = null;
  sandbox.show3DModel(torsoBrains);
  check("prints: pending request carries the element", sandbox.__bfPending3D.element, '4542547');
  sandbox.closeViewer();
  // Background preload fetches the printed file, not the plain one.
  const preloadCalls3 = [];
  sandbox.BulkFinder3D = { queuePreload(items, cb) { preloadCalls3.push(items); return items.length; }, preloadState() { return { running: false, done: 0, total: 0 }; } };
  sandbox.INVENTORIES['test-3'] = { items: [
    { id: '4542545-76382-Medium_Stone_Grey', qty: 1, colour: 'Light Grey', cat: 'Minifig / Accessories' },
    { id: '4542547-76382-White', qty: 1, colour: 'White', cat: 'Minifig / Accessories' },
  ] };
  sandbox.start3DPreload('test-3');
  check("prints: preload carries the element", preloadCalls3[0].map((i) => i.element), ['4542545', '4542547']);

  // v3.28 — confirm modal, assign finds, small-connector rule,
  // build-needs panel, delete-a-set, email-link fixes. (The Supabase
  // dashboard was audited live 2026-11-20: Site URL and redirect URLs
  // were already correct, so the email fix is app-side.)

  // Shared Yes/Cancel confirm modal: show, Cancel, confirm, Escape.
  let confirmFired = false;
  sandbox.showConfirm({ title: "Sure?", message: "Just checking.", confirmLabel: "Do it", onConfirm: function () { confirmFired = true; } });
  check("confirm: modal opens", sandbox.confirmModal.hidden, false);
  check("confirm: title + message + label", [sandbox.confirmTitleEl.textContent, sandbox.confirmMsgEl.textContent, sandbox.confirmYesEl.textContent], ["Sure?", "Just checking.", "Do it"]);
  sandbox.confirmModal.children[0].children[2].children[0].listeners.click[0](); // Cancel
  check("confirm: Cancel hides it", sandbox.confirmModal.hidden, true);
  check("confirm: Cancel does not fire", confirmFired, false);
  sandbox.showConfirm({ title: "Sure?", message: "Just checking.", confirmLabel: "Do it", onConfirm: function () { confirmFired = true; } });
  sandbox.confirmYesEl.listeners.click[0]();
  check("confirm: Yes hides it", sandbox.confirmModal.hidden, true);
  check("confirm: Yes fires", confirmFired, true);
  sandbox.showConfirm({ title: "Sure?", message: "Just checking.", onConfirm: function () {} });
  sandbox.document.listeners.keydown[0]({ key: "Escape" });
  check("confirm: Escape hides it", sandbox.confirmModal.hidden, true);

  // Assign finds in the All view: one set needing the piece -> direct;
  // two sets -> chooser with a hunting preference that sticks, then
  // clears once that set's need is complete.
  const fullCountsFor = (setNum) => { const m = {}; sandbox.getInventory(setNum).items.forEach((it) => { m[it.id] = it.qty; }); return m; };
  const counts8961a = fullCountsFor("8961-1"); counts8961a["300126-3001-Black"] = 3;
  sandbox.LS.set("bf:counts:8961-1", counts8961a);
  sandbox.LS.set("bf:counts:10305-1", fullCountsFor("10305-1"));
  sandbox.LS.set("bf:huntPrefs", {});
  // 10305-1 was pushed to the in-memory list by the fetch test without
  // saving, so a later sets = localSets() (logout / second boot) dropped
  // it; its inventory stayed registered. Re-add it, persisted, so the
  // assign test has a real second set with a unique part.
  if (!sandbox.findSet("10305-1")) {
    sandbox.sets.push({ key: "10305-1", set_num: "10305-1", set_name: "Test Set 2", total_parts: 5, total_lots: 2, user_set_id: "us-10305" });
    sandbox.saveLocalSets(sandbox.sets);
  }
  sandbox.setSelected(["8961-1", "10305-1"]);
  const shared10305 = sandbox.items.find((it) => it.id === "300126-3001-Black" && it.setKey === "10305-1");
  const shared8961 = sandbox.items.find((it) => it.id === "300126-3001-Black" && it.setKey === "8961-1");
  const only10305 = sandbox.items.find((it) => it.id === "614126-6141-White");
  check("assign: shared lot needs 3 in 8961-1", sandbox.remOf(shared8961), 3);
  check("assign: shared lot needs 3 in 10305-1", sandbox.remOf(shared10305), 3);
  sandbox.onFoundTap(only10305); // single-set-only part: no chooser, straight down
  check("assign: single-set part credits directly", sandbox.remOf(only10305), 1);
  check("assign: no chooser for a single-set part", !sandbox.huntChooser || sandbox.huntChooser.hidden, true);
  sandbox.onFoundTap(shared10305); // shared part: chooser with both candidates
  check("assign: chooser opens for a shared part", sandbox.huntChooser.hidden, false);
  const choiceBtns = [...sandbox.huntChoiceList.children];
  check("assign: chooser lists both sets", choiceBtns.map((b) => b.textContent), ["Crystal Sweeper", "Test Set 2"]);
  check("assign: chooser shows each need", choiceBtns.map((b) => b.children[0].textContent), ["needs 3", "needs 3"]);
  choiceBtns[0].listeners.click[0](); // pick Crystal Sweeper
  check("assign: chooser closes after a pick", sandbox.huntChooser.hidden, true);
  check("assign: preference saved", sandbox.LS.get("bf:huntPrefs", {}), { "3001|Black": "8961-1" });
  check("assign: find credited to the picked set", sandbox.remOf(shared8961), 2);
  check("assign: other set untouched", sandbox.remOf(shared10305), 3);
  sandbox.onFoundTap(shared10305); // next tap auto-applies the preference
  check("assign: preference auto-applies (no chooser)", sandbox.huntChooser.hidden, true);
  check("assign: second find goes to the same set", sandbox.remOf(shared8961), 1);
  sandbox.onFoundTap(shared10305); // completing that set's need clears it
  check("assign: third find finishes the set's need", sandbox.remOf(shared8961), 0);
  check("assign: preference cleared when the need is complete", sandbox.LS.get("bf:huntPrefs", {}), {});
  sandbox.onFoundTap(shared10305); // one set left needing it: straight down
  check("assign: last set needing it credits directly", sandbox.remOf(shared10305), 2);
  check("assign: still no chooser", sandbox.huntChooser.hidden, true);
  sandbox.setSelected(["10305-1"]); // single-set view: straight down, no chooser
  sandbox.onFoundTap(shared10305);
  check("assign: single-set view credits directly", sandbox.remOf(shared10305), 1);
  check("assign: single-set view shows no chooser", sandbox.huntChooser.hidden, true);

  // Small-connector rule (v3.28): Technic pins, bushes and connectors
  // — plus the tooth part and the mini antenna — are Small pieces, at
  // import time and at display time, so existing sets move too.
  const lotByPart = (p) => sandbox.INVENTORY_8961.items.find((it) => it.id.split("-")[1] === p);
  ["6590", "73587", "41669", "62462", "4274"].forEach((p) => {
    check("small: part " + p + " displays as Small pieces", sandbox.itemCat(lotByPart(p)), "Small pieces");
  });
  check("small: 73587 stored cat moved", lotByPart("73587").cat, "Small pieces");
  check("small: 41669 stored cat moved", lotByPart("41669").cat, "Small pieces");
  const pins62462 = sandbox.INVENTORY_8961.items.filter((it) => it.id.split("-")[1] === "62462");
  check("small: both 62462 lots stored as Small pieces", pins62462.map((it) => it.cat), ["Small pieces", "Small pieces"]);
  check("small: both 62462 lots are black and orange", pins62462.map((it) => it.id.split("-")[2]).sort(), ["Black", "Bright_Orange"]);
  check("small: Small pieces keeps its section", sandbox.displayCat({ setKey: "8961-1", cat: "Small pieces" }), "Small pieces");
  check("small: no Technic Pins / Bushes or Connectors lots left", sandbox.INVENTORY_8961.items.some((it) => it.cat === "Technic Pins / Bushes" || it.cat === "Technic Connectors"), false);

  // Build-needs panel inside the instructions viewer: grouped by type
  // then colour, +/- steps on the tracker's own remaining counts,
  // Mark all complete behind a confirm, and the close hook re-renders
  // the main view only when something changed.
  const counts8961b = fullCountsFor("8961-1"); counts8961b["300126-3001-Black"] = 0; // one lot already found, so + can raise it
  sandbox.LS.set("bf:counts:8961-1", counts8961b);
  sandbox.setSelected(["8961-1"]);
  sandbox.openBuildPanel("8961-1", "Crystal Sweeper");
  check("build: panel opens", sandbox.buildPanel.hidden, false);
  check("build: viewer gets the dock class", $("instrViewer").classList.contains("build-open"), true);
  const panelText = (cls) => [...sandbox.buildPanel.children].filter((c) => c.className === cls).map((c) => c.textContent);
  check("build: title", panelText("build-panel-title"), ["Build list — Crystal Sweeper"]);
  check("build: total need", panelText("build-panel-need"), ["Need 414 pieces"]);
  check("build: type groups include Small pieces", panelText("build-type").includes("Small pieces"), true);
  check("build: colour groups include Black", panelText("build-colour").includes("Black"), true);
  const buildRows = [...sandbox.buildPanel.children].filter((c) => c.className.indexOf("build-row") === 0);
  check("build: one row per lot", buildRows.length, 138);
  const zeroRow = buildRows.find((r) => [...r.children].some((c) => c.className === "build-row-need" && c.textContent === "Need 0"));
  check("build: the found lot shows Need 0", !!zeroRow, true);
  const zeroSteps = [...zeroRow.children].filter((c) => c.className === "build-step-btn");
  check("build: minus disabled at 0", zeroSteps[0].disabled, true);
  zeroSteps[1].listeners.click[0](); // +
  check("build: + raises the need", sandbox.remOf({ setKey: "8961-1", id: "300126-3001-Black", qty: 16 }), 1);
  check("build: tap marks the panel dirty", sandbox.buildDirty, true);
  check("build: total updates", panelText("build-panel-need"), ["Need 415 pieces"]);
  const markBtn = () => [...sandbox.buildPanel.children].find((c) => c.className === "btn build-mark-all");
  markBtn().listeners.click[0]();
  check("build: mark-all asks first", [sandbox.confirmModal.hidden, sandbox.confirmTitleEl.textContent, sandbox.confirmYesEl.textContent], [false, "Mark everything complete?", "Mark all complete"]);
  sandbox.confirmModal.children[0].children[2].children[0].listeners.click[0](); // Cancel
  check("build: mark-all Cancel leaves counts", sandbox.remOf({ setKey: "8961-1", id: "300126-3001-Black", qty: 16 }), 1);
  markBtn().listeners.click[0]();
  sandbox.confirmYesEl.listeners.click[0]();
  check("build: mark-all zeroes every lot", Object.values(sandbox.LS.get("bf:counts:8961-1", {})).every((v) => v === 0), true);
  const bulkOps = sandbox.outbox().filter((o) => o.kind === "bulk" && o.user_set_id === "us-8961-1");
  check("build: mark-all queues one bulk sync", bulkOps.length, 1);
  check("build: bulk sync carries all lots", bulkOps[0].rows.length, 138);
  check("build: panel shows everything complete", panelText("build-panel-need"), ["Nothing needed — everything is complete."]);
  check("build: close hook sees the dirty panel", sandbox.buildDirty, true);
  sandbox.__bfOnInstrClose();
  check("build: close hook re-renders and clears dirty", sandbox.buildDirty, false);
  sandbox.__bfOnInstrClose();
  check("build: close hook is a no-op when clean", sandbox.buildDirty, false);

  // Delete a set: the X asks first; Delete wipes local + cloud, and
  // the selection falls back; a failed cloud wipe leaves a tombstone
  // that the next sync retries.
  sandbox.openSet("10294-1");
  sandbox.LS.set("bf:huntPrefs", { "3001|Black": "10294-1" });
  sandbox.LS.set("bf:instrPos:10294-1", 123);
  check("delete: cloud id known before delete", sandbox.LS.get("bf:cloudIds", {})["10294-1"], "us-10294-1");
  sandbox.renderSets();
  const row10294 = $("setList").children.filter((li) => li.children[1].children[1].textContent === "10294-1")[0];
  const delBtn10294 = row10294.children.find((c) => c.className === "set-del-btn");
  check("delete: X on the row", !!delBtn10294 && delBtn10294.textContent, "×");
  delBtn10294.listeners.click[0]({ stopPropagation() {} });
  check("delete: confirm asks first", [sandbox.confirmModal.hidden, sandbox.confirmTitleEl.textContent, sandbox.confirmYesEl.textContent], [false, "Delete this set?", "Delete"]);
  sandbox.confirmModal.children[0].children[2].children[0].listeners.click[0](); // Cancel
  check("delete: Cancel keeps the set", sandbox.sets.some((s) => s.key === "10294-1"), true);
  delBtn10294.listeners.click[0]({ stopPropagation() {} });
  sandbox.confirmYesEl.listeners.click[0]();
  await sleep(10);
  check("delete: set gone from the list", sandbox.sets.some((s) => s.key === "10294-1"), false);
  check("delete: counts wiped", sandbox.LS.get("bf:counts:10294-1", null), null);
  check("delete: instructions position wiped", sandbox.LS.get("bf:instrPos:10294-1", null), null);
  check("delete: hunting prefs for the set wiped", sandbox.LS.get("bf:huntPrefs", {}), {});
  check("delete: cloud id wiped", sandbox.LS.get("bf:cloudIds", {})["10294-1"], undefined);
  check("delete: set_parts delete ran", dbCalls.filter((c) => c.table === "set_parts" && c.op === "delete" && c.filters && c.filters.user_set_id === "us-10294-1").length, 1);
  check("delete: user_sets delete ran", dbCalls.filter((c) => c.table === "user_sets" && c.op === "delete" && c.filters && c.filters.id === "us-10294-1").length, 1);
  check("delete: selection falls back off the deleted set", sandbox.selectedKeys.includes("10294-1"), false);
  check("delete: active set falls back", sandbox.activeSetKey, "8961-1");
  mockSb._deleteError = { message: "boom" }; // failed cloud wipe: tombstone
  sandbox.renderSets();
  const row10305 = $("setList").children.filter((li) => li.children[1].children[1].textContent === "10305-1")[0];
  row10305.children.find((c) => c.className === "set-del-btn").listeners.click[0]({ stopPropagation() {} });
  sandbox.confirmYesEl.listeners.click[0]();
  await sleep(10);
  check("delete: failed wipe still removes the set locally", sandbox.sets.some((s) => s.key === "10305-1"), false);
  check("delete: tombstone saved", sandbox.LS.get("bf:deletedSets", {}), { "us-10305": { set_num: "10305-1" } });
  check("delete: failed wipe stops at set_parts", dbCalls.filter((c) => c.table === "user_sets" && c.op === "delete" && c.filters && c.filters.id === "us-10305").length, 0);
  mockSb._deleteError = null;
  await sandbox.retryDeletedSets();
  check("delete: retry clears the tombstone", sandbox.LS.get("bf:deletedSets", {}), {});
  check("delete: retry finishes the user_sets delete", dbCalls.filter((c) => c.table === "user_sets" && c.op === "delete" && c.filters && c.filters.id === "us-10305").length, 1);

  // Email links (v3.28): signup passes an explicit redirect back to
  // this app, and a confirm landing clears the token from the URL —
  // but never on a recovery landing, and never without a session.
  $("authEmail").value = "josephvand@gmail.com";
  $("authPassword").value = "secret123";
  await sandbox.doSignup();
  check("email: signup passes this app as the redirect", mockSb._lastSignUp.options.emailRedirectTo, "https://josephvand-del.github.io/bulk-finder/");
  replacedUrl = null;
  sandbox.location.hash = "#access_token=abc&type=signup";
  sandbox.clearAuthHashIfLanded();
  check("email: confirm landing clears the token", replacedUrl, "/bulk-finder/");
  replacedUrl = null;
  sandbox.location.hash = "#access_token=abc&type=recovery";
  sandbox.clearAuthHashIfLanded();
  check("email: recovery landing keeps the hash", replacedUrl, null);
  replacedUrl = null;
  const savedUser = sandbox.user;
  sandbox.user = null;
  sandbox.location.hash = "#access_token=abc&type=signup";
  sandbox.clearAuthHashIfLanded();
  check("email: no session, no clear", replacedUrl, null);
  sandbox.user = savedUser;
  sandbox.location.hash = "";

  // v3.29 — panel filters, combined All-view totals, floored sidebar %.

  // Sidebar % is floored: 100% only when truly complete. Start from
  // the marked-all-complete state (every count 0): one piece back on
  // the need list must drop the sidebar to 99%, nine pieces to 97%.
  const zeroCounts8961 = {}; sandbox.getInventory("8961-1").items.forEach((it) => { zeroCounts8961[it.id] = 0; });
  sandbox.LS.set("bf:counts:8961-1", zeroCounts8961);
  sandbox.setSelected(["8961-1"]);
  check("percent: marked all complete reads 100%", sandbox.setPercent(sandbox.findSet("8961-1")), "100%");
  sandbox.changeRemaining(sandbox.items[0], +1);
  check("percent: one piece needed drops to 99%", sandbox.setPercent(sandbox.findSet("8961-1")), "99%");
  for (let i = 1; i < 9; i++) sandbox.changeRemaining(sandbox.items[i], +1);
  check("percent: nine pieces needed reads 97%", sandbox.setPercent(sandbox.findSet("8961-1")), "97%");

  // Build panel filters: the All colors / All types dropdowns inside
  // the panel filter its rows, like the main view's.
  const fullCounts8961 = {}; sandbox.getInventory("8961-1").items.forEach((it) => { fullCounts8961[it.id] = it.qty; });
  sandbox.LS.set("bf:counts:8961-1", fullCounts8961);
  sandbox.setSelected(["8961-1"]);
  sandbox.openBuildPanel("8961-1", "Crystal Sweeper");
  const buildColourSel = () => sandbox.buildColourSelectEl;
  const buildTypeSel = () => sandbox.buildTypeSelectEl;
  const buildRowCount = () => [...sandbox.buildPanel.children].filter((c) => c.className.indexOf("build-row") === 0).length;
  check("buildfilter: colour options", buildColourSel().children.map((o) => o.value), ["all", "Black", "Any colour", "Light Grey", "White", "Clear", "Blue", "Lime Green", "Orange", "Trans-Red", "Dark Grey", "Red", "Yellow", "Trans-Orange", "Trans-Blue", "Trans-Green", "Trans-Brown"]);
  check("buildfilter: type options", buildTypeSel().children.map((o) => o.value), ["all", "Bricks", "Small pieces", "Plates", "Technic Axles", "Technic Bricks", "Miscellaneous", "Sloped Bricks", "Wheels and Tyres", "Technic Special", "Minifig / Accessories", "Technic Beams", "Bars, Ladders and Fences", "String, Bands and Reels", "Plates Special", "Technic Steering, Suspension and Engine", "Flags, Banners and Signs", "Windows and Doors", "Plates Round Curved and Dishes", "Bricks Curved", "Transportation - Land", "Bricks Round and Cones", "Stickers", "Hinges, Arms and Turntables"]);
  check("buildfilter: all rows at first", buildRowCount(), 138);
  buildColourSel().value = "Black";
  buildColourSel().listeners.change[0]();
  check("buildfilter: Black shows its 15 lots", buildRowCount(), 15);
  check("buildfilter: colour selection sticks", sandbox.buildColourFilter, "Black");
  buildTypeSel().value = "Small pieces";
  buildTypeSel().listeners.change[0]();
  check("buildfilter: Black + Small pieces has no lots", buildRowCount(), 0);
  check("buildfilter: no-match note shows", [...sandbox.buildPanel.children].some((c) => c.className === "build-no-match"), true);
  buildColourSel().value = "Any colour";
  buildColourSel().listeners.change[0]();
  check("buildfilter: Any colour + Small pieces shows 8 lots", buildRowCount(), 8);
  buildColourSel().value = "all";
  buildColourSel().listeners.change[0]();
  check("buildfilter: Small pieces alone shows 22 lots", buildRowCount(), 22);
  buildTypeSel().value = "all";
  buildTypeSel().listeners.change[0]();
  check("buildfilter: back to all rows", buildRowCount(), 138);
  buildColourSel().value = "Black";
  buildColourSel().listeners.change[0]();
  sandbox.openBuildPanel("10305-1", "Test Set 2");
  check("buildfilter: a different set resets the filters", [sandbox.buildColourFilter, sandbox.buildTypeFilter], ["all", "all"]);
  check("buildfilter: new set shows its own lots", buildRowCount(), 2);

  // v3.32 — merged cards: one card per like piece in a multi-set view,
  // with the grand total; the buttons still route per set. Show every
  // card for the DOM checks (earlier tests can leave a 'done' filter).
  const prevMStatus = sandbox.statusFilter, prevMType = sandbox.typeFilter, prevMColour = sandbox.colourFilter;
  sandbox.statusFilter = "all"; sandbox.typeFilter = "all"; sandbox.colourFilter = "all";
  const counts8961c = fullCountsFor("8961-1"); counts8961c["300126-3001-Black"] = 3;
  sandbox.LS.set("bf:counts:8961-1", counts8961c);
  sandbox.LS.set("bf:counts:10305-1", fullCountsFor("10305-1"));
  sandbox.LS.set("bf:huntPrefs", {});
  if (!sandbox.findSet("10305-1")) {
    sandbox.sets.push({ key: "10305-1", set_num: "10305-1", set_name: "Test Set 2", total_parts: 5, total_lots: 2, user_set_id: "us-10305" });
    sandbox.saveLocalSets(sandbox.sets);
  }
  sandbox.setSelected(["8961-1", "10305-1"]);
  const lot8961c = (id) => sandbox.items.find((it) => it.id === id && it.setKey === "8961-1");
  check("merge: raw lots are still per-set", sandbox.items.length, 140);
  // 140 lots, two merges: the shared 3001 brick, and the two 62462 lots
  // inside 8961-1 (same part, any colour) that merge with each other.
  check("merge: the view merges the shared piece", sandbox.viewList().length, 138);
  const merged3001 = sandbox.viewList().find((it) => sandbox.partKeyOf(it) === "3001|Black");
  check("merge: one card for the shared piece", sandbox.viewList().filter((it) => sandbox.partKeyOf(it) === "3001|Black").length, 1);
  check("merge: grand total on the merged card", sandbox.leftText(merged3001), "6 of 19 left");
  check("merge: merged card carries the summed quantity", merged3001.qty, 19);
  const merged6141 = sandbox.viewList().find((it) => sandbox.partKeyOf(it) === "6141|White");
  check("merge: single-set piece is unchanged", sandbox.leftText(merged6141), "2 of 2 left");
  // The merged card itself: one card, grand total, summed quantity.
  while (sandbox.viewPending.length) sandbox.renderNextChunk();
  const findCard = (key) => {
    let found = null;
    const walk = (el) => {
      if (el.dataset && el.dataset.key === key) { found = el; return; }
      for (const c of el.children) walk(c);
    };
    walk($("setView"));
    return found;
  };
  const mergedCard = findCard("merged|3001|Black");
  check("merge: merged card exists in the view", !!mergedCard, true);
  const countCardsWithKey = (key) => {
    let n = 0;
    const w = (el) => { if (el.dataset && el.dataset.key === key) n++; for (const c of el.children) w(c); };
    w($("setView"));
    return n;
  };
  check("merge: no second card for the shared piece", countCardsWithKey("merged|3001|Black"), 1);
  check("merge: merged card shows the grand total", mergedCard.children.find((d) => d.className === "counter").children.find((s) => s.className === "left").textContent, "6 of 19 left");
  check("merge: merged card shows the summed quantity", mergedCard.children.some((d) => d.className === "qty" && d.textContent === "×19"), true);
  // Minus on a shared piece pops the chooser (no preference yet); picking
  // a set credits it there, and the next minus goes straight there.
  sandbox.onFoundTap(merged3001);
  check("merge: minus with two sets pops the chooser", sandbox.huntChooser.hidden, false);
  check("merge: chooser lists one row per set", sandbox.huntChoiceList.children.length, 2);
  check("merge: chooser shows each set's need", sandbox.huntChoiceList.children.map((b) => b.children[0].textContent), ["needs 3", "needs 3"]);
  sandbox.huntChoiceList.children[0].listeners.click[0](); // pick Crystal Sweeper
  check("merge: chooser pick credits the first set", sandbox.remOf(lot8961c("300126-3001-Black")), 2);
  check("merge: grand total moves with the find", sandbox.leftText(merged3001), "5 of 19 left");
  check("merge: chooser is closed after the pick", sandbox.huntChooser.hidden, true);
  sandbox.onFoundTap(merged3001); // preference routes straight to 8961-1
  check("merge: preference routes the next find", sandbox.remOf(lot8961c("300126-3001-Black")), 1);
  check("merge: grand total moves again", sandbox.leftText(merged3001), "4 of 19 left");
  // Plus undoes the most recent find (8961-1), not the first set's lot.
  sandbox.changeRemaining(merged3001, +1);
  check("merge: plus undoes into the last set", sandbox.remOf(lot8961c("300126-3001-Black")), 2);
  check("merge: grand total moves back", sandbox.leftText(merged3001), "5 of 19 left");
  check("merge: plus does not clear the preference", sandbox.LS.get("bf:huntPrefs", {}), { "3001|Black": "8961-1" });
  // A set holding the same part in two lots gets one chooser row.
  const c62462 = sandbox.setsNeedingPart(sandbox.items.find((it) => sandbox.partKeyOf(it) === "62462|"));
  check("merge: two lots in one set give one chooser row", c62462.length, 1);
  check("merge: that row carries the set's whole need", c62462[0].rem, sandbox.items.filter((it) => sandbox.partKeyOf(it) === "62462|").reduce((a, it) => a + sandbox.remOf(it), 0));
  // Done everywhere reads done on the grand total.
  counts8961c["300126-3001-Black"] = 0;
  sandbox.LS.set("bf:counts:8961-1", counts8961c);
  const counts10305c = fullCountsFor("10305-1"); counts10305c["300126-3001-Black"] = 0;
  sandbox.LS.set("bf:counts:10305-1", counts10305c);
  sandbox.setSelected(["8961-1", "10305-1"]);
  check("merge: done everywhere reads done on the grand total", sandbox.leftText(sandbox.viewList().find((it) => sandbox.partKeyOf(it) === "3001|Black")), "✓ 0 of 19 — done");
  // Single-set view is unchanged: no merging inside one set.
  sandbox.setSelected(["8961-1"]);
  check("merge: single set shows every lot", sandbox.viewList().length, 138);
  check("merge: the two 62462 lots stay separate in one set", sandbox.viewList().filter((it) => sandbox.partKeyOf(it) === "62462|").length, 2);
  sandbox.statusFilter = prevMStatus; sandbox.typeFilter = prevMType; sandbox.colourFilter = prevMColour;

  // v3.30 batch: edge swipe, batched rendering, fast startup, first-set
  // start, long-press reorder.

  // --- Batched rendering: the All view builds cards in batches and
  // loads more as it scrolls, instead of every card + image up front.
  const prevChunk = sandbox.CARD_CHUNK;
  const prevStatus = sandbox.statusFilter, prevType = sandbox.typeFilter, prevColour = sandbox.colourFilter;
  sandbox.statusFilter = "all"; sandbox.typeFilter = "all"; sandbox.colourFilter = "all";
  sandbox.LS.set("bf:counts:8961-1", fullCountsFor("8961-1"));
  sandbox.LS.set("bf:counts:10305-1", fullCountsFor("10305-1"));
  sandbox.INVENTORIES["10305-1"] = fixtureInv10305;
  sandbox.CARD_CHUNK = 10;
  sandbox.setSelected(["8961-1", "10305-1"]);
  const countCards = (el) => {
    let n = (el.className || "").split(" ").includes("card") ? 1 : 0;
    for (const c of el.children) n += countCards(c);
    return n;
  };
  const setViewEl = () => sandbox.document.getElementById("setView");
  check("batch: first batch is 10 cards, not all 138", countCards(setViewEl()), 10);
  check("batch: 128 still pending", sandbox.viewPending.length, 128);
  check("batch: button names the remainder", sandbox.viewMoreBtn.textContent, "Show more (128 left)");
  sandbox.viewMoreBtn.listeners.click[0]();
  check("batch: Show more renders the next 10", countCards(setViewEl()), 20);
  check("batch: pending drops to 118", sandbox.viewPending.length, 118);
  while (sandbox.viewPending.length) sandbox.renderNextChunk();
  check("batch: draining renders all 138", countCards(setViewEl()), 138);
  check("batch: nothing pending after drain", sandbox.viewPending.length, 0);
  check("batch: marker hides when done", sandbox.viewSentinel.hidden, true);
  // Tier banners still appear once each, in order, after a full drain.
  const tierBanners = [];
  const walkH3 = (el) => {
    if (el.tagName === "H3") tierBanners.push(el.className);
    for (const c of el.children) walkH3(c);
  };
  walkH3(setViewEl());
  check("batch: tier banners in order", tierBanners, ["tier-banner tier-1", "tier-banner tier-2", "tier-banner tier-3"]);
  // Default chunk: 8961-1 alone renders 120 of 138, then the rest.
  sandbox.CARD_CHUNK = 120;
  sandbox.setSelected(["8961-1"]);
  check("batch: default chunk renders 120 of 138", countCards(setViewEl()), 120);
  check("batch: 18 pending at default chunk", sandbox.viewPending.length, 18);
  sandbox.renderNextChunk();
  check("batch: second chunk finishes the set", countCards(setViewEl()), 138);
  check("batch: marker hides at the end", sandbox.viewSentinel.hidden, true);
  sandbox.CARD_CHUNK = prevChunk;
  sandbox.statusFilter = prevStatus; sandbox.typeFilter = prevType; sandbox.colourFilter = prevColour;

  // --- Edge swipe: a right swipe from the left edge opens the drawer.
  sandbox.setDrawer(false);
  check("swipe: drawer starts closed", sandbox.document.body.classList.contains("drawer-open"), false);
  doc.listeners.touchstart[0]({ touches: [{ clientX: 8, clientY: 300 }] });
  doc.listeners.touchmove[0]({ touches: [{ clientX: 70, clientY: 305 }] });
  check("swipe: edge swipe opens the drawer", sandbox.document.body.classList.contains("drawer-open"), true);
  doc.listeners.touchend[0]();
  // Left swipe closes it.
  doc.listeners.touchstart[0]({ touches: [{ clientX: 250, clientY: 300 }] });
  doc.listeners.touchmove[0]({ touches: [{ clientX: 180, clientY: 300 }] });
  check("swipe: left swipe closes the drawer", sandbox.document.body.classList.contains("drawer-open"), false);
  doc.listeners.touchend[0]();
  // A mostly-vertical drag is a scroll, not a swipe.
  doc.listeners.touchstart[0]({ touches: [{ clientX: 8, clientY: 300 }] });
  doc.listeners.touchmove[0]({ touches: [{ clientX: 12, clientY: 420 }] });
  check("swipe: vertical drag does not open", sandbox.document.body.classList.contains("drawer-open"), false);
  doc.listeners.touchend[0]();
  // A swipe starting away from the edge does not open.
  doc.listeners.touchstart[0]({ touches: [{ clientX: 120, clientY: 300 }] });
  doc.listeners.touchmove[0]({ touches: [{ clientX: 220, clientY: 300 }] });
  check("swipe: mid-screen swipe does not open", sandbox.document.body.classList.contains("drawer-open"), false);
  doc.listeners.touchend[0]();

  // --- Fast startup: the first set opens, never All.
  const allKeys = () => sandbox.sets.map((s) => s.key);
  sandbox.LS.set("bf:view", { date: "2026-11-20", status: "needed", type: "all", colour: "all" });
  sandbox.LS.set("bf:selectedSets", allKeys());
  sandbox.LS.set("bf:activeSet", allKeys()[1]);
  sandbox.restoreStartupView();
  check("startup: new day opens the first set only", sandbox.selectedKeys, [allKeys()[0]]);
  sandbox.LS.set("bf:view", { date: sandbox.todayStr(), status: "needed", type: "all", colour: "all" });
  sandbox.LS.set("bf:selectedSets", allKeys());
  sandbox.restoreStartupView();
  check("startup: saved All is clamped to the first set", sandbox.selectedKeys, [allKeys()[0]]);
  sandbox.LS.set("bf:selectedSets", [allKeys()[1]]);
  sandbox.restoreStartupView();
  check("startup: a saved single set is kept", sandbox.selectedKeys, [allKeys()[1]]);

  // --- Grip drag (v3.33): press the ⋮⋮ grip, move it, release — the
  // ranking follows, and the tap right after is not an open. The
  // 400ms long-press is gone: the grip lifts the row at once.
  if (!sandbox.findSet("10294-1")) {
    sandbox.INVENTORIES["10294-1"] = fixtureInv10294;
    sandbox.sets.push({ key: "10294-1", set_num: "10294-1", set_name: "Test Ship", total_parts: 10, total_lots: 3, user_set_id: "us-10294" });
    sandbox.saveLocalSets(sandbox.sets);
  }
  sandbox.setSelected(["8961-1"]);
  sandbox.renderSets();
  const setListEl = () => sandbox.document.getElementById("setList");
  const startOrder = setListEl().children.map((li) => li.dataset.key);
  check("reorder: rows in the sidebar", startOrder.length, sandbox.sets.length);
  const dragRow = setListEl().children[1];
  const dragKey = dragRow.dataset.key;
  const grip = dragRow.children[0];
  check("reorder: first child is the drag grip", grip.className, "set-drag-handle");
  check("reorder: the row itself has no drag press", dragRow.listeners.pointerdown, undefined);
  grip.listeners.pointerdown[0]({ preventDefault() {} });
  check("reorder: grip press lifts the row at once", sandbox.dragActive, true);
  check("reorder: row shows the dragging style", dragRow.classList.contains("dragging"), true);
  // Drop it at the top: move the row in the DOM, release.
  const listChildren = setListEl().children;
  listChildren.splice(1, 1);
  listChildren.unshift(dragRow);
  sandbox.endSetDrag();
  const droppedOrder = [dragKey].concat(startOrder.filter((k) => k !== dragKey));
  check("reorder: sets follow the dropped order", sandbox.sets.map((s) => s.key), droppedOrder);
  check("reorder: order is saved locally", JSON.parse(sandbox.localStorage.getItem("bf:sets")).map((s) => s.key), droppedOrder);
  check("reorder: sidebar rebuilds in the new order", setListEl().children.map((li) => li.dataset.key), droppedOrder);
  check("reorder: release arms the click guard", sandbox.suppressNextRowClick, true);
  // The tap right after the drag is swallowed, not an open.
  const selBefore = sandbox.selectedKeys.slice();
  setListEl().children[0].listeners.click[0]();
  check("reorder: tap after drag does not open the set", sandbox.selectedKeys, selBefore);
  check("reorder: guard is consumed by that tap", sandbox.suppressNextRowClick, false);
  // A tap on the grip itself is swallowed, not an open.
  const selBeforeGrip = sandbox.selectedKeys.slice();
  setListEl().children[0].children[0].listeners.click[0]({ stopPropagation() {} });
  check("reorder: tapping the grip does not open the set", sandbox.selectedKeys, selBeforeGrip);

  // --- Cloud refresh keeps the user's order (v3.30 merge).
  sandbox.LS.set("bf:deletedSets", {});
  setPartsRows = [];
  cloudSetRows = [
    { set_num: "8961-1", set_name: "Crystal Sweeper", total_parts: 430, total_lots: 138, id: "us-8961-1" },
    { set_num: "10305-1", set_name: "Test Set 2", total_parts: 5, total_lots: 2, id: "us-10305" },
    { set_num: "10294-1", set_name: "Test Ship", total_parts: 10, total_lots: 3, id: "us-10294" },
    { set_num: "75419-1", set_name: "Death Star", total_parts: 9023, total_lots: 1135, id: "us-75419" },
  ];
  const orderBeforeCloud = sandbox.sets.map((s) => s.key);
  await sandbox.refreshSetsFromCloud();
  check("cloud: refresh keeps the local order", sandbox.sets.map((s) => s.key), orderBeforeCloud.concat(["75419-1"]));
  const cloudIdsByNum = {};
  cloudSetRows.forEach((r) => { cloudIdsByNum[r.set_num] = r.id; });
  check("cloud: cloud data still lands on each set", sandbox.sets.map((s) => s.user_set_id), orderBeforeCloud.concat(["75419-1"]).map((k) => cloudIdsByNum[k] || "us-" + k));
  check("cloud: cloud-only set appends at the end", sandbox.sets[sandbox.sets.length - 1].key, "75419-1");
  cloudSetRows = null;

  // --- v3.33: BrickLink colour ids come from the LEGO colour in the
  // lot id, not the display colour (Trans-Green covers two LEGO
  // colours with different BrickLink ids).
  check("bl-colour: fluorescent trans-green is 16, not 20", sandbox.brickLinkColourId({ id: "4114505-30153-Transparent_Fluorescent_Green", colour: "Trans-Green" }), 16);
  check("bl-colour: plain trans-green is 20", sandbox.brickLinkColourId({ id: "x-30153-Transparent_Green", colour: "Trans-Green" }), 20);
  check("bl-colour: dark stone grey is 85", sandbox.brickLinkColourId({ id: "4211064-3747-Dark_Stone_Grey", colour: "Dark Grey" }), 85);
  check("bl-colour: trans-brown is 13", sandbox.brickLinkColourId({ id: "4552036-86209-Transparent_Brown", colour: "Trans-Brown" }), 13);
  check("bl-colour: not-specified has no id", sandbox.brickLinkColourId({ id: "4508647-2634-{Not_Specified}", colour: "White" }), undefined);
  check("bl-colour: unknown segment has no id", sandbox.brickLinkColourId({ id: "x-3001-Unknown_Colour", colour: "Black" }), undefined);
  check("fallback: fluorescent lot uses BrickLink 16", sandbox.fallbackImg({ id: "4114505-30153-Transparent_Fluorescent_Green", colour: "Trans-Green", cat: "Minifig / Accessories", setKey: "8961-1" }), "https://img.bricklink.com/ItemImage/PN/16/30153.png");

  // --- v3.33: Order remaining — BrickLink XML wanted list.
  // Reset 8961-1 counts to full, then: 3001 Black 6 left of 16,
  // 6141 fully found, sticker + not-specified lots left at full.
  const inv8961b = sandbox.getInventory("8961-1");
  const full8961b = {};
  inv8961b.items.forEach((it) => { full8961b[it.id] = it.qty; });
  full8961b["300126-3001-Black"] = 6;
  full8961b["614126-6141-Black"] = 0;
  sandbox.saveCounts("8961-1", full8961b);
  sandbox.setSelected(["8961-1"]);
  let r = sandbox.remainingXml();
  check("order-xml: 135 lines (138 lots - 1 done - 2 skipped)", r.lines, 135);
  check("order-xml: 416 pieces left", r.pieces, 416);
  check("order-xml: wraps in INVENTORY", r.xml.startsWith("<INVENTORY>") && r.xml.endsWith("</INVENTORY>"), true);
  check("order-xml: condition is new", r.xml.includes("<CONDITION>N</CONDITION>"), true);
  check("order-xml: item type is P", r.xml.includes("<ITEMTYPE>P</ITEMTYPE>"), true);
  const xml3001 = r.xml.slice(r.xml.indexOf("<ITEMID>3001</ITEMID>"), r.xml.indexOf("</ITEM>", r.xml.indexOf("<ITEMID>3001</ITEMID>")));
  check("order-xml: 3001 black remaining 6", xml3001.includes("<MINQTY>6</MINQTY>") && xml3001.includes("<COLOR>11</COLOR>"), true);
  check("order-xml: done lot is out", r.xml.includes("<ITEMID>6141</ITEMID>"), false);
  check("order-xml: sticker is out", r.xml.includes("85418"), false);
  check("order-xml: not-specified colour is out", r.xml.includes("2634"), false);
  check("order-xml: skipped lists both lots", r.skipped.map((s) => s.part).sort(), ["2634", "85418"]);
  // Multi-set: the same part+colour sums across sets.
  if (!sandbox.findSet("10305-1")) {
    sandbox.INVENTORIES["10305-1"] = fixtureInv10305;
    sandbox.sets.push({ key: "10305-1", set_num: "10305-1", set_name: "Test Set 2", total_parts: 5, total_lots: 2, user_set_id: "us-10305" });
    sandbox.saveLocalSets(sandbox.sets);
  }
  sandbox.INVENTORIES["10305-1"] = fixtureInv10305;
  const full94 = {};
  fixtureInv10294.items.forEach((it) => { full94[it.id] = it.qty; });
  sandbox.saveCounts("10294-1", full94);
  sandbox.setSelected(["8961-1", "10294-1"]);
  r = sandbox.remainingXml();
  check("order-xml: multi-set still 135 lines", r.lines, 135);
  check("order-xml: multi-set 426 pieces", r.pieces, 426);
  const xml3001b = r.xml.slice(r.xml.indexOf("<ITEMID>3001</ITEMID>"), r.xml.indexOf("</ITEM>", r.xml.indexOf("<ITEMID>3001</ITEMID>")));
  check("order-xml: 3001 sums to 12 across both sets", xml3001b.includes("<MINQTY>12</MINQTY>"), true);

  // --- v3.34: Order remaining — BrickStore .bsx for BrickLink's
  // file picker (the .xml is "not supported" there — Joseph, live
  // 2026-11-25). Same remaining set as the XML, same lines.
  sandbox.setSelected(["8961-1"]);
  const x = sandbox.remainingXml();
  const b = sandbox.remainingBsx();
  check("order-bsx: 135 lines", b.lines, 135);
  check("order-bsx: 416 pieces left", b.pieces, 416);
  check("order-bsx: wraps in BrickStoreXML", b.bsx.startsWith('<?xml version="1.0" encoding="UTF-8"?>') && b.bsx.includes("<BrickStoreXML>") && b.bsx.endsWith("</BrickStoreXML>"), true);
  check("order-bsx: has an Inventory", b.bsx.includes("<Inventory>") && b.bsx.includes("</Inventory>"), true);
  check("order-bsx: no DOCTYPE", b.bsx.includes("DOCTYPE"), false);
  check("order-bsx: item type is P", b.bsx.includes("<ItemTypeID>P</ItemTypeID>"), true);
  check("order-bsx: condition is new", b.bsx.includes("<Condition>N</Condition>"), true);
  const bsx3001 = b.bsx.slice(b.bsx.indexOf("<ItemID>3001</ItemID>"), b.bsx.indexOf("</Item>", b.bsx.indexOf("<ItemID>3001</ItemID>")));
  check("order-bsx: 3001 black remaining 6", bsx3001.includes("<Qty>6</Qty>") && bsx3001.includes("<ColorID>11</ColorID>"), true);
  check("order-bsx: done lot is out", b.bsx.includes("<ItemID>6141</ItemID>"), false);
  check("order-bsx: sticker is out", b.bsx.includes("85418"), false);
  check("order-bsx: not-specified colour is out", b.bsx.includes("2634"), false);
  check("order-bsx: skipped matches the XML", b.skipped, x.skipped);
  // Parse both formats back and compare part+colour+qty line by line.
  function parseBlXml(xml) {
    const out = [];
    const re = /<ITEM>([\s\S]*?)<\/ITEM>/g;
    let m;
    while ((m = re.exec(xml))) {
      const body = m[1];
      out.push({ part: /<ITEMID>([^<]+)<\/ITEMID>/.exec(body)[1], colour: Number(/<COLOR>(\d+)<\/COLOR>/.exec(body)[1]), qty: Number(/<MINQTY>(\d+)<\/MINQTY>/.exec(body)[1]) });
    }
    return out;
  }
  function parseBsx(bsx) {
    const out = [];
    const re = /<Item>([\s\S]*?)<\/Item>/g;
    let m;
    while ((m = re.exec(bsx))) {
      const body = m[1];
      out.push({ part: /<ItemID>([^<]+)<\/ItemID>/.exec(body)[1], colour: Number(/<ColorID>(\d+)<\/ColorID>/.exec(body)[1]), qty: Number(/<Qty>(\d+)<\/Qty>/.exec(body)[1]) });
    }
    return out;
  }
  check("order-bsx: parses back to the same lines as the XML", parseBsx(b.bsx), parseBlXml(x.xml));

  // --- v3.35: Rebrickable → BrickLink part numbers. Joseph hit the
  // bad numbers live 2026-11-25: BrickLink rejected 18 lines from a
  // pasted XML export. The 8961-1 export above (full counts, 3001
  // Black at 6, 6141 done) must contain none of the 14 bad numbers
  // as exact item ids — 3747b and 60470b contain "3747"/"60470" as
  // substrings, so the check runs on parsed item ids, not raw text —
  // and must contain the mapped numbers instead.
  const bad14 = ["30367", "30385", "30499", "3747", "41669", "54196", "60169", "60470", "60779", "6143", "64786", "73587", "86209", "88072"];
  const xmlById = {};
  parseBlXml(x.xml).forEach((l) => { (xmlById[l.part] = xmlById[l.part] || []).push(l); });
  check("bl-map: none of the 14 bad Rebrickable numbers is exported", bad14.some((p) => xmlById[p]), false);
  check("bl-map: 30367 is BrickLink 553 in both colours", xmlById["553"], [{ part: "553", colour: 11, qty: 2 }, { part: "553", colour: 85, qty: 2 }]);
  check("bl-map: 30385 is BrickLink 52 in three colours", xmlById["52"], [{ part: "52", colour: 14, qty: 2 }, { part: "52", colour: 17, qty: 2 }, { part: "52", colour: 98, qty: 2 }]);
  check("bl-map: 30499 is BrickLink 3684a, not the bare family number", xmlById["3684a"], [{ part: "3684a", colour: 34, qty: 1 }]);
  check("bl-map: 3747 is BrickLink 3747b", xmlById["3747b"], [{ part: "3747b", colour: 85, qty: 8 }]);
  check("bl-map: 41669 is BrickLink x346", xmlById["x346"], [{ part: "x346", colour: 4, qty: 24 }]);
  check("bl-map: 54196 is BrickLink 2654", xmlById["2654"], [{ part: "2654", colour: 12, qty: 2 }]);
  check("bl-map: 60169 orders 21 links of BrickLink 3711 per chain", xmlById["3711"], [{ part: "3711", colour: 85, qty: 21 }]);
  check("bl-map: 60470 is BrickLink 60470b", xmlById["60470b"], [{ part: "60470b", colour: 11, qty: 4 }]);
  check("bl-map: 60779 is BrickLink 2335", xmlById["2335"], [{ part: "2335", colour: 1, qty: 2 }]);
  check("bl-map: 6143 is BrickLink 3941", xmlById["3941"], [{ part: "3941", colour: 86, qty: 1 }]);
  check("bl-map: 64786 Trans-Red is Meltrox pm003", xmlById["pm003"], [{ part: "pm003", colour: 0, qty: 1 }]);
  check("bl-map: 64786 Trans-Blue is Glaciator pm004", xmlById["pm004"], [{ part: "pm004", colour: 0, qty: 1 }]);
  check("bl-map: 73587 is BrickLink 4592c02 (black lever)", xmlById["4592c02"], [{ part: "4592c02", colour: 1, qty: 4 }]);
  check("bl-map: 86209 is BrickLink 60601", xmlById["60601"], [{ part: "60601", colour: 13, qty: 1 }]);
  check("bl-map: 88072 is BrickLink 4623a", xmlById["4623a"], [{ part: "4623a", colour: 11, qty: 2 }]);
  // The minifig lines carry ITEMTYPE M (ItemTypeID M in the .bsx).
  const pm003Start = x.xml.lastIndexOf("<ITEM>", x.xml.indexOf("<ITEMID>pm003</ITEMID>"));
  const pm003Block = x.xml.slice(pm003Start, x.xml.indexOf("</ITEM>", pm003Start));
  check("bl-map: pm003 line is a minifig, colour 0", pm003Block.includes("<ITEMTYPE>M</ITEMTYPE>") && pm003Block.includes("<COLOR>0</COLOR>") && pm003Block.includes("<MINQTY>1</MINQTY>"), true);
  const pm004Start = x.xml.lastIndexOf("<ITEM>", x.xml.indexOf("<ITEMID>pm004</ITEMID>"));
  const pm004Block = x.xml.slice(pm004Start, x.xml.indexOf("</ITEM>", pm004Start));
  check("bl-map: pm004 line is a minifig, colour 0", pm004Block.includes("<ITEMTYPE>M</ITEMTYPE>") && pm004Block.includes("<COLOR>0</COLOR>") && pm004Block.includes("<MINQTY>1</MINQTY>"), true);
  const bsxPm003 = b.bsx.slice(b.bsx.indexOf("<ItemID>pm003</ItemID>"), b.bsx.indexOf("</Item>", b.bsx.indexOf("<ItemID>pm003</ItemID>")));
  check("bl-map: .bsx pm003 line is a minifig, colour 0", bsxPm003.includes("<ItemTypeID>M</ItemTypeID>") && bsxPm003.includes("<ColorID>0</ColorID>"), true);
  // The resolver itself, one line per bad number, plus the
  // pass-through and skip cases.
  check("bl-map: resolver 30367 → 553", sandbox.brickLinkPartFor({ id: "4161674-30367-Dark_Stone_Grey", colour: "Dark Grey" }, 2), { id: "553", type: "P", colour: 85, qty: 2 });
  check("bl-map: resolver 30385 → 52", sandbox.brickLinkPartFor({ id: "4541538-30385-Transparent_Blue", colour: "Trans-Blue" }, 2), { id: "52", type: "P", colour: 14, qty: 2 });
  check("bl-map: resolver 30499 → 3684a (bare 3684 is not a BrickLink item)", sandbox.brickLinkPartFor({ id: "4537923-30499-Bright_Yellowish_Green", colour: "Lime Green" }, 1), { id: "3684a", type: "P", colour: 34, qty: 1 });
  check("bl-map: resolver 3747 → 3747b", sandbox.brickLinkPartFor({ id: "4211064-3747-Dark_Stone_Grey", colour: "Dark Grey" }, 8), { id: "3747b", type: "P", colour: 85, qty: 8 });
  check("bl-map: resolver 41669 → x346", sandbox.brickLinkPartFor({ id: "4281515-41669-Bright_Orange", colour: "Orange" }, 24), { id: "x346", type: "P", colour: 4, qty: 24 });
  check("bl-map: resolver 54196 → 2654", sandbox.brickLinkPartFor({ id: "4278412-54196-Transparent", colour: "Clear" }, 2), { id: "2654", type: "P", colour: 12, qty: 2 });
  check("bl-map: resolver 60169 → 3711 ×21", sandbox.brickLinkPartFor({ id: "4516456-60169-Dark_Stone_Grey", colour: "Dark Grey" }, 1), { id: "3711", type: "P", colour: 85, qty: 21 });
  check("bl-map: resolver 60470 → 60470b", sandbox.brickLinkPartFor({ id: "4556158-60470-Black", colour: "" }, 4), { id: "60470b", type: "P", colour: 11, qty: 4 });
  check("bl-map: resolver 60779 → 2335", sandbox.brickLinkPartFor({ id: "4523403-60779-White", colour: "White" }, 2), { id: "2335", type: "P", colour: 1, qty: 2 });
  check("bl-map: resolver 6143 → 3941", sandbox.brickLinkPartFor({ id: "4211526-6143-Medium_Stone_Grey", colour: "Light Grey" }, 1), { id: "3941", type: "P", colour: 86, qty: 1 });
  check("bl-map: resolver 64786 Trans-Red → pm003", sandbox.brickLinkPartFor({ id: "4538017-64786-Transparent_Red", colour: "Trans-Red" }, 1), { id: "pm003", type: "M", colour: 0, qty: 1 });
  check("bl-map: resolver 64786 Trans-Blue → pm004", sandbox.brickLinkPartFor({ id: "4541465-64786-Transparent_Blue", colour: "Trans-Blue" }, 1), { id: "pm004", type: "M", colour: 0, qty: 1 });
  check("bl-map: resolver 64786 Trans-Orange → pm002", sandbox.brickLinkPartFor({ id: "4541468-64786-Transparent_Bright_Orange", colour: "Trans-Orange" }, 1), { id: "pm002", type: "M", colour: 0, qty: 1 });
  check("bl-map: resolver 64786 Trans-Neon-Green → pm005", sandbox.brickLinkPartFor({ id: "4541475-64786-Transparent_Fluorescent_Green", colour: "Trans-Green" }, 1), { id: "pm005", type: "M", colour: 0, qty: 1 });
  check("bl-map: resolver 73587 → 4592c02", sandbox.brickLinkPartFor({ id: "73737-73587-White", colour: "White" }, 4), { id: "4592c02", type: "P", colour: 1, qty: 4 });
  check("bl-map: resolver 86209 → 60601", sandbox.brickLinkPartFor({ id: "4552036-86209-Transparent_Brown", colour: "Trans-Brown" }, 1), { id: "60601", type: "P", colour: 13, qty: 1 });
  check("bl-map: resolver 88072 → 4623a", sandbox.brickLinkPartFor({ id: "4569733-88072-Black", colour: "" }, 2), { id: "4623a", type: "P", colour: 11, qty: 2 });
  check("bl-map: resolver passes a shared number through", sandbox.brickLinkPartFor({ id: "300126-3001-Black", colour: "Black" }, 6), { id: "3001", type: "P", colour: 11, qty: 6 });
  check("bl-map: resolver skips a rock monster in an unknown colour", sandbox.brickLinkPartFor({ id: "4578028-64786-Transparent_Yellow", colour: "Trans-Yellow" }, 1), { skip: "rock monster in Trans-Yellow — no known BrickLink minifig number" });
  // End to end: a rock monster in a colour with no known minifig is
  // skipped and reported, never exported blindly.
  sandbox.INVENTORIES["10306-1"] = { set: "10306-1 Test Monster", lots: 1, pieces: 1, tiers: { 1: "MOST LIKELY IN BULK", 2: "MEDIUM — WORTH A DIG", 3: "LEAST LIKELY IN BULK" }, items: [{ id: "4578028-64786-Transparent_Yellow", qty: 1, dim: "1 stud", colour: "Trans-Yellow", any: false, tier: 3, cat: "Minifig / Accessories", img: "https://example.test/4578028.jpg", name: "Rock Monster Mini Assemb." }] };
  sandbox.sets.push({ key: "10306-1", set_num: "10306-1", set_name: "Test Monster", total_parts: 1, total_lots: 1, user_set_id: "us-10306" });
  sandbox.saveLocalSets(sandbox.sets);
  sandbox.saveCounts("10306-1", { "4578028-64786-Transparent_Yellow": 1 });
  sandbox.setSelected(["10306-1"]);
  const rSkip = sandbox.remainingXml();
  check("bl-map: unmapped rock-monster colour exports zero lines", rSkip.lines, 0);
  check("bl-map: unmapped rock-monster colour is skipped and reported", rSkip.skipped, [{ part: "64786", colour: "Trans-Yellow", qty: 1, reason: "rock monster in Trans-Yellow — no known BrickLink minifig number" }]);
  sandbox.sets = sandbox.sets.filter((s) => s.key !== "10306-1");
  sandbox.saveLocalSets(sandbox.sets);
  delete sandbox.INVENTORIES["10306-1"];
  sandbox.setSelected(["8961-1"]);
  // Multi-set: the same part+colour sums across sets, in both formats.
  sandbox.setSelected(["8961-1", "10294-1"]);
  const bm = sandbox.remainingBsx();
  const bsx3001m = bm.bsx.slice(bm.bsx.indexOf("<ItemID>3001</ItemID>"), bm.bsx.indexOf("</Item>", bm.bsx.indexOf("<ItemID>3001</ItemID>")));
  check("order-bsx: multi-set 3001 sums to 12", bsx3001m.includes("<Qty>12</Qty>"), true);
  check("order-bsx: multi-set parses to the same lines as the XML", parseBsx(bm.bsx), parseBlXml(sandbox.remainingXml().xml));

  // --- v3.33: bulk lists are local-only, parts stack by part+colour.
  const bl = sandbox.createBulkList("Test bin");
  check("bulk: created with an id", bl.id.slice(0, 3), "bl-");
  sandbox.addScannedPart(bl.id, "3001", "Brick 2 x 4", "Black");
  check("bulk: one scanned part", sandbox.findBulkList(bl.id).parts, [{ part: "3001", name: "Brick 2 x 4", colour: "Black", qty: 1, img: "https://img.bricklink.com/ItemImage/PN/11/3001.png" }]);
  sandbox.addScannedPart(bl.id, "3001", "Brick 2 x 4", "Black");
  check("bulk: same part+colour stacks", sandbox.findBulkList(bl.id).parts[0].qty, 2);
  sandbox.addScannedPart(bl.id, "3001", "Brick 2 x 4", "Red");
  check("bulk: same part, other colour is a second row", sandbox.findBulkList(bl.id).parts.length, 2);
  check("bulk: saved to localStorage", JSON.parse(sandbox.localStorage.getItem("bf:bulkLists")).length, 1);
  sandbox.setScannedQty(bl.id, "3001", "Black", 1);
  check("bulk: stepper down", sandbox.findBulkList(bl.id).parts[0].qty, 1);
  sandbox.setScannedQty(bl.id, "3001", "Red", 0);
  check("bulk: stepper to zero removes the row", sandbox.findBulkList(bl.id).parts.length, 1);
  sandbox.deleteBulkList(bl.id);
  check("bulk: delete removes the list", sandbox.findBulkList(bl.id), null);

  // --- v3.33: Brickognize response parsing (live shape verified
  // 2026-11-25: { items: [{ id, name, score }] }, empty when nothing).
  check("brickognize: parses the best match", sandbox.parseBrickognizeResponse({ items: [{ id: "3001", name: "Brick 2 x 4", score: 0.97 }] }), { part: "3001", name: "Brick 2 x 4", score: 0.97, box: null });
  check("brickognize: empty items is null", sandbox.parseBrickognizeResponse({ items: [] }), null);
  check("brickognize: missing items is null", sandbox.parseBrickognizeResponse({}), null);
  check("brickognize: match without an id is null", sandbox.parseBrickognizeResponse({ items: [{ name: "Brick 2 x 4" }] }), null);
  // v3.36: the top-level bounding_box rides along (live shape verified
  // 2026-11-26: pixel coords in the submitted image).
  check("brickognize: bounding_box is kept", sandbox.parseBrickognizeResponse({ items: [{ id: "3001", name: "Brick 2 x 4", score: 0.74 }], bounding_box: { left: 1.6, upper: 25.2, right: 191.8, lower: 165.8, image_width: 192, image_height: 192, score: 0.98 } }), { part: "3001", name: "Brick 2 x 4", score: 0.74, box: { left: 1.6, upper: 25.2, right: 191.8, lower: 165.8, image_width: 192, image_height: 192 } });
  check("brickognize: a partial box is dropped", sandbox.parseBrickognizeResponse({ items: [{ id: "3001", name: "Brick 2 x 4", score: 0.74 }], bounding_box: { left: 1, upper: 2 } }), { part: "3001", name: "Brick 2 x 4", score: 0.74, box: null });

  // --- v3.33: scan confirm card — added on identify, Cancel undoes it.
  const scanList = sandbox.createBulkList("Scan test");
  sandbox.handleIdentified(scanList.id, "3001", "Brick 2 x 4", 0.97, "data:image/jpeg;base64,xxx");
  check("scan: piece added on identify", sandbox.findBulkList(scanList.id).parts, [{ part: "3001", name: "Brick 2 x 4", colour: "Black", qty: 1, img: "https://img.bricklink.com/ItemImage/PN/11/3001.png" }]);
  check("scan: confirm card shows the part number", sandbox.scanPartNumEl.textContent, "3001");
  check("scan: confirm card shows the name", sandbox.scanPartNameEl.textContent, "Brick 2 x 4");
  check("scan: confirm card shows confidence", sandbox.scanScoreEl.textContent, "Confidence 97%");
  sandbox.scanColourSel.value = "Red";
  sandbox.scanColourSel.listeners.change[0]({ target: sandbox.scanColourSel });
  check("scan: colour change moves the piece", sandbox.findBulkList(scanList.id).parts, [{ part: "3001", name: "Brick 2 x 4", colour: "Red", qty: 1, img: "https://img.bricklink.com/ItemImage/PN/5/3001.png" }]);
  sandbox.scanCancelBtn.listeners.click[0]();
  check("scan: Cancel removes the piece", sandbox.findBulkList(scanList.id).parts, []);
  check("scan: Cancel hides the confirm card", sandbox.scanConfirmEl.hidden, true);
  sandbox.handleIdentified(scanList.id, "3001", "Brick 2 x 4", 0.4, "data:image/jpeg;base64,yyy");
  check("scan: low confidence is flagged", sandbox.scanScoreEl.textContent.includes("Low confidence"), true);
  sandbox.scanDoneBtn.listeners.click[0]();
  check("scan: Done keeps the piece", sandbox.findBulkList(scanList.id).parts.length, 1);
  check("scan: Done hides the confirm card", sandbox.scanConfirmEl.hidden, true);

  // --- v3.35: scan assignment popup — Done asks where the piece
  // goes. The scan test above left the popup open; close it first.
  sandbox.closeScanAssign();
  sandbox.scanState.lastColour = "Black";
  const inv8961d = sandbox.getInventory("8961-1");
  const full8961d = {};
  inv8961d.items.forEach((it) => { full8961d[it.id] = it.qty; });
  full8961d["300126-3001-Black"] = 6;
  full8961d["614126-6141-Black"] = 0;
  sandbox.saveCounts("8961-1", full8961d);
  const full94d = {};
  fixtureInv10294.items.forEach((it) => { full94d[it.id] = it.qty; });
  sandbox.saveCounts("10294-1", full94d);
  const full05d = {};
  fixtureInv10305.items.forEach((it) => { full05d[it.id] = it.qty; });
  sandbox.saveCounts("10305-1", full05d);
  const assignList = sandbox.createBulkList("Assign test");
  sandbox.handleIdentified(assignList.id, "3001", "Brick 2 x 4", 0.97, "data:image/jpeg;base64,zzz");
  sandbox.scanDoneBtn.listeners.click[0]();
  check("assign: Done opens the popup", sandbox.scanAssignModal.hidden, false);
  check("assign: bulk list is the first row", sandbox.scanAssignList.children[0].textContent, "Add to bulk list");
  check("assign: bulk row names the list and its piece count", sandbox.scanAssignList.children[0].children[0].textContent, "Assign test · 1 pieces");
  const assignRows = sandbox.scanAssignList.children.slice(1);
  check("assign: every set needing the piece is listed", assignRows.map((b) => b.textContent).sort(), ["Crystal Sweeper", "Test Set 2", "Test Ship", "test-2"]);
  const assignRow8961 = assignRows.find((b) => b.textContent === "Crystal Sweeper");
  const assignRow10294 = assignRows.find((b) => b.textContent === "Test Ship");
  const assignRow10305 = assignRows.find((b) => b.textContent === "Test Set 2");
  const assignRowTest2 = assignRows.find((b) => b.textContent === "test-2");
  check("assign: 8961-1 row shows its need and progress", assignRow8961.children[0].textContent, "Needs 6 · 14/430 pieces found");
  check("assign: 10294-1 row shows its need and progress", assignRow10294.children[0].textContent, "Needs 6 · 0/10 pieces found");
  check("assign: 10305-1 row shows its need and progress", assignRow10305.children[0].textContent, "Needs 3 · 0/5 pieces found");
  check("assign: test-2 row shows its need and progress", assignRowTest2.children[0].textContent, "Needs 2 · 0/3 pieces found");
  assignRow8961.listeners.click[0]();
  check("assign: tapping 8961-1 credits the piece there", JSON.parse(sandbox.localStorage.getItem("bf:counts:8961-1"))["300126-3001-Black"], 5);
  check("assign: piece leaves the bulk list", sandbox.findBulkList(assignList.id).parts, []);
  check("assign: popup closes after assigning", sandbox.scanAssignModal.hidden, true);
  // The bulk row keeps the piece where it is.
  sandbox.handleIdentified(assignList.id, "3001", "Brick 2 x 4", 0.97, "data:image/jpeg;base64,zzz2");
  sandbox.scanDoneBtn.listeners.click[0]();
  sandbox.scanAssignList.children[0].listeners.click[0]();
  check("assign: bulk row keeps the piece in the list", sandbox.findBulkList(assignList.id).parts.length, 1);
  check("assign: bulk row closes the popup", sandbox.scanAssignModal.hidden, true);
  // A piece no tracked set needs: no popup at all — the piece just
  // stays in the bulk list and scanning resumes.
  sandbox.handleIdentified(assignList.id, "3001", "Brick 2 x 4", 0.97, "data:image/jpeg;base64,zzz3");
  sandbox.scanColourSel.value = "Red";
  sandbox.scanColourSel.listeners.change[0]({ target: sandbox.scanColourSel });
  sandbox.scanDoneBtn.listeners.click[0]();
  check("assign: no set needs the red piece, no popup", sandbox.scanAssignModal.hidden, true);
  check("assign: no popup, back to scanning", sandbox.scanControlsEl.hidden, false);
  check("assign: red piece stays in the bulk list", sandbox.findBulkList(assignList.id).parts.length, 2);
  // Cancel still closes the popup and keeps the piece, when a set
  // does need it and the popup opens.
  sandbox.scanState.lastColour = "Black";
  sandbox.handleIdentified(assignList.id, "3001", "Brick 2 x 4", 0.97, "data:image/jpeg;base64,zzz3b");
  sandbox.scanDoneBtn.listeners.click[0]();
  check("assign: popup opens for a needed piece", sandbox.scanAssignModal.hidden, false);
  const assignBox = sandbox.scanAssignModal.children[0];
  const assignCancel = assignBox.children.find((c) => c.textContent === "Cancel");
  assignCancel.listeners.click[0]();
  check("assign: Cancel keeps the pieces in the bulk list", sandbox.bulkListPieces(sandbox.findBulkList(assignList.id)), 3);
  check("assign: Cancel closes the popup", sandbox.scanAssignModal.hidden, true);
  // Escape closes the popup and keeps the piece, too.
  sandbox.scanState.lastColour = "Black";
  sandbox.handleIdentified(assignList.id, "3001", "Brick 2 x 4", 0.97, "data:image/jpeg;base64,zzz4");
  sandbox.scanDoneBtn.listeners.click[0]();
  check("assign: popup opens again for the next piece", sandbox.scanAssignModal.hidden, false);
  sandbox.document.listeners.keydown[0]({ key: "Escape" });
  check("assign: Escape closes the popup", sandbox.scanAssignModal.hidden, true);
  check("assign: Escape keeps the piece in the bulk list", sandbox.bulkListPieces(sandbox.findBulkList(assignList.id)), 4);

  // --- v3.33: scan picker — create a list, no camera here.
  sandbox.openScanPicker();
  check("scan: picker opens", sandbox.scanPickerModal.hidden, false);
  sandbox.scanNewNameInput.value = "  Picker list  ";
  sandbox.scanCreateBtn.listeners.click[0]();
  await sleep(10);
  check("scan: creating a list opens the scanner for it", sandbox.scanOverlay.hidden, false);
  check("scan: the new list exists", sandbox.bulkLists.some((l) => l.name === "Picker list"), true);
  check("scan: no camera in this environment is reported", sandbox.scanStatusEl.textContent, "This browser can't open the camera — pick a photo below instead.");
  sandbox.closeScan();
  check("scan: closing hides the overlay", sandbox.scanOverlay.hidden, true);

  // --- v3.33: Order remaining button + modal (copy/download fallbacks
  // in this environment have no clipboard or Blob).
  sandbox.setSelected(["8961-1"]);
  sandbox.renderSetView();
  const setView = sandbox.document.getElementById("setView");
  const orderBtn = setView.children.find((c) => c.textContent === "Order remaining");
  check("order: button is under the title", !!orderBtn, true);
  orderBtn.listeners.click[0]();
  check("order: modal opens", sandbox.orderModal.hidden, false);
  check("order: modal holds the XML", sandbox.orderXmlText.value.startsWith("<INVENTORY>"), true);
  check("order: modal XML has the 3001 line", sandbox.orderXmlText.value.includes("<ITEMID>3001</ITEMID>"), true);
  check("order: .bsx button names the BrickLink file picker", sandbox.orderBsxBtn.textContent.includes("BrickLink") && sandbox.orderBsxBtn.textContent.includes("upload picker"), true);
  check("order: .xml button names Rebrickable", sandbox.orderXmlBtn.textContent.includes("Rebrickable"), true);
  check("order: copy button names the XML-format tab", sandbox.orderCopyBtn.textContent.includes("Upload BrickLink XML format"), true);
  check("order: summary names both routes", sandbox.orderSummaryEl.textContent.includes("file picker") && sandbox.orderSummaryEl.textContent.includes("Upload BrickLink XML format"), true);
  sandbox.downloadRemainingBsx();
  check("order: .bsx download fallback tells the user", sandbox.orderStatusEl.textContent, "Download didn't work here — use Copy instead.");
  sandbox.copyRemainingXml();
  check("order: copy fallback tells the user", sandbox.orderStatusEl.textContent, "Text selected — copy it by hand.");
  sandbox.downloadRemainingXml();
  check("order: download fallback tells the user", sandbox.orderStatusEl.textContent, "Download didn't work here — use Copy instead.");
  sandbox.hideOrderModal();
  check("order: modal closes", sandbox.orderModal.hidden, true);

  // --- v3.33: optimizer — pieces covered, newest by year, price off.
  // Bulk: 3001 Black x6, 3747 Dark Grey x2, 30385 Trans-Blue x1,
  // 6141 White x2. 8961-1 covers 11 pieces in 4 lots (6141 is an
  // any-colour lot there), 10294-1 covers 9 in 3, 10305-1 covers 5 in 2.
  sandbox.sets.forEach((s) => { if (s.key === "10294-1") s.year = 2021; if (s.key === "10305-1") s.year = 2022; });
  const optList = sandbox.createBulkList("Optimizer test");
  [["3001", "Brick 2 x 4", "Black", 6], ["3747", "Slope 45 2 x 1", "Dark Grey", 2], ["30385", "Rock 1 x 1 Crystal 5 Point", "Trans-Blue", 1], ["6141", "Tile 1 x 1", "White", 2]].forEach(([part, name, colour, qty]) => { for (let i = 0; i < qty; i++) sandbox.addScannedPart(optList.id, part, name, colour); });
  const rankedByPieces = sandbox.rankBulkListSets(optList, "pieces");
  const byKey = {};
  rankedByPieces.forEach((r) => { byKey[r.setKey] = r; });
  check("opt: 8961-1 ranks above 10294-1 above 10305-1", rankedByPieces.map((r) => r.setKey).indexOf("8961-1") < rankedByPieces.map((r) => r.setKey).indexOf("10294-1") && rankedByPieces.map((r) => r.setKey).indexOf("10294-1") < rankedByPieces.map((r) => r.setKey).indexOf("10305-1"), true);
  check("opt: 8961-1 covers 11 pieces, 4 lots", [byKey["8961-1"].piecesCovered, byKey["8961-1"].lotsCovered], [11, 4]);
  check("opt: 10294-1 covers 9 pieces, 3 lots", [byKey["10294-1"].piecesCovered, byKey["10294-1"].lotsCovered], [9, 3]);
  check("opt: 10305-1 covers 5 pieces, 2 lots", [byKey["10305-1"].piecesCovered, byKey["10305-1"].lotsCovered], [5, 2]);
  const rankedByNewest = sandbox.rankBulkListSets(optList, "newest").map((r) => r.setKey);
  check("opt: newest puts 2022 first, then 2021, year-less last", rankedByNewest.indexOf("10305-1") < rankedByNewest.indexOf("10294-1") && rankedByNewest.indexOf("10294-1") < rankedByNewest.indexOf("8961-1"), true);
  check("opt: price mode is BrickOwl", sandbox.OPTIMIZER_PRICE_MODE, "brickowl");
  sandbox.openBulkList(optList.id);
  sandbox.runOptimizer(optList.id, "pieces");
  check("opt: price button is enabled", sandbox.bulkOptPriceBtn.disabled, false);

  // --- v3.36: quantity stepper, blind toggle, fewest ranking,
  // price mode, suggestions, exclude-minifigures, colour sampling.
  // Reset the counts the earlier sections moved, so every check
  // below starts from full sets.
  const fullCounts = (inv) => { const m = {}; inv.items.forEach((it) => { m[it.id] = it.qty; }); return m; };
  sandbox.saveCounts("8961-1", fullCounts(sandbox.getInventory("8961-1")));
  sandbox.saveCounts("10294-1", fullCounts(fixtureInv10294));
  sandbox.saveCounts("10305-1", fullCounts(fixtureInv10305));
  sandbox.bulkOptBlind = false;
  sandbox.bulkOptExcludeMinifig = false;
  sandbox.localStorage.removeItem("bf:prices");
  sandbox.localStorage.removeItem("bf:suggest");
  sandbox.closeScanAssign();
  sandbox.scanState.lastColour = "Black";
  sandbox.scanCanvas = null;

  // Quantity stepper: default 1, floor 1, moves the bulk list live.
  const qtyList = sandbox.createBulkList("Qty test");
  sandbox.handleIdentified(qtyList.id, "3001", "Brick 2 x 4", 0.97, "data:image/jpeg;base64,q1");
  check("qty: default 1", sandbox.scanState.pending.qty, 1);
  check("qty: number shows 1", sandbox.scanQtyEl.textContent, "1");
  check("qty: minus disabled at 1", sandbox.scanQtyMinusBtn.disabled, true);
  sandbox.scanQtyPlusBtn.listeners.click[0]();
  sandbox.scanQtyPlusBtn.listeners.click[0]();
  check("qty: plus twice is 3", sandbox.scanState.pending.qty, 3);
  check("qty: bulk list holds 3", sandbox.findBulkList(qtyList.id).parts[0].qty, 3);
  check("qty: minus enabled above 1", sandbox.scanQtyMinusBtn.disabled, false);
  sandbox.scanQtyMinusBtn.listeners.click[0]();
  check("qty: minus back to 2", sandbox.scanState.pending.qty, 2);
  sandbox.scanQtyMinusBtn.listeners.click[0]();
  sandbox.scanQtyMinusBtn.listeners.click[0]();
  check("qty: minus never goes below 1", sandbox.scanState.pending.qty, 1);
  check("qty: bulk list back to 1", sandbox.findBulkList(qtyList.id).parts[0].qty, 1);
  // Colour change moves the whole quantity, not one copy.
  sandbox.scanQtyPlusBtn.listeners.click[0]();
  sandbox.scanColourSel.value = "Red";
  sandbox.scanColourSel.listeners.change[0]({ target: sandbox.scanColourSel });
  check("qty: colour change moves both copies", sandbox.findBulkList(qtyList.id).parts, [{ part: "3001", name: "Brick 2 x 4", colour: "Red", qty: 2, img: "https://img.bricklink.com/ItemImage/PN/5/3001.png" }]);
  // Cancel restores the base the scan started from.
  const cancelList = sandbox.createBulkList("Cancel qty test");
  for (let i = 0; i < 5; i++) sandbox.addScannedPart(cancelList.id, "3001", "Brick 2 x 4", "Black");
  sandbox.scanState.lastColour = "Black";
  sandbox.handleIdentified(cancelList.id, "3001", "Brick 2 x 4", 0.97, "data:image/jpeg;base64,q2");
  sandbox.scanQtyPlusBtn.listeners.click[0]();
  check("qty: base 5 plus scan 2 is 7", sandbox.findBulkList(cancelList.id).parts[0].qty, 7);
  sandbox.scanCancelBtn.listeners.click[0]();
  check("qty: Cancel leaves the base 5", sandbox.findBulkList(cancelList.id).parts[0].qty, 5);
  // Assigning N credits up to the set's need; the rest stays in bulk.
  sandbox.saveCounts("10305-1", { "300126-3001-Black": 2, "614126-6141-White": 2 });
  const assignQtyList = sandbox.createBulkList("Assign qty test");
  sandbox.scanState.lastColour = "Black";
  sandbox.handleIdentified(assignQtyList.id, "3001", "Brick 2 x 4", 0.97, "data:image/jpeg;base64,q3");
  sandbox.scanQtyPlusBtn.listeners.click[0]();
  sandbox.scanQtyPlusBtn.listeners.click[0]();
  sandbox.scanDoneBtn.listeners.click[0]();
  check("qty-assign: popup opens", sandbox.scanAssignModal.hidden, false);
  const assignQtyRow = sandbox.scanAssignList.children.slice(1).find((b) => b.textContent === "Test Set 2");
  check("qty-assign: Test Set 2 row shows its need of 2", assignQtyRow.children[0].textContent, "Needs 2 · 1/5 pieces found");
  assignQtyRow.listeners.click[0]();
  check("qty-assign: set credited up to its need of 2", JSON.parse(sandbox.localStorage.getItem("bf:counts:10305-1"))["300126-3001-Black"], 0);
  check("qty-assign: remainder 1 stays in the bulk list", sandbox.findBulkList(assignQtyList.id).parts, [{ part: "3001", name: "Brick 2 x 4", colour: "Black", qty: 1, img: "https://img.bricklink.com/ItemImage/PN/11/3001.png" }]);
  check("qty-assign: popup closes after assigning", sandbox.scanAssignModal.hidden, true);
  sandbox.saveCounts("10305-1", fullCounts(fixtureInv10305));

  // Colour-doesn't-matter toggle: a blue 2x4 covers a red need
  // only when it is on. Temporary fixture set, removed afterwards.
  sandbox.INVENTORIES["red-1"] = { set: "red-1 Test Red", lots: 1, pieces: 2, items: [{ id: "x-3001-Red", qty: 2, dim: "2 × 4 studs", colour: "Red", any: false, tier: 1, cat: "Bricks", img: "https://example.test/x.jpg", name: "Brick 2 x 4" }] };
  sandbox.sets.push({ key: "red-1", set_num: "red-1", set_name: "Test Red", total_parts: 2, total_lots: 1 });
  sandbox.saveCounts("red-1", { "x-3001-Red": 2 });
  const blueList = sandbox.createBulkList("Blue test");
  sandbox.addScannedPart(blueList.id, "3001", "Brick 2 x 4", "Blue");
  sandbox.addScannedPart(blueList.id, "3001", "Brick 2 x 4", "Blue");
  const redOff = sandbox.rankBulkListSets(blueList, "pieces", false).find((r) => r.setKey === "red-1");
  check("blind: off, blue 2x4 does not cover a red need", [redOff.piecesCovered, redOff.lotsCovered], [0, 0]);
  const redOn = sandbox.rankBulkListSets(blueList, "pieces", true).find((r) => r.setKey === "red-1");
  check("blind: on, blue 2x4 covers the red need", [redOn.piecesCovered, redOn.lotsCovered], [2, 1]);
  sandbox.runOptimizer(optList.id, "pieces");
  sandbox.bulkOptBlindBtn.listeners.click[0]();
  check("blind: toggle button shows on", sandbox.bulkOptBlindBtn.className.includes("on") && sandbox.bulkOptBlindBtn.attributes["aria-pressed"] === "true", true);
  sandbox.bulkOptBlindBtn.listeners.click[0]();
  check("blind: toggle button shows off again", !sandbox.bulkOptBlindBtn.className.includes("on") && sandbox.bulkOptBlindBtn.attributes["aria-pressed"] === "false", true);
  sandbox.sets = sandbox.sets.filter((s) => s.key !== "red-1");
  sandbox.saveLocalSets(sandbox.sets);
  delete sandbox.INVENTORIES["red-1"];

  // Fewest-missing ranking: fewest pieces left first.
  sandbox.saveCounts("10305-1", { "300126-3001-Black": 1, "614126-6141-White": 0 });
  const rankedFewest = sandbox.rankBulkListSets(optList, "fewest").map((r) => r.setKey);
  check("fewest: one piece left ranks first, then 3, 10, 430", rankedFewest, ["10305-1", "test-2", "10294-1", "8961-1"]);
  sandbox.saveCounts("10305-1", fullCounts(fixtureInv10305));

  // Price mode: mocked get-prices, $0.05 / $0.50 / $1.00 / $0.10
  // per part, $0.10 default for everything else.
  const PRICE_BY_DESIGN = { "3001": 0.05, "3747": 0.5, "30385": 1.0, "6141": 0.1 };
  let priceCalls = 0;
  const priceHandler = async (name, opts) => {
    if (name === "get-prices") {
      priceCalls++;
      return { data: { ok: true, prices: (opts.body.items || []).map((it) => ({ key: it.key, usd: PRICE_BY_DESIGN[it.design_id] === undefined ? 0.1 : PRICE_BY_DESIGN[it.design_id] })) }, error: null };
    }
    return { data: null, error: { message: "no handler" } };
  };
  invokeHandler = priceHandler;
  const usd = (n) => Math.round(n * 100) / 100;
  const price10294 = await sandbox.fetchSetPrices("10294-1", false);
  check("price: 10294-1 costs $3.30 to complete", usd(price10294.totalUsd), 3.3);
  check("price: 10294-1 has no unpriced lots", price10294.unpricedLots, 0);
  const price10305 = await sandbox.fetchSetPrices("10305-1", false);
  check("price: 10305-1 costs $0.35 to complete", usd(price10305.totalUsd), 0.35);
  const priceTest2 = await sandbox.fetchSetPrices("test-2", false);
  check("price: test-2 costs $0.10, rock monster unpriced", [usd(priceTest2.totalUsd), priceTest2.unpricedLots], [0.1, 1]);
  // The cache is shared across sets: 3001's price, fetched for
  // 10294-1, is reused by 10305-1 and test-2, so only two invokes.
  check("price: two invokes cover three sets (shared cache)", priceCalls, 2);
  sandbox.runOptimizer(optList.id, "price");
  await sleep(50);
  const priceRows = sandbox.bulkOptWrap.children[2].children.map((r) => r.children[0].children[0].textContent);
  check("price: rows sort cheapest first", priceRows, ["test-2", "Test Set 2 (2022)", "Test Ship (2021)", "Crystal Sweeper"]);
  const priceSub = sandbox.bulkOptWrap.children[2].children.map((r) => r.children[0].children[1].textContent);
  check("price: test-2 row shows cost and the unpriced lot", priceSub[0], "Cost to complete $0.10 · 3 pieces left · 1 lot unpriced");
  check("price: 10305-1 row shows $0.35", priceSub[1], "Cost to complete $0.35 · 5 pieces left");
  check("price: 8961-1 row counts its unpriced lots", priceSub[3].includes("unpriced"), true);
  check("price: render adds one invoke, for 8961-1's uncached lines", priceCalls, 3);
  // Cache reuse: a failing handler still returns the cached total.
  invokeHandler = async () => { throw new Error("must not be called"); };
  const priceCached = await sandbox.fetchSetPrices("10294-1", false);
  check("price: cached total survives a dead handler", usd(priceCached.totalUsd), 3.3);
  check("price: no new invoke while cached", priceCalls, 3);
  // No-key error surfaces as a setup message, not a silent zero.
  sandbox.localStorage.removeItem("bf:prices");
  invokeHandler = async (name) => (name === "get-prices" ? { data: { ok: false, error: "no_api_key" }, error: null } : { data: null, error: { message: "no handler" } });
  const priceNoKey = await sandbox.fetchSetPrices("10305-1", false);
  check("price: no-key returns the error, no total", [priceNoKey.error, priceNoKey.totalUsd], ["no_api_key", null]);
  check("price: no-key message names the secret", sandbox.priceErrorText("no_api_key").includes("BRICKOWL_API_KEY"), true);
  // Blind mode prices by part alone: keys are design|any.
  invokeHandler = priceHandler;
  sandbox.localStorage.removeItem("bf:prices");
  const priceBlind = await sandbox.fetchSetPrices("10305-1", true);
  check("price: blind total is the same $0.35", usd(priceBlind.totalUsd), 0.35);
  check("price: blind cache keys drop the colour", Object.keys(sandbox.loadPriceCache()).sort(), ["3001|any", "6141|any"]);
  // Minifigures excluded from pricing: the 30385 crystal drops out.
  const priceNoMini = await sandbox.fetchSetPrices("10294-1", false, true);
  check("price: minifigures excluded, 10294-1 is $1.30", [priceNoMini.totalUsd, priceNoMini.unpricedLots], [1.3, 0]);

  // All-sets suggestions: mocked suggest-sets + import-set.
  invokeHandler = async (name, opts) => {
    if (name === "suggest-sets") {
      return { data: { ok: true, candidates: [
        { set_num: "99999-1", name: "Fake Set A", year: 2023, num_parts: 50, set_img_url: "https://cdn.rebrickable.com/media/sets/99999-1.jpg", lotsCovered: 3, missingUpper: 47 },
        { set_num: "99998-1", name: "Fake Set B", year: 2020, num_parts: 20, set_img_url: "https://cdn.rebrickable.com/media/sets/99998-1.jpg", lotsCovered: 2, missingUpper: 18 },
        { set_num: "10294-1", name: "Test Ship", year: 2021, num_parts: 10, set_img_url: "https://cdn.rebrickable.com/media/sets/10294-1.jpg", lotsCovered: 3, missingUpper: 7 },
      ], queried: ["3001|Black"], partial: false, unmapped: [] }, error: null };
    }
    if (name === "import-set") {
      return { data: { ok: true, cached: false, set: { set_num: "99999-1", name: "Fake Set A", year: 2023, num_parts: 50, set_img_url: "" }, inventory: { set: "99999-1", lots: 1, pieces: 50, items: [{ id: "z-3001-Black", qty: 50, colour: "Black", any: false, tier: 2, cat: "Bricks", img: "", name: "Brick 2 x 4" }] }, lots: 1, pieces: 50 }, error: null };
    }
    return { data: null, error: { message: "no handler" } };
  };
  sandbox.runOptimizer(optList.id, "pieces");
  await sandbox.findSuggestions(optList.id, false);
  check("sugg: state is done with 3 candidates", [sandbox.bulkSuggState.status, sandbox.bulkSuggState.candidates.length], ["done", 3]);
  const suggRows = sandbox.bulkSuggWrap.children.filter((c) => c.className.includes("sugg-row"));
  check("sugg: tracked sets are filtered out of the rows", suggRows.map((r) => r.children[1].children[0].textContent), ["Fake Set A (2023)", "Fake Set B (2020)"]);
  check("sugg: row shows lots, total and missing", suggRows[0].children[1].children[1].textContent, "Shares 3 lots · 50 pieces total · up to 47 missing");
  check("sugg: local ranking puts fewest missing first", sandbox.rankSuggestionsLocal(sandbox.bulkSuggState.candidates, "fewest").map((c) => c.set_num), ["10294-1", "99998-1", "99999-1"]);
  check("sugg: cache key changes with the minifig toggle", sandbox.suggestCacheKeyFor(sandbox.distinctBulkParts(optList), false, false) !== sandbox.suggestCacheKeyFor(sandbox.distinctBulkParts(optList), false, true), true);
  const origOpenSet = sandbox.openSet;
  let openedKeys = [];
  sandbox.openSet = (k) => { openedKeys.push(k); };
  suggRows[0].children[2].listeners.click[0]({ stopPropagation() {} });
  await sleep(50);
  check("sugg: Add imports without opening the set", openedKeys, []);
  check("sugg: set is in My sets", sandbox.findSet("99999-1") && sandbox.findSet("99999-1").set_num, "99999-1");
  check("sugg: imported set leaves the suggestions", sandbox.bulkSuggState.candidates.some((c) => c.set_num === "99999-1"), false);
  sandbox.openSet = origOpenSet;
  sandbox.sets = sandbox.sets.filter((s) => s.key !== "99999-1");
  sandbox.saveLocalSets(sandbox.sets);
  delete sandbox.INVENTORIES["99999-1"];

  // Exclude minifigures: the toggle drops minifig lots on both sides.
  check("minifig: rock monster lot is a minifig lot", sandbox.isMinifigLot({ id: "b-64786-Trans-Blue", cat: "Minifig / Accessories", colour: "Trans-Blue" }), true);
  check("minifig: minifig-category lot is a minifig lot", sandbox.isMinifigLot({ id: "4541538-30385-Transparent_Blue", cat: "Minifig Accessories", colour: "Trans-Blue" }), true);
  check("minifig: plain brick is not", sandbox.isMinifigLot({ id: "300126-3001-Black", cat: "Bricks", colour: "Black" }), false);
  const rankedMiniOff = sandbox.rankBulkListSets(optList, "pieces", false, false).find((r) => r.setKey === "10294-1");
  const rankedMiniOn = sandbox.rankBulkListSets(optList, "pieces", false, true).find((r) => r.setKey === "10294-1");
  check("minifig: off, 10294-1 covers 9 pieces in 3 lots", [rankedMiniOff.piecesCovered, rankedMiniOff.lotsCovered], [9, 3]);
  check("minifig: on, coverage ignores the minifig lot", [rankedMiniOn.piecesCovered, rankedMiniOn.lotsCovered], [8, 2]);
  check("minifig: off, 10 pieces left", rankedMiniOff.remainingPieces, 10);
  check("minifig: on, missing drops by the 2 minifig pieces", rankedMiniOn.remainingPieces, 8);
  check("minifig: on, total drops to the 8 non-minifig pieces", rankedMiniOn.totalPieces, 8);
  check("minifig: off, the crystal is queried for suggestions", sandbox.distinctBulkParts(optList, false, false).map((p) => p.part), ["3001", "3747", "6141", "30385"]);
  check("minifig: on, the crystal is not queried", sandbox.distinctBulkParts(optList, true, false).map((p) => p.part), ["3001", "3747", "6141"]);
  const miniList = sandbox.createBulkList("Minifig test");
  sandbox.addScannedPart(miniList.id, "64786", "Rock Monster", "Trans-Blue");
  sandbox.addScannedPart(miniList.id, "3001", "Brick 2 x 4", "Black");
  check("minifig: on, a rock monster never drives a suggestion", sandbox.distinctBulkParts(miniList, true, false).map((p) => p.part), ["3001"]);
  sandbox.runOptimizer(optList.id, "pieces");
  check("minifig: toggle button starts off", sandbox.bulkOptMinifigBtn.textContent, "Exclude minifigures");
  sandbox.bulkOptMinifigBtn.listeners.click[0]();
  check("minifig: toggle button shows on", sandbox.bulkOptMinifigBtn.className.includes("on") && sandbox.bulkOptMinifigBtn.attributes["aria-pressed"] === "true", true);
  check("minifig: footer says minifigures were excluded", sandbox.bulkOptWrap.children[4].textContent.includes("Minifigures excluded from the match."), true);
  check("minifig: suggestions note the exclusion", sandbox.bulkSuggWrap.children.some((c) => c.textContent && c.textContent.includes("Minifigures excluded from the match")), true);
  sandbox.bulkOptMinifigBtn.listeners.click[0]();
  check("minifig: toggle button shows off again", !sandbox.bulkOptMinifigBtn.className.includes("on"), true);

  // Colour sampling: a fake canvas stands in for the captured frame.
  const makeTestCanvas = (w, h, px) => ({
    width: w, height: h,
    getContext: () => ({
      getImageData(x, y, rw, rh) {
        const data = new Uint8ClampedArray(rw * rh * 4);
        for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) {
          const c = px(x + i, y + j);
          const o = (j * rw + i) * 4;
          data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
        }
        return { data, width: rw, height: rh };
      },
      drawImage() {},
    }),
  });
  const sampleList = sandbox.createBulkList("Sample test");
  const redBox = { left: 0, upper: 0, right: 100, lower: 100, image_width: 100, image_height: 100 };
  sandbox.scanState.lastColour = "Black";
  sandbox.scanCanvas = makeTestCanvas(100, 100, () => [201, 26, 9]);
  sandbox.handleIdentified(sampleList.id, "3001", "Brick 2 x 4", 0.97, "data:image/jpeg;base64,s1", redBox);
  check("sample: red frame pre-selects Red", sandbox.scanColourSel.value, "Red");
  check("sample: piece filed as Red", sandbox.findBulkList(sampleList.id).parts, [{ part: "3001", name: "Brick 2 x 4", colour: "Red", qty: 1, img: "https://img.bricklink.com/ItemImage/PN/5/3001.png" }]);
  check("sample: chips shown", sandbox.scanChipsEl.hidden, false);
  const chipNames = () => sandbox.scanChipsEl.children.filter((c) => c.tagName === "BUTTON").map((c) => c.textContent);
  check("sample: top-3 chips are Red, Trans-Red, Trans-Orange", chipNames(), ["Red", "Trans-Red", "Trans-Orange"]);
  check("sample: the sampled chip reads active", sandbox.scanChipsEl.children.filter((c) => c.tagName === "BUTTON")[0].className.includes("on"), true);
  // A chip tap corrects the colour; the picker follows.
  sandbox.scanChipsEl.children.filter((c) => c.tagName === "BUTTON")[1].listeners.click[0]();
  check("sample: chip tap files the piece as Trans-Red", sandbox.findBulkList(sampleList.id).parts[0].colour, "Trans-Red");
  check("sample: picker follows the chip", sandbox.scanColourSel.value, "Trans-Red");
  check("sample: active chip moves to Trans-Red", chipNames().indexOf("Trans-Red") === 1 && sandbox.scanChipsEl.children.filter((c) => c.tagName === "BUTTON")[1].className.includes("on"), true);
  sandbox.scanCancelBtn.listeners.click[0]();
  // Blue frame, and near-white background pixels don't wash it out.
  sandbox.scanState.lastColour = "Black";
  sandbox.scanCanvas = makeTestCanvas(100, 100, () => [0, 85, 191]);
  sandbox.handleIdentified(sampleList.id, "3001", "Brick 2 x 4", 0.97, "data:image/jpeg;base64,s2", redBox);
  check("sample: blue frame pre-selects Blue", sandbox.scanColourSel.value, "Blue");
  check("sample: blue top-3", chipNames(), ["Blue", "Trans-Blue", "Dark Grey"]);
  sandbox.scanCancelBtn.listeners.click[0]();
  sandbox.scanCanvas = makeTestCanvas(100, 100, (x, y) => (x >= 30 && x < 70 && y >= 30 && y < 70 ? [201, 26, 9] : [255, 255, 255]));
  sandbox.handleIdentified(sampleList.id, "3001", "Brick 2 x 4", 0.97, "data:image/jpeg;base64,s3", redBox);
  check("sample: white background is ignored, red centre wins", sandbox.scanColourSel.value, "Red");
  sandbox.scanCancelBtn.listeners.click[0]();
  // No bounding box: the centre 40% is sampled instead.
  sandbox.handleIdentified(sampleList.id, "3001", "Brick 2 x 4", 0.97, "data:image/jpeg;base64,s4");
  check("sample: no box falls back to the frame centre", sandbox.scanColourSel.value, "Red");
  sandbox.scanCancelBtn.listeners.click[0]();
  // The manual picker still overrides a sample.
  sandbox.scanState.lastColour = "Black";
  sandbox.scanCanvas = makeTestCanvas(100, 100, () => [0, 85, 191]);
  sandbox.handleIdentified(sampleList.id, "3001", "Brick 2 x 4", 0.97, "data:image/jpeg;base64,s5", redBox);
  sandbox.scanColourSel.value = "Black";
  sandbox.scanColourSel.listeners.change[0]({ target: sandbox.scanColourSel });
  check("sample: manual picker overrides the sample", sandbox.findBulkList(sampleList.id).parts[0].colour, "Black");
  sandbox.scanCancelBtn.listeners.click[0]();
  // An all-white frame samples nothing: last-used colour, no chips.
  sandbox.scanState.lastColour = "Black";
  sandbox.scanCanvas = makeTestCanvas(100, 100, () => [255, 255, 255]);
  sandbox.handleIdentified(sampleList.id, "3001", "Brick 2 x 4", 0.97, "data:image/jpeg;base64,s6", redBox);
  check("sample: all-white falls back to the last colour", sandbox.scanColourSel.value, "Black");
  check("sample: all-white shows no chips", sandbox.scanChipsEl.hidden, true);
  sandbox.scanCancelBtn.listeners.click[0]();
  sandbox.scanCanvas = null;
  // File-input path: the picked photo is drawn to the sampling
  // canvas at natural size before identification runs.
  class FakeImage {
    constructor() { this.naturalWidth = 192; this.naturalHeight = 192; this._src = ""; }
    set src(v) { this._src = v; if (this.onload) this.onload(); }
    get src() { return this._src; }
  }
  class FakeFileReader {
    readAsDataURL() { this.result = "data:image/jpeg;base64,file1"; if (this.onload) this.onload(); }
  }
  sandbox.Image = FakeImage;
  sandbox.FileReader = FakeFileReader;
  let drawn = null;
  sandbox.scanCanvas = { width: 0, height: 0, getContext: () => ({ drawImage(img, x, y) { drawn = { img, x, y }; }, getImageData() { return { data: new Uint8ClampedArray(0) }; } }) };
  sandbox.onScanFile({ name: "part.jpg" });
  check("sample: file photo is drawn to the canvas", drawn && drawn.img instanceof FakeImage && drawn.x === 0 && drawn.y === 0, true);
  check("sample: canvas sized to the photo", [sandbox.scanCanvas.width, sandbox.scanCanvas.height], [192, 192]);
  sandbox.scanCanvas = null;
  delete sandbox.Image;
  delete sandbox.FileReader;
  // --- v3.37: popup skip, photo colour map, optimizer view,
  // suggestion thumbnails + lightbox, price error surfacing,
  // chunking, 0-part suggestions.
  sandbox.closeScanAssign();
  sandbox.scanState.lastColour = "Black";
  sandbox.localStorage.removeItem("bf:prices");
  sandbox.localStorage.removeItem("bf:suggest");
  sandbox.bulkOptBlind = false;
  sandbox.bulkOptExcludeMinifig = false;

  // Photo colour map: display colours outside the old 16 now resolve.
  check("photo37: Dark Stone Grey maps to BrickLink 85", sandbox.bulkPartImg("3001", "Dark Stone Grey"), "https://img.bricklink.com/ItemImage/PN/85/3001.png");
  check("photo37: Olive Green maps to BrickLink 155", sandbox.bulkPartImg("3001", "Olive Green"), "https://img.bricklink.com/ItemImage/PN/155/3001.png");
  check("photo37: Brown is Reddish Brown 88", sandbox.bulkPartImg("3001", "Brown"), "https://img.bricklink.com/ItemImage/PN/88/3001.png");
  check("photo37: Trans-Yellow maps to 19", sandbox.bulkPartImg("3001", "Trans-Yellow"), "https://img.bricklink.com/ItemImage/PN/19/3001.png");
  check("photo37: Violet is Bright Violet 43", sandbox.bulkPartImg("3001", "Violet"), "https://img.bricklink.com/ItemImage/PN/43/3001.png");
  check("photo37: Pearl Gold is Warm Gold 115", sandbox.bulkPartImg("3001", "Pearl Gold"), "https://img.bricklink.com/ItemImage/PN/115/3001.png");
  check("photo37: Trans-Neon Green maps to 16", sandbox.bulkPartImg("3001", "Trans-Neon Green"), "https://img.bricklink.com/ItemImage/PN/16/3001.png");
  check("photo37: Medium Turquoise has no verified id", sandbox.bulkPartImg("3001", "Medium Turquoise"), "");
  check("photo37: Dark Grey still maps to the modern 85, not the old 10", sandbox.bulkPartImg("3001", "Dark Grey"), "https://img.bricklink.com/ItemImage/PN/85/3001.png");
  // A row stored with no img gets one at render time.
  const photoList = sandbox.createBulkList("Photo test");
  sandbox.findBulkList(photoList.id).parts.push({ part: "3001", name: "Brick 2 x 4", colour: "Olive Green", qty: 2, img: "" });
  const photoRow = sandbox.buildBulkRow(sandbox.findBulkList(photoList.id), sandbox.findBulkList(photoList.id).parts[0]);
  check("photo37: stored row without img renders one", photoRow.children[0].tagName, "IMG");
  check("photo37: rendered img is the Olive Green photo", photoRow.children[0].src, "https://img.bricklink.com/ItemImage/PN/155/3001.png");
  // The v3.36 regression path: a sampled Olive Green piece is filed
  // with its photo, not without one.
  sandbox.INVENTORIES["olive-1"] = { set: "olive-1 Test Olive", lots: 1, pieces: 1, items: [{ id: "x-3001-Olive_Green", qty: 1, dim: "2 × 4 studs", colour: "Olive Green", any: false, tier: 1, cat: "Bricks", img: "https://example.test/x.jpg", name: "Brick 2 x 4" }] };
  sandbox.sets.push({ key: "olive-1", set_num: "olive-1", set_name: "Test Olive", total_parts: 1, total_lots: 1 });
  sandbox.saveCounts("olive-1", { "x-3001-Olive_Green": 1 });
  const oliveList = sandbox.createBulkList("Olive sample test");
  sandbox.scanState.lastColour = "Black";
  sandbox.scanCanvas = makeTestCanvas(100, 100, () => [155, 154, 90]);
  sandbox.handleIdentified(oliveList.id, "3001", "Brick 2 x 4", 0.97, "data:image/jpeg;base64,o1", redBox);
  check("photo37: sampled Olive Green pre-selects", sandbox.scanColourSel.value, "Olive Green");
  check("photo37: sampled piece carries its photo", sandbox.findBulkList(oliveList.id).parts, [{ part: "3001", name: "Brick 2 x 4", colour: "Olive Green", qty: 1, img: "https://img.bricklink.com/ItemImage/PN/155/3001.png" }]);
  sandbox.scanCancelBtn.listeners.click[0]();
  sandbox.scanCanvas = null;
  sandbox.sets = sandbox.sets.filter((s) => s.key !== "olive-1");
  sandbox.saveLocalSets(sandbox.sets);
  delete sandbox.INVENTORIES["olive-1"];

  // Scan popup: bulk-only destination means no popup at all.
  const skipList = sandbox.createBulkList("Skip test");
  sandbox.scanState.lastColour = "Black";
  sandbox.handleIdentified(skipList.id, "99999", "No Such Part", 0.97, "data:image/jpeg;base64,sk1");
  sandbox.scanDoneBtn.listeners.click[0]();
  check("assign37: no set needs it, no popup", sandbox.scanAssignModal.hidden, true);
  check("assign37: no popup, back to scanning", sandbox.scanControlsEl.hidden, false);
  check("assign37: piece stays in the bulk list", sandbox.findBulkList(skipList.id).parts.length, 1);

  // Optimizer view: its own page, Back + X, phone back button.
  const hist37 = [];
  sandbox.window.history = { pushState(s) { hist37.push(["push", s]); }, back() { hist37.push(["back"]); }, replaceState(state, title, url) { replacedUrl = url; } };
  sandbox.openBulkList(optList.id);
  sandbox.openOptimizerView(optList.id);
  check("optview: opening sets the view", sandbox.optViewId, optList.id);
  check("optview: opening pushes a history entry", hist37.some((c) => c[0] === "push" && c[1] && c[1].bfopt === true), true);
  const optHead = sandbox.$("setView").children[0];
  check("optview: header row is first", optHead.className, "opt-view-head");
  check("optview: header has Back, title, X", [optHead.children[0].textContent, optHead.children[1].textContent, optHead.children[2].className], ["← Back", "Optimizer test", "opt-view-x"]);
  check("optview: optimizer renders inside the view", sandbox.$("setView").children.some((c) => c === sandbox.bulkOptWrap), true);
  check("optview: heading is Sets this bulk can build", sandbox.bulkOptWrap.children[0].textContent, "Sets this bulk can build");
  // X closes it and pops the entry.
  optHead.children[2].listeners.click[0]();
  check("optview: X clears the view", sandbox.optViewId, null);
  check("optview: X pops the history entry", hist37.some((c) => c[0] === "back"), true);
  check("optview: X returns to the bulk list", sandbox.$("setView").children.some((c) => c.className === "bulk-parts"), true);
  // Phone back button closes it without a second back().
  sandbox.openOptimizerView(optList.id);
  const optBacksBefore = hist37.filter((c) => c[0] === "back").length;
  sandbox._winListeners.popstate();
  check("optview: popstate closes the view", sandbox.optViewId, null);
  check("optview: popstate does not go back a second time", hist37.filter((c) => c[0] === "back").length, optBacksBefore);
  check("optview: popstate returns to the bulk list", sandbox.$("setView").children.some((c) => c.className === "bulk-parts"), true);
  // Back button in the header closes it too.
  sandbox.openOptimizerView(optList.id);
  sandbox.$("setView").children[0].children[0].listeners.click[0]();
  check("optview: Back closes the view", sandbox.optViewId, null);

  // Suggestion thumbnails + lightbox (suggestions come from the
  // v3.36 run's cache, so no invoke is needed here).
  sandbox.openOptimizerView(optList.id);
  await sandbox.findSuggestions(optList.id, false);
  const suggRows37 = sandbox.bulkSuggWrap.children.filter((c) => c.className.includes("sugg-row"));
  check("sugg37: two untracked suggestion rows", suggRows37.length, 2);
  check("sugg37: thumbnail is first in the row", suggRows37[0].children[0].tagName, "IMG");
  check("sugg37: thumbnails are the set pictures", suggRows37.map((r) => r.children[0].src), ["https://cdn.rebrickable.com/media/sets/99999-1.jpg", "https://cdn.rebrickable.com/media/sets/99998-1.jpg"]);
  suggRows37[0].children[0].listeners.click[0]({ stopPropagation() {} });
  check("sugg37: tap opens the lightbox", sandbox.suggLightboxEl.hidden, false);
  check("sugg37: lightbox shows the set picture", sandbox.suggLightboxImg.src, "https://cdn.rebrickable.com/media/sets/99999-1.jpg");
  check("sugg37: lightbox pushes a history entry", hist37.some((c) => c[0] === "push" && c[1] && c[1].bfsugg === true), true);
  const lbBacksBefore = hist37.filter((c) => c[0] === "back").length;
  sandbox.suggLightboxEl.children[0].listeners.click[0]();
  // v3.38: X only pops the history entry — the lightbox hides when
  // the popstate that follows arrives. Hiding on the click itself
  // blinded the popstate handler, which then closed the optimizer
  // view underneath and dumped the user back to the bulk list.
  check("sugg38: X pops the history entry, lightbox still open till popstate", [hist37.filter((c) => c[0] === "back").length, sandbox.suggLightboxEl.hidden], [lbBacksBefore + 1, false]);
  check("sugg38: optimizer view still open after X", sandbox.optViewId, optList.id);
  sandbox._winListeners.popstate();
  check("sugg38: popstate after X hides the lightbox", sandbox.suggLightboxEl.hidden, true);
  check("sugg38: popstate after X does not go back a second time", hist37.filter((c) => c[0] === "back").length, lbBacksBefore + 1);
  check("sugg38: optimizer view stays open after closing the lightbox", sandbox.optViewId, optList.id);
  suggRows37[0].children[0].listeners.click[0]({ stopPropagation() {} });
  const lbBacksBeforePop = hist37.filter((c) => c[0] === "back").length;
  sandbox._winListeners.popstate();
  check("sugg37: popstate closes the lightbox", sandbox.suggLightboxEl.hidden, true);
  check("sugg37: popstate does not go back a second time", hist37.filter((c) => c[0] === "back").length, lbBacksBeforePop);
  check("sugg37: popstate leaves the optimizer view open", sandbox.optViewId, optList.id);
  sandbox.closeOptimizerView();

  // Toggle highlight: off is plain (btn-quiet), on is filled.
  sandbox.openBulkList(optList.id);
  sandbox.runOptimizer(optList.id, "pieces");
  check("toggle37: blind starts off and plain", [sandbox.bulkOptBlindBtn.className.includes("on"), sandbox.bulkOptBlindBtn.className.includes("btn-quiet")], [false, true]);
  check("toggle37: minifig starts off and plain", [sandbox.bulkOptMinifigBtn.className.includes("on"), sandbox.bulkOptMinifigBtn.className.includes("btn-quiet")], [false, true]);
  sandbox.bulkOptBlindBtn.listeners.click[0]();
  check("toggle37: blind on is filled, not quiet", [sandbox.bulkOptBlindBtn.className.includes("on"), sandbox.bulkOptBlindBtn.className.includes("btn-quiet")], [true, false]);
  sandbox.bulkOptBlindBtn.listeners.click[0]();
  check("toggle37: blind off again is plain", [sandbox.bulkOptBlindBtn.className.includes("on"), sandbox.bulkOptBlindBtn.className.includes("btn-quiet")], [false, true]);
  sandbox.bulkOptMinifigBtn.listeners.click[0]();
  check("toggle37: minifig on is filled, not quiet", [sandbox.bulkOptMinifigBtn.className.includes("on"), sandbox.bulkOptMinifigBtn.className.includes("btn-quiet")], [true, false]);
  sandbox.bulkOptMinifigBtn.listeners.click[0]();
  check("toggle37: minifig off again is plain", [sandbox.bulkOptMinifigBtn.className.includes("on"), sandbox.bulkOptMinifigBtn.className.includes("btn-quiet")], [false, true]);

  // Price audit: an ok:true answer with no prices at all surfaces
  // the function's reason instead of a silent $0.00.
  sandbox.localStorage.removeItem("bf:prices");
  invokeHandler = async (name) => (name === "get-prices"
    ? { data: { ok: true, prices: [], unpriced: [{ key: "3001|11", reason: "BrickOwl error: BrickOwl answered 401 on /catalog/color_list" }] }, error: null }
    : { data: null, error: { message: "no handler" } });
  const priceBadKey = await sandbox.fetchSetPrices("10305-1", false);
  check("price37: all-unpriced returns the key error, no total", [priceBadKey.error, priceBadKey.totalUsd], ["brickowl_key", null]);
  check("price37: key error names the secret", sandbox.priceErrorText("brickowl_key").includes("BRICKOWL_API_KEY"), true);
  // A failed invoke that carries the function's error body no longer
  // reports "not deployed".
  invokeHandler = async (name) => (name === "get-prices"
    ? { data: null, error: { context: { error: "no_api_key" } } }
    : { data: null, error: { message: "no handler" } });
  const priceBodyErr = await sandbox.fetchSetPrices("10305-1", false);
  check("price37: error body code survives the invoke", priceBodyErr.error, "no_api_key");
  invokeHandler = async (name) => (name === "get-prices"
    ? { data: null, error: { message: "boom" } }
    : { data: null, error: { message: "no handler" } });
  const priceNoBody = await sandbox.fetchSetPrices("10305-1", false);
  check("price37: no body still reports not deployed", priceNoBody.error, "not_deployed");
  // Chunking: a set with more than 200 priceable lines is sent in
  // two invokes, not one failing call.
  const bigItems = [];
  for (let i = 0; i < 210; i++) {
    const design = String(90001 + i);
    bigItems.push({ id: "el-" + design + "-Black", qty: 1, dim: "1 × 1 studs", colour: "Black", any: false, tier: 1, cat: "Bricks", img: "", name: "Brick 1 x 1" });
  }
  sandbox.INVENTORIES["big-1"] = { set: "big-1 Test Big", lots: 210, pieces: 210, items: bigItems };
  sandbox.sets.push({ key: "big-1", set_num: "big-1", set_name: "Test Big", total_parts: 210, total_lots: 210 });
  const bigCounts = {};
  bigItems.forEach((it) => { bigCounts[it.id] = 1; });
  sandbox.saveCounts("big-1", bigCounts);
  let bigCalls = 0;
  let bigMaxItems = 0;
  invokeHandler = async (name, opts) => {
    if (name === "get-prices") {
      bigCalls++;
      bigMaxItems = Math.max(bigMaxItems, (opts.body.items || []).length);
      return { data: { ok: true, prices: (opts.body.items || []).map((it) => ({ key: it.key, usd: 0.1 })) }, error: null };
    }
    return { data: null, error: { message: "no handler" } };
  };
  sandbox.localStorage.removeItem("bf:prices");
  const priceBig = await sandbox.fetchSetPrices("big-1", false);
  check("price37: 210 lines price in two invokes", bigCalls, 2);
  check("price37: no invoke carries more than 200 items", bigMaxItems, 200);
  check("price37: big set totals $21.00", usd(priceBig.totalUsd), 21);
  check("price37: big set has no unpriced lots", priceBig.unpricedLots, 0);
  sandbox.sets = sandbox.sets.filter((s) => s.key !== "big-1");
  sandbox.saveLocalSets(sandbox.sets);
  delete sandbox.INVENTORIES["big-1"];

  // 0-part suggestions: product collections can't be built, so they
  // never appear — real sets rank above them.
  sandbox.localStorage.removeItem("bf:suggest");
  invokeHandler = async (name) => {
    if (name === "suggest-sets") {
      return { data: { ok: true, candidates: [
        { set_num: "5001133-1", name: "Monster Fighters Collection", year: 2012, num_parts: 0, set_img_url: "https://cdn.rebrickable.com/media/sets/5001133-1.jpg", lotsCovered: 2, missingUpper: 0 },
        { set_num: "99998-1", name: "Fake Set B", year: 2020, num_parts: 20, set_img_url: "https://cdn.rebrickable.com/media/sets/99998-1.jpg", lotsCovered: 2, missingUpper: 18 },
      ], queried: ["3001|Black"], partial: false, unmapped: [] }, error: null };
    }
    return { data: null, error: { message: "no handler" } };
  };
  sandbox.openOptimizerView(optList.id);
  await sandbox.findSuggestions(optList.id, false);
  const suggRows0 = sandbox.bulkSuggWrap.children.filter((c) => c.className.includes("sugg-row"));
  check("sugg037: 0-part collection is not shown", suggRows0.map((r) => r.children[1].children[0].textContent), ["Fake Set B (2020)"]);
  // And when every candidate is 0-part, the note says so.
  sandbox.localStorage.removeItem("bf:suggest");
  invokeHandler = async (name) => {
    if (name === "suggest-sets") {
      return { data: { ok: true, candidates: [
        { set_num: "5001133-1", name: "Monster Fighters Collection", year: 2012, num_parts: 0, set_img_url: "https://cdn.rebrickable.com/media/sets/5001133-1.jpg", lotsCovered: 2, missingUpper: 0 },
      ], queried: ["3001|Black"], partial: false, unmapped: [] }, error: null };
    }
    return { data: null, error: { message: "no handler" } };
  };
  await sandbox.findSuggestions(optList.id, false);
  const suggRowsNone = sandbox.bulkSuggWrap.children.filter((c) => c.className.includes("sugg-row"));
  check("sugg037: all 0-part shows no rows", suggRowsNone.length, 0);
  check("sugg037: all 0-part explains why", sandbox.bulkSuggWrap.children.some((c) => c.textContent && c.textContent.includes("no piece count")), true);
  sandbox.closeOptimizerView();
  // --- v3.38: budget filter, on-demand inventories, suggestion
  // auto-start, 30499 export.
  sandbox.localStorage.removeItem("bf:suggest");
  sandbox.localStorage.removeItem("bf:prices");
  sandbox.localStorage.removeItem("bf:optBudget");
  sandbox.bulkOptBudget = null;
  sandbox.bulkOptBlind = false;
  sandbox.bulkOptExcludeMinifig = false;

  // The 30499 line exports as 3684a through the full remaining-lines
  // path, not just the resolver.
  sandbox.INVENTORIES["map-1"] = { set: "map-1 Test Map", lots: 1, pieces: 1, items: [{ id: "4537923-30499-Bright_Yellowish_Green", qty: 1, dim: "2 × 2 × 3", colour: "Lime Green", any: false, tier: 1, cat: "Sloped Bricks", img: "", name: "Slope 75 2 x 2 x 3" }] };
  sandbox.sets.push({ key: "map-1", set_num: "map-1", set_name: "Test Map", total_parts: 1, total_lots: 1 });
  sandbox.setSelected(["map-1"]);
  check("map38: 30499 exports as 3684a in the wanted list", sandbox.remainingLines().items.map((l) => l.part), ["3684a"]);
  sandbox.sets = sandbox.sets.filter((s) => s.key !== "map-1");
  sandbox.saveLocalSets(sandbox.sets);
  delete sandbox.INVENTORIES["map-1"];

  // Budget split is pure: a set with no price is never a fit.
  const split38 = sandbox.budgetSplit([
    { setName: "Cheap", costUsd: 0.5 },
    { setName: "Dear", costUsd: 5 },
    { setName: "NoPrice", costUsd: null },
    { setName: "NoCost" },
  ], 1);
  check("budget38: split fits", split38.fits.map((r) => r.setName), ["Cheap"]);
  check("budget38: split over", split38.over.map((r) => r.setName), ["Dear"]);
  check("budget38: split unknown never fits", split38.unknown.map((r) => r.setName), ["NoPrice", "NoCost"]);
  check("budget38: a set at exactly the budget fits", sandbox.budgetSplit([{ setName: "Exact", costUsd: 1 }], 1).fits.length, 1);

  // Budget UI: price mode with a $1 max shows the two cheap sets
  // as rows and names the over-budget ones in a note, not as rows.
  invokeHandler = priceHandler;
  const priceRows38 = () => sandbox.bulkOptWrap.children[2].children.filter((c) => c.className.includes("bulk-opt-row")).map((r) => r.children[0].children[0].textContent);
  sandbox.openOptimizerView(optList.id);
  sandbox.runOptimizer(optList.id, "price");
  await sleep(50);
  check("budget38: no budget, all four sets are rows", priceRows38(), ["test-2", "Test Set 2 (2022)", "Test Ship (2021)", "Crystal Sweeper"]);
  check("budget38: budget input exists in price mode", !!sandbox.bulkOptBudgetInput && sandbox.bulkOptBudgetInput.className.includes("opt-budget-input"), true);
  sandbox.bulkOptBudgetInput.value = "1";
  sandbox.bulkOptBudgetInput.listeners.change[0]();
  await sleep(50);
  check("budget38: $1 budget keeps only the cheap sets as rows", priceRows38(), ["test-2", "Test Set 2 (2022)"]);
  const budgetNote38 = sandbox.bulkOptWrap.children[2].children.find((c) => c.className.includes("muted"));
  check("budget38: over-budget sets are named, not rows", budgetNote38 && budgetNote38.textContent.includes("Over $1.00:") && budgetNote38.textContent.includes("Test Ship"), true);
  check("budget38: unpriced sets are not named as fitting", !(budgetNote38 && budgetNote38.textContent.includes("No price yet")), true);
  check("budget38: budget persists on the device", sandbox.LS.get("bf:optBudget", null), 1);
  // The budget survives a re-rank: sort away and back.
  sandbox.runOptimizer(optList.id, "pieces");
  sandbox.runOptimizer(optList.id, "price");
  check("budget38: budget input still holds $1 after a re-rank", sandbox.bulkOptBudgetInput.value, "1");
  await sleep(50);
  check("budget38: rows still filtered after the re-rank", priceRows38(), ["test-2", "Test Set 2 (2022)"]);
  // No set fits $0.05: the note names the cheapest instead.
  sandbox.bulkOptBudgetInput.value = "0.05";
  sandbox.bulkOptBudgetInput.listeners.change[0]();
  await sleep(50);
  check("budget38: nothing fits $0.05, cheapest is named", sandbox.bulkOptWrap.children[2].children[0].textContent, "No tracked set fits $0.05 — the cheapest is test-2 at $0.10.");
  // Clear the budget again so the next open starts clean.
  sandbox.bulkOptBudgetInput.value = "";
  sandbox.bulkOptBudgetInput.listeners.change[0]();
  await sleep(50);
  check("budget38: cleared budget shows all rows again", priceRows38().length, 4);
  sandbox.closeOptimizerView();

  // Suggestions start on their own when the optimizer opens: no
  // button tap needed for the full-catalog check.
  sandbox.bulkSuggState = { listId: null, status: "idle", candidates: [], queried: [], partial: false, unmapped: [], error: "", remaining: [], cacheKey: null };
  invokeHandler = async (name, opts) => {
    if (name === "suggest-sets") {
      return { data: { ok: true, candidates: [
        { set_num: "99999-1", name: "Fake Set A", year: 2023, num_parts: 50, set_img_url: "https://cdn.rebrickable.com/media/sets/99999-1.jpg", lotsCovered: 3, missingUpper: 47 },
        { set_num: "99998-1", name: "Fake Set B", year: 2020, num_parts: 20, set_img_url: "https://cdn.rebrickable.com/media/sets/99998-1.jpg", lotsCovered: 2, missingUpper: 18 },
      ], queried: ["3001|Black"], partial: false, unmapped: [] }, error: null };
    }
    return { data: null, error: { message: "no handler" } };
  };
  sandbox.openOptimizerView(optList.id);
  await sleep(50);
  check("sugg38: opening the optimizer starts the catalog check on its own", sandbox.bulkSuggState.status, "done");
  check("sugg38: auto-started suggestions render rows", sandbox.bulkSuggWrap.children.filter((c) => c.className.includes("sugg-row")).length, 2);
  sandbox.closeOptimizerView();

  // A bulk list built from a set's parts (partial upload) ranks
  // that set — even when its inventory hadn't arrived yet.
  delete sandbox.INVENTORIES["10305-1"];
  const srcList38 = sandbox.createBulkList("From 10305-1");
  sandbox.addScannedPart(srcList38.id, "3001", "Brick 2 x 4", "Black");
  sandbox.addScannedPart(srcList38.id, "3001", "Brick 2 x 4", "Black");
  sandbox.addScannedPart(srcList38.id, "6141", "Tile 1 x 1", "White");
  sandbox.bulkOptSort = "pieces";
  sandbox.openOptimizerView(srcList38.id);
  const optRows38 = () => sandbox.bulkOptWrap.children[2].children.filter((c) => c.className.includes("bulk-opt-row")).map((r) => r.children[0].children[0].textContent);
  check("inv38: set with a missing inventory is not ranked yet", optRows38().includes("Test Set 2 (2022)"), false);
  check("inv38: the optimizer says the parts list is still loading", sandbox.bulkOptWrap.children.some((c) => c.textContent && c.textContent.includes("Still loading parts for Test Set 2")), true);
  await sleep(50);
  check("inv38: once the inventory lands, the partial set is ranked", optRows38().includes("Test Set 2 (2022)"), true);
  const srcRow38 = sandbox.bulkOptWrap.children[2].children.filter((c) => c.className.includes("bulk-opt-row")).find((r) => r.children[0].children[0].textContent === "Test Set 2 (2022)");
  check("inv38: partial upload shows 3 of 5 pieces, 2 lots", srcRow38.children[0].children[1].textContent, "3 of 5 pieces (60%) · 2 lots");
  sandbox.closeOptimizerView();

  // Tapping a saved set in the left list opens it — even when its
  // parts list hadn't arrived yet.
  delete sandbox.INVENTORIES["10305-1"];
  sandbox.renderSets();
  const row38 = sandbox.$("setList").children.find((li) => li.dataset && li.dataset.key === "10305-1");
  check("side38: the 10305-1 row exists in My sets", !!row38, true);
  row38.listeners.click[0]();
  check("side38: tapping the row selects the set", sandbox.selectedKeys, ["10305-1"]);
  check("side38: tapping shows Loading, not the empty state", sandbox.$("setView").children.some((c) => c.textContent && c.textContent.includes("Loading Test Set 2")), true);
  await sleep(50);
  check("side38: once the parts arrive the set renders", sandbox.$("emptyState").hidden, true);
  check("side38: the Loading note is gone", sandbox.$("setView").children.some((c) => c.textContent && c.textContent.includes("Loading")), false);

  // --- v3.39: suggestion paging + sort.
  sandbox.localStorage.removeItem("bf:suggest");
  sandbox.localStorage.removeItem("bf:suggSort");
  sandbox.bulkSuggSort = "bulk";
  sandbox.bulkOptBlind = false;
  sandbox.bulkOptExcludeMinifig = false;
  sandbox.bulkOptSort = "pieces";
  sandbox.bulkSuggState = { listId: null, status: "idle", candidates: [], queried: [], partial: false, unmapped: [], error: "", remaining: [], cacheKey: null, page: 1 };
  // 25 candidates: lots shared fall with i, so Most of bulk is i
  // ascending; missing falls with i too, so Fewest missing is i
  // descending; years are shuffled, so Newest is neither.
  const sugg39Cands = [];
  for (let i = 0; i < 25; i++) {
    sugg39Cands.push({
      set_num: "900" + (100 + i) + "-1", name: "Sugg " + i, year: 2010 + ((i * 7) % 15),
      num_parts: 200 - 7 * i, set_img_url: "https://cdn.rebrickable.com/media/sets/900" + (100 + i) + "-1.jpg",
      lotsCovered: 25 - i, missingUpper: 175 - 6 * i,
    });
  }
  let sugg39Calls = 0;
  invokeHandler = async (name) => {
    if (name === "suggest-sets") {
      sugg39Calls++;
      if (sugg39Calls === 1) {
        return { data: { ok: true, candidates: sugg39Cands, queried: ["3001|Black"], partial: true, unmapped: [] }, error: null };
      }
      return { data: { ok: true, candidates: [
        { set_num: "900125-1", name: "Sugg 25", year: 2025, num_parts: 40, set_img_url: "https://cdn.rebrickable.com/media/sets/900125-1.jpg", lotsCovered: 30, missingUpper: 10 },
      ], queried: ["3001|Black"], partial: false, unmapped: [] }, error: null };
    }
    return { data: null, error: { message: "no handler" } };
  };
  const suggRows39 = () => sandbox.bulkSuggWrap.children.filter((c) => c.className.includes("sugg-row")).map((r) => r.children[1].children[0].textContent);
  const pager39 = () => sandbox.bulkSuggWrap.children.find((c) => c.className && c.className.includes("sugg-pager"));
  const sortRow39 = () => sandbox.bulkSuggWrap.children.find((c) => c.className && c.className.includes("sugg-sort"));
  sandbox.openOptimizerView(optList.id);
  await sleep(50);
  check("sugg39: default sort is Most of bulk", sandbox.bulkSuggSort, "bulk");
  check("sugg39: sort row offers three sorts", sortRow39().children.map((b) => b.textContent), ["Most of bulk", "Fewest missing", "Newest"]);
  check("sugg39: active sort is filled, the others quiet", [sortRow39().children[0].className.includes("btn-quiet"), sortRow39().children[1].className.includes("btn-quiet")], [false, true]);
  check("sugg39: page 1 shows the 10 biggest sharers", suggRows39(), ["Sugg 0 (2010)", "Sugg 1 (2017)", "Sugg 2 (2024)", "Sugg 3 (2016)", "Sugg 4 (2023)", "Sugg 5 (2015)", "Sugg 6 (2022)", "Sugg 7 (2014)", "Sugg 8 (2021)", "Sugg 9 (2013)"]);
  check("sugg39: pager label page 1", pager39().children[1].textContent, "Page 1 of 3 · 1–10 of 25");
  check("sugg39: prev disabled on page 1", pager39().children[0].disabled, true);
  check("sugg39: next enabled on page 1", pager39().children[2].disabled, false);
  check("sugg39: no more 'Showing the top' line", sandbox.bulkSuggWrap.children.some((c) => c.textContent && c.textContent.includes("Showing the top")), false);
  pager39().children[2].listeners.click[0]();
  check("sugg39: page 2 rows", suggRows39(), ["Sugg 10 (2020)", "Sugg 11 (2012)", "Sugg 12 (2019)", "Sugg 13 (2011)", "Sugg 14 (2018)", "Sugg 15 (2010)", "Sugg 16 (2017)", "Sugg 17 (2024)", "Sugg 18 (2016)", "Sugg 19 (2023)"]);
  check("sugg39: pager label page 2", pager39().children[1].textContent, "Page 2 of 3 · 11–20 of 25");
  check("sugg39: prev enabled on page 2", pager39().children[0].disabled, false);
  check("sugg39: paging does not re-fetch", sugg39Calls, 1);
  pager39().children[2].listeners.click[0]();
  check("sugg39: page 3 shows the last 5", suggRows39(), ["Sugg 20 (2015)", "Sugg 21 (2022)", "Sugg 22 (2014)", "Sugg 23 (2021)", "Sugg 24 (2013)"]);
  check("sugg39: pager label page 3", pager39().children[1].textContent, "Page 3 of 3 · 21–25 of 25");
  check("sugg39: next disabled on last page", pager39().children[2].disabled, true);
  pager39().children[0].listeners.click[0]();
  check("sugg39: prev returns to page 2", suggRows39()[0], "Sugg 10 (2020)");
  sortRow39().children[1].listeners.click[0]();
  check("sugg39: Fewest missing sorts by missing, page 1", suggRows39(), ["Sugg 24 (2013)", "Sugg 23 (2021)", "Sugg 22 (2014)", "Sugg 21 (2022)", "Sugg 20 (2015)", "Sugg 19 (2023)", "Sugg 18 (2016)", "Sugg 17 (2024)", "Sugg 16 (2017)", "Sugg 15 (2010)"]);
  check("sugg39: sort change resets to page 1", pager39().children[1].textContent, "Page 1 of 3 · 1–10 of 25");
  check("sugg39: sort choice is saved on the device", sandbox.LS.get("bf:suggSort", null), "fewest");
  pager39().children[2].listeners.click[0]();
  check("sugg39: sort persists while paging", [sandbox.bulkSuggSort, suggRows39()[0]], ["fewest", "Sugg 14 (2018)"]);
  sortRow39().children[2].listeners.click[0]();
  check("sugg39: Newest puts the 2024 sets first", suggRows39(), ["Sugg 2 (2024)", "Sugg 17 (2024)", "Sugg 4 (2023)", "Sugg 19 (2023)", "Sugg 6 (2022)", "Sugg 21 (2022)", "Sugg 8 (2021)", "Sugg 23 (2021)", "Sugg 10 (2020)", "Sugg 12 (2019)"]);
  sortRow39().children[0].listeners.click[0]();
  check("sugg39: Most of bulk again starts with Sugg 0", suggRows39()[0], "Sugg 0 (2010)");
  // Merging a second batch ("Check more parts") resets to page 1
  // and the new top sharer leads.
  pager39().children[2].listeners.click[0]();
  pager39().children[2].listeners.click[0]();
  check("sugg39: back on page 3 before the merge", pager39().children[1].textContent, "Page 3 of 3 · 21–25 of 25");
  sandbox.bulkSuggState.remaining = [{ part: "3001", colour: "Black", qty: 1, bl_colour: 11 }];
  sandbox.bulkSuggState.partial = true;
  sandbox.renderSuggestionsInto(sandbox.bulkSuggWrap, optList);
  const moreBtn39 = sandbox.bulkSuggWrap.children.find((c) => c.textContent && c.textContent.indexOf("Check ") === 0);
  check("sugg39: Check more parts button sits alongside the pager", !!moreBtn39, true);
  moreBtn39.listeners.click[0]();
  await sleep(50);
  check("sugg39: second batch fetched once", sugg39Calls, 2);
  check("sugg39: merge resets to page 1", pager39().children[1].textContent, "Page 1 of 3 · 1–10 of 26");
  check("sugg39: new top sharer leads after the merge", suggRows39()[0], "Sugg 25 (2025)");
  // --- v3.40: optimizer apply popup — only the bulk pieces that
  // fit the tapped set, each with an Add button.
  sandbox.saveCounts("10294-1", { "300126-3001-Black": 4, "4211064-3747-Dark_Stone_Grey": 0, "4541538-30385-Transparent_Blue": 2 });
  sandbox.saveCounts("10305-1", fullCounts(fixtureInv10305));
  // Counts are read from localStorage by the popup, but finds are
  // credited through the in-memory map — reload it so a map an
  // earlier section loaded cannot shadow the saved counts.
  sandbox.remainingBySet["10294-1"] = sandbox.loadCounts("10294-1");
  sandbox.remainingBySet["10305-1"] = sandbox.loadCounts("10305-1");
  sandbox.bulkOptBlind = false;
  sandbox.bulkOptExcludeMinifig = false;
  // Test Ship: 3001 lot still needs 4 of 6, 3747 lot is fully found
  // (must not appear), 30385 lot still needs both.
  const applyList = sandbox.createBulkList("Apply test");
  for (let i = 0; i < 5; i++) sandbox.addScannedPart(applyList.id, "3001", "Brick 2 x 4", "Black");
  sandbox.addScannedPart(applyList.id, "30385", "Rock 1 x 1 Crystal 5 Point", "Trans-Blue");
  for (let i = 0; i < 2; i++) sandbox.addScannedPart(applyList.id, "6141", "Tile 1 x 1", "White");
  sandbox.addScannedPart(applyList.id, "99999", "No Such Part", "Black");
  const applyRows = () => sandbox.optApplyList.children.filter((c) => c.className.includes("opt-apply-row"));
  const applyRowText = () => applyRows().map((r) => [r.children[0].children[0].textContent, r.children[0].children[1].textContent]);
  const optRows40 = () => sandbox.bulkOptWrap.children[2].children.filter((c) => c.className.includes("bulk-opt-row"));
  const optRowText40 = (name) => { const r = optRows40().find((x) => x.children[0].children[0].textContent === name); return r ? r.children[0].children[1].textContent : null; };
  sandbox.openBulkList(applyList.id);
  sandbox.openOptimizerView(applyList.id);
  sandbox.runOptimizer(applyList.id, "pieces");
  const shipRow = optRows40().find((r) => r.children[0].children[0].textContent === "Test Ship (2021)");
  check("apply40: Test Ship row is ranked", !!shipRow, true);
  check("apply40: Test Ship covers 6 pieces, 2 lots", optRowText40("Test Ship (2021)"), "6 of 10 pieces (60%) · 2 lots");
  shipRow.listeners.click[0]();
  check("apply40: tap opens the popup, not the set view", [sandbox.optApplyModal.hidden, sandbox.optViewId], [false, applyList.id]);
  check("apply40: popup title is the set", sandbox.optApplyTitle.textContent, "Test Ship");
  check("apply40: popup pushes a history entry", hist37.some((c) => c[0] === "push" && c[1] && c[1].bfoptapply === true), true);
  check("apply40: only the lots the bulk can still feed", applyRowText(), [
    ["Brick 2 x 4 · Black", "4 of 4 from bulk"],
    ["Rock 1 x 1 Crystal 5 Point · Trans-Blue", "1 of 2 from bulk"],
  ]);
  // Escape closes it the same way as X: back() first, hidden on popstate.
  const escBacksBefore = hist37.filter((c) => c[0] === "back").length;
  sandbox.document.listeners.keydown[0]({ key: "Escape" });
  check("apply40: Escape pops the history entry, popup still open till popstate", [hist37.filter((c) => c[0] === "back").length, sandbox.optApplyModal.hidden], [escBacksBefore + 1, false]);
  sandbox._winListeners.popstate();
  check("apply40: popstate after Escape hides the popup", sandbox.optApplyModal.hidden, true);
  check("apply40: optimizer view stays open after Escape", sandbox.optViewId, applyList.id);
  // Reopen and Add the 3001 row: the set is credited 4, the bulk loses 4.
  optRows40().find((r) => r.children[0].children[0].textContent === "Test Ship (2021)").listeners.click[0]();
  applyRows()[0].children[1].listeners.click[0]();
  check("apply40: set credited 4 of the 3001 lot", JSON.parse(sandbox.localStorage.getItem("bf:counts:10294-1"))["300126-3001-Black"], 0);
  check("apply40: bulk keeps 1 black 2x4", sandbox.findBulkList(applyList.id).parts.find((p) => p.part === "3001").qty, 1);
  check("apply40: covered lot drops off the popup", applyRowText(), [
    ["Rock 1 x 1 Crystal 5 Point · Trans-Blue", "1 of 2 from bulk"],
  ]);
  check("apply40: popup stays open after Add", sandbox.optApplyModal.hidden, false);
  check("apply40: optimizer behind it re-ranks", optRowText40("Test Ship (2021)"), "2 of 10 pieces (20%) · 2 lots");
  // Add the crystal row: the bulk crystal is gone, the popup says
  // nothing fits now.
  applyRows()[0].children[1].listeners.click[0]();
  check("apply40: set credited 1 crystal", JSON.parse(sandbox.localStorage.getItem("bf:counts:10294-1"))["4541538-30385-Transparent_Blue"], 1);
  check("apply40: bulk crystal is gone", sandbox.findBulkList(applyList.id).parts.find((p) => p.part === "30385"), undefined);
  check("apply40: popup says nothing fits now", [sandbox.optApplyNote.hidden, sandbox.optApplyNote.textContent], [false, "No pieces from this bulk list fit Test Ship right now."]);
  check("apply40: optimizer shows 1 piece left to cover", optRowText40("Test Ship (2021)"), "1 of 10 pieces (10%) · 1 lots");
  // X only pops the history entry — the popup hides on popstate,
  // and the optimizer view stays open (v3.38 shape).
  const applyX = sandbox.optApplyModal.children[0].children[0].children.find((c) => c.className === "opt-view-x");
  const xBacksBefore = hist37.filter((c) => c[0] === "back").length;
  applyX.listeners.click[0]();
  check("apply40: X pops the history entry, popup still open till popstate", [hist37.filter((c) => c[0] === "back").length, sandbox.optApplyModal.hidden], [xBacksBefore + 1, false]);
  check("apply40: optimizer view still open after X", sandbox.optViewId, applyList.id);
  sandbox._winListeners.popstate();
  check("apply40: popstate after X hides the popup", sandbox.optApplyModal.hidden, true);
  check("apply40: popstate after X does not go back a second time", hist37.filter((c) => c[0] === "back").length, xBacksBefore + 1);
  check("apply40: optimizer view stays open after closing the popup", sandbox.optViewId, applyList.id);
  // Colour-doesn't-matter: a blue 2x4 covers a red need only when
  // it is on, and the blue pieces leave the bulk list.
  sandbox.INVENTORIES["red-1"] = { set: "red-1 Test Red", lots: 1, pieces: 2, items: [{ id: "x-3001-Red", qty: 2, dim: "2 × 4 studs", colour: "Red", any: false, tier: 1, cat: "Bricks", img: "https://example.test/x.jpg", name: "Brick 2 x 4" }] };
  sandbox.sets.push({ key: "red-1", set_num: "red-1", set_name: "Test Red", total_parts: 2, total_lots: 1 });
  sandbox.saveCounts("red-1", { "x-3001-Red": 2 });
  const blindList = sandbox.createBulkList("Blind apply test");
  sandbox.addScannedPart(blindList.id, "3001", "Brick 2 x 4", "Blue");
  sandbox.addScannedPart(blindList.id, "3001", "Brick 2 x 4", "Blue");
  sandbox.openOptApply(blindList.id, "red-1");
  check("apply40: blind off, blue does not fit a red need", [sandbox.optApplyList.children.length, sandbox.optApplyNote.hidden], [0, false]);
  sandbox.bulkOptBlind = true;
  sandbox.openOptApply(blindList.id, "red-1");
  check("apply40: blind on, blue covers the red need", applyRowText(), [["Brick 2 x 4 · Red", "2 of 2 from bulk"]]);
  applyRows()[0].children[1].listeners.click[0]();
  check("apply40: blind Add credits the red lot", JSON.parse(sandbox.localStorage.getItem("bf:counts:red-1"))["x-3001-Red"], 0);
  check("apply40: blind Add removes the blue pieces", sandbox.findBulkList(blindList.id).parts.length, 0);
  check("apply40: blind Add leaves the popup with nothing fitting", sandbox.optApplyNote.hidden, false);
  sandbox.bulkOptBlind = false;
  sandbox.closeOptApply(true);
  sandbox.sets = sandbox.sets.filter((s) => s.key !== "red-1");
  sandbox.saveLocalSets(sandbox.sets);
  delete sandbox.INVENTORIES["red-1"];
  // A set whose parts list never loaded still opens the popup with
  // the plain note instead of crashing.
  sandbox.sets.push({ key: "noinv-1", set_num: "noinv-1", set_name: "No Inv", total_parts: 0, total_lots: 0 });
  sandbox.openOptApply(applyList.id, "noinv-1");
  check("apply40: no inventory, popup says nothing fits", [sandbox.optApplyModal.hidden, sandbox.optApplyNote.hidden, sandbox.optApplyNote.textContent], [false, false, "No pieces from this bulk list fit No Inv right now."]);
  sandbox.closeOptApply(true);
  sandbox.sets = sandbox.sets.filter((s) => s.key !== "noinv-1");
  sandbox.saveLocalSets(sandbox.sets);
  sandbox.closeOptimizerView();

  // --- v3.41: Export list button after "Find optimal sets" ---
  const expList = sandbox.createBulkList("Export test");
  sandbox.addScannedPart(expList.id, "3001", "Brick 2 x 4", "Black");
  sandbox.addScannedPart(expList.id, "3001", "Brick 2 x 4", "Black");
  sandbox.addScannedPart(expList.id, "54200", "Slope 30 1 x 1 x 2/3", "Light Grey");
  check("export41: text lists part, colour, qty and name per lot", sandbox.bulkListExportText(expList), [
    "Bulk list: Export test",
    "3 pieces · 2 lots · exported " + sandbox.todayStr(),
    "3001 · Black ×2 — Brick 2 x 4",
    "54200 · Light Grey ×1 — Slope 30 1 x 1 x 2/3",
    "",
  ].join("\n"));
  sandbox.openBulkList(expList.id);
  const expRow = sandbox.$("setView").children.find((c) => c.className.includes("bulk-actions"));
  check("export41: Export list sits right after Find optimal sets", expRow.children.map((b) => b.textContent), ["📷 Add more", "Find optimal sets", "Export list", "Delete list", "← Back to sets"]);
  expRow.children[2].listeners.click[0]();
  check("export41: download fallback tells the user", sandbox.bulkExportStatusEl.textContent, "Export didn't work here — take a screenshot of the list instead.");

  invokeHandler = null;

  console.log(failures === 0 ? "\nALL PASS" : "\n" + failures + " FAILURES");
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("HARNESS ERROR", e); process.exit(2); });
