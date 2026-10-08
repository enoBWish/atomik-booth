// ATOMIK booth art -- retro-futuristic chrome + emerald, matching the brand's chrome logo.
// Every overlay is painted ONCE into a sprite canvas at high detail; each frame just scales it, which
// looks better and is far cheaper on the Fire tablet than redrawing every curve 30 times a second.

export const BRAND = { green: '#2FD45A', greenDeep: '#0B6B24', greenGlow: 'rgba(47,212,90,.75)', ink: '#07090B' };

const img = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
export const assets = { logo: null, emblem: null, word: null };
export async function loadAssets() {
  [assets.logo, assets.emblem, assets.word] = await Promise.all([
    img('assets/logo_chrome.png'), img('assets/emblem_chrome.png'), img('assets/word_chrome.png'),
  ]);
  if (document.fonts) {
    const faces = [['Montserrat', 'assets/fonts/Montserrat-Black.ttf', '900'], ['Montserrat', 'assets/fonts/Montserrat-ExtraBold.ttf', '800'],
                   ['Montserrat', 'assets/fonts/Montserrat-SemiBold.ttf', '600'], ['Montserrat', 'assets/fonts/Montserrat-Medium.ttf', '500']];
    await Promise.all(faces.map(([f, u, w]) => new FontFace(f, `url(${u})`, { weight: w }).load().then((ff) => document.fonts.add(ff)).catch(() => {})));
  }
  helmetSprite = makeHelmet(); alienSprites = makeAlien();
}

// ---------------------------------------------------------------- shared painting helpers
function sprite(w, h, paint) { const c = document.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d'), w, h); return c; }

// Polished chrome: a sky/horizon reflection band, like the logo's finish.
function chromeGrad(c, x0, y0, x1, y1) {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, '#fbfdff'); g.addColorStop(0.18, '#d9e0e6'); g.addColorStop(0.42, '#9aa5ae');
  g.addColorStop(0.5, '#3a4148'); g.addColorStop(0.56, '#7e8a94'); g.addColorStop(0.78, '#d3dbe2'); g.addColorStop(1, '#f4f7fa');
  return g;
}
function emeraldOrb(c, x, y, r, glow = true) {
  c.save();
  if (glow) { c.shadowColor = BRAND.greenGlow; c.shadowBlur = r * 1.6; }
  const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, '#d8ffe0'); g.addColorStop(0.18, '#5cf27f'); g.addColorStop(0.6, '#13a83a'); g.addColorStop(1, '#03390f');
  c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  c.restore();
  c.fillStyle = 'rgba(255,255,255,.85)'; c.beginPath(); c.ellipse(x - r * 0.35, y - r * 0.42, r * 0.28, r * 0.16, -0.6, 0, Math.PI * 2); c.fill();
}

// ---------------------------------------------------------------- AIRBRUSH METAL (Sorayama-style finish)
// Classic airbrushed chrome mirrors a blue sky on top, a dark horizon line, then warm desert below.
const SKY_CHROME = [[0, '#f4fbff'], [0.12, '#bfe0ff'], [0.32, '#5f8fd6'], [0.46, '#1d2b55'], [0.5, '#070a14'],
                    [0.54, '#5a3d26'], [0.66, '#c98a4a'], [0.84, '#f2cf98'], [1, '#fff6e6']];
const TEAL_METAL = [[0, '#e6fffb'], [0.14, '#8fe3da'], [0.36, '#2f9f98'], [0.5, '#0b3236'], [0.56, '#3b4a3c'],
                    [0.7, '#9b8a5e'], [0.86, '#3fa39b'], [1, '#bff3ec']];
