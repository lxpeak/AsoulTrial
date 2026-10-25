/**
 * 经验与升级三选一。
 *
 * 这一层只做四件事：
 *   1. 记经验、算升级（可以一次连升多级，pendingLevels 记欠着的次数）
 *   2. 按权重抽 3 张卡
 *   3. 把选中的卡 apply 到 player 上
 *   4. 开关三选一界面
 *
 * **不在伤害/击杀里直接推界面**：一次爆炸可能同时打死 6 只怪，如果在
 * damageEnemy 里 push 界面，同一帧剩下的结算还会继续跑，甚至可能紧接着
 * 触发死亡结算，把 gameOver 叠在升级界面上。所以这里只累加待升级次数，
 * 由 update() 在**一帧的全部结算做完之后**统一调用 openUpgrade()。
 */
import { CARD_LIST } from '../data/cards.js';
import { app } from './app.js';
import { push, pop } from '../ui/screen.js';
import { rng } from '../core/rng.js';
import { SFX } from '../gfx/assets.js';

/** 升到下一级所需经验。递增但别太陡，一局里能摸到十级左右 */
export function xpNeed(level) {
  return 5 + level * 3;
}

/**
 * 加经验，返回这次升了几级。
 * 溢出经验会带到下一级（不像某些游戏那样清零），连升时也会逐级结算。
 */
export function gainXP(gs, n) {
  const p = gs.player;
  p.xp += n;
  let ups = 0;
  while (p.xp >= xpNeed(p.level)) {
    p.xp -= xpNeed(p.level);
    p.level++;
    p.pendingLevels++;
    ups++;
  }
  if (ups > 0) SFX.levelUp();
  return ups;
}

/** 某张卡还能不能拿 */
function available(gs, card) {
  return (gs.player.upgrades[card.id] || 0) < card.max;
}

/**
 * 权重随时间挪移：前期数值卡多、后期质变卡多。
 * 用等级做自变量而不是时间，因为等级才是"这一局走到哪了"的可靠刻度。
 */
function weightOf(gs, card) {
  const lv = gs.player.level;
  if (card.tier === 'special') {
    return card.weight * (1 + Math.min(1.5, (lv - 1) * 0.12));
  }
  return card.weight * Math.max(0.55, 1 - (lv - 1) * 0.04);
}

/**
 * 抽 count 张不重复的卡（权重轮盘，抽到就从池子里拿掉）。
 * 池子不够时有多少给多少 —— 界面按实际张数居中排。
 */
export function rollCards(gs, count = 3) {
  const pool = CARD_LIST.filter((c) => available(gs, c));
  const out = [];
  while (out.length < count && pool.length > 0) {
    let total = 0;
    for (const c of pool) total += weightOf(gs, c);
    let r = rng.next() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= weightOf(gs, pool[i]);
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    out.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return out;
}

/**
 * 该升级就推界面。只在战斗界面、并且确实欠着升级时生效。
 * @returns {boolean} 是否打开了三选一
 */
export function openUpgrade() {
  const gs = app.gs;
  if (!gs) return false;
  if (app.screen !== 'game') return false;

  const p = gs.player;
  if (p.pendingLevels <= 0) return false;

  const choices = rollCards(gs, 3);
  if (choices.length === 0) {
    // 卡池抽干了（理论上十级内不可能），给个保底而不是卡死流程
    p.atk = Math.round((p.atk + 0.5) * 100) / 100;
    p.pendingLevels = 0;
    return false;
  }

  app.upgradeChoices = choices;
  app.upgradeIdx = 0;
  app.upgradeAt = performance.now();
  push('upgrade');
  return true;
}

/**
 * 选中第 idx 张。
 * 选完先关界面再判断还有没有欠着的升级，所以连升两级时会连续弹两次，
 * 而不是把两次的卡混在一屏里让人一次选两个。
 */
export function chooseCard(idx) {
  const gs = app.gs;
  const list = app.upgradeChoices || [];
  const card = list[idx];
  if (!card || !gs) return false;

  const p = gs.player;
  card.apply(p, gs);
  p.upgrades[card.id] = (p.upgrades[card.id] || 0) + 1;
  p.pendingLevels = Math.max(0, p.pendingLevels - 1);

  SFX.confirm();
  app.upgradeChoices = null;
  pop();

  if (p.pendingLevels > 0) openUpgrade();
  return true;
}

/** 开局清掉上一局残留的卡面状态（不这样写，重开会闪一下上局的卡） */
export function resetUpgrade() {
  app.upgradeChoices = null;
  app.upgradeIdx = 0;
  app.upgradeAt = 0;
}
