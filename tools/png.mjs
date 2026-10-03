// OWNER: LEAD (build tooling). Zero-dependency PNG encoder + the procedural app icon.
// Used by build.mjs to write icon-192.png / icon-512.png for the web manifest.
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

/** Encode RGBA8 pixels (Uint8Array, length w*h*4, row 0 = top) as a PNG Buffer. */
export function encodePNG(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function hash(x, y) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Draw the Blockcraft app icon: an original isometric grass block on a sky tile.
 * Drawn at 32x32 "art pixels" and scaled up with nearest-neighbour.
 */
export function drawAppIcon(size) {
  const ART = 32;
  const art = new Uint8Array(ART * ART * 4);
  const put = (x, y, r, g, b) => { const i = (y * ART + x) * 4; art[i] = r; art[i + 1] = g; art[i + 2] = b; art[i + 3] = 255; };
  const sky = [[120, 167, 255], [140, 182, 255]];
  const grass = [[77, 138, 44], [90, 154, 51], [103, 169, 59], [116, 185, 68]];
  const dirt = [[90, 59, 34], [107, 70, 40], [122, 82, 48], [138, 94, 56]];
  for (let y = 0; y < ART; y++) {
    for (let x = 0; x < ART; x++) {
      const s = sky[y < 16 ? 0 : 1];
      put(x, y, s[0], s[1], s[2]);
      const n = hash(x, y);
      const cx = x + 0.5, cy = y + 0.5;
      // top rhombus centred at (16, 8)
      const top = Math.abs(cx - 16) / 14 + Math.abs(cy - 8.5) / 7 <= 1;
      const leftTopEdge = 8.5 + (cx - 2) / 2;
      const rightTopEdge = 15.5 - (cx - 16) / 2;
      let col = null, shade = 1;
      if (top) {
        col = grass[Math.min(3, Math.floor(n * 4))];
      } else if (cx >= 2 && cx <= 16 && cy >= leftTopEdge && cy <= leftTopEdge + 15) {
        const depth = cy - leftTopEdge;
        col = depth < 3 + (n > 0.6 ? 1 : 0) ? grass[1 + Math.floor(n * 2)] : dirt[Math.floor(n * 4)];
        shade = 0.8;
      } else if (cx >= 16 && cx <= 30 && cy >= rightTopEdge && cy <= rightTopEdge + 15) {
        const depth = cy - rightTopEdge;
        col = depth < 3 + (n > 0.6 ? 1 : 0) ? grass[1 + Math.floor(n * 2)] : dirt[Math.floor(n * 4)];
        shade = 0.6;
      }
      if (col) put(x, y, Math.round(col[0] * shade), Math.round(col[1] * shade), Math.round(col[2] * shade));
    }
  }
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const ay = Math.min(ART - 1, Math.floor((y * ART) / size));
    for (let x = 0; x < size; x++) {
      const ax = Math.min(ART - 1, Math.floor((x * ART) / size));
      const si = (ay * ART + ax) * 4, di = (y * size + x) * 4;
      out[di] = art[si]; out[di + 1] = art[si + 1]; out[di + 2] = art[si + 2]; out[di + 3] = 255;
    }
  }
  return out;
}
