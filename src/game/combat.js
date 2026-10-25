/**
 * 战斗结算的唯一入口。
 *
 * 重构前，扣血逻辑在本项目里复制了 9 份（炸弹 / 追踪弹 / 穿透弹 / 普通弹 /
 * 贝拉撞击 / 荆棘 / 糖果 / 星星 / 接触伤害），每份都自己写一遍"扣血 → 爆炸
 * 粒子 → 音效 → 从数组移除 → 击杀数 +1 → 技能条充能"。加暴击、吸血、击退、
 * 掉落表的时候，改 9 处必然漏。
 *
 * 现在只剩两个入口：
 *   damageEnemy(gs, e, amount, opts)   —— 敌人受伤，返回是否死亡
 *   damagePlayer(gs, amount, opts)     —— 玩家受伤，返回是否死亡
 *
 * "命中反馈"（粒子颜色/数量、音效）做成参数，默认值与重构前完全一致，
 * 所以接进来不会有任何手感变化；个别招式想要不同表现就传进去。
 *
 * 暴击**不在这里掷骰**：出膛那一刻在 update.js 里算好，把伤害和 crit 标记
 * 一起塞进子弹。这样伤害入口保持纯函数（测试里不会因为随机数偶发失败），
 * 而且"同一发子弹打三个人"暴不暴击是同一个答案，符合直觉。
 */
import { SFX } from '../gfx/assets.js';
import { spawnFX } from './fx.js';
import { endGame } from './flow.js';
import { gainXP } from './level.js';
import { rng } from '../core/rng.js';
import { playerCenterY } from '../data/appearance.js';
import { guardKind, consumeThorn, THORN_IFRAMES, HIT_IFRAMES } from './guard.js';

/**
 * 每次击杀给技能条充能多少。
 *
 * 10 → 4：原来 10 杀就满，而中后期一秒就能清掉七八只，技能几乎是常驻的，
 * "攒大招"这件事完全不存在。改成 4（25 杀），前期约 35~40 秒一次，
 * 中后期靠清屏提速——节奏才是"慢慢攒、攒到了反打一波"。
 */
export const KILL_CHARGE = 4;

/**
 * 按层级给充能：小怪是"数量"来源，精英和 Boss 是"节点"来源。
 * 如果所有击杀都给同样的量，一发范围技能清二十只小怪等于白送一个大招，
 * 打精英反而没有任何加速感。
 */
const TIER_CHARGE = { normal: KILL_CHARGE, elite: 15, boss: 30 };

export function addSkillCharge(gs, e) {
  const p = gs.player;
  if (p.skillActive > 0) return;
  const gain = (e && TIER_CHARGE[e.tier]) || KILL_CHARGE;
  const prev = p.skillCharge;
  p.skillCharge = Math.min(100, p.skillCharge + gain);
  if (prev < 100 && p.skillCharge >= 100) SFX.skillReady();
}

function play(name) {
  if (!name) return;
  const fn = SFX[name];
  if (fn) fn();
}

/**
 * 荆棘格挡的飘字。
 *
 * 耐久是玩家要**算着用**的资源，不显示剩几次等于让人闭着眼睛用——
 * 这和"剩 5 秒无敌"的体感完全不同，所以必须给数字。
 */
function blockFloat(gs, x, y, left) {
  gs.floats.push({
    x: x + (rng.next() - 0.5) * 14,
    y: y - 16,
    text: left > 0 ? `格挡 ×${left}` : '格挡!',
    life: 30,
    max: 30,
    color: '#f1c40f',
  });
}

/**
 * 对敌人造成伤害。
 *
 * @param {object} gs
 * @param {object} e 敌人
 * @param {number} amount 伤害值；传 Infinity 表示秒杀
 * @param {object} opts
 * @param {string|null} opts.hitFx        命中粒子颜色，null = 不播
 * @param {number} opts.hitFxCount        命中粒子数量
 * @param {{x:number,y:number}} opts.hitPos 命中特效落点（子弹用弹丸位置，默认用敌人位置）
 * @param {string|null} opts.hitSfx       命中音效名，null = 不播
 * @param {string|null} opts.deathFx      死亡粒子颜色，null = 不播
 * @param {number} opts.deathFxCount      死亡粒子数量
 * @param {string|null} opts.deathSfx     死亡音效名，null = 不播
 * @returns {boolean} true 表示这一击打死了它，且已从 gs.enemies 移除
 */
