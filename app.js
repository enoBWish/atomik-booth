// ATOMIK photo booth -- prototype.
// Live view = the <video> (mirrored + CSS filter, cheap) with a transparent canvas on top for the
// helmet / alien / frame. The photo itself is composed once, at the camera's full resolution.

import { loadAssets, drawHelmet, drawAlien, drawJoint, drawFrame, FRAMES } from './art.js';
import { CONFIG } from './config.js';
import { submitEntry, flushOutbox, outboxCount, drawQR } from './delivery.js';

const $ = (id) => document.getElementById(id);
const video = $('cam'), fx = $('fx'), ctx = fx.getContext('2d');

const IDLE_RESET_MS = 60000;   // no touches for this long -> back to the attract screen
const MAX_FACES = 4;

const FILTERS = [
  { name: 'Clean',  css: 'none' },
  { name: 'Glow',   css: 'saturate(1.3) contrast(1.08) brightness(1.06)' },
  { name: 'Atomic', css: 'sepia(.35) hue-rotate(58deg) saturate(1.45) contrast(1.08)', vignette: true },   // emerald retro
  { name: 'Retro',  css: 'sepia(.45) saturate(1.25) contrast(1.06) brightness(1.02)', vignette: true },
  { name: 'Noir',   css: 'grayscale(1) contrast(1.25) brightness(1.04)', vignette: true },
];

// FAKE BACKGROUNDS: airbrushed paintings (tools/gen_backgrounds.py). Live, the person is cut out with
// Google's selfie segmenter in the worker (a few masks a second -- edges soften while moving); the photo
// gets its own fresh cut-out of the exact frame taken.
const BACKGROUNDS = [
  { name: 'None', src: null },        // (the real room -- no fake background)
  { name: 'Desert', src: 'assets/bg/desert.jpg' },
  { name: 'Space', src: 'assets/bg/space.jpg' },
  { name: 'Grid', src: 'assets/bg/grid.jpg' },
];
for (const b of BACKGROUNDS) if (b.src) { b.img = new Image(); b.img.src = b.src; }

const state = {
  screen: 'attract', frame: 1, filter: 0, bg: 0, helmet: true, alien: true,
  joint: false,   // (off by default -- check with ATOMIK compliance before turning it on at events)
  tracks: [], nextId: 1, busy: false, lastTouch: Date.now(), photo: null,
};

// ------------------------------------------------------------------ screens
function show(name) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('show', s.id === name);
  state.screen = name;
}
function status(msg) { const el = $('status'); el.textContent = msg || ''; el.classList.toggle('show', !!msg); }

// ------------------------------------------------------------------ camera + face tracking
// Face DETECTOR (box + eyes / nose / mouth / ears) -- far lighter than the 478-point face mesh, and
// that's all a helmet + an alien need. It runs in a background worker (det-worker.js) so the screen
// stays smooth; two looks per frame, each pre-shrunk by the browser (createImageBitmap):
//   near = the whole picture       far = a ZOOM x crop of the middle (where people stand), so faces a
//   few feet back are ZOOM x bigger to the model -> about ZOOM x the range.
const ZOOM = 2.0, ZOOM_UP = 0.35;   // ZOOM_UP: crop sits a bit above center (faces are in the upper half)
const DET_W = 320;                  // detector input width (the model shrinks to 128 px anyway)
// Fire HD 10: its GPU is SLOWER than the CPU for this tiny model, and copying a 1080p camera frame
// costs ~60 ms -- so CPU by default (?gpu=1 to compare) and a 720p camera (?cam=1080 for more).
const Q = new URLSearchParams(location.search);
const USE_GPU = Q.get('gpu') === '1';
const CAM_W = Q.get('cam') === '1080' ? 1920 : 1280, CAM_H = CAM_W === 1920 ? 1080 : 720;

async function startCamera() {
  if (video.srcObject) return;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false, video: { facingMode: 'user', width: { ideal: CAM_W }, height: { ideal: CAM_H } },
  });
  video.srcObject = stream;
  await video.play();
}

