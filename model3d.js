// 3D part viewer (v3.15, orientation fixed v3.17) — tap a card photo and the part pops up as a
// live 3D model. Free, no key, no account: the part's real geometry
// comes from the LDraw parts library (gkjohnson mirror on jsDelivr),
// rendered with Three.js LDrawLoader. Drag to spin, scroll or pinch to
// zoom, Top / Front / Side / Underside buttons for the flat views —
// the underside is the angle no photo source has.
// Limits: the mirror is a Jan 2023 snapshot, so parts introduced after
// that have no model; prints and stickers don't show; transparent and
// chrome render as plain approximations. A part with no model shows
// its photo big in the same popup instead (v3.21) — same image as the
// card, just larger, with the Top/Front/Side buttons hidden.
import * as THREE from 'three';
import { LDrawLoader } from 'three/addons/loaders/LDrawLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

var LIB = 'https://cdn.jsdelivr.net/gh/gkjohnson/ldraw-parts-library@master/complete/ldraw/';
var MATERIALS_URL = 'https://cdn.jsdelivr.net/gh/gkjohnson/ldraw-parts-library@master/colors/ldcfgalt.ldr';

var container = null;
var statusEl = null;
var renderer = null, scene = null, camera = null, controls = null;
var loader = null, materialsReady = null;
var currentGroup = null, currentKey = null, pendingKey = null;
var frame = null; // { distance } — the part is centred on the origin
var cache = new Map();
var rafId = null, running = false;
var webglFailed = false;
var photoEl = null; // the big-photo fallback <img> inside #model3d (v3.21)

function status(msg) { if (statusEl) statusEl.textContent = msg; }

// The big-photo fallback (v3.21): when a part has no 3D model — or
// this device can't do WebGL — the popup shows the part's photo big
// instead of the "no model" text. Same image as the card, just larger.
// The Top/Front/Side buttons mean nothing for a photo, so they hide
// until a real model loads. Returns true when a photo was shown.
function showPhoto(imgUrl, fallbackUrl) {
  if (!container || !imgUrl) return false;
  clearPhoto();
  stopLoop(); // nothing to spin; saves battery
  if (renderer) renderer.domElement.style.display = 'none';
  var presets = document.getElementById('model3dPresets');
  if (presets) presets.style.display = 'none';
  photoEl = document.createElement('img');
  photoEl.className = 'model3d-photo';
  photoEl.alt = 'Part photo';
  photoEl.addEventListener('error', function () {
    // Primary photo is dead too (the card already fell back to
    // BrickLink for those) — try the BrickLink photo once, then give
    // up with the plain message.
    if (fallbackUrl && photoEl.src !== fallbackUrl) { photoEl.src = fallbackUrl; return; }
    clearPhoto();
    status('No 3D model for this part yet — the photo on the card is the reference.');
  });
  photoEl.src = imgUrl;
  container.appendChild(photoEl);
  status('No 3D model for this part yet — showing the photo instead.');
  return true;
}

function clearPhoto() {
  if (photoEl) { photoEl.remove(); photoEl = null; }
  if (renderer) renderer.domElement.style.display = 'block';
  var presets = document.getElementById('model3dPresets');
  if (presets) presets.style.display = '';
}

function ensureRenderer() {
  if (renderer) return true;
  if (webglFailed) return false;
  container = document.getElementById('model3d');
  statusEl = document.getElementById('model3dStatus');
  if (!container) return false;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (e) {
    webglFailed = true;
    status('3D is not available on this device — the photo on the card is the reference.');
    return false;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.touchAction = 'none';
  container.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xececec);
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  var dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(1, 2, 1.5);
  scene.add(dir);
  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.enablePan = false;
  controls.minDistance = 10;
  controls.maxDistance = 2000;
  ensureLoader();
  if (window.ResizeObserver) {
    new ResizeObserver(function () { resize(); }).observe(container);
  }
  window.addEventListener('resize', resize);
  // Preset view buttons (static markup in the lightbox).
  var btns = document.querySelectorAll('#lightbox [data-view]');
  btns.forEach(function (btn) {
    btn.addEventListener('click', function () { setView(btn.getAttribute('data-view')); });
  });
  return true;
}

function resize() {
  if (!renderer || !container || !camera) return;
  var w = container.clientWidth, h = container.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  render();
}

function render() { if (renderer && scene && camera) renderer.render(scene, camera); }

function loop() {
  if (!running) return;
  rafId = requestAnimationFrame(loop);
  controls.update();
  render();
}

function startLoop() {
  if (running) return;
  running = true;
  loop();
}

function stopLoop() {
  running = false;
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
}

function ensureMaterials() {
  if (!materialsReady) {
    // Must load the colour table first, or the loader errors with
    // "Unknown colour code" on the first part.
    materialsReady = loader.preloadMaterials(MATERIALS_URL).catch(function (e) {
      materialsReady = null;
      throw e;
    });
  }
  return materialsReady;
}

// The loader is just a parser — no WebGL needed — so the background
// preload can build it without opening the viewer.
function ensureLoader() {
  if (!loader) {
    loader = new LDrawLoader();
    loader.setPartsLibraryPath(LIB);
  }
  return loader;
}

