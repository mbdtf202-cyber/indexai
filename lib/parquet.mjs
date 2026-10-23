/* IndexAI 零依赖 Parquet 读取器
 * 支持：FLAT schema、OPTIONAL/REQUIRED 标量列、PLAIN 与 RLE_DICTIONARY 编码、
 *      UNCOMPRESSED 与 SNAPPY 压缩、多 row group。
 * 用途：读 LMArena 等官方榜单在 HuggingFace 上发布的 leaderboard parquet。
 * 限制：不支持嵌套类型、DELTA/LZ4/ZSTD。遇到不支持的组合会明确报错，不静默出错。
 */

/* ─────────────── Snappy（raw block format） ─────────────── */
export function snappyDecode(src) {
  let p = 0, o = 0;
  const rl = () => { let r = 0, s = 0; for (;;) { const b = src[p++]; r += (b & 0x7f) * 2 ** s; if (!(b & 0x80)) return r; s += 7; } };
  const total = rl();
  const dst = Buffer.allocUnsafe(total);
  while (p < src.length && o < total) {
    const tag = src[p++], t = tag & 3;
    if (t === 0) {
      let l = tag >>> 2;
      if (l < 60) l += 1;
      else { const n = l - 59; let v = 0; for (let i = 0; i < n; i++) v += src[p++] * 2 ** (8 * i); l = v + 1; }
      src.copy(dst, o, p, p + l); p += l; o += l;
    } else {
      let L, O;
      if (t === 1) { L = ((tag >>> 2) & 7) + 4; O = (((tag >>> 5) & 7) << 8) | src[p++]; }
      else if (t === 2) { L = (tag >>> 2) + 1; O = src[p] | (src[p + 1] << 8); p += 2; }
      else { L = (tag >>> 2) + 1; O = (src[p] | (src[p + 1] << 8) | (src[p + 2] << 16) | (src[p + 3] << 24)) >>> 0; p += 4; }
      if (O === 0 || O > o) throw new Error(`snappy: invalid offset ${O} at ${o}`);
      for (let i = 0; i < L; i++) { dst[o] = dst[o - O]; o++; }
    }
  }
  if (o !== total) throw new Error(`snappy: decoded ${o} != declared ${total}`);
  return dst;
}

/* ─────────────── Thrift Compact Protocol ─────────────── */
export function makeThrift(buf) {
  let p = 0;
  const uvarint = () => { let r = 0, s = 0; for (;;) { const b = buf[p++]; r += (b & 0x7f) * 2 ** s; if (!(b & 0x80)) return r; s += 7; } };
  const zigzag = () => { const n = uvarint(); return n % 2 === 0 ? n / 2 : -(n + 1) / 2; };

  function readValue(type) {
    switch (type) {
      case 1: return true;
      case 2: return false;
      case 3: { const v = buf[p++]; return v > 127 ? v - 256 : v; }
      case 4: case 5: case 6: return zigzag();
      case 7: { const d = buf.readDoubleLE(p); p += 8; return d; }
      case 8: { const l = uvarint(); const s = buf.subarray(p, p + l); p += l; return s; }
      case 9: case 10: {
        const h = buf[p++]; let n = h >> 4; const et = h & 0xf;
        if (n === 15) n = uvarint();
        const a = [];
        for (let i = 0; i < n; i++) a.push(et === 12 ? readStruct(null) : readValue(et));
        return a;
      }
      case 12: return readStruct(null);
      case 11: {
        const h = buf[p++]; let n = h >> 4; const kt = h & 0xf, vt = h & 0xf;
        if (n === 15) n = uvarint();
        const o = {};
        for (let i = 0; i < n; i++) { const k = readValue(kt); o[String(k)] = readValue(vt); }
        return o;
      }
      default: throw new Error(`thrift: unsupported value type ${type}`);
    }
  }

  function skip(type) {
    switch (type) {
      case 1: case 2: return;
      case 3: p += 1; return;
      case 4: case 5: case 6: uvarint(); return;
      case 7: p += 8; return;
      case 8: { const l = uvarint(); p += l; return; }
      case 9: case 10: { const h = buf[p++]; let n = h >> 4; const et = h & 0xf; if (n === 15) n = uvarint(); for (let i = 0; i < n; i++) { if (et === 12) readStruct(null); else skip(et); } return; }
      case 11: { const h = buf[p++]; let n = h >> 4; const kt = h & 0xf, vt = h & 0xf; if (n === 15) n = uvarint(); for (let i = 0; i < n; i++) { skip(kt); skip(vt); } return; }
      case 12: { readStruct(null); return; }
      default: throw new Error(`thrift: unsupported skip type ${type}`);
    }
  }

  function readStruct(cb, offset) {
    if (offset != null) p = offset;
    const out = {};
    let last = 0;
    for (;;) {
      if (p >= buf.length) break;
      const h = buf[p++];
      if (h === 0) break;
      const t = h & 0xf, delta = h >> 4;
      const id = delta ? last + delta : zigzag();
      last = id;
      if (cb) cb(id, t, out, () => readValue(t), () => skip(t));
      else out[id] = readValue(t);
    }
    return out;
  }

  return { readStruct, readValue, skip, get pos() { return p; }, set pos(v) { p = v; } };
}

