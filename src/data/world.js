/**
 * 世界（战场）定义与坐标工具。
 *
 * 世界 1600×1200 = 视口 800×600 的 2×2。摄像机在其中移动，钳制在边界内，
 * 所以玩家永远看不到世界外的黑边，也永远不会走出战场。
 *
 * 约定：本文件里所有坐标都是**世界坐标**。要做屏幕定位请减去 camera。
 */
import { VIEW_W, VIEW_H } from '../gfx/canvas.js';

export const WORLD = { w: 1600, h: 1200 };

/** 角色/敌人贴世界边时留出的内缩，避免只露出半张脸 */
export const EDGE_PAD = 20;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 按半宽把 x 钳进世界 */
export function clampX(x, half = 0) {
  return clamp(x, half, WORLD.w - half);
}

export function clampY(y, half = 0) {
  return clamp(y, half, WORLD.h - half);
}

export function worldCenter() {
  return { x: WORLD.w / 2, y: WORLD.h / 2 };
}

/**
 * 判断一个世界坐标是否在视口外。
 * @param {number} margin 负数代表"要进入视口这么多像素才算进来"
 */
export function isOutsideView(x, y, camX, camY, margin = 0) {
  return (
    x < camX - margin ||
    x > camX + VIEW_W + margin ||
    y < camY - margin ||
    y > camY + VIEW_H + margin
  );
}

/**
 * 在玩家周围取一个**视野外**的刷怪点。
 *
 * 为什么不能沿用"屏幕外沿 ±25px"：世界比视口大之后，屏幕外沿指的是视口边界，
 * 而敌人必须从战场外面进来。这里改成以玩家为圆心、半径 620–780 的圆环取样，
 * 再用"是否落在当前视口矩形内"做二次筛选。
 *
 * 玩家被逼到世界角落时，圆环上的点可能全都在视口内（角落处视口对角距离只有约
 * 1000，而世界只剩一个方向可退），此时兜底取离玩家最远的世界角落，宁可贴边出现
 * 也不能让怪凭空生在脸前。
 *
 * @param {number} px 玩家世界 x
 * @param {number} py 玩家世界 y
 * @param {number} camX 摄像机 x
 * @param {number} camY 摄像机 y
 * @param {() => number} rnd 随机源（仅用 [0,1)）
 */
export function pickSpawnPoint(px, py, camX, camY, rnd) {
  const R_MIN = 620;
  const R_MAX = 780;
  const MARGIN = 24;

  for (let i = 0; i < 24; i++) {
    const a = rnd() * Math.PI * 2;
    const r = R_MIN + rnd() * (R_MAX - R_MIN);
    const x = clamp(px + Math.cos(a) * r, EDGE_PAD, WORLD.w - EDGE_PAD);
    const y = clamp(py + Math.sin(a) * r, EDGE_PAD, WORLD.h - EDGE_PAD);
    if (isOutsideView(x, y, camX, camY, MARGIN)) return { x, y };
  }

  // 兜底：世界四角里离玩家最远的那个
  const corners = [
    [EDGE_PAD, EDGE_PAD],
    [WORLD.w - EDGE_PAD, EDGE_PAD],
    [EDGE_PAD, WORLD.h - EDGE_PAD],
    [WORLD.w - EDGE_PAD, WORLD.h - EDGE_PAD],
  ];
  let best = corners[0];
  let bestD = -1;
  for (const [x, y] of corners) {
    const d = (x - px) ** 2 + (y - py) ** 2;
    if (d > bestD) {
      bestD = d;
      best = [x, y];
    }
  }
  return { x: best[0], y: best[1] };
}

/**
 * 在玩家周围取一个道具落点：要玩家走两步才能捡到，但不能远到看不见。
 * @param {() => number} rnd
 */
export function pickItemPoint(px, py, rnd) {
  const a = rnd() * Math.PI * 2;
  const r = 130 + rnd() * 290;
  return {
    x: clamp(px + Math.cos(a) * r, EDGE_PAD + 20, WORLD.w - EDGE_PAD - 20),
    y: clamp(py + Math.sin(a) * r, EDGE_PAD + 20, WORLD.h - EDGE_PAD - 20),
  };
}
