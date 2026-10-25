import { canvas, VIEW_W, VIEW_H } from '../gfx/canvas.js';

/**
 * 输入层只产出"语义"：移动轴、瞄准轴、离散按键。
 * 上层永远不读 keys['KeyW']，以后接手柄只需在这里补映射。
 */

const MOVE_KEYS = { KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0] };
const AIM_KEYS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Escape']);

const DEAD_ZONE = 0.2;
const STICK_R = 60;
const SKILL_BTN = { x: VIEW_W - 64, y: VIEW_H - 64, r: 30 };

const held = new Set();
const pressHandlers = [];
const pointers = new Map(); // pointerId -> 'left' | 'right'

export const input = {
  move: { x: 0, y: 0 },
  aim: { x: 0, y: 0 },
  sticks: { left: null, right: null },
  skillGlow: 0,
  sticksEnabled: false,
};

export function onPress(fn) {
  pressHandlers.push(fn);
}

function emitPress(code) {
  for (const fn of pressHandlers) fn(code);
}

export function setSticksEnabled(on) {
  input.sticksEnabled = on;
  if (!on) {
    input.sticks.left = null;
    input.sticks.right = null;
    pointers.clear();
  }
}

export function isAiming() {
  return Math.hypot(input.aim.x, input.aim.y) > DEAD_ZONE;
}

export function syncInput() {
  let mx = 0;
  let my = 0;
  let ax = 0;
  let ay = 0;

  for (const code of held) {
    const m = MOVE_KEYS[code];
    if (m) {
      mx += m[0];
      my += m[1];
    }
    const a = AIM_KEYS[code];
    if (a) {
      ax += a[0];
      ay += a[1];
    }
  }

  const left = input.sticks.left;
  const right = input.sticks.right;
  if (left) {
    mx = left.nx;
    my = left.ny;
  }
  if (right) {
    ax = right.nx;
    ay = right.ny;
  }

  const ml = Math.hypot(mx, my);
  if (ml > 1) {
    mx /= ml;
    my /= ml;
  }
  const al = Math.hypot(ax, ay);
  if (al > 1) {
    ax /= al;
    ay /= al;
  }

  input.move.x = mx;
  input.move.y = my;
  input.aim.x = ax;
  input.aim.y = ay;
  if (input.skillGlow > 0) input.skillGlow--;
}

export function clearHeld() {
  held.clear();
  input.sticks.left = null;
  input.sticks.right = null;
  pointers.clear();
}

// ==================== 键盘 ====================
window.addEventListener('keydown', (e) => {
  if (PREVENT.has(e.code)) e.preventDefault();
  if (held.has(e.code)) return;
  held.add(e.code);
  emitPress(e.code);
});

window.addEventListener('keyup', (e) => {
  held.delete(e.code);
});

// 切窗口时清空按键，避免 Alt+Tab 之后角色一直往一个方向飘
window.addEventListener('blur', clearHeld);

// ==================== 触屏双摇杆 ====================
function logicalPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (VIEW_W / rect.width),
    y: (e.clientY - rect.top) * (VIEW_H / rect.height),
  };
}

canvas.addEventListener('pointerdown', (e) => {
  if (!input.sticksEnabled) return;
  const pt = logicalPoint(e);

  if (Math.hypot(pt.x - SKILL_BTN.x, pt.y - SKILL_BTN.y) < SKILL_BTN.r) {
    input.skillGlow = 12;
    emitPress('Space');
    return;
  }

  const side = pt.x < VIEW_W / 2 ? 'left' : 'right';
  if (input.sticks[side]) return;

  input.sticks[side] = { baseX: pt.x, baseY: pt.y, x: pt.x, y: pt.y, nx: 0, ny: 0 };
  pointers.set(e.pointerId, side);
  if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  const side = pointers.get(e.pointerId);
  if (!side) return;
  const stick = input.sticks[side];
  if (!stick) return;

  const pt = logicalPoint(e);
  let dx = pt.x - stick.baseX;
  let dy = pt.y - stick.baseY;
  const len = Math.hypot(dx, dy);
  if (len > STICK_R) {
    dx = (dx / len) * STICK_R;
    dy = (dy / len) * STICK_R;
  }
  stick.x = stick.baseX + dx;
  stick.y = stick.baseY + dy;
  stick.nx = dx / STICK_R;
  stick.ny = dy / STICK_R;
});

function releasePointer(e) {
  const side = pointers.get(e.pointerId);
  if (!side) return;
  pointers.delete(e.pointerId);
  input.sticks[side] = null;
}

canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);

export { SKILL_BTN, STICK_R, DEAD_ZONE };
