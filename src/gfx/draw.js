import { ctx, VIEW_W, VIEW_H } from './canvas.js';
import { IMGS } from './assets.js';
import { WORLD } from '../data/world.js';

export function imgAt(key, x, y, w, h, alpha = 1) {
  const img = IMGS[key];
  if (!img || !img.complete || !img.naturalWidth) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
  ctx.restore();
}

export function txt(str, x, y, { size = 16, color = '#fff', align = 'center', bold = false, shadow = false } = {}) {
  ctx.save();
  ctx.font = `${bold ? 'bold ' : ''}${size}px 微软雅黑,sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  if (shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 6;
  }
  ctx.fillText(str, x, y);
  ctx.restore();
}

export function rrect(x, y, w, h, r, fill, stroke, lw = 1) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

const BASE_COLOR = '#22331c';

/**
 * 世界底图缓存。
 *
 * 背景素材是 1903×1857，比世界 1600×1200 还大——所以**根本不需要平铺**。
 * 一次性把素材按 cover 缩放画进一张 WORLD 尺寸的离屏画布，之后每帧只把
 * "摄像机看到的那一块"贴出来。
 *
 * 为什么不用平铺 + 镜像：素材是一张完整的"场景图"（中间有祭坛），平铺会在
 * 每 800/600px 处留下明显的对称轴，随镜头移动时像镜面扫过屏幕。整图裁切没有接缝。
 * 只有当素材比世界小时才退回平铺（镜像弱化重复），这种情况目前不会发生。
 */
let bgCanvas = null;
let bgFailed = false;

function buildBackground() {
  const img = IMGS.background;
  if (!img || !img.complete || !img.naturalWidth) return null;
  if (bgCanvas || bgFailed) return bgCanvas;

  try {
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = WORLD.w;
    c.height = WORLD.h;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';

    const cover = Math.max(WORLD.w / nw, WORLD.h / nh);
    if (cover <= 1.02) {
      // 素材够大：整张按 cover 居中裁切
      const dw = nw * cover;
      const dh = nh * cover;
      g.drawImage(img, (WORLD.w - dw) / 2, (WORLD.h - dh) / 2, dw, dh);
    } else {
      // 素材比世界小：平铺填满，奇偶块镜像避免四宫格重复
      const tw = nw;
      const th = nh;
      for (let j = 0; j * th < WORLD.h; j++) {
        for (let i = 0; i * tw < WORLD.w; i++) {
          const flipX = (i & 1) === 1;
          const flipY = (j & 1) === 1;
          g.save();
          g.translate(i * tw + (flipX ? tw : 0), j * th + (flipY ? th : 0));
          g.scale(flipX ? -1 : 1, flipY ? -1 : 1);
          g.drawImage(img, 0, 0, tw, th);
          g.restore();
        }
      }
    }
    bgCanvas = c;
  } catch (e) {
    bgFailed = true;
    bgCanvas = null;
  }
  return bgCanvas;
}

/**
 * 战场背景：贴出摄像机看到的那一块世界底图。
 * 在**屏幕空间**调用（贴图本身已经算好偏移，不需要 beginWorld）。
 */
export function worldBackground(camX, camY) {
  ctx.fillStyle = BASE_COLOR;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const src = buildBackground();
  if (src) {
    ctx.drawImage(src, camX, camY, VIEW_W, VIEW_H, 0, 0, VIEW_W, VIEW_H);
    return;
  }

  // 图片还没加载好：铺纯色，至少不是白屏
  const img = IMGS.background;
  if (!img || !img.complete || !img.naturalWidth) return;
  ctx.drawImage(img, camX, camY, VIEW_W, VIEW_H, 0, 0, VIEW_W, VIEW_H);
}

/**
 * 世界边界提示。在 beginWorld() 之后调用（世界坐标）。
 * 用一圈半透明金线 + 内阴影，让玩家一眼看出"这边到头了"，而不是以为画面卡住。
 */
export function worldBorder() {
  const pad = 6;
  ctx.save();
  // 世界边缘的暗角：往里 26px 渐隐，让边界看起来是"墙"而不是"画布截断"
  ctx.strokeStyle = 'rgba(0,0,0,0.26)';
  ctx.lineWidth = 26;
  ctx.strokeRect(13, 13, WORLD.w - 26, WORLD.h - 26);

  ctx.strokeStyle = 'rgba(255,215,0,0.30)';
  ctx.lineWidth = 3;
  ctx.strokeRect(pad, pad, WORLD.w - pad * 2, WORLD.h - pad * 2);
  ctx.restore();
}
