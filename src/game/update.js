import { WORLD, EDGE_PAD, clampX, clampY, isOutsideView, pickSpawnPoint, pickItemPoint } from '../data/world.js';
import {
  EYE_H, SPRITE_HALF_W, muzzleOf, playerBox, playerCenterY, playerHalfW,
} from '../data/appearance.js';
import { cam, updateCamera } from './camera.js';
import { app } from './app.js';
import { onBannerEnd, onSkillEnd } from './flow.js';
import { damageEnemy, damagePlayer } from './combat.js';
import { grantGuard, THORN_DMG, THORN_RING, THORN_REACH } from './guard.js';
import { spawnFX } from './fx.js';
import { input, isAiming, syncInput } from '../core/input.js';
import { pick, rand, rng } from '../core/rng.js';
import { SFX } from '../gfx/assets.js';
import { ITEM_TYPES } from '../data/items.js';
import { ENEMY_TYPES, canExecute, enemyDrawH, enemyHurtBox, strideFor } from '../data/enemies.js';
import { BOSS_PHASES, bossPhaseIndex } from '../data/boss.js';
import { hpScaleAt, tickDirector } from './director.js';
import { openUpgrade } from './level.js';

// ==================== 工具 ====================
function overlaps(a, b) {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
}

function nearestEnemy(gs, x, y) {
  let best = null;
  let bd = Infinity;
  for (const e of gs.enemies) {
    const d = Math.hypot(e.x - x, e.y - y);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

/** 实际射击间隔（帧）：卡的加成叠在基准上，但留 4 帧下限，免得一帧一发 */
function fireInterval(p) {
  return Math.max(4, Math.round(p.fireCD));
}

/**
 * 嘉然技能追踪弹的射程（像素）。
 *
 * 视口是 800×600，取 420 大约"从自己到屏幕边缘再往外一点"：
 * 够得着画面边缘的怪，又不会让子弹飞到视线之外继续拐弯。
 * 射程按**距离**算而不是按帧数算，因为速度卡和弹道卡都会改变帧寿命对应的实际距离。
 */
const SKILL_BULLET_RANGE = 420;

/**
 * 暴击飘字：伤害翻倍这件事必须一眼看见，光看血条是看不出来的。
 *
 * 但连射时 15 帧一发、飘字活 40 帧，同一个人身上会同时飘三四个"暴击"，
 * 叠在一起就成了一坨糊字。所以近处已有飘字就不再补 —— 玩家需要的是
 * "我这一下暴击了"的信号，不是"我暴击了几次"的计数。
 */
function critFloat(gs, x, y) {
  for (const f of gs.floats) {
    if (Math.hypot(f.x - x, f.y - y) < 34) return;
  }
  gs.floats.push({
    x: x + (rng.next() - 0.5) * 18,
    // 往上抬一点：贴着命中点画会被敌人身体挡住，抬到头顶才读得清
    y: y - 16,
    text: '暴击!',
    life: 34,
    max: 34,
    color: '#ffe066',
  });
}

// ==================== 生成 ====================
/**
 * Boss 扇形弹幕：朝玩家方向摊开 N 发（N 由阶段决定）。
 *
 * 为什么是"扇形"而不是随机散射：Boss 的威胁必须**可读**——
 * 玩家看到几道弹道就该知道往侧面走。随机散射只能靠运气躲，
 * 那是"难"，不是"有意思"。
 */
function bossFire(gs, e, tx, ty, phase = BOSS_PHASES[0]) {
  const ux = tx - e.x;
  const uy = ty - e.y;
  const len = Math.hypot(ux, uy) || 1;
  const base = Math.atan2(uy / len, ux / len);
  const half = (phase.shots - 1) / 2;
  for (let i = -half; i <= half; i++) {
    const a = base + i * phase.spread;
    gs.eBullets.push({
      // 从身体上沿出膛（不是脚底），和"从嘴里吐出来"的观感一致
      x: e.x + Math.cos(a) * 34,
      y: e.y - 24 + Math.sin(a) * 34,
      dx: Math.cos(a),
      dy: Math.sin(a),
      speed: phase.speed,
      r: 7,
      dmg: e.atk,
      life: 220,
    });
  }
  SFX.bossShot();
}
/**
 * 刷一只怪。
 *
 * 数值全部从 ENEMY_TYPES 读。之前这里是硬编码的 3 血 / 1 攻 / 40×40，
 * 每加一种怪都得复制一遍这个对象字面量，漏改一处就是"新怪血量不对"。
 */
function spawnEnemy(gs, typeKey = 'frog') {
  const t = ENEMY_TYPES[typeKey] || ENEMY_TYPES.frog;
  const { x, y } = pickSpawnPoint(gs.player.x, gs.player.y, cam.x, cam.y, () => rng.next());
  const speed = rand(t.speedMin, t.speedMax);
  // 血量随存活时间膨胀：同一只青蛙在 6 分钟时不该还是 3 血，
  // 否则卡组成型后整局就是"一路推平"，没有对抗
  const hp = Math.max(1, Math.round(t.hp * hpScaleAt(gs.time / 60)));

  gs.enemies.push({
    id: gs.eid++, type: typeKey, tier: t.tier,
    x, y, w: t.w, h: t.h,
    hp, maxHp: hp, atk: t.atk, xp: t.xp,
    speed,
    // 步频跟着速度走：疾行蛙跑两倍速，步子也得迈两倍快，
    // 否则看起来像在冰上滑行
    stride: strideFor(speed),
    flash: 0, // 受击闪白的剩余帧数
    frozen: 0, dmgCD: 0,
    age: 0, // 出生淡入用，避免贴边出现时像凭空冒出来
  });
}

function spawnItem(gs) {
  const type = pick(ITEM_TYPES);
  const { x, y } = pickItemPoint(gs.player.x, gs.player.y, () => rng.next());
  gs.items.push({
    x, y,
    w: 30, h: 30, type,
  });
}

function applyItem(gs, type) {
  const p = gs.player;
  if (type === 'heal') {
    p.hp = Math.min(p.maxHp, p.hp + 1);
    SFX.heal();
  } else if (type === 'bomb') {
    // 先拷贝一份再遍历：damageEnemy 会把死亡的敌人从原数组里移除
    for (const e of [...gs.enemies]) {
      damageEnemy(gs, e, 5, {
        hitFx: '#e67e22', hitFxCount: 8, hitSfx: null, deathFx: '#e67e22', deathSfx: null,
      });
    }
    spawnFX(gs, p.x, playerCenterY(p), '#ff9800', 50, 2.5);
    SFX.bomb();
  } else if (type === 'shield') {
    // 技能护体期间不降级：返回 false 让道具留在原地，技能结束后还能回来捡
    if (!grantGuard(p, 'shield')) return false;
    SFX.shield();
  } else if (type === 'thorns') {
    if (!grantGuard(p, 'thorns')) return false;
    SFX.thorns();
  }
  return true;
}

// ==================== 主更新 ====================
/**
 * 一帧的世界推进。
 *
 * 从 update() 里拆出来的原因：这一路上有好几个"本帧提前结束"的 return
 * （banner 期间世界静止、玩家阵亡后不再处理后面的东西）。如果把升级检测
 * 写在函数末尾，撞上这些 return 就再也不执行了。拆成两层之后，
 * stepWorld 里怎么 return 都行，update 一定会在它返回之后再问一次"该不该升级"。
 */
function stepWorld() {
  if (app.screen !== 'game' || !app.gs) return;

  const gs = app.gs;
  const p = gs.player;
  gs.frame++;
  gs.time++;

  // 计时器
  if (p.invincible > 0) p.invincible--;
  if (p.skillGuard > 0) p.skillGuard--;
  if (p.shield > 0) p.shield--;
  if (p.thorns > 0) p.thorns--;
  if (p.bannerTimer > 0) {
    p.bannerTimer--;
    if (p.bannerTimer === 0) onBannerEnd();
  }
  if (p.skillActive > 0) {
    p.skillActive--;
    if (p.skillActive === 0) onSkillEnd();
  }
  if (gs.announceTimer > 0) gs.announceTimer--;

  // 移动（banner 期间锁输入）；边界是世界边界，不是画布边界。
  // p.y 是脚底，所以上下各留 EDGE_PAD 就行——之前按碰撞盒半高钳，
  // 会让角色站在"世界边界往里 20px 的空气上"。
  if (p.bannerTimer <= 0) {
    const mx = input.move.x * p.speed;
    const my = input.move.y * p.speed;
    p.x = clampX(p.x + mx, p.w / 2);
    p.y = clampY(p.y + my, EDGE_PAD);
  }
  // 摄像机跟身体中心，不跟脚底：跟脚底会让角色整体偏上半个身高
  updateCamera(p.x, p.y - EYE_H);

  // 本帧的玩家碰撞盒（底边贴脚底）。一帧内 p.h 不会变，算一次就够
  const body = playerBox(p);
  // 视觉半宽同理，一帧只算一次。敌人贴身距离和接触判定都靠它
  const pHalfW = playerHalfW(p);

  // 射击
  if (gs.shootCD > 0) gs.shootCD--;
  if (gs.shootCD === 0 && p.bannerTimer <= 0 && isAiming()) {
    const len = Math.hypot(input.aim.x, input.aim.y) || 1;
    const sdx = input.aim.x / len;
    const sdy = input.aim.y / len;
    // 出膛点：身体上半段、沿射击方向推到身前。从脚底出发会像"地上支了个炮台"，
    // 从身体正中出发又会看着像贴图穿帮
    const mz = muzzleOf(p, sdx, sdy);

    const tracking = gs.charKey === 'jiaran' && p.skillActive > 0;
    const bellaSkill = gs.charKey === 'bella' && p.skillActive > 0;
    const eileenSkill = gs.charKey === 'eileen' && p.skillActive > 0;

    if (eileenSkill) {
      // 乃琳技能：四方位齐射。这里**不吃多重射击**——4 发已经够密，
      // 再乘个 3 会变成一屏 12 条激光，手机直接跪
      [[0, -1], [0, 1], [-1, 0], [1, 0]].forEach(([bx, by]) => {
        const m = muzzleOf(p, bx, by);
        gs.bullets.push({
          x: m.x, y: m.y, dx: bx, dy: by,
          speed: 7 * p.bulletSpeed, w: 10, h: 10,
          atk: p.atk, life: 80,
          tracking: false, pierce: true, hitIds: new Set(),
        });
      });
      SFX.shoot();
      gs.shootCD = fireInterval(p);
    } else {
      // 暴击在出膛这一刻掷骰：同一发子弹打三个人，暴不暴击是同一个答案；
      // 伤害入口也因此保持纯函数，测试不会被随机数咬
      const crit = rng.next() < p.critChance;
      const dmg = crit ? p.atk * p.critMult : p.atk;
      const shots = 1 + p.multishot;

      for (let i = 0; i < shots; i++) {
        // 多发时按「-8° / 0 / +8°」摊开，不摊开的话叠在一起等于没加
        const off = (i - (shots - 1) / 2) * 0.14;
        const cs = Math.cos(off);
        const sn = Math.sin(off);
        gs.bullets.push({
          x: mz.x, y: mz.y,
          dx: sdx * cs - sdy * sn,
          dy: sdx * sn + sdy * cs,
          speed: (bellaSkill ? 14 : 7) * p.bulletSpeed,
          w: bellaSkill ? 30 : 10,
          h: bellaSkill ? 30 : 10,
          atk: dmg,
          crit,
          life: Math.round((tracking ? 180 : 80) * p.bulletLife),
          // 追踪弹有**射程**（像素），不是按帧数活多久。
          // 它会一直贴着敌人拐弯，用 life 计寿命的话实际飞行距离受速度卡
          // 影响极大（bulletSpeed × bulletLife 两张卡都能把它拉到两屏以上），
          // 表现就是"子弹满场飞、飞很久"，清屏感变成了画面噪音
          range: tracking ? SKILL_BULLET_RANGE : 0,
          traveled: 0,
          // 技能弹标记：打不死精英/Boss，但按暴击结算（见命中分支）。
          // 乃琳的技能弹不在此列——她的技能是"四向穿透"，本来就不含斩杀设定
          exeCrit: tracking || bellaSkill,
          tracking,
          pierce: false,
          pierceLeft: p.pierce, // 穿透卡：还能再穿几个
          hitIds: new Set(),
        });
      }
      SFX.shoot();
      gs.shootCD = fireInterval(p);
    }
  }

  // banner 期间世界静止（与原逻辑一致）
  if (p.bannerTimer > 0) return;

  // 子弹
  gs.bullets = gs.bullets.filter((b) => {
    if (b.tracking && gs.enemies.length > 0) {
      const ne = nearestEnemy(gs, b.x, b.y);
      if (ne) {
        // 追**身体中心**而不是脚下：追踪弹朝脚踝俯冲，看着像在追影子
        const nb = enemyHurtBox(ne);
        const d = Math.hypot(nb.x - b.x, nb.y - b.y) || 1;
        b.dx += ((nb.x - b.x) / d) * 0.35;
        b.dy += ((nb.y - b.y) / d) * 0.35;
        const sp = Math.hypot(b.dx, b.dy) || 1;
        b.dx /= sp;
        b.dy /= sp;
      }
    }

    b.x += b.dx * b.speed;
    b.y += b.dy * b.speed;
    b.life--;
    // 射程按累计飞行距离算（追踪弹拐弯也算路程），用完就消失
    b.traveled = (b.traveled || 0) + b.speed;
    if (b.range && b.traveled >= b.range) return false;
    // 出界判定按世界边界：按画布边界算会让子弹飞到一半凭空消失
    if (b.x < -30 || b.x > WORLD.w + 30 || b.y < -30 || b.y > WORLD.h + 30 || b.life <= 0) return false;

    let consumed = false;
    for (let i = gs.enemies.length - 1; i >= 0; i--) {
      const e = gs.enemies[i];
      // 判定用**受击盒**（覆盖全身），不是脚下底盘。
      // 用底盘判会让子弹从青蛙头顶穿过去，上半身完全打不到
      if (b.hitIds.has(e.id) || !overlaps(b, enemyHurtBox(e))) continue;
      b.hitIds.add(e.id);

      // 技能弹打不死精英/Boss，但必须"打得疼"——按暴击结算。
      // 否则技能从"自动瞄准的大招"退化成"平A的自动挡"，玩家会觉得自己按了没效果。
      // 已经掷出暴击的子弹不再乘第二次（atk 里已经含了 critMult）
      const critHit = b.exeCrit === true && !canExecute(e);
      const isCrit = critHit || !!b.crit;
      const dmg = critHit && !b.crit ? b.atk * p.critMult : b.atk;

      if (b.tracking) {
        if (canExecute(e)) {
          // 糖果斩：只对小兵生效，贴上即秒杀并掉一颗会自己追人的糖果
          damageEnemy(gs, e, Infinity, {
            hitFx: '#ff69b4', hitFxCount: 8, hitSfx: 'candy', deathFx: null, deathSfx: null,
          });
          gs.specials.push({ type: 'candy', x: e.x, y: e.y, w: 32, h: 32, speed: 2.5, life: 240 });
        } else {
          // 精英 / Boss 免疫斩杀：改吃一发暴击
          damageEnemy(gs, e, dmg, {
            hitFx: isCrit ? '#ffe066' : '#ff6b6b',
            hitFxCount: isCrit ? 11 : 5,
            hitPos: b,
          });
          if (isCrit) critFloat(gs, b.x, b.y);
        }
        consumed = true;
        break;
      }

      if (b.pierce) {
        // 穿透弹：不死就继续穿，死了掉一颗冰淇淋
        const dead = damageEnemy(gs, e, dmg, {
          hitFx: '#87ceeb', hitFxCount: 4, hitPos: b, deathFx: null, deathSfx: null,
        });
        if (dead) {
          gs.specials.push({ type: 'icecream', x: e.x, y: e.y, w: 32, h: 32, life: 180 });
          SFX.icecream();
        }
        continue;
      }

      if (b.pierceLeft > 0) {
        // 穿透卡：次数有限，穿完一颗减一，减到 0 再撞就是普通弹
        b.pierceLeft--;
        damageEnemy(gs, e, dmg, {
          hitFx: isCrit ? '#ffe066' : '#ffa94d',
          hitFxCount: isCrit ? 9 : 5,
          hitPos: b,
          deathFx: null,
          deathSfx: null,
        });
        if (isCrit) critFloat(gs, b.x, b.y);
        continue;
      }

      damageEnemy(gs, e, dmg, {
        // 暴击用亮黄色 + 更多粒子：这类游戏里"伤害有没有翻倍"必须一眼看出来，
        // 光靠血量条的变化是看不出来的
        hitFx: isCrit ? '#ffe066' : '#ff6b6b',
        hitFxCount: isCrit ? 11 : 5,
        hitPos: b,
      });
      if (isCrit) critFloat(gs, b.x, b.y);
      consumed = true;
      break;
    }

    return !consumed;
  });

  // 敌人
  for (let i = gs.enemies.length - 1; i >= 0; i--) {
    const e = gs.enemies[i];
    e.age = (e.age || 0) + 1;
    if (e.flash > 0) e.flash--;
    if (e.dmgCD > 0) e.dmgCD--;
    if (e.frozen > 0) {
      e.frozen--;
      continue;
    }

    // 朝玩家的**身体中心**走，不是朝脚底。朝脚底会让怪一路钻到玩家脚后跟，
    // 视觉上像穿模；朝身体中心则停在"压在腿上"的位置，割草游戏里刚好
    const dx = p.x - e.x;
    const dy = body.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    // 贴身距离按**视觉**尺寸算，不按碰撞盒。
    // 碰撞盒只有 40 宽，用它算出来的"贴身"是 22px —— 画面上敌人整个压在
    // 角色身上，玩家找不到自己在哪。按视觉半宽的 80% 取，观感是"围住"而不是"埋住"。
    // 顺带解决另一个毛病：原来会一路走到中心再穿过玩家掉头，看着像抽搐
    const touchR = (pHalfW + enemyDrawH(e) * SPRITE_HALF_W) * 0.9;

    if (e.tier === 'boss') {
      const phaseIdx = bossPhaseIndex(e);
      const phase = BOSS_PHASES[phaseIdx];

      // 阶段切换：血量跨过 66% / 33% 的那一刻给一次"变招"反馈。
      // 少了这一步，玩家只会觉得"弹幕突然变密了"，读不出这是设计好的节点
      if (e.phase == null) e.phase = 0;
      if (phaseIdx > e.phase) {
        e.phase = phaseIdx;
        gs.announceText = phase.name;
        gs.announceTotal = 110;
        gs.announceTimer = 110;
        SFX.bossRage();
        spawnFX(gs, e.x, e.y - enemyDrawH(e) * 0.4, '#c86bff', 34, 3.2);
        // 变招前摇：0.75 秒不开火。既是给玩家的反应时间，
        // 也让"换阶段"读起来像一次蓄力，而不是弹幕突然糊脸
        e.fireCD = 45;
        e.extraVolley = 0;
      }

      // Boss 不贴脸：保持中距离用弹幕施压。
      // 它 2.5 倍体型贴上来会把玩家整个人盖住；而且"站着不动蹭伤害"没有对抗感，
      // 弹幕才是它该做的事
      const want = 200;
      const halfW = enemyDrawH(e) * SPRITE_HALF_W;
      const step = e.speed * phase.speedMul;
      if (d > want + 20) {
        e.x = clampX(e.x + (dx / d) * step, halfW);
        e.y = clampY(e.y + (dy / d) * step, halfW);
      } else if (d < want - 30) {
        // 被逼到墙角时停止后退，否则会一路退出世界
        e.x = clampX(e.x - (dx / d) * step, halfW);
        e.y = clampY(e.y - (dy / d) * step, halfW);
      }
      // 出场先蓄 80 帧（1.3 秒）：让玩家有时间发现"来了个大东西"
      if (e.fireCD == null) e.fireCD = 80;
      if (e.fireCD > 0) e.fireCD--;
      else {
        bossFire(gs, e, p.x, body.y, phase);
        e.fireCD = phase.cd;
        // 狂怒阶段：同一次齐射后 12 帧再补一轮。
        // 玩家必须"躲完第一层后换个方向"，站定让开一次不够
        if (phase.double) e.extraVolley = 12;
      }
      if (e.extraVolley > 0) {
        e.extraVolley--;
        if (e.extraVolley === 0) bossFire(gs, e, p.x, body.y, phase);
      }
    } else if (d > touchR) {
      // 视野外加速进场：世界变成 2×2 屏之后，敌人从 620px 外按原速走要 8 秒才露面，
      // 玩起来像"没怪"。进场阶段给 2.6 倍速，一进画面立刻恢复原速，观感与旧版对齐。
      const rush = isOutsideView(e.x, e.y, cam.x, cam.y, -40) ? 2.6 : 1;
      e.x += (dx / d) * e.speed * rush;
      e.y += (dy / d) * e.speed * rush;
    }

    // 敌人之间互相排斥。
    // 没有这一步，二十只怪会沿着同一条直线叠成一坨——看起来像"一只怪长了六个头"，
    // 玩家数不出有几只，血条也糊成一片。分离距离按**视觉**宽度算，
    // 只跟下标更大的配对，避免同一对被算两次。
    // Boss 不参与：它靠体型站住，被小怪推着走太滑稽
    if (e.tier !== 'boss') {
      for (let j = i + 1; j < gs.enemies.length; j++) {
        const o = gs.enemies[j];
        if (o.frozen > 0 || o.tier === 'boss') continue; // 冻住的不该被推走
        const sx = o.x - e.x;
        const sy = o.y - e.y;
        const sep = (enemyDrawH(e) + enemyDrawH(o)) * SPRITE_HALF_W * 0.8;
        const sd2 = sx * sx + sy * sy;
        if (sd2 < 1 || sd2 > sep * sep) continue;
        const sd = Math.sqrt(sd2);
        // 重叠越多推得越狠，但每帧只推 18%，收敛快又不会抖
        const push = ((sep - sd) / sep) * 0.36;
        const ux = (sx / sd) * push;
        const uy = (sy / sd) * push;
        e.x -= ux;
        e.y -= uy;
        o.x += ux;
        o.y += uy;
      }
    }

    // 防挤压：上面那步会把怪互相推开，被推的那只可能正好压到玩家身上
    // （实测出现过距离只剩 3px，等于又回到"玩家被埋住"）。推到贴身圈外才收工
    const nd = Math.hypot(e.x - p.x, e.y - body.y);
    if (nd > 0.01 && nd < touchR) {
      e.x = p.x + ((e.x - p.x) / nd) * touchR;
      e.y = body.y + ((e.y - body.y) / nd) * touchR;
    }

    for (const sp of gs.specials) {
      if (sp.type === 'star') {
        const sd = Math.hypot(sp.x - e.x, sp.y - e.y);
        if (sd < 130 && sd > 1) {
          e.x += ((sp.x - e.x) / sd) * 1.8;
          e.y += ((sp.y - e.y) / sd) * 1.8;
        }
      }
    }

    // 贝拉技能：撞击。判定同样用视觉距离——敌人停在 touchR 外，
    // 用碰撞盒判会永远撞不到
    if (gs.charKey === 'bella' && p.skillActive > 0 && d <= touchR * 1.06) {
      if (canExecute(e)) {
        damageEnemy(gs, e, Infinity, {
          hitFx: null, hitSfx: null, deathFx: '#ffd700', deathFxCount: 14, deathSfx: null,
        });
        gs.specials.push({ type: 'star', x: e.x, y: e.y, w: 34, h: 34, life: 480 });
        SFX.star();
        continue;
      }
      // 精英 / Boss 免疫撞击斩杀：改成一记重击 + 0.5 秒冷却。
      // 不设冷却的话敌人停在贴身圈里，会每帧挨一次 → 等于换了种方式秒杀
      if (e.dmgCD <= 0) {
        damageEnemy(gs, e, p.atk * 3, {
          hitFx: '#ffd700', hitFxCount: 10, deathFx: null, deathSfx: null,
        });
        e.dmgCD = 30;
      }
    }

    // 荆棘：四个环绕三角。半径/命中半径都取 guard.js 的常量，
    // 和绘制端共用一份，改范围不会出现"看着碰到了却不掉血"
    if (p.thorns > 0 && e.dmgCD <= 0) {
      const tRadius = p.w * THORN_RING;
      const hitR = p.w * THORN_REACH;
      const baseAngle = gs.frame * 0.04;
      let hit = false;
      for (let ti = 0; ti < 4; ti++) {
        const ang = baseAngle + (ti * Math.PI) / 2;
        const tx = p.x + Math.cos(ang) * tRadius;
        const ty = body.y + Math.sin(ang) * tRadius;
        if (Math.hypot(e.x - tx, e.y - ty) < hitR + e.w / 2) {
          hit = true;
          break;
        }
      }
      if (hit) {
        e.dmgCD = 30;
        const dead = damageEnemy(gs, e, THORN_DMG, {
          hitFx: '#f1c40f', hitFxCount: 5, deathFxCount: 10,
        });
        if (dead) continue;
      }
    }

    // 接触伤害（护体规则见 game/guard.js：同一时刻只有一个护体来源，
    // 荆棘是"挡 4 次"不是无敌）。距离判定和上面的贴身距离用同一个 touchR，
    // 视觉上"贴上"就是"挨打"，不会出现"看着还差一截就掉血"或"贴脸了却不扣血"
    if (d <= touchR * 1.06 && damagePlayer(gs, e.atk)) return;
  }

  // ── Boss 弹幕 ──
  // 和玩家子弹分开走：它的归属是"打玩家"，命中判定按视觉半径而不是碰撞盒
  // （弹幕是看得见的东西，按 40 宽的盒子判会让玩家觉得"明明擦过去了却掉血"）
  if (gs.eBullets.length > 0) {
    gs.eBullets = gs.eBullets.filter((b) => {
      b.x += b.dx * b.speed;
      b.y += b.dy * b.speed;
      b.life--;
      if (b.life <= 0) return false;
      if (b.x < -40 || b.x > WORLD.w + 40 || b.y < -40 || b.y > WORLD.h + 40) return false;
      if (Math.hypot(b.x - p.x, b.y - body.y) < pHalfW * 0.5 + b.r) {
        damagePlayer(gs, b.dmg);
        return false;
      }
      return true;
    });
  }

  // 特殊物：糖果 / 星星 / 冰淇淋
  for (let i = gs.specials.length - 1; i >= 0; i--) {
    const sp = gs.specials[i];
    sp.life--;
    if (sp.life <= 0) {
      gs.specials.splice(i, 1);
      continue;
    }

    if (sp.type === 'candy') {
      const ne = nearestEnemy(gs, sp.x, sp.y);
      if (ne) {
        // 朝**身体中心**飞，不是朝脚下底盘飞：糖果是长眼睛的，追着脚后跟
        // 看起来像贴图穿模；判定也换成受击盒，否则从头顶掠过会空手而归
        const box = enemyHurtBox(ne);
        const d = Math.hypot(box.x - sp.x, box.y - sp.y) || 1;
        sp.x += ((box.x - sp.x) / d) * sp.speed;
        sp.y += ((box.y - sp.y) / d) * sp.speed;
        if (overlaps(sp, box)) {
          damageEnemy(gs, ne, 10, {
            hitFx: '#ff69b4', hitFxCount: 16, hitPos: sp, hitSfx: 'candy',
          });
          gs.specials.splice(i, 1);
          continue;
        }
      }
    } else if (sp.type === 'star') {
      for (let j = gs.enemies.length - 1; j >= 0; j--) {
        const e = gs.enemies[j];
        if (overlaps(sp, enemyHurtBox(e))) {
          damageEnemy(gs, e, 5, { hitFx: '#ffd700', hitFxCount: 8, hitSfx: 'star' });
          gs.specials.splice(i, 1);
          break;
        }
      }
    } else if (sp.type === 'icecream') {
      for (const e of gs.enemies) {
        if (Math.hypot(e.x - sp.x, e.y - sp.y) < 110) {
          if (e.frozen <= 0) spawnFX(gs, e.x, e.y, '#87ceeb', 4);
          e.frozen = 30;
        }
      }
    }
  }

  // 道具拾取
  for (let i = gs.items.length - 1; i >= 0; i--) {
    if (overlaps(body, gs.items[i])) {
      // applyItem 返回 false = 这次没吃下去（技能护体期间捡到防御道具），
      // 那就别 splice，留在原地等技能结束
      if (applyItem(gs, gs.items[i].type)) gs.items.splice(i, 1);
    }
  }

  // 粒子
  gs.particles = gs.particles.filter((pt) => {
    pt.x += pt.dx;
    pt.y += pt.dy;
    return --pt.life > 0;
  });

  // 飘字：只往上飘、只减寿命，没有别的状态
  gs.floats = gs.floats.filter((f) => {
    f.y -= 0.9;
    return --f.life > 0;
  });

  // 刷怪：节奏和类型都交给波次导演。
  // 导演只返回"该刷哪些类型"，实体仍然在这里创建 —— 这样导演层能脱离
  // 渲染和实体单独测，不用 mock 一整套 canvas
  for (const typeKey of tickDirector(gs, () => rng.next())) {
    spawnEnemy(gs, typeKey);
    if (typeKey === 'elite') {
      SFX.eliteAppear();
      spawnFX(gs, gs.player.x, playerCenterY(gs.player), '#ffb340', 26, 2.2);
    } else if (typeKey === 'boss') {
      // Boss 可能在世界另一头刷出来，所以提示要贴在**玩家身上**：
      // 玩家看不见刷怪点，只能靠"自己身边一亮 + 一声闷响"知道大的来了
      SFX.bossAppear();
      spawnFX(gs, gs.player.x, playerCenterY(gs.player), '#8f6bff', 40, 3);
      gs.announceText = '符王·本相 降临';
      gs.announceTotal = 160;
      gs.announceTimer = 160;
    }
  }

  // 刷道具
  gs.itemTimer++;
  if (gs.itemTimer >= gs.itemInterval && gs.items.length < 4) {
    gs.itemTimer = 0;
    spawnItem(gs);
  }
}

export function update() {
  // 输入轴暂停时也要同步：否则按住方向键暂停再松开，恢复后角色会一直飘
  syncInput();

  if (app.screen !== 'game' || !app.gs) return;

  stepWorld();

  // 整帧结算都结束了，再决定要不要弹三选一 —— 这样"同一帧打死 6 只怪升了两级"
  // 和"同一帧被打死"都不会出现两个界面抢栈顶
  openUpgrade();
}