let worker = null, workerReady = false, workerBusy = false, frameId = 0, pending = null;
const tm = { near: 0, far: 0, cycle: 0 };
let dets = 0, rafs = 0, fpsAt = performance.now(), sentAt = 0;

function loadTracker() {
  if (worker) return workerReady ? Promise.resolve() : worker.readyP;
  status('Loading face magic…');
  worker = new Worker('det-worker.js', { type: 'module' });
  worker.readyP = new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'loaded') worker.postMessage({ type: 'init', gpu: USE_GPU });
      else if (m.type === 'ready') { workerReady = true; status(''); resolve(); }
      else if (m.type === 'error') { status('Face tracking failed: ' + m.message); reject(new Error(m.message)); }
      else if (m.type === 'det') onDetections(m);
      else if (m.type === 'seg') onSegment(m);
    };
    worker.onerror = (e) => { status('Face tracking failed: ' + (e.message || 'worker error')); reject(e); };
  });
  return worker.readyP;
}

// Hand the worker the next camera frame (two small pictures) -- only when it's free, so it never backs up.
async function sendFrame() {
  if (!workerReady || workerBusy || state.screen !== 'controls' || video.readyState < 2) return;
  workerBusy = true;
  const vw = video.videoWidth, vh = video.videoHeight, dh = Math.round(DET_W * vh / vw);
  const cw = vw / ZOOM, ch = vh / ZOOM, ox = (vw - cw) / 2, oy = (vh - ch) * ZOOM_UP;
  try {
    // (the looks take turns -- each one is ~30-80 ms on the Fire. With a fake background on, every other
    // turn is a person cut-out: near, cut-out, far, cut-out...)
    const opt = { resizeWidth: DET_W, resizeHeight: dh, resizeQuality: 'low' };
    const step = ++frameId % 4;
    if (state.bg > 0 && (step === 1 || step === 3)) {
      const sb = await createImageBitmap(video, { resizeWidth: SEG_W, resizeHeight: SEG_H, resizeQuality: 'medium' });
      loopSegId = frameId;
      worker.postMessage({ type: 'seg', id: frameId, bmp: sb, ts: performance.now() }, [sb]);
      return;
    }
    const isFar = state.bg > 0 ? step === 2 : step % 2 === 0;
    const bmp = isFar ? await createImageBitmap(video, Math.round(ox), Math.round(oy), Math.round(cw), Math.round(ch), opt)
                      : await createImageBitmap(video, opt);
    pending = { vw, vh, dh, cw, ox, oy, isFar };
    sentAt = performance.now();
    const msg = { type: 'frame', id: frameId, ts: sentAt, pixels: false };
    msg[isFar ? 'far' : 'near'] = bmp;
    worker.postMessage(msg, [bmp]);
  } catch (e) { console.warn(e); workerBusy = false; }
}