// Minifig parts with no LDraw model of their own (v3.18): LDraw
// models the UNPRINTED base component, not every printed variant, so
// a Power Miners head / torso / legs has no .dat under its own
// number — verified 404 in the mirror AND in the official library
// (64881, 64882, 76382, 85107). Fall back to the standard component
// so the part still renders as the right shape in the lot's colour:
// a head reads as a head, a torso as a torso. The rock-monster body
// (64786) has no standard equivalent, so it stays "no model yet".
// Two more files (64727, 4736) exist in the repo but jsDelivr answers
// 403 for them, so they are fetched from GitHub raw instead.
// Printed minifig parts (v3.23): LDraw models a print as a separate
// file with a "p" suffix, and the p-number can't be derived from the
// element ID — it needs a lookup. Verified Nov 15 (full-library greps
// + mirror curls): the two 8961-1 torsos have printed files; the heads
// (64881/64882), the legs (85107) and the rock-monster body (64786)
// have none anywhere, so they keep the plain component / photo.
// Keyed by ELEMENT id (the first field of the item id), because the
// print belongs to the element, not the design number: both torso lots
// are design 76382, but Rex (4542545) wears 973pau and Brains
// (4542547) wears 973pas. The files are torso-only (no arms) — the
// with-arms shortcuts 76382pau/76382pas are 2025 files, not in the
// Jan 2023 mirror (404) — so the plain-torso shape mapping still
// applies; only the print changes.
var PRINTED_DAT = { '4542545': '973pau', '4542547': '973pas' };
var MINIFIG_DAT = { '64881': '3626', '64882': '3626', '76382': '973', '85107': '970' };
var RAW_FALLBACK = { '64727': 1, '4736': 1 };
var LIB_RAW = 'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/complete/ldraw/';
function datPartFor(partNum, element) {
  if (element && PRINTED_DAT[element]) return PRINTED_DAT[element];
  return MINIFIG_DAT[partNum] || partNum;
}
function fetchDat(partNum) {
  var url = (RAW_FALLBACK[partNum] ? LIB_RAW : LIB) + 'parts/' + partNum + '.dat';
  return fetch(url).then(function (resp) {
    if (resp.ok || RAW_FALLBACK[partNum]) return resp;
    // jsDelivr blocked it (403) but the file may exist in the repo.
    return fetch(LIB_RAW + 'parts/' + partNum + '.dat');
  });
}

// Fetch one part's geometry and parse it into the cache. Resolves
// with the group, or null when the part has no model. Rejects only on
// a network failure, or 'nodat' when the .dat file itself is missing.
function loadModel(partNum, colourCode, element) {
  var datPart = datPartFor(partNum, element);
  // The cache key is the resolved .dat file, not the design number:
  // a printed torso (973pau) and a plain one (973) are different
  // geometry and must never share an entry.
  var key = datPart + ':' + colourCode;
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  ensureLoader();
  return fetchDat(datPart).then(function (resp) {
    if (!resp.ok) throw new Error('nodat');
    return ensureMaterials();
  }).then(function () {
    return new Promise(function (resolve) {
      // A one-line LDraw model: this part, in this colour.
      var text = '1 ' + colourCode + ' 0 0 0 1 0 0 0 1 0 0 0 1 ' + datPart + '.dat';
      loader.parse(text, function (group) {
        if (!group || !group.children || !group.children.length) { resolve(null); return; }
        // LDraw's Y axis points DOWN — a brick's top is y=0, its bottom
        // y=24, studs stick out toward -Y (verified in 3001.dat) — and
        // the loader passes those coordinates straight through (its
        // getVector reads x,y,z as-is, no flip anywhere). So in
        // three.js, where Y points up, every part came out upside down:
        // studs down, hollow underside up. A half-turn about X maps
        // LDraw's axes onto three.js's exactly (a proper rotation, so
        // faces stay wound the right way), restoring each part to the
        // orientation it was authored in — inverted parts included,
        // whose studs point down by design.
        group.rotation.x = Math.PI;
        cache.set(key, group);
        resolve(group);
      });
    });
  });
}

// Centre the part on the origin so it spins in place, and put the
// camera far enough out to see the whole thing.
function frameGroup(group) {
  var box = new THREE.Box3().setFromObject(group);
  var center = box.getCenter(new THREE.Vector3());
  var sphere = box.getBoundingSphere(new THREE.Sphere());
  var radius = Math.max(sphere.radius, 1);
  group.position.sub(center);
  var distance = radius / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.35;
  frame = { distance: distance };
  controls.target.set(0, 0, 0);
  setView('iso');
}

function setView(name) {
  if (!frame || !camera) return;
  var d = frame.distance;
  var p;
  if (name === 'top') p = [0, d, 0.01];
  else if (name === 'under') p = [0, -d, 0.01];
  else if (name === 'front') p = [0, 0, d];
  else if (name === 'side') p = [d, 0, 0];
  else p = [d * 0.75, d * 0.6, d * 0.75]; // iso: three-quarter view
  camera.position.set(p[0], p[1], p[2]);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);
  controls.update();
  render();
}

