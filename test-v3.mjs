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
    { id: "4211064-3747-Dark_Stone_Grey", qty: 2, dim: "2 × 1 studs", colour: "Dark Grey", any: false, tier: 2, cat: "Sloped Bricks", img: "https://example.test/4211064.jpg", name: "Slope 45 2 x 1" },
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
    if (this.table === "set_parts") return Promise.resolve({ data: setPartsRows, error: null }).then(resolve, reject);
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

  // Seed the starter set (as the sidebar button does).
  await sandbox.addSeedSet();
  check("seed: sets has 8961-1", sandbox.sets.map((s) => s.key), ["8961-1"]);
  check("seed: 138 lots loaded", sandbox.items.length, 138);

  // v3.1 type merges: the dropdown is built from the real app code.
  sandbox.rebuildTypeSelect();
  check("types: v3.1 dropdown (12 cats)", sandbox.document.getElementById("typeSelect").children.map((o) => o.value), ["all", "Plates", "Miscellaneous", "Bricks", "Sloped Bricks", "Small pieces", "Technic Pins / Bushes", "Minifig / Accessories", "Technic Axles", "Wheels and Tyres", "Technic Beams", "Technic Bricks", "Windows and Doors"]);
  check("types: Minifig / Accessories never folds", sandbox.displayCat({ setKey: "8961-1", cat: "Minifig / Accessories" }), "Minifig / Accessories");
  check("types: 2-lot raw cat folds to Miscellaneous", sandbox.displayCat({ setKey: "8961-1", cat: "Tubes and Hoses" }), "Miscellaneous");
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
  check("rows: percent after one lot found", sandbox.setPercent(sandbox.findSet("8961-1")), "4%");
  sandbox.renderSets();
  const rows8961 = $("setList").children.filter((li) => li.children[0].children[1].textContent === "8961-1");
  check("rows: one row for 8961-1", rows8961.length, 1);
  const row8961 = rows8961[0];
  check("rows: name first", row8961.children[0].children[0].textContent, "Crystal Sweeper");
  check("rows: number second", row8961.children[0].children[1].textContent, "8961-1");
  check("rows: percent third", row8961.children[0].children[2].textContent, "4%");
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
  const banners = $("setView").children.filter((n) => n.className && n.className.indexOf("tier-banner") === 0).map((n) => n.textContent);
  check("tiers: one banner per tier across sets", banners, ["TIER 1 — MOST LIKELY IN BULK", "TIER 2 — MEDIUM — WORTH A DIG", "TIER 3 — LEAST LIKELY IN BULK"]);
  check("tiers: no per-set heading in the combined view", $("setView").children.some((n) => n.className === "set-heading"), false);
  const grids = $("setView").children.filter((n) => n.className === "card-grid");
  const gridSets = (g) => g.children.map((c) => (c.dataset.key || "").split("|")[0]);
  check("tiers: tier 2 grid holds both sets", gridSets(grids[1]).includes("8961-1") && gridSets(grids[1]).includes("10294-1"), true);
  // Single-set view is unchanged: three banners, no set tags.
  sandbox.setSelected(["8961-1"]);
  const singleBanners = $("setView").children.filter((n) => n.className && n.className.indexOf("tier-banner") === 0).map((n) => n.textContent);
  check("tiers: single set still shows all three tiers", singleBanners, ["TIER 1 — MOST LIKELY IN BULK", "TIER 2 — MEDIUM — WORTH A DIG", "TIER 3 — LEAST LIKELY IN BULK"]);
  check("tiers: single set cards carry no set tag", $("setView").children.filter((n) => n.className === "card-grid").some((g) => g.children.some((c) => c.children.some((d) => d.className === "set-tag"))), false);

  // v3.9 — the fold follows lots still left: 3+ open lots keeps a section.
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
  check("fold: two lots left in Plates folds", sandbox.displayCat(sandbox.items.find((it) => it.cat === "Plates" && sandbox.remOf(it) > 0)), "Miscellaneous");
  check("fold: Bricks fully open keeps its section", sandbox.displayCat(sandbox.items.find((it) => it.cat === "Bricks")), "Bricks");
  const typeVals = $("typeSelect").children.map((o) => o.value);
  check("dropdown: fully found categories get no entry", ["Small pieces", "Technic Axles", "Technic Bricks", "Technic Pins / Bushes"].some((c) => typeVals.includes(c)), false);
  check("dropdown: folded Wheels and Tyres gets no entry", typeVals.includes("Wheels and Tyres"), false);
  check("dropdown: Windows and Doors still listed", typeVals.includes("Windows and Doors"), true);
  check("dropdown: no type shows 0 left", $("typeSelect").children.map((o) => o.textContent).some((t) => t.indexOf(" 0 left") >= 0), false);
  // Live fold: finding one of the three Windows and Doors lots folds it.
  const doorLot = sandbox.items.find((it) => it.cat === "Windows and Doors" && sandbox.remOf(it) > 0);
  sandbox.changeRemaining(doorLot, -1);
  check("fold: live tap folds Windows and Doors", sandbox.displayCat(doorLot), "Miscellaneous");
  sandbox.rebuildTypeSelect(); // the stub DOM has no card, so updateCardUI returns before rebuilding
  check("dropdown: live tap drops Windows and Doors", $("typeSelect").children.map((o) => o.value).includes("Windows and Doors"), false);
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
  check("grid: 5 columns use minmax(0, 1fr)", css.includes("repeat(5, minmax(0, 1fr))"), true);
  check("grid: 3 columns use minmax(0, 1fr)", css.includes("repeat(3, minmax(0, 1fr))"), true);
  check("grid: 2 columns use minmax(0, 1fr)", css.includes("repeat(2, minmax(0, 1fr))"), true);
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
  check("photo: unknown colour has no fallback", fb('8961-1', 'Bricks', 'Magenta', 'x-1234-Magenta'), '');
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

  console.log(failures === 0 ? "\nALL PASS" : "\n" + failures + " FAILURES");
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("HARNESS ERROR", e); process.exit(2); });
