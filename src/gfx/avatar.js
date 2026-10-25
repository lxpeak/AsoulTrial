/**
 * 立绘处理：把"白底方形 jpg"变成"带透明通道的贴图"。
 *
 * 现有素材三个角色都是白底 jpg（168×168 / 225×225），直接 drawImage 到
 * 绿色草地上就是一个白方块，这是比"不动"更伤观感的问题。
 *
 * 为什么不用纯阈值一刀切：角色身上也有大块白色（嘉然的白围裙、眼白、
 * 高光），按颜色判会连衣服一起抠穿。这里用**从四边开始的泛洪填充**：
 * 只抠掉"和图片边缘连通的白"，被深色线条包住的白色一律保留。
 *
 * 顺带做一步收边：紧贴透明区的浅色像素降为半透明，消除 jpg 压缩留下的
 * 一圈白边（不处理的话，角色轮廓会挂上一层灰白毛边，比白方块还显眼）。
 *
 * 结果缓存在离屏 canvas 里，只在第一次绘制时算一次。
 */
import { IMGS } from './assets.js';

const cache = new Map();

/** 与背景参考色的最大曼哈顿色差（纸纹、jpeg 噪声一般在 40 以内） */
const BG_TOLERANCE = 52;
/** 低于这个亮度一定不是背景（背景接近纯白） */
const MIN_LUM = 226;
/** 收边时视为"浅色"的亮度门槛 */
const EDGE_LUM = 198;

function colorDist(d, i, r0, g0, b0) {
  return Math.abs(d[i] - r0) + Math.abs(d[i + 1] - g0) + Math.abs(d[i + 2] - b0);
}

