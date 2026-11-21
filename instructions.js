// Bulk Finder — instructions viewer (v3.28).
// Tap "Instructions" on a My sets row and the set's booklets open as
// one long scroll: every page rendered by pdf.js, booklets back to
// back, so scrolling flows from one booklet into the next. The scroll
// position is saved per set and restored on reopen. The X floats
// top-left the whole time. PDFs come through the get-instructions Edge
// Function (list + CORS proxy) because LEGO's CDN blocks direct browser
// fetches and framing. If anything in that chain fails, the viewer
// falls back to a link out to LEGO's own instructions page for the set.
//
// Loaded as a module script; exposes window.BulkFinderInstructions.
// The app may open the viewer before this module finishes loading —
// it leaves the request in window.__bfPendingInstr for us to pick up.

var PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
var PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
var MAX_RENDERED = 10; // canvases kept alive at once — bounds memory

var currentSet = null;
var currentName = '';
var booklets = []; // [{ name, size, pdf, numPages, aspect }]
var slots = []; // [{ booklet, page, el, canvas, rendered, rendering }]
var observer = null;
var pdfJsPromise = null;
var instrOpen = false;
var instrHistoryPushed = false;
var generation = 0;
var saveTimer = null;
var statusTimer = null;

function $(id) { return document.getElementById(id); }

function loadPdfJs() {
  if (pdfJsPromise) return pdfJsPromise;
  pdfJsPromise = new Promise(function (resolve, reject) {
    if (window.pdfjsLib) { resolve(window.pdfjsLib); return; }
    var s = document.createElement('script');
    s.src = PDFJS_URL;
    s.onload = function () {
      try {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        resolve(window.pdfjsLib);
      } catch (e) { reject(e); }
    };
    s.onerror = function () { reject(new Error('pdfjs_load_failed')); };
    document.head.appendChild(s);
  });
  return pdfJsPromise;
}

function setStatus(text) {
  var el = $('instrStatus');
  if (el) el.textContent = text;
}

function savePosition() {
  if (!currentSet) return;
  var c = $('instrPages');
  if (!c) return;
  try { localStorage.setItem(instrPosKey(currentSet), String(c.scrollTop)); } catch (e) {}
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(function () { saveTimer = null; savePosition(); }, 400);
}

// Which booklet/page is at the top of the view right now, for the
// status line next to the X.
function updateStatus() {
  if (!slots.length) return;
  var c = $('instrPages');
  if (!c) return;
  var y = c.scrollTop + c.clientHeight * 0.25;
  var cur = slots[0];
  for (var i = 0; i < slots.length; i++) {
    if (slots[i].el.offsetTop <= y) cur = slots[i];
    else break;
  }
  var b = booklets[cur.booklet];
  setStatus(currentName + ' — Booklet ' + (cur.booklet + 1) + ' of ' + booklets.length +
    ' · p. ' + cur.page + ' of ' + b.numPages);
}

function scheduleStatus() {
  if (statusTimer) return;
  statusTimer = setTimeout(function () { statusTimer = null; updateStatus(); }, 150);
}

function renderSlot(slot) {
  if (slot.rendered || slot.rendering || !slot.pdf) return;
  slot.rendering = true;
  var gen = generation;
  var cssWidth = slot.el.clientWidth || 800;
  slot.pdf.getPage(slot.page).then(function (page) {
    if (gen !== generation || !slot.el.isConnected) { slot.rendering = false; return; }
    var vp = page.getViewport({ scale: 1 });
    var scale = (cssWidth * 1.5) / vp.width;
    var viewport = page.getViewport({ scale: scale });
    var canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.className = 'instr-canvas';
    var ctx = canvas.getContext('2d');
    return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
      if (gen !== generation || !slot.el.isConnected) return;
      slot.el.innerHTML = '';
      slot.el.appendChild(canvas);
      slot.canvas = canvas;
      slot.rendered = true;
      slot.rendering = false;
      pruneRendered();
    });
  }).catch(function () {
    slot.rendering = false;
  });
}

function unrenderSlot(slot) {
  if (!slot.rendered) return;
  slot.el.innerHTML = '';
  slot.canvas = null;
  slot.rendered = false;
}

// Keep only the nearest MAX_RENDERED pages as canvases; the rest go
// back to empty placeholders (same height, so the scroll position
// never jumps).
function pruneRendered() {
  var c = $('instrPages');
  var rendered = slots.filter(function (s) { return s.rendered; });
  if (rendered.length <= MAX_RENDERED || !c) return;
  var y = c.scrollTop + c.clientHeight / 2;
  rendered.sort(function (a, b) {
    var da = Math.abs(a.el.offsetTop - y);
    var db = Math.abs(b.el.offsetTop - y);
    return db - da; // farthest first
  });
  while (rendered.length > MAX_RENDERED) unrenderSlot(rendered.shift());
}

function buildSlots() {
  var pages = $('instrPages');
  pages.innerHTML = '';
  slots = [];
  booklets.forEach(function (b, bi) {
    if (bi > 0) {
      var label = document.createElement('div');
      label.className = 'instr-booklet-label';
      label.textContent = 'Booklet ' + (bi + 1) + ' — ' + b.name + (b.size ? ' (' + b.size + ')' : '');
      pages.appendChild(label);
    }
    for (var p = 1; p <= b.numPages; p++) {
      var slot = document.createElement('div');
      slot.className = 'instr-page';
      slot.style.aspectRatio = b.aspect;
      pages.appendChild(slot);
      slots.push({ booklet: bi, page: p, el: slot, canvas: null, rendered: false, rendering: false, pdf: b.pdf });
    }
  });
  if (observer) observer.disconnect();
  observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      var slot = slots.find(function (s) { return s.el === entry.target; });
      if (!slot) return;
      if (entry.isIntersecting) renderSlot(slot);
      else if (slot.rendered) {
        // Only drop canvases well outside the view — the observer's
        // rootMargin already gives a wide buffer, so anything it
        // reports as out is genuinely far away.
        unrenderSlot(slot);
      }
    });
  }, { root: pages, rootMargin: '1200px 0px' });
  slots.forEach(function (s) { observer.observe(s.el); });
}

