/**
 * 零依赖 PNG 编解码。
 *
 * 从 tools/sprite-sheet.mjs 抽出来的：那边只关心"抠底 + 切帧"，
 * 但 tools/sheet-shrink.mjs 也要读写 PNG，与其复制一份，不如共用。
 *
 * 只支持 8bit、非隔行。AI 出图和 canvas 导出的图都是这范围，
 * 超出范围直接抛错比默默画错好。
 */
import zlib from 'node:zlib';

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

/** 读 PNG → {w,h,rgba}。只支持 8bit、非隔行、color type 0/2/3/4/6 */
export function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  let off = 8;
  let ihdr = null;
  const idat = [];
  let plte = null;
  let trns = null;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        w: data.readUInt32BE(0),
        h: data.readUInt32BE(4),
        depth: data[8],
        color: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!ihdr) throw new Error('缺 IHDR');
  if (ihdr.depth !== 8) throw new Error(`只支持 8bit，实际 ${ihdr.depth}`);
  if (ihdr.interlace !== 0) throw new Error('不支持隔行 PNG');

  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr.color];
  if (!ch) throw new Error(`不支持 color type ${ihdr.color}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = ihdr.w * ch;
  const px = Buffer.alloc(stride * ihdr.h);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < ihdr.h; y++) {
    const f = raw[y * (stride + 1)];
    const cur = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev[x];
      const c = x >= ch ? prev[x - ch] : 0;
      let v = cur[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 255;
    }
    cur.copy(px, y * stride);
    prev = cur;
  }

  const rgba = new Uint8Array(ihdr.w * ihdr.h * 4);
  for (let i = 0, n = ihdr.w * ihdr.h; i < n; i++) {
    let r, g, b, a = 255;
    if (ihdr.color === 2) {
      r = px[i * 3];
      g = px[i * 3 + 1];
      b = px[i * 3 + 2];
    } else if (ihdr.color === 6) {
      r = px[i * 4];
      g = px[i * 4 + 1];
      b = px[i * 4 + 2];
      a = px[i * 4 + 3];
    } else if (ihdr.color === 3) {
      const k = px[i];
      r = plte[k * 3];
      g = plte[k * 3 + 1];
      b = plte[k * 3 + 2];
      if (trns && k < trns.length) a = trns[k];
    } else if (ihdr.color === 0) {
      r = g = b = px[i];
    } else {
      r = px[i * 2];
      a = px[i * 2 + 1];
    }
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = a;
  }
  return { w: ihdr.w, h: ihdr.h, rgba };
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * 写 PNG（RGBA）。
 *
 * `adaptive` 会逐行在 5 种 filter 里挑"预测误差绝对值之和"最小的那个——
 * 这是 PNG 规范的推荐启发式。同一张图通常能再压掉 10~20%，
 * 代价是编码慢 5 倍，但生成素材只跑一次，划算。
 */
export function encodePNG(w, h, rgba, { adaptive = true } = {}) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  const prev = Buffer.alloc(stride);
  const cand = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));

  for (let y = 0; y < h; y++) {
    const cur = Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride);
    let best = 0;
    let bestScore = Infinity;
    for (const f of adaptive ? [0, 1, 2, 3, 4] : [0]) {
      const out = cand[f];
      for (let x = 0; x < stride; x++) {
        const a = x >= 4 ? cur[x - 4] : 0;
        const b = prev[x];
        const c = x >= 4 ? prev[x - 4] : 0;
        let pred = 0;
        if (f === 1) pred = a;
        else if (f === 2) pred = b;
        else if (f === 3) pred = (a + b) >> 1;
        else if (f === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        out[x] = (cur[x] - pred) & 255;
      }
      let score = 0;
      for (let x = 0; x < stride; x++) score += out[x] < 128 ? out[x] : 256 - out[x];
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    raw[y * (stride + 1)] = best;
    cand[best].copy(raw, y * (stride + 1) + 1);
    cur.copy(prev);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