function metal(c, x0, y0, x1, y1, stops = SKY_CHROME) {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  for (const [o, col] of stops) g.addColorStop(o, col);
  return g;
}
// airbrush "star glint": a soft glow with a thin 4-point cross
function glint(c, x, y, size, alpha = 1) {
  c.save(); c.globalAlpha = alpha; c.globalCompositeOperation = 'lighter';
  const g = c.createRadialGradient(x, y, 0, x, y, size * 0.5);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.beginPath(); c.arc(x, y, size * 0.5, 0, Math.PI * 2); c.fill();
  c.fillStyle = 'rgba(255,255,255,.9)';
  for (const [w, h] of [[size * 2.2, size * 0.07], [size * 0.07, size * 1.6]]) {
    c.beginPath(); c.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2); c.fill();
  }
  c.restore();
}
// glossy highlight blob (airbrushed, soft-edged white)
function sheen(c, x, y, rx, ry, rot, alpha) {
  c.save(); c.translate(x, y); c.rotate(rot); c.scale(1, ry / rx);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(255,255,255,${alpha})`); g.addColorStop(0.6, `rgba(255,255,255,${alpha * 0.35})`); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.beginPath(); c.arc(0, 0, rx, 0, Math.PI * 2); c.fill(); c.restore();
}

// ---------------------------------------------------------------- SPACE HELMET
// 50s pulp helmet in airbrushed chrome: glass dome, robot ear discs, heavy neck ring, emerald antenna.
// Sprite is 1024 x 1100; the glass dome is centered at HELMET.cx/cy with radius HELMET.r.
export const HELMET = { w: 1024, h: 1100, cx: 512, cy: 470, r: 400 };
let helmetSprite = null;
function makeHelmet() {
  const { w, h, cx, cy, r } = HELMET;
  return sprite(w, h, (c) => {
    // antenna (behind the dome)
    c.save(); c.lineCap = 'round';
    c.strokeStyle = 'rgba(5,8,14,.7)'; c.lineWidth = 22;
    c.beginPath(); c.moveTo(cx + r * 0.46, cy - r * 0.84); c.lineTo(cx + r * 0.66, cy - r * 1.1); c.stroke();
    c.strokeStyle = metal(c, cx + r * 0.5, 0, cx + r * 0.66, 0); c.lineWidth = 14; c.stroke(); c.restore();
    emeraldOrb(c, cx + r * 0.66, cy - r * 1.1, 30);
    glint(c, cx + r * 0.6, cy - r * 1.16, 60, 0.9);

    // glass: clear in the middle so the face reads; airbrushed blue-violet toward the rim
    const glass = c.createRadialGradient(cx - r * 0.15, cy - r * 0.2, r * 0.2, cx, cy, r);
    glass.addColorStop(0, 'rgba(200,225,255,.02)'); glass.addColorStop(0.7, 'rgba(150,175,255,.06)');
    glass.addColorStop(0.9, 'rgba(110,130,240,.24)'); glass.addColorStop(1, 'rgba(170,190,255,.6)');
    c.fillStyle = glass; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
    c.save(); c.beginPath(); c.arc(cx, cy, r - 2, 0, Math.PI * 2); c.clip();
    // warm desert bounce on the bottom of the glass + a faint horizon band (low, under the chin)
    const warm = c.createLinearGradient(0, cy + r * 0.45, 0, cy + r);
    warm.addColorStop(0, 'rgba(240,170,100,0)'); warm.addColorStop(1, 'rgba(240,170,100,.28)');
    c.fillStyle = warm; c.fillRect(cx - r, cy + r * 0.45, r * 2, r * 0.6);
    c.strokeStyle = 'rgba(15,20,45,.16)'; c.lineWidth = 26;
    c.beginPath(); c.ellipse(cx, cy + r * 0.62, r * 1.05, r * 0.2, 0, Math.PI * 1.02, Math.PI * 1.98, true); c.stroke();
    // airbrushed window reflections (big soft + crisp sliver), and a sky-blue sheen up top
    sheen(c, cx - r * 0.45, cy - r * 0.5, r * 0.32, r * 0.14, -0.75, 0.55);
    c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 14; c.lineCap = 'round';
    c.beginPath(); c.arc(cx, cy, r * 0.88, Math.PI * 1.12, Math.PI * 1.34); c.stroke();
    c.lineWidth = 7; c.beginPath(); c.arc(cx, cy, r * 0.88, Math.PI * 1.39, Math.PI * 1.45); c.stroke();
    c.strokeStyle = 'rgba(190,215,255,.35)'; c.lineWidth = 10; c.beginPath(); c.arc(cx, cy, r * 0.93, Math.PI * 1.6, Math.PI * 1.9); c.stroke();
    c.restore();
    // rim: thin bright edge + cool outer line
    c.strokeStyle = 'rgba(30,45,110,.55)'; c.lineWidth = 8; c.beginPath(); c.arc(cx, cy, r + 2, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = 'rgba(240,248,255,.9)'; c.lineWidth = 3; c.beginPath(); c.arc(cx, cy, r - 2, 0, Math.PI * 2); c.stroke();
    glint(c, cx - r * 0.62, cy - r * 0.62, 90);
    glint(c, cx + r * 0.83, cy + r * 0.3, 50, 0.7);

    // robot ear discs (chrome, concentric rings, emerald light, little spike)
    for (const sx of [-1, 1]) {
      const bx = cx + sx * r * 0.99, by = cy + r * 0.08;
      c.save(); c.translate(bx, by);
      c.strokeStyle = metal(c, 0, -150, 0, -60); c.lineWidth = 12; c.lineCap = 'round';
      c.beginPath(); c.moveTo(sx * 20, -60); c.lineTo(sx * 55, -150); c.stroke();
      c.fillStyle = 'rgba(5,8,14,.75)'; c.beginPath(); c.ellipse(0, 0, 66, 104, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = metal(c, 0, -100, 0, 100); c.beginPath(); c.ellipse(0, 0, 60, 98, 0, 0, Math.PI * 2); c.fill();
      for (const k of [0.74, 0.5]) {
        c.strokeStyle = 'rgba(8,12,24,.55)'; c.lineWidth = 4; c.beginPath(); c.ellipse(0, 0, 60 * k, 98 * k, 0, 0, Math.PI * 2); c.stroke();
      }
      c.restore();
      emeraldOrb(c, bx, by, 16);
      sheen(c, bx - 14, by - 46, 22, 10, -0.4, 0.8);
    }

    // heavy neck ring: airbrushed chrome torus
    const ry = cy + r * 0.95, rw = r * 0.66, rh = 78;
    c.fillStyle = 'rgba(5,8,14,.8)'; c.beginPath(); c.ellipse(cx, ry + 6, rw + 8, rh + 8, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = metal(c, cx, ry - rh, cx, ry + rh); c.beginPath(); c.ellipse(cx, ry, rw, rh, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = metal(c, cx, ry - rh * 0.5, cx, ry + rh * 0.1); c.beginPath(); c.ellipse(cx, ry - rh * 0.22, rw * 0.84, rh * 0.42, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(10,14,28,.55)'; c.beginPath(); c.ellipse(cx, ry - rh * 0.3, rw * 0.74, rh * 0.26, 0, Math.PI, Math.PI * 2); c.fill();
    sheen(c, cx - rw * 0.5, ry - rh * 0.45, rw * 0.28, 10, 0.08, 0.85);
    glint(c, cx + rw * 0.62, ry - rh * 0.3, 70);
    if (assets.emblem) {
      const ew = 118, eh = ew * assets.emblem.height / assets.emblem.width;
      c.save(); c.shadowColor = 'rgba(0,0,0,.65)'; c.shadowBlur = 10;
      c.drawImage(assets.emblem, cx - ew / 2, ry + rh * 0.12 - eh / 2, ew, eh); c.restore();
    }
  });
}

// Draw the helmet on a face. (X, Y) = face center on screen, fw/fh = face size, roll = head tilt.
export function drawHelmet(c, X, Y, fw, fh, roll) {
  if (!helmetSprite) return;
  const rad = Math.max(fw * 0.98, fh * 0.84);          // dome radius on screen
  const k = rad / HELMET.r;
  c.save(); c.translate(X, Y - fh * 0.06); c.rotate(roll);
  c.drawImage(helmetSprite, -HELMET.cx * k, -HELMET.cy * k, HELMET.w * k, HELMET.h * k);
  c.restore();
}

// ---------------------------------------------------------------- ALIEN
// A glossy teal-metal android alien in the airbrush style: tall cranium, big glassy emerald eyes held
// half-lidded (chill), a seam-line smirk, a chrome coil-spring neck, chrome shoulders + fingers.
// Two arm states: both hands grip the shoulder while it climbs, then the near hand throws a peace sign.
export const ALIEN = { w: 700, h: 980, footX: 350, footY: 900 };   // footY = the shoulder line it grips
let alienSprites = null;
const EDGE = 'rgba(4,10,14,.85)';

function paintAlienBody(c) {
  const { w } = ALIEN, x = w / 2;
  // shoulders / chest plate: chrome with a teal panel
  c.fillStyle = EDGE; c.beginPath(); c.moveTo(x - 150, 905); c.quadraticCurveTo(x - 160, 700, x - 60, 660);
  c.lineTo(x + 60, 660); c.quadraticCurveTo(x + 160, 700, x + 150, 905); c.closePath(); c.fill();
  c.fillStyle = metal(c, x, 660, x, 905); c.beginPath(); c.moveTo(x - 140, 900); c.quadraticCurveTo(x - 150, 708, x - 56, 670);
  c.lineTo(x + 56, 670); c.quadraticCurveTo(x + 150, 708, x + 140, 900); c.closePath(); c.fill();
  c.fillStyle = metal(c, x, 700, x, 900, TEAL_METAL); c.beginPath(); c.moveTo(x - 70, 900); c.lineTo(x - 52, 720); c.lineTo(x + 52, 720); c.lineTo(x + 70, 900); c.closePath(); c.fill();
  emeraldOrb(c, x, 780, 15); emeraldOrb(c, x - 34, 830, 9, false); emeraldOrb(c, x + 34, 830, 9, false);
  sheen(c, x - 95, 730, 40, 14, -0.5, 0.8); glint(c, x + 108, 715, 56, 0.8);

  // coil-spring neck (chrome rings stacked)
  for (let i = 0; i < 8; i++) {
    const yy = 660 - i * 17, rw = 52 - Math.sin((i / 7) * Math.PI) * 4;
    c.fillStyle = EDGE; c.beginPath(); c.ellipse(x, yy + 3, rw + 4, 13, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = metal(c, x, yy - 11, x, yy + 11); c.beginPath(); c.ellipse(x, yy, rw, 10, 0, 0, Math.PI * 2); c.fill();
  }

  // head: tall glossy teal cranium, narrow jaw
  const headPath = () => {
    c.beginPath(); c.moveTo(x, 545);
    c.bezierCurveTo(x + 95, 540, x + 210, 400, x + 215, 270);
    c.bezierCurveTo(x + 220, 110, x + 120, 30, x, 30);
    c.bezierCurveTo(x - 120, 30, x - 220, 110, x - 215, 270);
    c.bezierCurveTo(x - 210, 400, x - 95, 540, x, 545); c.closePath();
  };
  c.save(); c.lineWidth = 14; c.strokeStyle = EDGE; headPath(); c.stroke(); c.restore();
  c.fillStyle = metal(c, x, 30, x, 545, TEAL_METAL); headPath(); c.fill();
  c.save(); headPath(); c.clip();
  const shade = c.createRadialGradient(x - 60, 170, 40, x, 290, 300);
  shade.addColorStop(0, 'rgba(255,255,255,.18)'); shade.addColorStop(0.6, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,20,30,.45)');
  c.fillStyle = shade; c.fillRect(0, 0, w, 600);
  c.strokeStyle = 'rgba(190,230,255,.45)'; c.lineWidth = 18; c.beginPath(); c.arc(x, 290, 230, Math.PI * 1.08, Math.PI * 1.42); c.stroke();
  c.strokeStyle = 'rgba(4,30,32,.55)'; c.lineWidth = 4; c.beginPath(); c.moveTo(x, 40); c.quadraticCurveTo(x + 6, 150, x, 230); c.stroke();
  c.restore();
  sheen(c, x - 100, 120, 70, 30, -0.7, 0.9);
  glint(c, x - 122, 98, 100);

  // eyes: big glassy emerald domes, HALF-LIDDED by the metal brow plate (chill)
  for (const s of [-1, 1]) {
    c.save(); c.translate(x + s * 92, 335); c.rotate(s * 0.34);
    c.fillStyle = EDGE; c.beginPath(); c.ellipse(0, 0, 90, 50, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(0, 0, 82, 43, 0, 0, Math.PI * 2); c.closePath(); c.save(); c.clip();
    const eye = c.createRadialGradient(-22, -8, 4, 0, 6, 92);
    eye.addColorStop(0, '#b9ffcf'); eye.addColorStop(0.25, '#3fe070'); eye.addColorStop(0.65, '#0d7a2c'); eye.addColorStop(1, '#021a09');
    c.fillStyle = eye; c.fillRect(-90, -50, 180, 100);
    c.fillStyle = 'rgba(255,255,255,.85)'; c.beginPath(); c.ellipse(-30, 12, 18, 8, -0.2, 0, Math.PI * 2); c.fill();
    c.fillStyle = metal(c, 0, -50, 0, 8, TEAL_METAL);
    c.beginPath(); c.moveTo(-95, -55); c.lineTo(95, -55); c.lineTo(95, -4); c.quadraticCurveTo(0, 12, -95, -4); c.closePath(); c.fill();
    c.restore();
    c.strokeStyle = 'rgba(220,250,255,.75)'; c.lineWidth = 5; c.beginPath(); c.moveTo(-80, -3); c.quadraticCurveTo(0, 12, 80, -3); c.stroke();
    c.restore();
  }
  glint(c, x - 120, 352, 44, 0.85);
  // mouth: a thin seam line with a lazy smirk
  c.strokeStyle = 'rgba(3,22,24,.8)'; c.lineWidth = 7; c.lineCap = 'round';
  c.beginPath(); c.moveTo(x - 38, 478); c.quadraticCurveTo(x + 4, 492, x + 42, 468); c.stroke();
  c.strokeStyle = 'rgba(200,245,240,.5)'; c.lineWidth = 3; c.beginPath(); c.moveTo(x - 34, 486); c.quadraticCurveTo(x + 4, 499, x + 38, 477); c.stroke();
}

// a chrome tube along a quadratic path: dark edge, chrome body, a thin specular line
function chromeLimb(c, pts, width) {
  const [[x0, y0], [qx, qy], [x1, y1]] = pts;
  const path = () => { c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo(qx, qy, x1, y1); };
  c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
  c.strokeStyle = EDGE; c.lineWidth = width + 10; path(); c.stroke();
  c.strokeStyle = metal(c, Math.min(x0, x1) - width, 0, Math.max(x0, x1) + width, 0); c.lineWidth = width; path(); c.stroke();
  c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = Math.max(3, width * 0.16); c.translate(-width * 0.18, -width * 0.12); path(); c.stroke();
  c.restore();
}

function paintArm(c, side, peace) {
  const { w } = ALIEN, x = w / 2;
  const sx = x + side * 120, sy = 720;                          // shoulder joint
  if (!peace) {
    const hx = x + side * 210, hy = 900;
    chromeLimb(c, [[sx, sy], [x + side * 235, 770], [hx, hy - 30]], 34);
    for (const f of [-1, 0, 1]) chromeLimb(c, [[hx, hy - 36], [hx + f * 20, hy], [hx + f * 34, hy + 34]], 13);
  } else {
    const hx = x + side * 255, hy = 470;
    chromeLimb(c, [[sx, sy], [x + side * 300, 640], [hx, hy + 44]], 34);
    c.fillStyle = EDGE; c.beginPath(); c.ellipse(hx, hy + 30, 40, 46, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = metal(c, hx, hy - 10, hx, hy + 75); c.beginPath(); c.ellipse(hx, hy + 30, 34, 40, 0, 0, Math.PI * 2); c.fill();
    for (const f of [-1, 1]) chromeLimb(c, [[hx + f * 10, hy + 6], [hx + f * 26, hy - 50], [hx + f * 44, hy - 112]], 15);
    chromeLimb(c, [[hx - side * 18, hy + 42], [hx - side * 32, hy + 46], [hx - side * 42, hy + 54]], 12);
    glint(c, hx + 34, hy - 104, 40, 0.85);
  }
}

function makeAlien() {
  const make = (peace) => sprite(ALIEN.w, ALIEN.h, (c) => {
    paintArm(c, -1, false);                 // far arm always grips
    paintAlienBody(c);
    paintArm(c, 1, peace);                  // near arm: grip, or peace sign
  });
  return { climb: make(false), peace: make(true) };
}

// Draw the alien on a shoulder. side = +1 screen-right of the face, -1 screen-left. ageMs = since this face
// appeared (the climb animation); size follows the face.
export function drawAlien(c, X, Y, fw, fh, roll, ageMs, side) {
  if (!alienSprites) return;
  const k = (fh * 0.9) / ALIEN.h * 1.55;                 // alien height ~ 1.4x the face height
  const sx = X + side * fw * 1.2, sy = Y + fh * 1.05;   // the shoulder spot
  const t = Math.min(1, ageMs / 1700);
  const ease = 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);   // ease-out with a little settle
  const climb = (1 - ease) * ALIEN.h * k * 0.9;
  const sway = Math.sin(ageMs / 900) * 0.04;
  const spr = ageMs > 2300 ? alienSprites.peace : alienSprites.climb;
  c.save();
  c.translate(sx, sy + climb); c.rotate(roll * 0.4 + side * -0.06 + sway);
  if (side < 0) c.scale(-1, 1);                          // peace hand stays on the outside
  c.drawImage(spr, -ALIEN.footX * k, -ALIEN.footY * k, ALIEN.w * k, ALIEN.h * k);
  c.restore();
}

// ---------------------------------------------------------------- JOINT (Extras toggle, off by default)
// Airbrushed hand-rolled cone: cardboard crutch at the mouth, soft cream paper with spiral seams, a
// glowing ember + ash at the tip. Smoke is drawn live (a few soft puffs drifting up) so it moves.
export const JOINT = { w: 640, h: 220, mouthX: 30, midY: 110, tipX: 590 };
let jointSprite = null;
function makeJoint() {
  const { w, h, mouthX, midY, tipX } = JOINT;
  return sprite(w, h, (c) => {
    const len = tipX - mouthX;
    const r0 = 24, r1 = 46;                                   // radius at the mouth end / the lit end (a fat cone, not a cigarette)
    const top = (x) => midY - (r0 + (r1 - r0) * (x - mouthX) / len);
    const bot = (x) => midY + (r0 + (r1 - r0) * (x - mouthX) / len);
    const body = () => { c.beginPath(); c.moveTo(mouthX, top(mouthX)); c.lineTo(tipX, top(tipX)); c.lineTo(tipX, bot(tipX)); c.lineTo(mouthX, bot(mouthX)); c.closePath(); };
    // soft drop shadow
    c.save(); c.shadowColor = 'rgba(0,0,0,.45)'; c.shadowBlur = 14; c.shadowOffsetY = 8; c.fillStyle = '#000'; body(); c.fill(); c.restore();
    // paper: cylinder shading (highlight upper third, warm shadow underneath)
    const paper = c.createLinearGradient(0, midY - r1, 0, midY + r1);
    paper.addColorStop(0, '#d9d0bd'); paper.addColorStop(0.22, '#fffaf0'); paper.addColorStop(0.42, '#f3ead8');
    paper.addColorStop(0.75, '#cbbfa6'); paper.addColorStop(1, '#8f8370');
    c.fillStyle = paper; body(); c.fill();
    c.save(); body(); c.clip();
    // spiral seams + a faint glued edge
    c.strokeStyle = 'rgba(120,105,80,.28)'; c.lineWidth = 2;
    for (let x = mouthX + 90; x < tipX - 20; x += 46) { c.beginPath(); c.moveTo(x, top(x) - 2); c.quadraticCurveTo(x + 14, midY, x + 4, bot(x) + 2); c.stroke(); }
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 3; c.beginPath(); c.moveTo(mouthX + 70, top(mouthX + 70) + 7); c.lineTo(tipX - 40, top(tipX - 40) + 10); c.stroke();
    // crutch (cardboard filter) at the mouth end
    const cx1 = mouthX + 58;
    const card = c.createLinearGradient(0, midY - r0, 0, midY + r0 + 6);
    card.addColorStop(0, '#c9a46a'); card.addColorStop(0.3, '#f0d6a0'); card.addColorStop(1, '#8a6a3c');
    c.fillStyle = card; c.fillRect(mouthX, 0, cx1 - mouthX, h);
    c.strokeStyle = 'rgba(90,65,30,.4)'; c.lineWidth = 2;
    for (let x = mouthX + 10; x < cx1; x += 12) { c.beginPath(); c.moveTo(x, top(x)); c.lineTo(x + 6, bot(x)); c.stroke(); }
    // charred end: dark ring, then ash
    const burnX = tipX - 26;
    const char = c.createLinearGradient(burnX - 30, 0, tipX, 0);
    char.addColorStop(0, 'rgba(60,40,25,0)'); char.addColorStop(0.45, 'rgba(50,32,20,.85)'); char.addColorStop(1, '#2a1d14');
    c.fillStyle = char; c.fillRect(burnX - 30, 0, tipX - burnX + 30, h);
    c.restore();
    // ash cap + glowing ember
    c.save();
    const ash = c.createRadialGradient(tipX - 4, midY - 8, 2, tipX, midY, r1 + 4);
    ash.addColorStop(0, '#d8d4cf'); ash.addColorStop(0.6, '#8d8883'); ash.addColorStop(1, '#4b4744');
    c.fillStyle = ash; c.beginPath(); c.ellipse(tipX, midY, 12, r1 + 1, 0, 0, Math.PI * 2); c.fill();
    c.globalCompositeOperation = 'lighter';
    const ember = c.createRadialGradient(tipX + 2, midY + 6, 1, tipX + 2, midY + 6, r1 * 1.6);
    ember.addColorStop(0, 'rgba(255,240,170,1)'); ember.addColorStop(0.2, 'rgba(255,140,40,.95)');
    ember.addColorStop(0.5, 'rgba(230,60,10,.55)'); ember.addColorStop(1, 'rgba(200,30,0,0)');
    c.fillStyle = ember; c.beginPath(); c.arc(tipX + 2, midY + 6, r1 * 1.6, 0, Math.PI * 2); c.fill();
    c.restore();
    glint(c, tipX + 4, midY + 2, 46, 0.6);
  });
}

// (mx, my) = mouth center on screen, fw = face width, roll = head tilt, side = +1 points to screen-right.
export function drawJoint(c, mx, my, fw, roll, side, timeMs) {
  if (!jointSprite) jointSprite = makeJoint();
  const { w, h, mouthX, midY, tipX } = JOINT;
  const k = (fw * 0.5) / (tipX - mouthX);
  const ang = roll + 0.32;                                        // droops down from the lip
  c.save();
  c.translate(mx + side * fw * 0.14, my + fw * 0.03); c.scale(side, 1); c.rotate(ang);
  c.drawImage(jointSprite, -mouthX * k, -midY * k, w * k, h * k);
  // smoke: soft puffs rising off the ember, drifting and fading
  const tx = (tipX - mouthX) * k, ty = 0;
  c.rotate(-ang);                                                 // smoke rises straight up, not along the joint
  const ex = Math.cos(ang) * tx, ey = Math.sin(ang) * tx;
  for (let i = 0; i < 7; i++) {
    const t = ((timeMs / 2600) + i / 7) % 1;                      // each puff's life 0..1
    const px = ex + Math.sin(t * 5 + i) * fw * 0.06 * t - fw * 0.03 * t;
    const py = ey - t * fw * 0.75;
    const pr = fw * (0.04 + t * 0.13);
    const g = c.createRadialGradient(px, py, 0, px, py, pr);
    const a = 0.32 * Math.sin(t * Math.PI);
    g.addColorStop(0, `rgba(235,238,240,${a})`); g.addColorStop(1, 'rgba(235,238,240,0)');
    c.fillStyle = g; c.beginPath(); c.arc(px, py, pr, 0, Math.PI * 2); c.fill();
  }
  c.restore();
}

// ---------------------------------------------------------------- FRAMES
export const FRAMES = ['None', 'Chrome', 'Orbit', 'Atomic Age'];

function drawImageFit(c, im, cx, cy, maxW, maxH) {
  if (!im) return;
  const k = Math.min(maxW / im.width, maxH / im.height);
  c.drawImage(im, cx - im.width * k / 2, cy - im.height * k / 2, im.width * k, im.height * k);
}
function chromeRect(c, x, y, w, h, lw) {
  c.save(); c.lineWidth = lw; c.strokeStyle = chromeGrad(c, 0, y, 0, y + h); c.strokeRect(x, y, w, h); c.restore();
}
function starburst(c, x, y, r, points, fill) {
  c.save(); c.translate(x, y); c.fillStyle = fill; c.beginPath();
  for (let i = 0; i < points * 2; i++) { const a = (i * Math.PI) / points, rr = i % 2 ? r * 0.18 : r; c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  c.closePath(); c.fill(); c.restore();
}

export function drawFrame(c, W, H, which) {
  const m = Math.min(W, H);
  if (which === 1) {                       // CHROME: black bezel, chrome bevel lines, emerald inner glow, logo plate
    const b = m * 0.045;
    c.save(); c.fillStyle = BRAND.ink;
    c.fillRect(0, 0, W, b); c.fillRect(0, H - b * 2.4, W, b * 2.4); c.fillRect(0, 0, b, H); c.fillRect(W - b, 0, b, H); c.restore();
    chromeRect(c, b * 0.35, b * 0.35, W - b * 0.7, H - b * 0.7, b * 0.16);
    c.save(); c.shadowColor = BRAND.greenGlow; c.shadowBlur = b * 0.8; c.strokeStyle = BRAND.green; c.lineWidth = b * 0.07;
    c.strokeRect(b, b, W - b * 2, H - b * 3.4); c.restore();
    drawImageFit(c, assets.word, W / 2, H - b * 1.2, W * 0.32, b * 1.55);
    drawImageFit(c, assets.emblem, b * 2.2, H - b * 1.2, b * 2.2, b * 1.9);
    drawImageFit(c, assets.emblem, W - b * 2.2, H - b * 1.2, b * 2.2, b * 1.9);
  } else if (which === 2) {                // ORBIT: chrome electron orbits sweeping across the corners
    c.save();
    const orbit = (cx, cy, rx, ry, rot) => {
      c.save(); c.translate(cx, cy); c.rotate(rot);
      c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = m * 0.03; c.beginPath(); c.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); c.stroke();
      c.strokeStyle = chromeGrad(c, 0, -ry, 0, ry); c.lineWidth = m * 0.018; c.stroke();
      c.restore();
    };
    orbit(0, 0, m * 0.42, m * 0.16, 0.6);
    orbit(W, H, m * 0.5, m * 0.18, 0.6);
    orbit(W, 0, m * 0.36, m * 0.13, -0.65);
    c.restore();
    emeraldOrb(c, m * 0.32, m * 0.2, m * 0.028);
    emeraldOrb(c, W - m * 0.42, H - m * 0.27, m * 0.03);
    emeraldOrb(c, W - m * 0.25, m * 0.17, m * 0.024);
    c.save(); c.shadowColor = 'rgba(0,0,0,.7)'; c.shadowBlur = m * 0.02;
    drawImageFit(c, assets.logo, m * 0.2, H - m * 0.17, m * 0.34, m * 0.26); c.restore();
  } else if (which === 3) {                // ATOMIC AGE: 50s starbursts + boomerangs in chrome & emerald
    const b = m * 0.03;
    chromeRect(c, b * 0.6, b * 0.6, W - b * 1.2, H - b * 1.2, b * 0.5);
    c.save(); c.strokeStyle = BRAND.green; c.lineWidth = b * 0.18; c.setLineDash([b * 1.2, b * 0.8]);
    c.strokeRect(b * 1.7, b * 1.7, W - b * 3.4, H - b * 3.4); c.restore();
    for (const [x, y, r, col] of [[b * 4, b * 4, b * 2.6, '#e9eef2'], [W - b * 4, b * 4, b * 2, BRAND.green],
                                  [W - b * 7, b * 8.5, b * 1.1, '#e9eef2'], [b * 8, b * 7.5, b * 1.2, BRAND.green]]) starburst(c, x, y, r, 8, col);
    c.save(); c.font = `800 ${m * 0.032}px Montserrat, sans-serif`; c.textAlign = 'right'; c.textBaseline = 'middle';
    c.fillStyle = '#e9eef2'; c.shadowColor = 'rgba(0,0,0,.8)'; c.shadowBlur = m * 0.01;
    c.letterSpacing = `${m * 0.006}px`;
    c.fillText('WELCOME TO THE ATOMIC AGE', W - b * 3.2, H - b * 3.4); c.restore();
    c.save(); c.shadowColor = 'rgba(0,0,0,.7)'; c.shadowBlur = m * 0.02;
    drawImageFit(c, assets.logo, m * 0.17, H - m * 0.15, m * 0.28, m * 0.22); c.restore();
  }
}
