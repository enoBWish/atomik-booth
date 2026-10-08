// Sending a guest's photo + info to the Google Apps Script backend (backend/Code.gs).
// If the booth is offline (or the backend isn't set up yet) the entry waits in the tablet's own storage
// (IndexedDB "outbox") and goes out automatically once it can -- nobody's photo or sign-up gets lost.
import { CONFIG } from './config.js';

const DB = 'atomik-booth', STORE = 'outbox';
function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'qid', autoIncrement: true });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode), st = t.objectStore(STORE);
    const out = fn(st);
    t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
    t.onerror = () => rej(t.error);
  });
}
const queue = (entry) => tx('readwrite', (st) => st.add(entry));
const queued = () => tx('readonly', (st) => st.getAll());
const unqueue = (qid) => tx('readwrite', (st) => st.delete(qid));

async function post(entry) {
  // text/plain keeps it a "simple" request (no CORS preflight, which Apps Script can't answer)
  const r = await fetch(CONFIG.BACKEND_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                                              body: JSON.stringify({ ...entry, key: CONFIG.BOOTH_KEY }) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'backend refused');
  return j;
}

// -> { sent: true, id, viewUrl }  or  { sent: false, queued: true }
export async function submitEntry(entry) {
  if (CONFIG.BACKEND_URL && navigator.onLine) {
    try {
      const j = await Promise.race([post(entry), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 25000))]);
      return { sent: true, id: j.id, viewUrl: `${CONFIG.BACKEND_URL}?p=${encodeURIComponent(j.id)}` };
    } catch (e) { console.warn('send failed, queued', e); }
  }
  // (late = it could not be shown as a QR, so the backend emails it no matter which option they picked)
  await queue({ ...entry, late: true });
  return { sent: false, queued: true };
}

let flushing = false;
export async function flushOutbox() {
  if (flushing || !CONFIG.BACKEND_URL || !navigator.onLine) return 0;
  flushing = true; let n = 0;
  try {
    for (const e of await queued()) {
      try { await post(e); await unqueue(e.qid); n++; } catch { break; }    // stop at the first failure; try again later
    }
  } finally { flushing = false; }
  return n;
}
export async function outboxCount() { try { return (await queued()).length; } catch { return 0; } }
setInterval(flushOutbox, 30000);
window.addEventListener('online', () => flushOutbox());

// QR code (qrcode-generator, loaded in index.html) drawn crisp onto a canvas
export function drawQR(canvas, text, px = 360) {
  const qr = window.qrcode(0, 'M'); qr.addData(text); qr.make();
  const n = qr.getModuleCount(), quiet = 3, cell = Math.floor(px / (n + quiet * 2));
  const size = cell * (n + quiet * 2);
  canvas.width = canvas.height = size;
  const c = canvas.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, size, size); c.fillStyle = '#07090B';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (qr.isDark(r, k)) c.fillRect((k + quiet) * cell, (r + quiet) * cell, cell, cell);
}