function showFallback(message) {
  var pages = $('instrPages');
  pages.innerHTML = '';
  slots = [];
  var box = document.createElement('div');
  box.className = 'instr-fallback';
  var p = document.createElement('p');
  p.textContent = message;
  var a = document.createElement('a');
  a.href = legoInstructionsUrl(currentSet);
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = 'Open the instructions on LEGO’s site';
  box.appendChild(p);
  box.appendChild(a);
  pages.appendChild(box);
  setStatus(currentName + ' — instructions on LEGO’s site');
}

function open(setNum, setName) {
  currentSet = setNum;
  currentName = setName || setNum;
  generation++;
  booklets = [];
  slots = [];
  instrOpen = true;
  var viewer = $('instrViewer');
  viewer.hidden = false;
  setStatus('Loading instructions…');
  $('instrPages').innerHTML = '';
  $('instrPages').scrollTop = 0;
  if (!instrHistoryPushed && window.history && history.pushState) {
    history.pushState({ bfInstr: true }, '');
    instrHistoryPushed = true;
  }

  // The list comes from the Edge Function (Brickset lookup, no key).
  // sb is the app's Supabase client; without it there is no list, so
  // fall straight back to the LEGO page link.
  var listPromise;
  if (typeof sb !== 'undefined' && sb && sb.functions) {
    listPromise = sb.functions.invoke('get-instructions', { body: { set: setNum } })
      .then(function (res) { return res.data; });
  } else {
    listPromise = Promise.resolve(null);
  }

  Promise.all([loadPdfJs(), listPromise]).then(function (results) {
    if (!instrOpen || currentSet !== setNum) return; // closed or superseded
    var pdfjsLib = results[0];
    var data = results[1];
    var list = data && data.ok && data.instructions ? data.instructions : [];
    if (!list.length) {
      showFallback('No instruction PDFs found for this set — LEGO still lists them on its own page:');
      return;
    }
    setStatus('Loading ' + list.length + (list.length === 1 ? ' booklet…' : ' booklets…'));
    // One getDocument per booklet; a booklet that fails to load is
    // skipped rather than blocking the rest.
    var loads = list.map(function (item) {
      return pdfjsLib.getDocument({
        url: instrPdfUrl(item.url),
        httpHeaders: { apikey: SUPABASE_KEY },
      }).promise.then(function (pdf) {
        return pdf.getPage(1).then(function (page1) {
          var vp = page1.getViewport({ scale: 1 });
          return { name: item.name, size: item.size, pdf: pdf, numPages: pdf.numPages, aspect: vp.width + ' / ' + vp.height };
        });
      }).catch(function () { return null; });
    });
    return Promise.all(loads).then(function (loaded) {
      if (!instrOpen || currentSet !== setNum) return;
      booklets = loaded.filter(function (b) { return b; });
      if (!booklets.length) {
        showFallback('The instruction PDFs wouldn’t load — LEGO still lists them on its own page:');
        return;
      }
      buildSlots();
      // Back where you left off: the placeholders hold the same heights
      // as the rendered pages, so the saved scroll position lands right.
      var saved = 0;
      try { saved = parseInt(localStorage.getItem(instrPosKey(setNum)) || '0', 10) || 0; } catch (e) {}
      requestAnimationFrame(function () {
        var c = $('instrPages');
        if (c && saved > 0) c.scrollTop = saved;
        updateStatus();
      });
      updateStatus();
    });
  }).catch(function () {
    if (!instrOpen || currentSet !== setNum) return;
    showFallback('The instructions wouldn’t load here — LEGO still lists them on its own page:');
  });
}

function close(fromPop) {
  if (!instrOpen) return;
  if (!fromPop && instrHistoryPushed) {
    // Let the Back press do the closing: the popstate handler below
    // clears the flag first, so this never goes back twice.
    history.back();
    return;
  }
  instrOpen = false;
  instrHistoryPushed = false;
  savePosition();
  // The app's build list may have edited the set's counts while the
  // viewer was open — let it refresh the main view behind us.
  if (typeof window.__bfOnInstrClose === 'function') { try { window.__bfOnInstrClose(); } catch (e) {} }
  generation++;
  if (observer) { observer.disconnect(); observer = null; }
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
  var viewer = $('instrViewer');
  if (viewer) viewer.hidden = true;
  var pages = $('instrPages');
  if (pages) pages.innerHTML = '';
  slots = [];
  booklets = [];
  currentSet = null;
}

window.addEventListener('popstate', function () {
  if (!instrOpen) return;
  instrHistoryPushed = false;
  close(true);
});

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && instrOpen) close(false);
});

(function bindViewer() {
  var pages = $('instrPages');
  if (pages) {
    pages.addEventListener('scroll', function () { scheduleSave(); scheduleStatus(); }, { passive: true });
  }
  var x = $('instrClose');
  if (x) x.addEventListener('click', function () { close(false); });
})();

window.BulkFinderInstructions = { open: open, close: close };

// The app may have opened the viewer before this module finished
// loading — it leaves the request here for us to pick up.
if (window.__bfPendingInstr) {
  var p = window.__bfPendingInstr;
  window.__bfPendingInstr = null;
  open(p.set, p.name);
}