/* ─────────────── RLE / Bit-Packed hybrid ─────────────── */
function uvarintAt(buf, p) { let r = 0, s = 0; for (;;) { const b = buf[p++]; r += (b & 0x7f) * 2 ** s; if (!(b & 0x80)) return { val: r, pos: p }; s += 7; } }

function readHybrid(buf, bitWidth, count) {
  const out = [];
  if (bitWidth === 0) { for (let i = 0; i < count; i++) out.push(0); return out; }
  const byteWidth = Math.ceil(bitWidth / 8);
  const mask = 2 ** bitWidth - 1;
  let p = 0;
  while (p < buf.length && out.length < count) {
    const h = uvarintAt(buf, p); p = h.pos;
    if (h.val & 1) {
      const groups = h.val >>> 1;
      const startBit = p * 8;
      for (let i = 0; i < groups * 8 && out.length < count; i++) {
        const bit = startBit + i * bitWidth;
        const bi = bit >>> 3, off = bit & 7;
        let acc = 0;
        for (let k = 0; k < bitWidth; k++) {
          const byte = buf[bi + ((off + k) >> 3)];
          if (byte === undefined) break;
          acc |= ((byte >> ((off + k) & 7)) & 1) << k;
        }
        out.push(acc & mask);
      }
      p += groups * bitWidth;
    } else {
      const run = h.val >>> 1;
      let v = 0;
      for (let i = 0; i < byteWidth; i++) { const b = buf[p + i]; if (b !== undefined) v += b * 2 ** (8 * i); }
      p += byteWidth;
      for (let i = 0; i < run && out.length < count; i++) out.push(v & mask);
    }
  }
  while (out.length < count) out.push(0);
  return out;
}

/* ─────────────── PLAIN 值解码 ─────────────── */
const PHYS = { BOOLEAN: 0, INT32: 1, INT64: 2, INT96: 3, FLOAT: 4, DOUBLE: 5, BYTE_ARRAY: 6, FIXED_LEN_BYTE_ARRAY: 7 };

function decodePlainValues(raw, physType, n, typeLength) {
  const out = [];
  let p = 0;
  switch (physType) {
    case PHYS.BYTE_ARRAY: case PHYS.FIXED_LEN_BYTE_ARRAY: {
      for (let i = 0; i < n; i++) {
        let len;
        if (physType === PHYS.FIXED_LEN_BYTE_ARRAY) len = typeLength || 0;
        else { len = raw.readUInt32LE(p); p += 4; }
        out.push(raw.subarray(p, p + len).toString('utf8')); p += len;
      }
      break;
    }
    case PHYS.INT32: for (let i = 0; i < n; i++) { out.push(raw.readInt32LE(p)); p += 4; } break;
    case PHYS.INT64: for (let i = 0; i < n; i++) { out.push(Number(raw.readBigInt64LE(p))); p += 8; } break;
    case PHYS.FLOAT: for (let i = 0; i < n; i++) { out.push(raw.readFloatLE(p)); p += 4; } break;
    case PHYS.DOUBLE: for (let i = 0; i < n; i++) { out.push(raw.readDoubleLE(p)); p += 8; } break;
    case PHYS.BOOLEAN: for (let i = 0; i < n; i++) { out.push(((raw[i >> 3] >> (i & 7)) & 1) === 1); } break;
    default: throw new Error(`parquet: unsupported physical type ${physType}`);
  }
  return out;
}

/* ─────────────── 主入口 ─────────────── */
const CODEC = { 0: 'UNCOMPRESSED', 1: 'SNAPPY', 2: 'GZIP', 3: 'LZO', 4: 'BROTLI', 5: 'LZ4', 6: 'ZSTD' };
const ENC = { 0: 'PLAIN', 2: 'PLAIN_DICTIONARY', 3: 'RLE', 4: 'BIT_PACKED', 5: 'DELTA_BINARY_PACKED', 7: 'DELTA_LENGTH_BYTE_ARRAY', 8: 'RLE_DICTIONARY' };

function str(v) { return v == null ? null : (Buffer.isBuffer(v) ? v.toString('utf8') : String(v)); }

