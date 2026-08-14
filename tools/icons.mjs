/**
 * Draw the extension's icons.
 *
 *   node tools/icons.mjs            write icons/icon-{16,32,48,96,128}.png
 *   node tools/icons.mjs --design road --out /tmp/preview   try one somewhere else
 *
 * Why a generator rather than five checked-in PNGs and a design tool: the 16px
 * icon is the one anybody actually sees, and it is far too small to survive
 * being a downscale of the 128px one. A 2px bar becomes 1px on one edge and 2px
 * on the other, which is what made the previous icon read as a smudged blue
 * square. So every size is drawn at its own scale with the geometry snapped to
 * whole pixels for that size, and the shapes are described in a 128-unit grid
 * that divides evenly by all five.
 *
 * No dependencies, deliberately: this repo has two devDependencies and copies
 * files rather than bundling them. Everything here is arithmetic plus `zlib`,
 * which Node already has.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SIZES = [16, 32, 48, 96, 128];
/** Samples per pixel per axis. 4 is plenty and keeps 128px instant. */
const SS = 4;

// --- colour ------------------------------------------------------------------

/**
 * The tile is opaque on purpose. An extension icon is painted straight onto the
 * browser toolbar, which is #f9f9fa on a light theme and #2b2a33 on a dark one,
 * and MV3 gives no way to serve a different icon per theme. A bare glyph on
 * transparency therefore disappears against one of the two. A tile carries its
 * own background and reads on both.
 */
const INK = [255, 255, 255, 255];

const PALETTE = {
  blue: [43, 108, 176, 255],
  indigo: [79, 70, 160, 255],
  teal: [17, 110, 112, 255],
};

// --- shapes ------------------------------------------------------------------
//
// Each shape is a function from a point to "is this point inside", in the
// 128-unit design grid. Anti-aliasing falls out of supersampling, so none of
// them needs to know about pixels.

const rect = (x, y, w, h) => (px, py) => px >= x && px < x + w && py >= y && py < y + h;

const roundRect = (x, y, w, h, r) => (px, py) => {
  if (px < x || px >= x + w || py < y || py >= y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
};

/** A bar with fully round ends. */
const pill = (x, y, w, h) => roundRect(x, y, w, h, h / 2);

const disc = (cx, cy, r) => (px, py) => Math.hypot(px - cx, py - cy) <= r;

/** Points as [x, y] pairs, wound in either direction. */
const polygon = (points) => (px, py) => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const union =
  (...shapes) =>
  (px, py) =>
    shapes.some((s) => s(px, py));

const subtract = (base, ...holes) => (px, py) => base(px, py) && !holes.some((h) => h(px, py));

// --- the designs -------------------------------------------------------------
//
// Rules every one of these follows:
//   - nothing thinner than 16 units, which is 2px at 16px, or one edge of the
//     shape renders a pixel thinner than the other;
//   - edges on multiples of 8, so they land on whole pixels at every size;
//   - the mark fills roughly 70% of the tile. Less than that and the icon reads
//     as a coloured square with something small in it;
//   - two ideas at most. At 16px there is no room for a third.

const DESIGNS = {
  /**
   * Sliders: three lines, each with a handle, so the mark reads as "a list you
   * can adjust" rather than as a generic list.
   */
  sliders: {
    tint: PALETTE.blue,
    glyph: () => {
      const bars = [
        { y: 28, knob: 76 },
        { y: 56, knob: 40 },
        { y: 84, knob: 60 },
      ];
      return union(
        ...bars.flatMap(({ y, knob }) => [
          pill(20, y, 88, 12),
          subtract(disc(knob + 6, y + 6, 13), disc(knob + 6, y + 6, 5)),
        ])
      );
    },
  },

  /**
   * An open book. The most direct statement of what the extension is for, and a
   * silhouette with a distinctive top edge: two pages rising away from a spine,
   * which nothing else in a toolbar row has.
   *
   * Not spectacles, which is the obvious mark for a reading extension: two
   * lenses need a rim of at least 16 units and a hole wide enough to still read
   * as a hole at 16px, and once both hold, the pair looks like a barbell.
   */
  book: {
    tint: PALETTE.indigo,
    glyph: () =>
      union(
        polygon([
          [14, 40],
          [58, 30],
          [58, 96],
          [14, 88],
        ]),
        polygon([
          [114, 40],
          [70, 30],
          [70, 96],
          [114, 88],
        ])
      ),
  },

  /**
   * A road running to the horizon. It takes the "Road" half of the name, which
   * no other extension is competing for, without going anywhere near Royal
   * Road's own branding: this must not look like an official add-on.
   */
  road: {
    tint: PALETTE.teal,
    /**
     * The horizon bar is not decoration. Without it, a tapering road with centre
     * dashes reads as a capital A. Capping the taper with a horizontal line
     * settles it as a road going away from you.
     */
    glyph: () =>
      union(
        rect(16, 24, 96, 14),
        polygon([
          [46, 48],
          [82, 48],
          [114, 110],
          [14, 110],
        ])
      ),
    holes: () =>
      union(rect(58, 56, 12, 16), rect(56, 80, 16, 24)),
  },
};

// --- rasteriser --------------------------------------------------------------

function render(design, size) {
  const { tint, glyph, holes } = DESIGNS[design];
  const mark = glyph();
  const cut = holes ? holes() : null;
  const scale = 128 / size;
  const px = new Uint8Array(size * size * 4);

  // The corner radius stays proportionally the same, but is rounded to a whole
  // number of pixels *at this size* before being scaled back into design units,
  // so the curve starts and ends on a pixel edge rather than halfway across one.
  const tile = roundRect(0, 0, 128, 128, Math.round(24 / scale) * scale);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let inTile = 0;
      let inMark = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const gx = (x + (sx + 0.5) / SS) * scale;
          const gy = (y + (sy + 0.5) / SS) * scale;
          if (tile(gx, gy)) inTile += 1;
          if (mark(gx, gy) && !(cut && cut(gx, gy))) inMark += 1;
        }
      }
      const total = SS * SS;
      const tileA = inTile / total;
      const markA = (inMark / total) * tileA; // the glyph never spills past the tile
      // Glyph over tile, tile over nothing.
      const a = tileA;
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        px[i + c] = Math.round(tint[c] * (1 - markA) + INK[c] * markA);
      }
      px[i + 3] = Math.round(a * 255);
    }
  }
  return px;
}

// --- PNG ---------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(pixels, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  // 10, 11, 12: deflate, adaptive filtering, no interlace. All zero already.

  // One filter byte per scanline; 0 means "no filter", which deflate handles
  // well enough for flat art and keeps this readable.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- main --------------------------------------------------------------------

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

/** What `icons/` currently holds. Re-running with no arguments must not change it. */
const design = arg('design', 'sliders');
const out = arg('out', join(HERE, '..', 'icons'));

if (!DESIGNS[design]) {
  console.error(`unknown design "${design}". try: ${Object.keys(DESIGNS).join(', ')}`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
console.log(`drawing "${design}" into ${out}`);
for (const size of SIZES) {
  const file = join(out, `icon-${size}.png`);
  writeFileSync(file, png(render(design, size), size));
  console.log(`  icon-${size}.png`);
}