function swapGroup(group, key) {
  clearPhoto();
  if (currentGroup) scene.remove(currentGroup);
  currentGroup = group;
  currentKey = key;
  scene.add(group);
  frameGroup(group);
  status('Drag to spin · scroll or pinch to zoom');
}

function show(partNum, colourCode, imgUrl, fallbackUrl, element) {
  if (!ensureRenderer()) {
    // No WebGL on this device — the photo is the whole viewer.
    if (imgUrl) showPhoto(imgUrl, fallbackUrl);
    return;
  }
  resize();
  startLoop();
  var key = datPartFor(partNum, element) + ':' + colourCode;
  pendingKey = key;
  clearPhoto(); // a photo from the last part must not linger under the new one
  if (currentKey === key && currentGroup) {
    frameGroup(currentGroup);
    status('Drag to spin · scroll or pinch to zoom');
    return;
  }
  if (cache.has(key)) { swapGroup(cache.get(key), key); return; }
  // Not ready yet: say why. If the background download is still
  // running, the model is on its way; otherwise it loads right now.
  status(preloadRunning
    ? 'Still downloading the 3D models — this one will pop in when it’s ready.'
    : 'Loading 3D model…');
  loadModel(partNum, colourCode, element).then(function (group) {
    if (pendingKey !== key) return; // a newer tap already won
    if (!group) {
      if (!showPhoto(imgUrl, fallbackUrl)) status('No 3D model for this part yet — the photo on the card is the reference.');
      return;
    }
    swapGroup(group, key);
  }).catch(function (err) {
    if (pendingKey !== key) return;
    if (err && err.message === 'nodat') {
      if (!showPhoto(imgUrl, fallbackUrl)) status('No 3D model for this part yet — the photo on the card is the reference.');
    } else if (!showPhoto(imgUrl, fallbackUrl)) {
      status('Couldn’t load the 3D library — check connection and try again.');
    }
  });
}

// ---------- background 3D preload (v3.16) ----------
// After a set is added, every part's geometry downloads in the
// background so tapping a photo is instant later. One job at a time,
// in display order; a part already in the cache or already queued is
// never fetched twice. The geometry is the public LDraw library —
// the same file for everyone — so it lives in this browser's cache,
// not in the user's account; the account holds the set and the
// counts, the CDN holds the geometry. Progress is reported through
// the callback so the app can show it (and remember what's done).
var preloadRunning = false;
var preloadQueue = []; // { part, colour, key, setKey }
var preloadQueued = {}; // key -> true (queued, done, or failed — checked once)
var preloadDone = 0, preloadTotal = 0;
var preloadCb = null;

function queuePreload(items, onProgress) {
  if (onProgress) preloadCb = onProgress;
  var added = 0;
  items.forEach(function (it) {
    var key = it.part + ':' + it.colour;
    // The queue key stays part:colour (it is also the ready-tracking
    // key the app stores). The geometry cache is keyed by the resolved
    // .dat file instead, so check that — a printed torso already
    // cached as 973pau must not re-queue as plain 76382.
    // Note: two lots with the same design + colour but different
    // elements (different prints) would share one queue entry; that
    // doesn't occur in 8961-1/8960-1/8962-1 (the two 76382 lots differ
    // in colour), so it is left as a known limit, not a bug.
    if (preloadQueued[key] || cache.has(datPartFor(it.part, it.element) + ':' + it.colour)) return;
    preloadQueued[key] = true;
    preloadQueue.push({ part: it.part, colour: it.colour, element: it.element || '', key: key, setKey: it.setKey || null });
    added++;
  });
  preloadTotal = preloadDone + preloadQueue.length;
  if (added && !preloadRunning) runPreload();
  else if (preloadCb) preloadCb(preloadDone, preloadTotal, preloadRunning, null, null);
  return added;
}

async function runPreload() {
  preloadRunning = true;
  while (preloadQueue.length) {
    var it = preloadQueue.shift();
    try { await loadModel(it.part, it.colour, it.element); } catch (e) { /* no model or no network: counted, not retried this session */ }
    preloadDone++;
    if (preloadCb) preloadCb(preloadDone, preloadTotal, true, it.key, it.setKey);
  }
  preloadRunning = false;
  if (preloadCb) preloadCb(preloadDone, preloadTotal, false, null, null);
}

function preloadState() {
  return { running: preloadRunning, done: preloadDone, total: preloadTotal };
}

function hide() {
  pendingKey = null;
  stopLoop();
  clearPhoto();
  if (currentGroup && scene) scene.remove(currentGroup);
  currentGroup = null;
  currentKey = null;
  frame = null;
}

window.BulkFinder3D = { show: show, hide: hide, queuePreload: queuePreload, preloadState: preloadState };

// Tell the app the 3D module is ready, so it can start the
// background download for the sets it already has.
if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
  window.dispatchEvent(new CustomEvent('bf3dready'));
}

// The app may have opened the viewer before this module finished
// loading — it leaves the request here for us to pick up.
if (window.__bfPending3D) {
  var p = window.__bfPending3D;
  window.__bfPending3D = null;
  show(p.part, p.colour, p.img, p.fallback, p.element);
}