// ---- person cut-out
const SEG_W = 256, SEG_H = 144;
const maskCv = document.createElement('canvas'), maskCtx = maskCv.getContext('2d');
const maskSoft = document.createElement('canvas'), maskSoftCtx = maskSoft.getContext('2d');
let maskReady = false, loopSegId = 0, segSeq = 1e9;
const segWaiters = new Map();
function maskToCanvas(m, cv, cctx) {
  if (cv.width !== m.w || cv.height !== m.h) { cv.width = m.w; cv.height = m.h; }
  const id = cctx.createImageData(m.w, m.h), d = id.data;
  for (let i = 0, j = 0; i < m.alpha.length; i++, j += 4) { d[j] = d[j + 1] = d[j + 2] = 255; d[j + 3] = m.alpha[i]; }
  cctx.putImageData(id, 0, 0);
}
function onSegment(m) {
  if (segWaiters.has(m.id)) { segWaiters.get(m.id)(m); segWaiters.delete(m.id); }
  if (m.id === loopSegId) workerBusy = false;
  maskToCanvas(m, maskCv, maskCtx);
  // a slightly bigger, softened copy for drawing (feathered edges instead of stair-steps)
  if (maskSoft.width !== m.w * 2) { maskSoft.width = m.w * 2; maskSoft.height = m.h * 2; }
  maskSoftCtx.clearRect(0, 0, maskSoft.width, maskSoft.height);
  maskSoftCtx.filter = 'blur(2px)'; maskSoftCtx.drawImage(maskCv, 0, 0, maskSoft.width, maskSoft.height); maskSoftCtx.filter = 'none';
  maskReady = true;
}
function coverRect(W, H, iw, ih) { const s = Math.max(W / iw, H / ih); return [(W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s]; }

const bgcv = $('bgcv'), bgctx = bgcv.getContext('2d');
const personCv = document.createElement('canvas'), personCtx = personCv.getContext('2d');
function drawBgLive() {
  const bg = BACKGROUNDS[state.bg];
  const on = state.bg > 0 && maskReady && bg.img && bg.img.complete && state.screen === 'controls';
  bgcv.style.display = on ? 'block' : 'none';
  video.style.opacity = on ? '0' : '1';
  if (!on) return;
  const W = bgcv.clientWidth, H = bgcv.clientHeight;     // (1x, not retina -- this canvas redraws every frame)
  if (bgcv.width !== W || bgcv.height !== H) { bgcv.width = personCv.width = W; bgcv.height = personCv.height = H; }
  bgctx.drawImage(bg.img, ...coverRect(W, H, bg.img.width, bg.img.height));
  const r = coverRect(W, H, video.videoWidth, video.videoHeight);
  personCtx.globalCompositeOperation = 'copy';
  personCtx.save(); personCtx.translate(W, 0); personCtx.scale(-1, 1); personCtx.drawImage(video, ...r);
  personCtx.globalCompositeOperation = 'destination-in'; personCtx.drawImage(maskSoft, ...r); personCtx.restore();
  personCtx.globalCompositeOperation = 'source-over';
  bgctx.drawImage(personCv, 0, 0);
}

function onDetections(m) {
  workerBusy = false;
  const p = pending; if (!p) return;
  const now = performance.now();
  tm.near += m.msNear; tm.far += m.msFar; tm.cycle += now - sentAt; dets++;
  updateTracks(dedupe([
    ...(m.near || []).map((d) => measure(d, p.vw / DET_W, 0, 0, DET_W, p.dh)),
    ...(m.far || []).map((d) => measure(d, p.cw / DET_W, p.ox, p.oy, DET_W, p.dh)),
  ]), now);
}

// One detection -> face in camera pixels (unmirrored). k = camera px per detector px, (ox, oy) = where
// the detector's view starts in the camera picture.
function measure(det, k, ox, oy, iw, ih) {
  const bb = det.boundingBox, kp = det.keypoints || [];
  let roll = 0;
  if (kp.length >= 2) {
    let a = kp[0], b = kp[1];
    if (b.x < a.x) [a, b] = [b, a];
    roll = Math.atan2((b.y - a.y) * ih, (b.x - a.x) * iw);
  }
  const w = bb.width * k, h = bb.height * k;
  const cx = ox + (bb.originX + bb.width / 2) * k, cy = oy + (bb.originY + bb.height / 2) * k;
  const mouth = kp[3] ? { mx: ox + kp[3].x * iw * k, my: oy + kp[3].y * ih * k } : { mx: cx, my: cy + h * 0.28 };
  return { cx, cy: cy - h * 0.12, w: w * 1.05, h: h * 1.25, roll, ...mouth };
}

// Both looks see someone standing in the middle -- keep one copy (the bigger, closer view wins).
// Also drops a "face" sitting right under a real face's chin: that's a face printed on a shirt.
function dedupe(faces) {
  const out = [];
  for (const f of faces.sort((p, q) => q.w - p.w)) {
    // (one look per frame now, and the detector already merges its own overlaps -- so only near-identical
    // boxes are duplicates; two friends cheek to cheek must stay two people)
    const dup = out.some((o) => Math.hypot(o.cx - f.cx, o.cy - f.cy) < Math.max(o.w, f.w) * 0.35);
    // shirt print = a SMALLER face straight under a real one, within its body. A friend standing in
    // front / lower is closer to the camera, so their face is the same size or bigger -> kept.
    const onShirt = out.some((o) => Math.abs(f.cx - o.cx) < o.w * 0.7 && f.cy > o.cy + o.h * 0.9 && f.cy < o.cy + o.h * 3.5 && f.w < o.w * 0.9);
    if (!dup && !onShirt) out.push(f);
  }
  return out.slice(0, MAX_FACES);
}

// Keep the same "track" per person between detections (so the alien's climb and the smoothing don't jump).
// cx/cy/w/h/roll = where the face is; the d* copies glide toward it every screen frame (see glide()).
const KEYS = ['cx', 'cy', 'w', 'h', 'roll', 'mx', 'my'];
const CONFIRM_HITS = 3;   // a face must show up in 3 detections in a row before it gets a helmet (kills one-frame ghosts)
function updateTracks(faces, now) {
  // Pair faces to tracks closest-first across ALL pairs (not face by face), so two people standing
  // close never steal each other's helmet.
  const pairs = [];
  faces.forEach((f, fi) => state.tracks.forEach((t, ti) => {
    const d = Math.hypot(t.cx - f.cx, t.cy - f.cy);
    if (d < Math.max(f.w, t.w) * 1.1) pairs.push([d, fi, ti]);
  }));
  pairs.sort((p, q) => p[0] - q[0]);
  const fUsed = new Set(), tUsed = new Set();
  for (const [, fi, ti] of pairs) {
    if (fUsed.has(fi) || tUsed.has(ti)) continue;
    fUsed.add(fi); tUsed.add(ti);
    const t = state.tracks[ti], f = faces[fi];
    for (const k of KEYS) t[k] += (f[k] - t[k]) * 0.7;
    t.seen = now; t.hits++;
    if (t.hits === CONFIRM_HITS) t.born = now;   // (the alien starts climbing once it's real)
  }
  faces.forEach((f, fi) => {
    if (fUsed.has(fi) || state.tracks.length >= MAX_FACES + 2) return;
    const t = { ...f, id: state.nextId++, born: now, seen: now, hits: 1 };
    for (const k of KEYS) t['d' + k] = f[k];
    state.tracks.push(t);
  });
  state.tracks = state.tracks.filter((t) => now - t.seen < 700);   // (looks take turns -> allow a couple of misses)
}
function glide(dt) {
  const a = 1 - Math.pow(0.0001, dt / 1000);   // frame-rate independent ease (~90% of the way in ~250 ms)
  for (const t of state.tracks) for (const k of KEYS) {
    const dk = 'd' + k;
    if (t[dk] === undefined) t[dk] = t[k];
    t[dk] += (t[k] - t[dk]) * a;
  }
}

let lastFrameAt = performance.now();
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  sendFrame();
  glide(now - lastFrameAt); lastFrameAt = now;
  rafs++;
  drawLive(now);
  if (now - fpsAt > 1000) {
    const d = Math.max(dets, 1);
    $('fps').textContent = `${dets} det/s · ${rafs} draw/s · ${video.videoWidth}x${video.videoHeight} · ${state.tracks.length} faces · ms near ${(tm.near / d).toFixed(1)} far ${(tm.far / d).toFixed(1)} cycle ${(tm.cycle / d).toFixed(1)}`;
    dets = 0; rafs = 0; fpsAt = now; tm.near = tm.far = tm.cycle = 0;
  }
}

