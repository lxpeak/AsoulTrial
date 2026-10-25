/**
 * 序列帧色相染色（离屏预处理）。
 *
 * 用途：四种敌人共用一张青蛙帧表，靠色相区分类型。
 *
 * ── 为什么不用每帧 ctx.filter ──
 * canvas 的 filter 在 drawImage 上是"每次绘制都重新跑一遍滤镜"。
 * 40 只怪 × 60fps = 2400 次带滤镜的缩放采样，中低端手机直接掉到 30 帧。
 * 而这里每种类型只需要染一次，之后就是普通的 drawImage，零额外开销。
 *
 * ── 为什么用 hue-rotate 而不是叠一层半透明色 ──
 * hue-rotate 只旋转色相、不动亮度，而无彩色（白/灰/黑）根本没有色相可转。
 * 青蛙的白眼球、白衬衫、牙齿因此完全不受影响。
 * 如果改用 source-atop 叠色，白眼球会变成淡紫/淡黄，看着像贴图损坏。
 *
 * 代价是一份额外的离屏位图（源图尺寸）。四种类型里只有三种需要染色，
 * 约 18MB —— 换来的是每帧零成本，这笔账在割草游戏里是划算的。
 */

/** key 形如 `enemy_q:152:1.1`，同一张图 + 同一套参数只染一次 */
const cache = new Map();

/**
 * 拿到染色后的图。不需要染色（hue 为 0）时原样返回。
 *
 * @param {string} key  缓存键前缀（帧表 key）
 * @param {HTMLImageElement} img 已加载完成的源图
 * @param {number} hue  色相旋转角度
 * @param {number} saturate 饱和度倍率
 */
export function tintedSprite(key, img, hue, saturate = 1) {
  if (!hue) return img;
  if (!img || !img.naturalWidth) return img;

  const id = `${key}:${hue}:${saturate}`;
  const hit = cache.get(id);
  if (hit) return hit;

  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d');
  // 老 Safari（<16.4）没有 ctx.filter。这种情况下直接放弃染色、
  // 返回原图——少一种颜色区分，总好过一个满屏黑色的游戏
  if ('filter' in g) {
    g.filter = `hue-rotate(${hue}deg) saturate(${saturate})`;
  }
  g.drawImage(img, 0, 0);

  cache.set(id, c);
  return c;
}

/** 重开一局 / 换素材时清掉，避免拿到旧帧表染出来的图 */
export function clearTintCache() {
  cache.clear();
}