export function damageEnemy(gs, e, amount, {
  hitFx = '#ff6b6b',
  hitFxCount = 5,
  hitPos = null,
  hitSfx = 'hit',
  deathFx = '#e74c3c',
  deathFxCount = 12,
  deathSfx = 'enemyDie',
} = {}) {
  e.hp -= amount;
  // 受击闪白：只有粒子的话，混战里根本看不出"这一下打中了谁"。
  // 4 帧刚好在 60Hz 下是一瞬，连射时会连成一片闪，正好是想要的效果
  e.flash = 4;

  if (hitSfx) play(hitSfx);
  if (hitFx) {
    const fx = hitPos || e;
    spawnFX(gs, fx.x, fx.y, hitFx, hitFxCount);
  }

  if (e.hp > 0) return false;

  // ── 死亡结算 ──
  const idx = gs.enemies.indexOf(e);
  if (idx !== -1) gs.enemies.splice(idx, 1);
  gs.kills++;

  const p = gs.player;
  p.killCount++;
  addSkillCharge(gs, e);
  gainXP(gs, e.xp == null ? 1 : e.xp);

  // 嗜血：每 N 杀回 1 点，满血时不消耗计数（不然满血期间白攒）
  if (p.vampEvery > 0 && p.killCount % p.vampEvery === 0 && p.hp < p.maxHp) {
    p.hp++;
    spawnFX(gs, p.x, playerCenterY(p), '#2ecc71', 10);
    SFX.heal();
  }

  // 追击：掉一颗会自己追人的糖果（复用特殊物的现成逻辑）
  if (p.candyChance > 0 && rng.next() < p.candyChance) {
    gs.specials.push({ type: 'candy', x: e.x, y: e.y, w: 32, h: 32, speed: 2.5, life: 240 });
  }

  // 音效按层级换：Boss 倒下必须是"这一关过去了"的声音，
  // 沿用普通击杀音会让整场苦战结束得毫无仪式感
  const deathSound =
    e.tier === 'boss' ? 'bossDown' : e.tier === 'elite' ? 'eliteDown' : deathSfx;
  if (deathSound) play(deathSound);
  if (deathFx) {
    // Boss 死得比精英再炸一倍：它是一整段战斗的出口
    const mult = e.tier === 'boss' ? 2.5 : e.tier === 'elite' ? 2.5 : 1;
    spawnFX(gs, e.x, e.y, deathFx, deathFxCount * mult);
  }

  // 精英 / Boss 必掉道具。不打精英也能活，但打了要有回报——
  // 否则"绕过去"永远是更优解，精英就只是个移动障碍物
  if (e.tier === 'elite' || e.tier === 'boss') {
    const drops = e.tier === 'boss' ? 3 : 1;
    for (let i = 0; i < drops; i++) {
      gs.items.push({
        // Boss 一次掉三个，横向摊开免得叠在同一个点上捡不到
        x: e.x + (i - (drops - 1) / 2) * 34,
        y: e.y,
        w: 30,
        h: 30,
        type: rng.next() < 0.55 ? 'heal' : 'shield',
      });
    }
  }

  return true;
}

/**
 * 玩家当前是否可以被伤害。
 *
 * 规则全部收敛到 `game/guard.js` 的 `guardKind()`：四个状态不再是"各自完全免伤、
 * 可以叠 28 秒"，而是"同一时刻只有一个护体来源"。这里只回答"有没有护体"，
 * 具体是哪种、该怎么消耗，由 damagePlayer 和 guard.js 负责。
 */
export function canTakeDamage(p) {
  return guardKind(p) === null;
}

/**
 * 对玩家造成伤害。
 *
 * 荆棘是唯一的例外：它不是"免伤"，而是**消耗一次耐久挡下来**。
 * 所以这一击仍然算"打中了"——要有格挡特效和音效，只是不掉血。
 *
 * @param {object} gs
 * @param {number} amount
 * @param {object} opts
 * @param {number} opts.invincibleFrames 受伤后的无敌帧数，默认 60（1 秒）
 * @returns {boolean} true 表示玩家已阵亡（已触发结算）
 */
export function damagePlayer(gs, amount, { invincibleFrames = HIT_IFRAMES } = {}) {
  const p = gs.player;
  const guard = guardKind(p);

  // 荆棘：挡一下，少一个三角。剩下的耐久决定这层护体还能撑几次
  if (guard === 'thorns') {
    const left = consumeThorn(p);
    p.invincible = THORN_IFRAMES;
    spawnFX(gs, p.x, playerCenterY(p), '#f1c40f', 14, 2);
    blockFloat(gs, p.x, playerCenterY(p), left);
    SFX.thorns();
    return false;
  }
  if (guard !== null) return false;

  p.hp -= amount;
  p.invincible = invincibleFrames;
  const cy = playerCenterY(p);
  spawnFX(gs, p.x, cy, '#fff', 8);
  SFX.playerHit();

  // 反伤：挨打瞬间把贴脸的敌人弹开。先拷贝再遍历，damageEnemy 会改数组
  if (p.reflect > 0) {
    for (const e of [...gs.enemies]) {
      if (Math.hypot(e.x - p.x, e.y - cy) < 130) {
        damageEnemy(gs, e, p.reflect, {
          hitFx: '#ffa94d', hitFxCount: 6, hitSfx: null, deathFxCount: 10,
        });
      }
    }
  }

  if (p.hp <= 0) {
    p.hp = 0;
    endGame();
    return true;
  }
  return false;
}
