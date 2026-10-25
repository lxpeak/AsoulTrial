/**
 * 序列帧降采样：把 1536×1024 的 4×2 帧表缩到更小的尺寸。
 *
 * 为什么要缩：四张 sheet 共 7.4MB，手机首屏要下好几秒。而实际绘制时
 * 角色只有 99~126px 高（源帧 512px 高），也就是说**九成像素从来没被采到**。
 *
 * 尺寸怎么定：玩家视觉高 132，最宽的精英也就 126×0.75 ≈ 95px；DPR 2 的设备
 * 需要 190~264 物理像素。每格 288×384（0.75 倍）对玩家是 1.45 倍余量、
 * 对精英是 1.5 倍余量，都在安全区。再往下就会在视网膜屏上看得出糊。
 *
 * ── 为什么不是"直接抽点" ──
 * 0.75 不是整数倍，最近邻采样会让描边抖动、锯齿明显。这里用**面积平均**：
 * 每个目标像素覆盖 1.33×1.33 个源像素，按重叠面积加权。
 *
 * ── 为什么先乘 alpha 再平均 ──
 * 透明像素的 RGB 是垃圾值（通常是 0）。直接平均会把这层黑"渗"进轮廓边缘，
 * 表现为一圈发暗的脏边。正确做法是预乘 alpha 求加权平均，最后再反预乘回来。
 *
 * 用法：
 *   node tools/sheet-shrink.mjs <输入.png> <输出.png> [--scale=0.75]
 */
import fs from 'node:fs';
import path from 'node:path';
import { decodePNG, encodePNG } from './lib/png.mjs';

const argv = process.argv.slice(2);
const flags = {};
const pos = [];
for (const a of argv) {
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split('=');
    flags[k] = v === undefined ? true : v;
  } else pos.push(a);
}

const [input, output] = pos;
if (!input || !output) {
  console.error('用法: node tools/sheet-shrink.mjs <输入.png> <输出.png> [--scale=0.75]');
  process.exit(1);
}

const scale = Number(flags.scale || 0.75);
if (!(scale > 0 && scale <= 1)) {
  console.error('--scale 必须在 (0, 1] 之间');
  process.exit(1);
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

const src = decodePNG(fs.readFileSync(input));
const dw = Math.round(src.w * scale);
const dh = Math.round(src.h * scale);
const dst = new Uint8Array(dw * dh * 4);

// 每个目标像素对应的源区域大小
const stepX = src.w / dw;
const stepY = src.h / dh;

for (let dy = 0; dy < dh; dy++) {
  const y0 = dy * stepY;
  const y1 = y0 + stepY;
  const syStart = Math.floor(y0);
  const syEnd = Math.ceil(y1);
  for (let dx = 0; dx < dw; dx++) {
    const x0 = dx * stepX;
    const x1 = x0 + stepX;
    const sxStart = Math.floor(x0);
    const sxEnd = Math.ceil(x1);

    let pr = 0;
    let pg = 0;
    let pb = 0;
    let pa = 0; // 按面积加权的 alpha 和（0~255 量纲）
    let wsum = 0;

    for (let sy = syStart; sy < syEnd; sy++) {
      const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
      if (wy <= 0) continue;
      const syc = sy < 0 ? 0 : sy >= src.h ? src.h - 1 : sy;
      for (let sx = sxStart; sx < sxEnd; sx++) {
        const wx = Math.min(sx + 1, x1) - Math.max(sx, x0);
        if (wx <= 0) continue;
        const sxc = sx < 0 ? 0 : sx >= src.w ? src.w - 1 : sx;
        const si = (syc * src.w + sxc) * 4;
        const w = wx * wy;
        // 预乘：颜色按"不透明度 × 面积"加权
        const aw = (src.rgba[si + 3] / 255) * w;
        pr += src.rgba[si] * aw;
        pg += src.rgba[si + 1] * aw;
        pb += src.rgba[si + 2] * aw;
        pa += src.rgba[si + 3] * w;
        wsum += w;
      }
    }

    const di = (dy * dw + dx) * 4;
    if (wsum === 0) continue;
    const alpha = pa / wsum;
    dst[di + 3] = clamp255(alpha);
    // 反预乘：pr 里每个颜色都被乘过 alpha，所以要除以 alpha 的加权和
    const aSum = pa / 255;
    if (aSum > 0.0001) {
      dst[di] = clamp255(pr / aSum);
      dst[di + 1] = clamp255(pg / aSum);
      dst[di + 2] = clamp255(pb / aSum);
    }
  }
}

fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, encodePNG(dw, dh, dst));

const before = fs.statSync(input).size;
const after = fs.statSync(output).size;
const kb = (n) => `${(n / 1024).toFixed(0)}KB`;
console.log(
  `${path.basename(input)}: ${src.w}×${src.h} (${kb(before)}) → ${dw}×${dh} (${kb(after)})  ` +
    `省 ${(100 - (after / before) * 100).toFixed(0)}%`
);
