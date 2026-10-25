/**
 * 摄像机：把世界坐标映射到屏幕坐标。
 *
 * 只做平移，不做缩放（缩放留给以后的小地图/震屏）。钳制在世界边界内，
 * 所以视口永远落在战场里——玩家不会看到世界外的空白。
 *
 * 取整到整数像素：DPR 放大后半个像素的偏移会让整屏纹理发虚。
 */
import { ctx, VIEW_W, VIEW_H } from '../gfx/canvas.js';
import { WORLD, clamp } from '../data/world.js';

export const cam = { x: 0, y: 0 };

/** 让摄像机跟着某个世界坐标（通常是玩家），并钳制在边界内 */
export function updateCamera(px, py) {
  // 取整：摄像机停在半像素上，整屏贴图和精灵都会发虚
  cam.x = Math.round(clamp(px - VIEW_W / 2, 0, WORLD.w - VIEW_W));
  cam.y = Math.round(clamp(py - VIEW_H / 2, 0, WORLD.h - VIEW_H));
}

/** 进入世界坐标系绘制：之后所有绘制都用世界坐标 */
export function beginWorld() {
  ctx.save();
  ctx.translate(-Math.round(cam.x), -Math.round(cam.y));
}

export function endWorld() {
  ctx.restore();
}

/** 世界坐标 → 屏幕坐标（画世界外的东西时偶尔要用） */
export function toScreenX(x) {
  return x - cam.x;
}

export function toScreenY(y) {
  return y - cam.y;
}
