// Face detection off the main thread, so the screen stays smooth while it works.
// MediaPipe's loader calls importScripts(), which module workers don't have -- this stand-in fetches
// the script synchronously and runs it globally, which is what importScripts would have done.
if (typeof self.importScripts !== 'function' || (() => { try { self.importScripts(); return false; } catch { return true; } })()) {
  self.importScripts = (...urls) => {
    for (const url of urls) {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);
      xhr.send();
      (0, eval)(xhr.responseText);
    }
  };
}

// (bundled with the booth -- vendor/ -- so it runs with no internet; the offline cache keeps it on the tablet)
const BASE = new URL('vendor/mediapipe', self.location).href;
const MODELS = new URL('vendor/models/', self.location).href;
const { FaceDetector, ImageSegmenter, FilesetResolver } = await import(`${BASE}/vision_bundle.mjs`);
let near = null, far = null, seg = null, cv = null, cx = null;

const plain = (dets) => (dets || []).map((d) => ({
  boundingBox: { originX: d.boundingBox.originX, originY: d.boundingBox.originY, width: d.boundingBox.width, height: d.boundingBox.height },
  keypoints: (d.keypoints || []).map((k) => ({ x: k.x, y: k.y })),
}));

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      const files = await FilesetResolver.forVisionTasks(`${BASE}/wasm`);
      const opts = {
        baseOptions: { modelAssetPath: MODELS + 'blaze_face_short_range.tflite', delegate: m.gpu ? 'GPU' : 'CPU' },
        runningMode: 'VIDEO', minDetectionConfidence: 0.55,
      };
      near = await FaceDetector.createFromOptions(files, opts);
      far = await FaceDetector.createFromOptions(files, opts);
      // person cut-out for fake backgrounds (Google's selfie segmenter; the landscape model matches a 16:9 camera)
      const segOpts = (model) => ({
        baseOptions: { modelAssetPath: MODELS + model + '.tflite', delegate: 'CPU' },
        runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false,
      });
      try { seg = await ImageSegmenter.createFromOptions(files, segOpts('selfie_segmenter_landscape')); }
      catch { seg = await ImageSegmenter.createFromOptions(files, segOpts('selfie_segmenter')); }
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err && err.message || err) });
    }
  } else if (m.type === 'seg') {
    // person mask: confidence 0..1 -> alpha 0..255, sharpened a little so edges aren't mushy
    const t0 = performance.now();
    const res = seg.segmentForVideo(m.bmp, m.ts);
    const mk = res.confidenceMasks[0];
    const f = mk.getAsFloat32Array(), w = mk.width, h = mk.height;
    const a = new Uint8ClampedArray(w * h);
    for (let i = 0; i < f.length; i++) { const v = (f[i] - 0.3) / 0.4; a[i] = v <= 0 ? 0 : v >= 1 ? 255 : v * v * (3 - 2 * v) * 255; }
    res.close && res.close();
    m.bmp.close();
    self.postMessage({ type: 'seg', id: m.id, w, h, alpha: a, ms: performance.now() - t0 }, [a.buffer]);
  } else if (m.type === 'frame') {
    // Plain pixels (ImageData from a CPU-side canvas) instead of the bitmap: handing MediaPipe a bitmap
    // routes it through the GPU and back, which stalls badly on the Fire. (?pix=0 to compare)
    const toPixels = (bmp) => {
      if (!m.pixels) return bmp;
      if (!cv || cv.width !== bmp.width || cv.height !== bmp.height) { cv = new OffscreenCanvas(bmp.width, bmp.height); cx = cv.getContext('2d', { willReadFrequently: true }); }
      cx.drawImage(bmp, 0, 0);
      return cx.getImageData(0, 0, bmp.width, bmp.height);
    };
    const t0 = performance.now();
    const n = m.near ? near.detectForVideo(toPixels(m.near), m.ts).detections : null;
    const t1 = performance.now();
    const f = m.far ? far.detectForVideo(toPixels(m.far), m.ts).detections : null;
    const t2 = performance.now();
    if (m.near) m.near.close(); if (m.far) m.far.close();
    self.postMessage({ type: 'det', id: m.id, near: n ? plain(n) : null, far: f ? plain(f) : null, msNear: t1 - t0, msFar: t2 - t1 });
  }
};
self.postMessage({ type: 'loaded' });
