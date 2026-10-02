// Generates public/icons/icon{16,32,48,128}.png with no dependencies:
// an indigo rounded square with a white quotation-mark-and-check ("a quote, verified").
// Run: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const OUT = join(import.meta.dirname, '..', 'public', 'icons');
const BG = [67, 56, 202]; // indigo-700
const FG = [255, 255, 255];
const ACCENT = [251, 191, 36]; // amber-400

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Shapes in a 0..1 coordinate space. Returns [r,g,b,a] for a sample point. */
function sample(x, y) {
  // Rounded square.
  const r = 0.22;
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  if (Math.hypot(x - cx, y - cy) > r) return [0, 0, 0, 0];
  // Opening quote mark: two dots with tails (top-left).
  for (const ox of [0.24, 0.42]) {
    if (Math.hypot(x - ox, y - 0.33) < 0.075) return [...ACCENT, 255];
    if (distToSegment(x, y, ox - 0.05, 0.36, ox - 0.02, 0.47) < 0.035) return [...ACCENT, 255];
  }
  // Check mark.
  const w = 0.075;
  if (distToSegment(x, y, 0.3, 0.6, 0.45, 0.75) < w || distToSegment(x, y, 0.45, 0.75, 0.78, 0.36) < w) return [...FG, 255];
  return [...BG, 255];
}

function render(size) {
  const ss = 6;
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const [cr, cg, cb, ca] = sample((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
          r += cr * ca;
          g += cg * ca;
          b += cb * ca;
          a += ca;
        }
      }
      const i = (py * size + px) * 4;
      buf[i] = a ? Math.round(r / a) : 0;
      buf[i + 1] = a ? Math.round(g / a) : 0;
      buf[i + 2] = a ? Math.round(b / a) : 0;
      buf[i + 3] = Math.round(a / (ss * ss));
    }
  }
  return png(size, buf);
}

mkdirSync(OUT, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(OUT, `icon${size}.png`), render(size));
  console.log(`wrote icon${size}.png`);
}