// ------------------------------------------------------------------ drawing
// Camera px -> output px. `cover` = the live screen crop; the photo uses the full frame (s=1).
function mapper(W, H, vw, vh, cover) {
  const s = cover ? Math.max(W / vw, H / vh) : W / vw;
  const ox = (W - vw * s) / 2, oy = (H - vh * s) / 2;
  return { s, x: (x) => W - (ox + x * s), y: (y) => oy + y * s };   // mirrored, like a selfie
}

function drawOverlays(c, W, H, map, now) {
  state.tracks.forEach((t, i) => {
    if ((t.hits || CONFIRM_HITS) < CONFIRM_HITS) return;
    const v = (k) => (t['d' + k] !== undefined ? t['d' + k] : t[k]);
    const X = map.x(v('cx')), Y = map.y(v('cy')), fw = v('w') * map.s, fh = v('h') * map.s, roll = -v('roll');
    // joint first, so the helmet glass sits over it; it points toward the middle (the alien takes the outside)
    if (state.joint && v('mx') !== undefined) drawJoint(c, map.x(v('mx')), map.y(v('my')), fw, roll, X < W / 2 ? 1 : -1, now);
    if (state.helmet) drawHelmet(c, X, Y, fw, fh, roll);
    // (the alien climbs the OUTSIDE shoulder -- toward the nearest screen edge -- so friends don't get crowded)
    if (state.alien) drawAlien(c, X, Y, fw, fh, roll, now - t.born, X < W / 2 ? -1 : 1);
  });
  // the frame is drawn once per size/style and reused (its glows are expensive to redraw every frame)
  const key = `${W}x${H}:${state.frame}`;
  if (frameCache.key !== key) {
    frameCache.key = key;
    frameCache.cv = document.createElement('canvas'); frameCache.cv.width = W; frameCache.cv.height = H;
    drawFrame(frameCache.cv.getContext('2d'), W, H, state.frame);
  }
  c.drawImage(frameCache.cv, 0, 0);
}
const frameCache = { key: '', cv: null };

