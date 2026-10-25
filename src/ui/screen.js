/**
 * 界面栈。
 *
 * 为什么需要它：原来的"当前在哪个界面"是一个字符串 + 六段 if-else，
 * 每加一个界面（升级三选一、装备选择、图鉴……）都要在 onKeyPress 和
 * onCanvasClick 里各改一处，而且要自己记"我是从哪个界面点进设置的"
 * （曾经用 app.settingsFrom 这个补丁）。界面对话框天然是栈：
 * 进入 = push，返回 = pop，谁压在上面谁收输入，下面的一律不动。
 *
 * 约定：
 *  - `opaque: true`  该界面自己铺满画面，下面的界面不再绘制（如标题、角色选择）
 *  - `opaque: false` 半透明遮罩，下面的界面继续绘制（如暂停、结算、三选一）
 *  - 输入只发给栈顶，栈顶不处理就丢弃 —— 不会出现"暂停时按空格还放技能"
 *  - 栈里存的是**名字**，绘制/输入时才查表，所以后注册的界面也能用
 */
import { app } from '../game/app.js';
import { setSticksEnabled } from '../core/input.js';

/** @type {Map<string, object>} */
const registry = new Map();
/** @type {string[]} */
const stack = [];

/**
 * 注册一个界面。
 * @param {string} name
 * @param {{draw?:Function, onKey?:Function, onClick?:Function,
 *          onEnter?:Function, onExit?:Function, opaque?:boolean}} def
 */
export function register(name, def) {
  registry.set(name, {
    name,
    opaque: def.opaque !== false,
    draw: def.draw || null,
    onKey: def.onKey || null,
    onClick: def.onClick || null,
    onEnter: def.onEnter || null,
    onExit: def.onExit || null,
  });
}

const FALLBACK = { name: '?', opaque: true, draw: null, onKey: null, onClick: null, onEnter: null, onExit: null };

function defOf(name) {
  return registry.get(name) || FALLBACK;
}

/** 每次栈变化后把状态同步给 app（update.js 等老代码仍在读 app.screen） */
function sync() {
  const top = stack.length ? stack[stack.length - 1] : null;
  app.screen = top;
  app.stack = stack.slice();
  // 摇杆只在真正打游戏时可用：暂停 / 结算 / 三选一都应该让位给点击
  setSticksEnabled(top === 'game');
}

/** 栈顶界面名，空栈为 null */
export function current() {
  return stack.length ? stack[stack.length - 1] : null;
}

/** 栈深度，调试用 */
export function depth() {
  return stack.length;
}

/** 压入一个界面（下面那个继续绘制，如果它是半透明的） */
export function push(name) {
  const d = defOf(name);
  stack.push(name);
  d.onEnter?.();
  sync();
}

/** 弹出栈顶，返回被弹出的名字 */
export function pop() {
  if (!stack.length) return null;
  const name = stack.pop();
  defOf(name).onExit?.();
  sync();
  return name;
}

/** 替换栈顶（同层级跳转，如 标题 → 角色选择 → 游戏） */
export function replace(name) {
  if (!stack.length) {
    push(name);
    return;
  }
  const old = stack.pop();
  defOf(old).onExit?.();
  stack.push(name);
  defOf(name).onEnter?.();
  sync();
}

/** 清空并重建为单个界面（开新局、回主菜单用） */
export function reset(name) {
  for (let i = stack.length - 1; i >= 0; i--) defOf(stack[i]).onExit?.();
  stack.length = 0;
  stack.push(name);
  defOf(name).onEnter?.();
  sync();
}

/**
 * 从"最上面那个不透明界面"开始往上画。
 * 半透明界面（暂停/结算）会自动带上下面的游戏画面，不用调用方手动补。
 */
export function drawScreens() {
  if (!stack.length) return;
  let base = 0;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (defOf(stack[i]).opaque) {
      base = i;
      break;
    }
  }
  for (let i = base; i < stack.length; i++) defOf(stack[i]).draw?.();
}

/** 把按键交给栈顶，返回是否被处理 */
export function dispatchKey(code) {
  const fn = defOf(current() || '').onKey;
  if (!fn) return false;
  fn(code);
  return true;
}

/** 把点击交给栈顶 */
export function dispatchClick(mx, my) {
  const fn = defOf(current() || '').onClick;
  if (!fn) return false;
  fn(mx, my);
  return true;
}
