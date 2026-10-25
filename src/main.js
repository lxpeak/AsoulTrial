import { canvas, VIEW_W, VIEW_H } from './gfx/canvas.js';
import { createLoop } from './core/loop.js';
import { onPress } from './core/input.js';
import { loadSave } from './data/save.js';
import { app } from './game/app.js';
import { update } from './game/update.js';
import './ui/router.js'; // 副作用导入：把六个界面注册进界面栈
import { drawScreens, dispatchClick, dispatchKey, reset } from './ui/screen.js';
import { preloadImages } from './gfx/preload.js';
import { DEBUG, initDebug, drawDebug } from './ui/debug.js';

// 读档必须早于第一次绘制与第一次输入：设置项（音量/音效）要靠它生效
loadSave();
reset('title');

onPress(dispatchKey);

canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = ((e.clientX - rect.left) * VIEW_W) / rect.width;
  const my = ((e.clientY - rect.top) * VIEW_H) / rect.height;
  dispatchClick(mx, my);
});

// 调试钩子先挂上：加载期间也能在控制台里查界面栈，不用等进场
// 调试钩子：控制台里 __asoul.app.stack 能直接看到界面栈，排障比截图快
globalThis.__asoul = { app, screen: () => drawScreens, DEBUG };

// ?debug=1 才挂调试面板；按键监听也在里面，正式玩法完全不受影响
initDebug();

const boot = document.getElementById('boot');
let bootClosing = false;

function bootText(text) {
  if (!boot || bootClosing) return;
  boot.textContent = text;
}

/**
 * 启动顺序被这次改写动过，别轻易换回去：
 *
 *   读档 → 建输入 → **等图片** → 开循环 → 撤加载层
 *
 * 关键是"等图片"必须在"开循环"之前、且"撤加载层"必须是最后一步。
 * 之前是先开循环再立刻撤加载层，等于把"还没画出来"的那几秒直接暴露给玩家。
 */
async function bootGame() {
  bootText('加载中…');
  const res = await preloadImages(({ done, total }) => bootText(`加载中… ${done}/${total}`));

  if (!res.ok) {
    // 缺图不拦人：记一条警告就进场，让玩家至少能玩
    console.warn(`[预加载] ${res.failed.length}/${res.total} 张图没加载成功：${res.failed.join(', ')}`);
  }

  // 调试面板必须画在界面栈之后：它要盖在暂停/三选一那些半透明层上面，
  // 否则调数值时正好弹出三选一，面板就被压在底下了
  createLoop({ update, render: () => { drawScreens(); drawDebug(); } }).start();

  // 必须先置位再改 DOM：boot 的过渡动画里还会不会再被写文字无所谓，
  // 但状态要准，免得加载层撤到一半又被进度回调改了内容
  bootClosing = true;
  if (boot) boot.classList.add('hide');
}

bootGame();