function drawLive(now) {
  drawBgLive();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(fx.clientWidth * dpr), H = Math.round(fx.clientHeight * dpr);
  if (fx.width !== W || fx.height !== H) { fx.width = W; fx.height = H; }
  ctx.clearRect(0, 0, W, H);
  if (!video.videoWidth || (state.screen !== 'controls' && state.screen !== 'attract')) return;
  if (FILTERS[state.filter].vignette) drawVignette(ctx, W, H);
  drawOverlays(ctx, W, H, mapper(W, H, video.videoWidth, video.videoHeight, true), now);
}

function drawVignette(c, W, H) {
  const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.55)');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
}

// ------------------------------------------------------------------ capture
async function capture() {
  const vw = video.videoWidth, vh = video.videoHeight;
  const frame = document.createElement('canvas'); frame.width = vw; frame.height = vh;
  frame.getContext('2d').drawImage(video, 0, 0, vw, vh);              // freeze the exact frame first
  const bg = BACKGROUNDS[state.bg];
  let mask = null;
  if (state.bg > 0 && workerReady && bg.img) {
    const bmp = await createImageBitmap(frame, { resizeWidth: SEG_W, resizeHeight: SEG_H, resizeQuality: 'high' });
    const id = ++segSeq;
    mask = await Promise.race([
      new Promise((res) => { segWaiters.set(id, res); worker.postMessage({ type: 'seg', id, bmp, ts: performance.now() }, [bmp]); }),
      wait(2500).then(() => null),
    ]);
  }
  const out = document.createElement('canvas'); out.width = vw; out.height = vh;
  const c = out.getContext('2d');
  c.filter = FILTERS[state.filter].css;
  if (state.bg > 0 && bg.img && (mask || maskReady)) {
    c.drawImage(bg.img, ...coverRect(vw, vh, bg.img.width, bg.img.height));
    const mc = document.createElement('canvas'), mctx = mc.getContext('2d');
    if (mask) maskToCanvas(mask, mc, mctx); else { mc.width = maskCv.width; mc.height = maskCv.height; mctx.drawImage(maskCv, 0, 0); }
    const person = document.createElement('canvas'); person.width = vw; person.height = vh;
    const p = person.getContext('2d');
    p.translate(vw, 0); p.scale(-1, 1);
    p.drawImage(frame, 0, 0);
    p.globalCompositeOperation = 'destination-in';
    p.imageSmoothingQuality = 'high'; p.filter = 'blur(' + Math.max(1, vw / 700) + 'px)';
    p.drawImage(mc, 0, 0, vw, vh);
    c.drawImage(person, 0, 0);
  } else {
    c.save(); c.translate(vw, 0); c.scale(-1, 1); c.drawImage(frame, 0, 0); c.restore();
  }
  c.filter = 'none';
  if (FILTERS[state.filter].vignette) drawVignette(c, vw, vh);
  drawOverlays(c, vw, vh, mapper(vw, vh, vw, vh, false), performance.now() + 99999); // aliens fully perched
  return out.toDataURL('image/jpeg', 0.92);
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function countdownAndShoot() {
  if (state.busy) return; state.busy = true;
  $('controls').classList.remove('show');
  const cd = $('countdown');
  for (let n = 5; n >= 1; n--) { cd.innerHTML = `<span>${n}</span>`; await wait(1000); }
  cd.innerHTML = '';
  const flash = $('flash'); flash.classList.add('on');
  state.photo = await capture();
  await wait(60); flash.classList.remove('on');
  $('shot').src = state.photo; show('preview');
  state.busy = false;
}

// ------------------------------------------------------------------ reset between guests
function resetBooth() {
  clearInterval(doneTimer);
  state.photo = null; $('shot').removeAttribute('src'); $('infoShot').removeAttribute('src');
  $('infoForm').reset(); $('formErr').textContent = '';
  for (const id of ['fEmail', 'fPhone']) $(id).classList.remove('bad');
  for (const id of ['doneQR', 'policyQR']) { const cv = $(id); cv.width = cv.height = 0; }
  $('doneMsg').textContent = '';
  setControlsHidden(false);
  state.frame = 1; state.filter = 0; state.bg = 0; maskReady = false; state.helmet = true; state.alien = true; state.joint = false; state.tracks = [];
  renderChips(); applyFilter();
  show('attract');
}

// ------------------------------------------------------------------ UI wiring
function applyFilter() { video.style.filter = bgcv.style.filter = FILTERS[state.filter].css; }
function renderChips() {
  const mk = (host, list, cur, pick) => {
    host.innerHTML = '';
    list.forEach((name, i) => {
      const b = document.createElement('button'); b.className = 'chip' + (i === cur ? ' on' : ''); b.textContent = name;
      b.onclick = () => { pick(i); renderChips(); };
      host.appendChild(b);
    });
  };
  // (no 'None' -- every photo carries a frame, so every photo says ATOMIK)
  mk($('frames'), FRAMES.slice(1), state.frame - 1, (i) => (state.frame = i + 1));
  mk($('filters'), FILTERS.map((f) => f.name), state.filter, (i) => { state.filter = i; applyFilter(); });
  mk($('bgs'), BACKGROUNDS.map((b) => b.name), state.bg, (i) => { state.bg = i; maskReady = false; });
  $('tHelmet').classList.toggle('on', state.helmet);
  $('tAlien').classList.toggle('on', state.alien);
  $('tJoint').classList.toggle('on', state.joint);
}
$('tHelmet').onclick = () => { state.helmet = !state.helmet; renderChips(); };
$('tJoint').onclick = () => { state.joint = !state.joint; renderChips(); };
$('tAlien').onclick = () => { state.alien = !state.alien; for (const t of state.tracks) t.born = performance.now(); renderChips(); };

$('startBtn').onclick = async () => {
  show('age');
};
$('ageNo').onclick = async () => { show('underage'); await wait(3000); resetBooth(); };
$('ageYes').onclick = async () => {
  try { await startCamera(); await loadTracker(); }
  catch (e) { status('Camera problem: ' + (e.message || e)); console.error(e); return; }
  for (const t of state.tracks) t.born = performance.now();
  show('controls');
};
$('shutter').onclick = countdownAndShoot;
function setControlsHidden(h) {
  $('controls').classList.toggle('hidden', h);
  $('eyeBtn').textContent = h ? 'Show controls' : 'Hide controls';
}
$('eyeBtn').onclick = () => setControlsHidden(!$('controls').classList.contains('hidden'));
$('retake').onclick = () => show('controls');
$('keep').onclick = () => openInfo();

// ------------------------------------------------------------------ guest info + delivery
let delivery = 'email';
const policyLink = (label, url) => `<a href="#" data-policy="${label}" data-url="${url}">${label}</a>`;
function openInfo() {
  $('infoShot').src = state.photo;
  $('cEmailText').textContent = CONFIG.CONSENT_EMAIL;
  $('cSmsText').innerHTML = CONFIG.CONSENT_SMS.replace('View Terms & Privacy.',
    `View ${policyLink('Terms', CONFIG.TERMS_URL)} &amp; ${policyLink('Privacy', CONFIG.PRIVACY_URL)}.`);
  $('fPhone').placeholder = CONFIG.REQUIRE_PHONE ? 'Phone number' : 'Phone number (optional)';
  setDelivery('email');
  show('info');
}
function setDelivery(v) {
  delivery = v;
  for (const b of $('deliverSeg').children) b.classList.toggle('on', b.dataset.v === v);
}
$('deliverSeg').onclick = (e) => { const v = e.target.dataset && e.target.dataset.v; if (v) setDelivery(v); };

// Terms / Privacy: show a QR to read it on their own phone -- the kiosk never browses away
let policyFrom = 'info';
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[data-policy]');
  if (!a) return;
  e.preventDefault(); e.stopPropagation();
  $('policyTitle').textContent = a.dataset.policy;
  $('policyUrl').textContent = a.dataset.url;
  drawQR($('policyQR'), a.dataset.url, 420);
  policyFrom = state.screen; show('policy');
}, true);
$('policyClose').onclick = () => show(policyFrom);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function cleanPhone(p) { const d = p.replace(/\D/g, ''); return d.length === 11 && d[0] === '1' ? d.slice(1) : d; }
function validate() {
  const email = $('fEmail').value.trim(), phone = cleanPhone($('fPhone').value);
  const bad = [];
  $('fEmail').classList.toggle('bad', !EMAIL_RE.test(email)); if (!EMAIL_RE.test(email)) bad.push('a valid email');
  // phone: optional, unless they ticked the text-message box (no number = nothing to text)
  const needPhone = CONFIG.REQUIRE_PHONE || $('cSms').checked;
  const phoneOk = phone.length === 10 || (!needPhone && phone.length === 0);
  $('fPhone').classList.toggle('bad', !phoneOk);
  if (!phoneOk) bad.push($('cSms').checked && phone.length === 0 ? 'a phone number for the text messages' : 'a 10-digit phone number');
  $('formErr').textContent = bad.length ? 'Please enter ' + bad.join(' and ') + '.' : '';
  return bad.length ? null : { email, phone };
}
$('infoForm').onsubmit = async (e) => {
  e.preventDefault();
  const ok = validate(); if (!ok) return;
  document.activeElement && document.activeElement.blur();          // drop the on-screen keyboard
  show('sending');
  const entry = {
    ts: new Date().toISOString(), booth: CONFIG.BOOTH_ID, event: CONFIG.EVENT_NAME,
    name: $('fName').value.trim(), email: ok.email, phone: ok.phone, delivery,
    optInEmail: $('cEmail').checked, optInSms: $('cSms').checked,
    consentEmailText: CONFIG.CONSENT_EMAIL, consentSmsText: CONFIG.CONSENT_SMS,
    photo: state.photo,
  };
  const res = await submitEntry(entry);
  showDone(res, entry);
};
$('infoBack').onclick = () => resetBooth();

