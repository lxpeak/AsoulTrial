/**
 * 调试面板：`?debug=1` 才挂上（TECH_PLAN「一、运行与开发」）。
 *
 * ── 为什么必须有 ──
 *
 * 肉鸽调参的循环是"改一个数 → 开一局 → 打两分钟 → 死掉 → 再看"。
 * 没有面板就只能靠感觉判断"这一波是不是太密了"，一天调不出三张卡。
 * 有了它，精英/Boss 节点、血量系数、刷怪间隔全都变成可以盯着看的数字。
 *
 * ── 几个刻意的设计 ──
 *
 * 1. **只在 `?debug=1` 时生效**。挂在线上供所有玩家看 FPS 只会让人分心，
 *    而且 F1~F4 会抢走正常按键。
 * 2. **不进游戏逻辑**。面板只读 `app.gs`，写操作全部通过现成的公开函数
 *    （`gainXP` / `damageEnemy`），不直接改 hp / enemies 数组——否则
 *    调试路径和真实路径行为不一致，"调出来的手感"就是假的。
 * 3. **F3 无敌用 `p.god` 而不是借 `p.invincible`**。借无敌帧会让角色
 *    每 5 帧闪一次、还一直播受击姿势，看着像出了 bug；而且会和真实的
 *    受击无敌抢同一个字段。
 */

import { ctx, VIEW_W, VIEW_H } from '../gfx/canvas.js';
import { app } from '../game/app.js';
import { guardKind } from '../game/guard.js';
import { gainXP, xpNeed } from '../game/level.js';
import { damageEnemy } from '../game/combat.js';
import { PHASES, phaseInfo, hpScaleAt, intervalAt } from '../game/director.js';
import { elapsedSeconds } from '../game/state.js';
import { PARAMS } from '../core/params.js';

export const DEBUG = {
  on: false,
  fps: 0,
  /** 上一次绘制时刻，用来算渲染帧率（除零保护见 drawDebug） */
  last: 0,
};

const FONT = '11px Consolas, Menlo, monospace';

function line(text, x, y, color) {
  ctx.font = FONT;
  ctx.fillStyle = color || '#cfe3ff';
  ctx.fillText(text, x, y);
}

/**
 * 跳波：把时间拨到下一个阶段起点。
 *
 * 用 `PHASES` 算下一档而不是 +60 秒——阶段表是"作者定好的节奏刻度"，
 * +60 秒可能一次跨两个阶段，跳过的那一档永远看不到。
 */
function jumpPhase() {
  const gs = app.gs;
  if (!gs) return;
  const sec = gs.time / 60;
  const next = PHASES.find((p) => p.at > sec);
  gs.time = (next ? next.at : Math.floor(sec / 60) * 60 + 60) * 60;
}

function forceLevel() {
  const gs = app.gs;
  if (!gs) return;
  const p = gs.player;
  // 走真实的加经验入口：这样"升级动画 / 三选一"也一起验了，
  // 直接改 level 会跳过整个流程，等于没测
  gainXP(gs, Math.max(1, xpNeed(p.level) - p.xp));
}

function toggleGod() {
  const gs = app.gs;
  if (!gs) return;
  gs.player.god = gs.player.god ? 0 : 1;
}

function clearScreen() {
  const gs = app.gs;
  if (!gs) return;
  // 拷贝再遍历：damageEnemy 会把死掉的从原数组移除
  for (const e of [...gs.enemies]) {
    damageEnemy(gs, e, Infinity, { hitFx: null, hitSfx: null, deathSfx: null, deathFx: null });
  }
  gs.eBullets.length = 0;
}

const KEYS = {
  F1: jumpPhase,
  F2: forceLevel,
  F3: toggleGod,
  F4: clearScreen,
};

/**
 * 处理一个调试热键，返回是否被消费。
 *
 * 单独抽出来是为了能测：`initDebug` 要往 `window` 上挂监听，测试里没有真实键盘，
 * 直接调这个函数就能验"F1 真的跳了一波"。
 */
export function handleDebugKey(key) {
  if (!DEBUG.on) return false;
  const fn = KEYS[key];
  if (!fn) return false;
  fn();
  return true;
}

/**
 * 挂上键盘监听。只在 `?debug=1` 时由 main.js 调用。
 */
export function initDebug() {
  if (!PARAMS.debug) return;
  DEBUG.on = true;
  window.addEventListener('keydown', (e) => {
    // F1 会开浏览器帮助、F3/F4 在部分环境也有默认行为，消费掉才不打架
    if (handleDebugKey(e.key)) e.preventDefault();
  });
}

/** 每帧一次，画在界面栈之后（所以它永远在最上层） */
export function drawDebug() {
  if (!DEBUG.on) return;
  const now = performance.now();
  if (DEBUG.last) {
    const dt = now - DEBUG.last;
    // 指数平滑：单帧抖动会让数字疯狂跳，读不出"稳不稳"
    if (dt > 0) DEBUG.fps = DEBUG.fps * 0.9 + (1000 / dt) * 0.1;
  }
  DEBUG.last = now;

  const gs = app.gs;
  const rows = [];
  if (!gs) {
    rows.push(['FPS', DEBUG.fps.toFixed(0), '— 无对局（先在标题页开始游戏）']);
  } else {
    const p = gs.player;
    const info = phaseInfo(gs);
    rows.push([
      'FPS',
      DEBUG.fps.toFixed(0),
      `敌 ${gs.enemies.length}  弹 ${gs.bullets.length}  敌弹 ${gs.eBullets.length}  粒 ${gs.particles.length}  道具 ${gs.items.length}`,
    ]);
    rows.push([
      '阶段',
      `${info.tag} ${info.seconds}s`,
      `血量×${hpScaleAt(gs.time / 60).toFixed(2)}  间隔 ${intervalAt(gs.time / 60)}f  精英 ${gs.elitesSpawned}  Boss ${gs.bossesSpawned}`,
    ]);
    const gk = guardKind(p);
    const guardText = gk === 'thorns' ? `thorns ×${p.thornCharges}` : gk || '无';
    rows.push([
      '玩家',
      `Lv.${p.level} ${p.xp}/${xpNeed(p.level)}`,
      `击杀 ${gs.kills}  HP ${p.hp}/${p.maxHp}  护体 ${guardText}  坐标 ${p.x.toFixed(0)},${p.y.toFixed(0)}`,
    ]);
    rows.push(['seed', String(gs.seed || '—'), '给复现用：?seed=' + (gs.seed || '')]);
  }

  const H = 16 + rows.length * 14 + 16;
  ctx.save();
  ctx.fillStyle = 'rgba(8,10,20,0.72)';
  ctx.fillRect(0, 44, VIEW_W, H);
  ctx.strokeStyle = 'rgba(120,180,255,0.28)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 44.5, VIEW_W - 1, H - 1);

  let y = 58;
  for (const [label, value, rest] of rows) {
    line(label, 6, y, '#7fb2e5');
    line(value, 44, y, '#ffd700');
    line(rest, 150, y, '#cfe3ff');
    y += 14;
  }
  line('F1 跳波   F2 升级   F3 无敌' + (gs && gs.player.god ? '（开）' : '') + '   F4 清屏', 6, y + 8, '#7f8fa6');
  ctx.restore();
}
