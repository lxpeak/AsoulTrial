/**
 * 序列帧素材处理管线：AI 生成的「棋盘格底 sprite sheet」→ 可直接进游戏的透明帧表。
 *
 * AI 出图有三个问题，纯手改不现实，所以固化成脚本：
 *   1. 要「透明底」时，模型常常在 RGB 图上**画出**棋盘格来冒充透明，
 *      导出的 PNG 里根本没有 alpha 通道 —— 必须自己抠。
 *   2. 各帧的脚底线不统一，直接按网格切会上下抖。
 *   3. 角色在格子里的水平位置也不统一，走路时会左右飘。
 *
 * 处理完的 sheet 保持原始分辨率（零重采样，不掉画质）：
 * 每格内容按「包围盒底部对齐 + 水平居中」重新摆放，运行时按格子取即可。
 *
 * 用法：node tools/sprite-sheet.mjs <输入.png> <输出.png> [--cols=4] [--rows=2]
 *                                       [--pad-bottom=20] [--debug]
 */
import fs from 'node:fs';
import path from 'node:path';

// PNG 编解码抽到 lib/png.mjs，和 tools/sheet-shrink.mjs 共用同一份实现
import { decodePNG, encodePNG } from './lib/png.mjs';

// ==================== 抠底 ====================

/** 无彩色判定：max-min 不超过这个值就当作"灰/白" */
const NEUTRAL_SPREAD = 30;
/** 亮度下限：棋盘格最深的格子也在 195 以上，角色暗部远低于此 */
const NEUTRAL_MIN = 182;

/**
 * 有些模型会自作主张给角色描一圈暖色外发光（prompt 里写了 rim light 就会翻车），
 * 那不是无彩色，光靠上面的判定抠不掉，会在角色外留一圈橙边，像贴纸。
 *
 * 这类光晕的特征是「很亮 + 偏暖 + 低饱和」，开这个开关就一并当背景处理。
 * 靠连通性兜底：只有从画面边缘能走到的才会被吃，角色内部的皮肤走不到。
 */
let WARM_KEY = false; // 由 --warm-key 打开，见下方参数解析
const WARM_SPREAD = 85;
const WARM_MIN = 120;
const WARM_BIAS = 20;

/**
 * 从格子四边向内泛洪，抠掉「无彩色 + 够亮」的连通区域。
 *
 * 为什么不用亮度阈值一刀切：白围裙、白袜子、眼白也满足"亮且无彩"，
 * 但它们在角色内部，被深色描边围住 —— 泛洪从边缘出发，走不到那里。
 * 同一张图里生成的 8 帧共享同一套配色，一套参数就能全抠干净。
 *
 * @returns {Uint8Array} 每像素 alpha
 */
function keyOut(rgba, w, h, x0, y0, cw, chh) {
  const mask = new Uint8Array(cw * chh); // 0 未访问 / 1 背景 / 2 前景
  const stack = [];
  const alpha = new Uint8Array(cw * chh).fill(255);

  const at = (x, y) => ((y0 + y) * w + (x0 + x)) * 4;

  const isBg = (x, y) => {
    const i = at(x, y);
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    if (rgba[i + 3] < 8) return true; // 已经是透明的
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    // 中性纸白 / 棋盘格
    if (mx - mn <= NEUTRAL_SPREAD && mn >= NEUTRAL_MIN) return true;
    // 暖色外发光（只在开了 --warm-key 时认，否则会把正常角色的暖色描边也吃掉）
    if (WARM_KEY && mn >= WARM_MIN && mx - mn <= WARM_SPREAD && r - b >= WARM_BIAS) {
      return true;
    }
    return false;
  };

  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= cw || y >= chh) return;
    const p = y * cw + x;
    if (mask[p]) return;
    if (!isBg(x, y)) {
      mask[p] = 2;
      return;
    }
    mask[p] = 1;
    stack.push(p);
  };

  for (let x = 0; x < cw; x++) {
    push(x, 0);
    push(x, chh - 1);
  }
  for (let y = 0; y < chh; y++) {
    push(0, y);
    push(cw - 1, y);
  }

  while (stack.length) {
    const p = stack.pop();
    const x = p % cw;
    const y = (p / cw) | 0;
    alpha[p] = 0;
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }

  // 收边：紧贴透明区的亮像素半透明化，去掉 1~2px 的浅灰描边环
  for (let y = 0; y < chh; y++) {
    for (let x = 0; x < cw; x++) {
      const p = y * cw + x;
      if (mask[p] === 1) continue;
      const i = at(x, y);
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      if (Math.min(r, g, b) < 196) continue;
      const near =
        (x > 0 && mask[p - 1] === 1) ||
        (x < cw - 1 && mask[p + 1] === 1) ||
        (y > 0 && mask[p - cw] === 1) ||
        (y < chh - 1 && mask[p + cw] === 1);
      if (near) alpha[p] = 30;
    }
  }
  return alpha;
}