// ---- on-screen keyboard: in full screen it covers the bottom half and has no "hide" key, so:
//  Enter = next box (last box = done), a floating "Done typing" button, tap off the boxes to close it,
//  and room to scroll while it's up.
const FIELDS = ['fName', 'fEmail', 'fPhone'];
function hideKeyboard() { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }
FIELDS.forEach((id, i) => {
  $(id).addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (i < FIELDS.length - 1) $(FIELDS[i + 1]).focus(); else hideKeyboard();
  });
  $(id).addEventListener('focus', () => {
    $('kbDone').classList.add('show'); $('info').classList.add('typing');
    setTimeout(() => $(id).scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
  });
  $(id).addEventListener('blur', () => setTimeout(() => {
    if (!FIELDS.includes(document.activeElement && document.activeElement.id)) { $('kbDone').classList.remove('show'); $('info').classList.remove('typing'); }
  }, 50));
});
$('kbDone').addEventListener('pointerdown', (e) => { e.preventDefault(); hideKeyboard(); });
$('info').addEventListener('pointerdown', (e) => {
  if (!e.target.closest('input, button, label, a')) hideKeyboard();     // tap on empty space = close the keyboard
});
// keep the floating button just above the keyboard
if (window.visualViewport) {
  const place = () => { $('kbDone').style.bottom = Math.max(16, innerHeight - visualViewport.height - visualViewport.offsetTop + 16) + 'px'; };
  visualViewport.addEventListener('resize', place); visualViewport.addEventListener('scroll', place);
}