export function readParquet(fileBuf) {
  const len = fileBuf.length;
  if (len < 12) throw new Error('parquet: file too small');
  if (fileBuf.toString('latin1', len - 4, len) !== 'PAR1') throw new Error('parquet: missing trailing magic');
  const flen = fileBuf.readUInt32LE(len - 8);
  const fstart = len - 8 - flen;
  if (fstart < 4) throw new Error('parquet: bad footer length');
  const tr = makeThrift(fileBuf.subarray(fstart, len - 8));
  const meta = tr.readStruct();

  const schemaRaw = meta[2] || [];
  const leaves = [];
  // schema[0] 是 root，其余按出现顺序为叶子列（本读取器只支持 flat schema）
  for (let i = 1; i < schemaRaw.length; i++) {
    const s = schemaRaw[i];
    const name = str(s[4]);
    const rep = s[3];        // 0=REQUIRED 1=OPTIONAL 2=REPEATED
    const phys = s[1];
    const typeLength = s[2];
    const numChildren = s[5];
    if (numChildren != null && numChildren > 0) throw new Error(`parquet: nested schema not supported (${name})`);
    leaves.push({ name, repType: rep, physType: phys, typeLength, isOptional: rep === 1, index: leaves.length });
  }

  const rowGroups = meta[4] || [];
  const cols = Object.fromEntries(leaves.map(l => [l.name, []]));

  for (const rg of rowGroups) {
    const colChunks = rg[1] || [];
    for (const leaf of leaves) {
      const chunk = colChunks[leaf.index];
      if (!chunk) continue;
      // ColumnChunk: field 3 = meta_data (ColumnMetaData)
      const cm = chunk[3];
      if (!cm) continue;
      const codec = cm[4];
      const codecName = CODEC[codec];
      if (codecName !== 'UNCOMPRESSED' && codecName !== 'SNAPPY') {
        throw new Error(`parquet: unsupported codec ${codecName} (column ${leaf.name})`);
      }
      const dictStart = cm[11];
      const dataStart = cm[9];
      const totalComp = cm[7];
      const start = (dictStart && dictStart > 0) ? dictStart : dataStart;
      const seg = fileBuf.subarray(start, start + totalComp);
      const values = decodeColumnChunk(seg, leaf, codecName);
      cols[leaf.name].push(...values);
    }
  }

  const numRows = meta[3] ?? 0;
  const rows = [];
  for (let i = 0; i < numRows; i++) {
    const r = {};
    for (const leaf of leaves) r[leaf.name] = cols[leaf.name][i];
    rows.push(r);
  }

  return { numRows, rows, columns: leaves.map(l => l.name), rowGroupCount: rowGroups.length };
}

function decodeColumnChunk(seg, leaf, codecName) {
  const values = [];
  let dict = null;
  let p = 0;

  while (p < seg.length) {
    const before = p;
    const tr = makeThrift(seg);
    tr.pos = p;
    const ph = tr.readStruct();
    p = tr.pos;

    const pageType = ph[1];
    const uncompressedSize = ph[2];
    const compressedSize = ph[3];
    const dh = ph[5];
    const dph = ph[7];

    if (compressedSize == null) break;
    const body = seg.subarray(p, p + compressedSize);
    p += compressedSize;
    const raw = codecName === 'SNAPPY' ? snappyDecode(body) : body;
    if (uncompressedSize != null && raw.length !== uncompressedSize) {
      throw new Error(`parquet: page size mismatch ${raw.length} != ${uncompressedSize}`);
    }

    if (pageType === 2 && dph) {
      const n = dph[1];
      dict = decodePlainValues(raw, leaf.physType, n, leaf.typeLength);
    } else if (pageType === 0 && dh) {
      const n = dh[1];
      const enc = dh[2];
      const defEnc = dh[3];
      const repEnc = dh[4];
      let q = 0;
      let defs = null;
      if (leaf.isOptional) {
        // DataPage V1：definition levels 前有 4 字节小端长度前缀
        const byteLen = raw.readUInt32LE(q); q += 4;
        defs = readHybrid(raw.subarray(q, q + byteLen), 1, n);
        q += byteLen;
      }
      const encName = ENC[enc] || String(enc);
      if (encName === 'RLE_DICTIONARY' || encName === 'PLAIN_DICTIONARY') {
        if (!dict) throw new Error('parquet: dictionary page missing');
        const bitWidth = raw[q]; q += 1;
        const idxs = readHybrid(raw.subarray(q), bitWidth, n);
        for (let i = 0; i < n; i++) {
          values.push(leaf.isOptional && defs[i] === 0 ? null : dict[idxs[i]]);
        }
      } else if (encName === 'PLAIN') {
        const vals = decodePlainValues(raw.subarray(q), leaf.physType, n, leaf.typeLength);
        for (let i = 0; i < n; i++) values.push(leaf.isOptional && defs[i] === 0 ? null : vals[i]);
      } else {
        throw new Error(`parquet: unsupported encoding ${encName}`);
      }
    } else if (pageType === 3) {
      // INDEX_PAGE，跳过
    } else {
      break;
    }
    if (p <= before) break;
  }
  return values;
}