// ==================== 主流程 ====================

function parseArgs(argv) {
  const flags = {};
  const pos = [];
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      flags[k] = v === undefined ? true : v;
    } else pos.push(a);
  }
  return { pos, flags };
}

const { pos, flags } = parseArgs(process.argv.slice(2));
const [input, output] = pos;
if (!input || !output) {
  console.error(
    '用法: node tools/sprite-sheet.mjs <输入.png> <输出.png> [--cols=4] [--rows=2] [--pad-bottom=20] [--warm-key] [--debug]'
  );
  process.exit(1);
}
WARM_KEY = !!flags['warm-key'];

const COLS = Number(flags.cols ?? 4);
const ROWS = Number(flags.rows ?? 2);
const PAD_BOTTOM = Number(flags['pad-bottom'] ?? 20);

const src = decodePNG(fs.readFileSync(input));
const CW = Math.floor(src.w / COLS);
const CH = Math.floor(src.h / ROWS);
console.log(`源图 ${src.w}x${src.h} → ${COLS}x${ROWS} 格，每格 ${CW}x${CH}`);

const out = new Uint8Array(src.w * src.h * 4); // 输出同尺寸，全透明
const cells = [];

for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const x0 = c * CW;
    const y0 = r * CH;
    const alpha = keyOut(src.rgba, src.w, src.h, x0, y0, CW, CH);

    // 包围盒
    let minX = CW, minY = CH, maxX = -1, maxY = -1;
    for (let y = 0; y < CH; y++) {
      for (let x = 0; x < CW; x++) {
        if (alpha[y * CW + x] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) {
      cells.push(null);
      console.log(`  格(${r},${c}) 空`);
      continue;
    }
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;

    // 目标位置：底部对齐到格底 - PAD_BOTTOM，水平居中
    const dx = Math.round((CW - bw) / 2);
    const dy = CH - PAD_BOTTOM - bh;

    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const a = alpha[(minY + y) * CW + (minX + x)];
        if (!a) continue;
        const si = ((y0 + minY + y) * src.w + (x0 + minX + x)) * 4;
        const di = ((r * CH + dy + y) * src.w + (c * CW + dx + x)) * 4;
        out[di] = src.rgba[si];
        out[di + 1] = src.rgba[si + 1];
        out[di + 2] = src.rgba[si + 2];
        out[di + 3] = a;
      }
    }
    cells.push({ r, c, bw, bh, dx, dy });
    console.log(`  格(${r},${c}) bbox ${bw}x${bh} → 偏移 (${dx},${dy})`);
  }
}

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, encodePNG(src.w, src.h, out));
console.log(`写出 ${output}`);

if (flags.debug) {
  // 透明区填洋红，肉眼确认有没有漏抠的灰块
  const dbg = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) {
      dbg[i] = 255;
      dbg[i + 1] = 0;
      dbg[i + 2] = 255;
      dbg[i + 3] = 255;
    } else {
      dbg[i] = out[i];
      dbg[i + 1] = out[i + 1];
      dbg[i + 2] = out[i + 2];
      dbg[i + 3] = 255;
    }
  }
  const dbgPath = output.replace(/\.png$/, '.debug.png');
  fs.writeFileSync(dbgPath, encodePNG(src.w, src.h, dbg));
  console.log(`写出 ${dbgPath}`);
}