let doneTimer = null;
function showDone(res, entry) {
  const masked = entry.email.replace(/^(.).*(@.*)$/, '$1•••$2');
  $('doneQRWrap').style.display = res.sent ? '' : 'none';
  if (res.sent) drawQR($('doneQR'), res.viewUrl, 480);
  $('doneTitle').textContent = 'Out of this world.';
  $('doneMsg').textContent = res.sent
    ? (entry.delivery === 'email' ? `Sent to ${masked} — check your inbox.` : 'Your photo is ready.')
    : `We'll email it to ${masked} as soon as we're back online.`;
  show('done');
  let left = CONFIG.DONE_SECONDS;
  const tick = () => { $('doneTimer').textContent = `Next guest in ${left}s`; if (left-- <= 0) resetBooth(); };
  clearInterval(doneTimer); tick(); doneTimer = setInterval(tick, 1000);
}
$('doneBtn').onclick = () => resetBooth();

// idle reset + hidden fps toggle (triple-tap top-right corner)
let taps = [];
// FULL SCREEN: browsers only allow it from a real tap, and drop it on reload -- so any tap on the
// booth puts it (back) into full screen. (At events, Fully Kiosk Browser runs it with no bars at all.)
function goFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || document.webkitFullscreenElement) return;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req) { try { const p = req.call(el, { navigationUI: 'hide' }); p && p.catch && p.catch(() => {}); } catch {} }
}
document.addEventListener('pointerdown', (e) => {
  goFullscreen();
  state.lastTouch = Date.now();
  if (e.clientX > innerWidth * 0.9 && e.clientY < innerHeight * 0.1) {
    taps = taps.filter((t) => Date.now() - t < 800).concat(Date.now());
    if (taps.length >= 3) { $('fps').classList.toggle('show'); taps = []; }
  }
});
setInterval(() => {
  const limit = state.screen === 'info' ? IDLE_RESET_MS * 2 : IDLE_RESET_MS;
  if (state.screen !== 'attract' && state.screen !== 'done' && !state.busy && Date.now() - state.lastTouch > limit) resetBooth();
}, 2000);

