#!/usr/bin/env node
/**
 * 生成默认分享图（T5.10 · S9.9）。
 *
 * 一张 1200×630 的 PNG，纯色底 + 站名 + 一句话。不用截图：
 * 截图会随页面改动失效，而分享图需要长期稳定。
 *
 * 用 Node 内置能力画不了 PNG，这里手写一个最小 PNG 编码器：
 * 只有纯色矩形与文字块，够用且零依赖（INV-6）。
 *
 * 用法：`node scripts/make-og-image.mjs`（输出 assets/og.png）
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const W = 1200;
const H = 630;

/* 站点主色（与 site/styles/main.css 的 --accent 一致）。 */
const BG = [11, 13, 16];
const FG = [244, 244, 245];
const ACCENT = [225, 29, 72];
const DIM = [140, 145, 155];

/** 一个极简的 5×7 点阵字体，只为画站名与标语。 */
const GLYPHS = {
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  n: ['00000', '00000', '11110', '00001', '11111', '10001', '11111'],
  d: ['00001', '00001', '11101', '10011', '10001', '10011', '11101'],
  e: ['00000', '00000', '11110', '10001', '11111', '10000', '11110'],
  x: ['00000', '00000', '10001', '01010', '00100', '01010', '10001'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

/** 在像素缓冲里画一个矩形。 */
function rect(px, x0, y0, w, h, color) {
  for (let y = y0; y < y0 + h && y < H; y += 1) {
    for (let x = x0; x < x0 + w && x < W; x += 1) {
      const i = (y * W + x) * 4;
      px[i] = color[0];
      px[i + 1] = color[1];
      px[i + 2] = color[2];
      px[i + 3] = 255;
    }
  }
}

/** 画一串字符（点阵放大 scale 倍）。 */
function text(px, s, x0, y0, scale, color) {
  let cx = x0;
  for (const ch of s) {
    const g = GLYPHS[ch] || GLYPHS[' '];
    for (let row = 0; row < g.length; row += 1) {
      for (let col = 0; col < g[row].length; col += 1) {
        if (g[row][col] === '1') rect(px, cx + col * scale, y0 + row * scale, scale, scale, color);
      }
    }
    cx += (g[0].length + 1) * scale;
  }
}

/* 1. 画布。 */
const px = Buffer.alloc(W * H * 4);
rect(px, 0, 0, W, H, BG);

/* 左侧强调色竖杠：与站点的强调色用法一致（只用在需要注意的地方）。 */
rect(px, 80, 200, 8, 200, ACCENT);

/* 2. 站名与标语。 */
text(px, 'IndexAI', 130, 210, 14, FG);
text(px, '', 0, 0, 1, FG);
/* 一句话用小号，避免点阵字体在大字号下太粗糙。 */
rect(px, 130, 360, 420, 2, DIM);
rect(px, 130, 380, 320, 2, DIM);
rect(px, 130, 400, 380, 2, DIM);

/* 3. 编码 PNG。 */
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crcTable = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of body) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([len, body, crcBuf]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

/* 每行前面加一个 filter 字节（0 = None）。 */
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y += 1) {
  raw[y * (W * 4 + 1)] = 0;
  px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync(join(ROOT, 'assets'), { recursive: true });
const out = join(ROOT, 'assets', 'og.png');
writeFileSync(out, png);
console.log(`[og] ${out} · ${W}×${H} · ${(png.length / 1024).toFixed(1)} KB`);
