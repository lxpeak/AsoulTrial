/**
 * 画布与高清化。
 *
 * 坐标系统分两层，务必区分：
 *   - VIEW_W / VIEW_H：**画布**（视口）逻辑尺寸，恒 800×600。HUD、菜单、摇杆都用它。
 *   - WORLD（见 data/world.js）：**战场**尺寸 1600×1200。角色、子弹、敌人用它。
 * 历史上这两个概念都叫 W/H，导致"画布边界"和"世界边界"混用，已彻底拆开。
 */
export const VIEW_W = 800;
export const VIEW_H = 600;

export const dpr = Math.min(window.devicePixelRatio || 1, 2);

export const canvas = document.getElementById('gameCanvas');
canvas.width = VIEW_W * dpr;
canvas.height = VIEW_H * dpr;
canvas.style.width = VIEW_W + 'px';
canvas.style.height = VIEW_H + 'px';

export const ctx = canvas.getContext('2d');
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