loadAssets().then(() => { frameCache.key = ''; renderChips(); });
flushOutbox();
// OFFLINE CACHE (sw.js): after the first visit the whole booth -- art, fonts, face + cut-out models -- loads
// from the tablet itself, so a flaky venue connection can't break it. (Only guest uploads need internet.)
if ('serviceWorker' in navigator && location.hash !== '#demo') navigator.serviceWorker.register('sw.js').catch((e) => console.warn('offline cache', e));
renderChips(); applyFilter(); show('attract'); loop();

// #demo: no camera -- a painted "video" with two fake faces, for checking overlays on a PC.
if (location.hash === '#demo') {
  const fake = document.createElement('canvas'); fake.width = 1280; fake.height = 720;
  const g = fake.getContext('2d');
  g.fillStyle = '#3b4a5a'; g.fillRect(0, 0, 1280, 720);
  for (const [x, y] of [[430, 330], [860, 360]]) {
    g.fillStyle = '#2a3440'; g.beginPath(); g.ellipse(x, y + 330, 210, 170, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#d9a77f'; g.beginPath(); g.ellipse(x, y, 85, 110, 0, 0, Math.PI * 2); g.fill();
  }
  video.srcObject = fake.captureStream(30); video.play();
  const now = performance.now();
  state.tracks = [
    { cx: 1280 - 430, cy: 330, w: 170, h: 220, roll: 0.05, mx: 1280 - 430, my: 395, id: 1, born: now, seen: Infinity },
    { cx: 1280 - 860, cy: 360, w: 160, h: 205, roll: -0.08, mx: 1280 - 860, my: 420, id: 2, born: now, seen: Infinity },
  ];
  state.joint = true; show('controls');
  window.__shoot = async () => { state.photo = await capture(); $('shot').src = state.photo; show('preview'); };
}
