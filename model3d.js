// 3D part viewer (v3.15) — tap a card photo and the part pops up as a
// live 3D model. Free, no key, no account: the part's real geometry
// comes from the LDraw parts library (gkjohnson mirror on jsDelivr),
// rendered with Three.js LDrawLoader. Drag to spin, scroll or pinch to
// zoom, Top / Front / Side / Underside buttons for the flat views —
// the underside is the angle no photo source has.
// Limits: the mirror is a Jan 2023 snapshot, so parts introduced after
// that have no model; prints and stickers don't show; transparent and
// chrome render as plain approximations. A part with no model shows a
// plain message instead — the photo on the card stays the reference.
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

function status(msg) { if (statusEl) statusEl.textContent = msg; }

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
  loader = new LDrawLoader();
  loader.setPartsLibraryPath(LIB);
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
  if (currentGroup) scene.remove(currentGroup);
  currentGroup = group;
  currentKey = key;
  scene.add(group);
  frameGroup(group);
  status('Drag to spin · scroll or pinch to zoom');
}

function show(partNum, colourCode) {
  if (!ensureRenderer()) return;
  status('Loading 3D model…');
  resize();
  startLoop();
  var key = partNum + ':' + colourCode;
  pendingKey = key;
  if (currentKey === key && currentGroup) {
    frameGroup(currentGroup);
    status('Drag to spin · scroll or pinch to zoom');
    return;
  }
  if (cache.has(key)) { swapGroup(cache.get(key), key); return; }
  // The loader has no error callback on parse(), so check the part
  // file exists first — otherwise a missing part hangs on "Loading…".
  fetch(LIB + 'parts/' + partNum + '.dat').then(function (resp) {
    if (pendingKey !== key) return; // a newer tap already won
    if (!resp.ok) throw new Error('nodat');
    return ensureMaterials();
  }).then(function () {
    if (pendingKey !== key) return;
    // A one-line LDraw model: this part, in this colour.
    var text = '1 ' + colourCode + ' 0 0 0 1 0 0 0 1 0 0 0 1 ' + partNum + '.dat';
    loader.parse(text, function (group) {
      if (pendingKey !== key) return;
      if (!group || !group.children || !group.children.length) {
        status('No 3D model for this part yet — the photo on the card is the reference.');
        return;
      }
      cache.set(key, group);
      swapGroup(group, key);
    });
  }).catch(function (err) {
    if (pendingKey !== key) return;
    if (err && err.message === 'nodat') {
      status('No 3D model for this part yet — the photo on the card is the reference.');
    } else {
      status('Couldn’t load the 3D library — check connection and try again.');
    }
  });
}

function hide() {
  pendingKey = null;
  stopLoop();
  if (currentGroup && scene) scene.remove(currentGroup);
  currentGroup = null;
  currentKey = null;
  frame = null;
}

window.BulkFinder3D = { show: show, hide: hide };

// The app may have opened the viewer before this module finished
// loading — it leaves the request here for us to pick up.
if (window.__bfPending3D) {
  var p = window.__bfPending3D;
  window.__bfPending3D = null;
  show(p.part, p.colour);
}