function keyOut(img) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true });
  if (!g) return cv;
  g.drawImage(img, 0, 0);

  let data = null;
  try {
    data = g.getImageData(0, 0, w, h);
  } catch {
    return cv; // 读不到像素（跨域 / 无头桩），退回原图
  }
  if (!data || !data.data) return cv;
  const d = data.data;

  // 背景参考色：从四条边里挑"亮且无彩"的那一批像素求平均。
  //
  // 不能直接用四角平均——贝拉那张图的左下角是深褐 (34,29,0)、右下角是
  // 深紫 (94,88,132)（角色头发顶到了画布角上），平均出来是个中间灰，
  // 跟纯白底的色差远超容差，结果一个像素都抠不掉，角色顶着白方块满场跑。
  // 边缘采样只统计"像纸白"的像素，角色贴边也不会把参考色带偏。
  let r0 = 0;
  let g0 = 0;
  let b0 = 0;
  let n = 0;
  const sample = (x, y) => {
    const i = (y * w + x) * 4;
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const mn = Math.min(r, g, b);
    const mx = Math.max(r, g, b);
    if (mn >= 200 && mx - mn <= 24) {
      r0 += r;
      g0 += g;
      b0 += b;
      n++;
    }
  };
  for (let x = 0; x < w; x++) {
    sample(x, 0);
    sample(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    sample(0, y);
    sample(w - 1, y);
  }

  if (n < (w + h) * 0.2) {
    // 边缘几乎没有纸白（角色贴满整圈），退回四角平均，至少不会完全失效
    r0 = 0;
    g0 = 0;
    b0 = 0;
    const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + (w - 1)) * 4];
    for (const i of corners) {
      r0 += d[i];
      g0 += d[i + 1];
      b0 += d[i + 2];
    }
    n = corners.length;
  }
  r0 /= n;
  g0 /= n;
  b0 /= n;

  // mask: 0 未访问 / 1 已判定为背景 / 2 已判定为前景
  const mask = new Uint8Array(w * h);
  const stack = [];

  const tryPush = (x, y) => {
    const p = y * w + x;
    if (mask[p]) return;
    const i = p * 4;
    const mn = Math.min(d[i], d[i + 1], d[i + 2]);
    if (mn < MIN_LUM || colorDist(d, i, r0, g0, b0) > BG_TOLERANCE) {
      mask[p] = 2;
      return;
    }
    mask[p] = 1;
    stack.push(p);
  };

  for (let x = 0; x < w; x++) {
    tryPush(x, 0);
    tryPush(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    tryPush(0, y);
    tryPush(w - 1, y);
  }

  while (stack.length) {
    const p = stack.pop();
    const x = p % w;
    const y = (p / w) | 0;
    d[p * 4 + 3] = 0;
    if (x > 0) tryPush(x - 1, y);
    if (x < w - 1) tryPush(x + 1, y);
    if (y > 0) tryPush(x, y - 1);
    if (y < h - 1) tryPush(x, y + 1);
  }

  // 二次清除：角色贴到画布边缘时，会把白底切成几块互不相通的区域，
  // 四边出发的泛洪只走得到其中一块，剩下的就变成角色身下一块"死白"。
  // 这里把没被访问到的孤立块单独标出来——只清"颜色几乎均匀"的块：
  // 白裙子、白袜子有褶皱和阴影，亮度起伏明显，不会中招。
  const seen = new Uint8Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (mask[start] !== 0 || seen[start]) continue;
    const block = [start];
    seen[start] = 1;
    for (let k = 0; k < block.length; k++) {
      const p = block[k];
      const x = p % w;
      const y = (p / w) | 0;
      if (x > 0 && mask[p - 1] === 0 && !seen[p - 1]) {
        seen[p - 1] = 1;
        block.push(p - 1);
      }
      if (x < w - 1 && mask[p + 1] === 0 && !seen[p + 1]) {
        seen[p + 1] = 1;
        block.push(p + 1);
      }
      if (y > 0 && mask[p - w] === 0 && !seen[p - w]) {
        seen[p - w] = 1;
        block.push(p - w);
      }
      if (y < h - 1 && mask[p + w] === 0 && !seen[p + w]) {
        seen[p + w] = 1;
        block.push(p + w);
      }
    }
    if (block.length > w * h * 0.2) continue; // 太大，像整片前景，别碰

    let uniform = true;
    let sum = 0;
    let sum2 = 0;
    for (const p of block) {
      const i = p * 4;
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      if (Math.min(r, g, b) < MIN_LUM || colorDist(d, i, r0, g0, b0) > BG_TOLERANCE) {
        uniform = false;
        break;
      }
      const lum = (r + g + b) / 3;
      sum += lum;
      sum2 += lum * lum;
    }
    if (!uniform) continue;
    const mean = sum / block.length;
    const sd = Math.sqrt(Math.max(0, sum2 / block.length - mean * mean));
    if (sd > 5) continue; // 有明暗过渡，是衣服不是背景
    // 同步标记成"背景"，后面的收边才知道这些位置已经是透明的
    for (const p of block) {
      d[p * 4 + 3] = 0;
      mask[p] = 1;
    }
  }

  // 收边：jpg 的白底会在轮廓外留 2~3px 的浅灰过渡，只处理紧贴的那一圈
  // 会剩下一层灰毛，所以做两圈渐弱——第一圈几乎全透，第二圈半透。
  // 同一圈的命中先收集再统一写入，避免这一圈内部互相传染、一路啃进角色。
  const edged = new Uint8Array(w * h);
  for (let pass = 0; pass < 2; pass++) {
    const a = pass === 0 ? 34 : 96;
    const lum = pass === 0 ? EDGE_LUM : EDGE_LUM + 18;
    const hits = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (mask[p] === 1 || edged[p]) continue;
        const i = p * 4;
        if (Math.min(d[i], d[i + 1], d[i + 2]) < lum) continue;
        const touching =
          (x > 0 && (mask[p - 1] === 1 || edged[p - 1])) ||
          (x < w - 1 && (mask[p + 1] === 1 || edged[p + 1])) ||
          (y > 0 && (mask[p - w] === 1 || edged[p - w])) ||
          (y < h - 1 && (mask[p + w] === 1 || edged[p + w]));
        if (touching) hits.push(p);
      }
    }
    for (const p of hits) {
      d[p * 4 + 3] = a;
      edged[p] = 1;
    }
  }

  g.putImageData(data, 0, 0);
  return cv;
}

/**
 * 取一张已抠底的立绘。图片没加载完时返回 null（调用方回退到原图）。
 *
 * 将来若某角色有了序列帧，只需在 assets 里给它配 frames 数组，
 * 在这里按 index 取对应帧并缓存——绘制端不用改。
 * @param {string} key IMGS 里的键（如 'jiaran'）
 */
export function getAvatar(key) {
  const hit = cache.get(key);
  if (hit) return hit;
  const img = IMGS[key];
  if (!img || !img.complete || !img.naturalWidth) return null;
  const out = keyOut(img);
  cache.set(key, out);
  return out;
}
