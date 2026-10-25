/**
 * 粒子特效。
 * 单独成文件是为了让 combat.js 和 update.js 都能用，避免两者互相 import 造成循环依赖。
 */
import { rng } from '../core/rng.js';

/**
 * 在指定位置炸开一簇粒子。
 * @param {object} gs 游戏状态
 * @param {number} x 世界坐标
 * @param {number} y 世界坐标
 * @param {string} color
 * @param {number} n 粒子数
 * @param {number} sm 速度倍率（大爆炸用 2~3）
 */
export function spawnFX(gs, x, y, color, n, sm = 1) {
  for (let i = 0; i < n; i++) {
    const a = rng.next() * Math.PI * 2;
    const s = (1 + rng.next() * 3) * sm;
    gs.particles.push({
      x,
      y,
      dx: Math.cos(a) * s,
      dy: Math.sin(a) * s,
      life: 30 + rng.next() * 20,
      color,
    });
  }
}
