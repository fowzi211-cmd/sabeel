/**
 * Draws the app icon (a white water drop on Sabeel teal) into public/icons/*.png without any image library:
 * rasterises with 3×3 supersampling and writes PNGs by hand.   npx tsx scripts/make-icons.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const TEAL = [0x0b, 0x7a, 0x8f];
const DEEP = [0x07, 0x5e, 0x70];
const WHITE = [0xff, 0xff, 0xff];

/** Signed "inside" test for a drop centred at (0,0) with unit radius: a circle plus a pointed top. */
function inDrop(x: number, y: number): boolean {
  // circle body centred slightly low; teardrop tip above
  const cy = 0.18;
  const r = 0.52;
  if ((x * x) + ((y - cy) * (y - cy)) <= r * r) return true;
  const tipY = -0.62;
  if (y < cy && y > tipY) {
    const t = (y - tipY) / (cy - tipY); // 0 at tip, 1 at circle centre
    const half = r * Math.pow(t, 0.9) * 0.98;
    return Math.abs(x) <= half;
  }
  return false;
}

function render(size: number, opts: { maskable: boolean }): Buffer {
  const px = Buffer.alloc(size * size * 4);
  const ss = 3;
  const dropScale = opts.maskable ? 0.36 : 0.44; // maskable icons keep content inside the safe zone
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let drop = 0;
      let inside = 0;
      for (let sj = 0; sj < ss; sj++) {
        for (let si = 0; si < ss; si++) {
          const fx = (i + (si + 0.5) / ss) / size - 0.5;
          const fy = (j + (sj + 0.5) / ss) / size - 0.5;
          if (inDrop(fx / dropScale, fy / dropScale)) drop++;
          // rounded square background for "any" icons; full bleed for maskable
          const rr = 0.22;
          const ax = Math.abs(fx) - (0.5 - rr);
          const ay = Math.abs(fy) - (0.5 - rr);
          const d = Math.hypot(Math.max(ax, 0), Math.max(ay, 0));
          if (opts.maskable || d <= rr) inside++;
        }
      }
      const n = ss * ss;
      const k = (j * size + i) * 4;
      const t = j / size; // subtle vertical gradient
      const bg = TEAL.map((c, idx) => Math.round(c + (DEEP[idx] - c) * t));
      const dropA = drop / n;
      const bgA = inside / n;
      for (let c = 0; c < 3; c++) px[k + c] = Math.round(bg[c] * (1 - dropA) + WHITE[c] * dropA);
      px[k + 3] = Math.round(255 * Math.max(bgA, dropA));
    }
  }
  return px;
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size: number, rgba: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

mkdirSync("public/icons", { recursive: true });
for (const [name, size, maskable] of [["icon-192.png", 192, false], ["icon-512.png", 512, false], ["icon-maskable-512.png", 512, true]] as const) {
  writeFileSync(`public/icons/${name}`, png(size, render(size, { maskable })));
  console.log("wrote", name);
}
