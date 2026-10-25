/**
 * 波次导演：决定"什么时候刷、刷什么、刷多少"。
 *
 * 重构前这套逻辑在 update.js 里是两行：
 *
 *     spawnEnemy(gs);
 *     gs.spawnInterval = Math.max(40, 120 - Math.floor(gs.kills / 5) * 5);
 *
 * 也就是说**只有一种怪，压力只靠数量和速度**。打到三分钟以后，屏幕上
 * 全是同一种青蛙，玩家的构筑再强也没有"对手变了"的感觉——这是当前
 * 最大的玩法空洞。
 *
 * 设计上刻意做成**纯函数 + 少量状态**：
 *   - 阶段划分用 `gs.time`（逻辑帧）推导，不用挂在外部计时器上
 *   - `tickDirector(gs)` 只返回"这帧该刷哪些类型"，真正创建敌人仍在
 *     update.js 里做。这样这一层可以脱离渲染和实体直接单测
 *   - 随机数通过参数注入，测试里塞一个确定性序列就能断言权重
 *
 * ── 难度曲线的三条腿 ──
 *   1. **类型**：从单一小兵 → 加疾行蛙（逼你走位）→ 加铁符蛙（逼你堆穿透/暴击）
 *   2. **密度**：刷怪间隔随时间收窄，但用同屏上限兜住，不会无限堆
 *   3. **强度**：血量系数缓慢上升，避免后期"卡组强到一枪清屏"变得无脑
 *
 * 三条腿必须一起走。只加密度会让后期变成幻灯片，只加强度会让前中期
 * 变得又慢又硬。
 */

/**
 * 阶段表。`at` 是存活秒数。
 *
 * `types` 是权重表：['frog', 3] 表示权重 3，不是"三只"。
 * `cap` 是同屏普通怪上限——这个数直接决定帧率，手机上 40 以上就要小心。
 */
export const PHASES = [
  {
    at: 0,
    tag: '热身',
    interval: 78,
    cap: 14,
    hpMul: 1,
    types: [['frog', 1]],
  },
  {
    at: 50,
    tag: '试探',
    interval: 68,
    cap: 20,
    hpMul: 1.05,
    types: [['frog', 3], ['runner', 1]],
  },
  {
    at: 100,
    tag: '压迫',
    interval: 58,
    cap: 26,
    hpMul: 1.2,
    types: [['frog', 3], ['runner', 2], ['brute', 1]],
  },
  {
    at: 160,
    tag: '混战',
    interval: 48,
    cap: 34,
    hpMul: 1.4,
    types: [['frog', 2], ['runner', 3], ['brute', 2]],
  },
  {
    at: 240,
    tag: '狂潮',
    interval: 38,
    cap: 42,
    hpMul: 1.7,
    types: [['frog', 2], ['runner', 3], ['brute', 3]],
  },
];

const LAST_AT = PHASES[PHASES.length - 1].at;

/** 精英间隔（秒）。第一只出现在 75 秒，之后每 75 秒一只 */
export const ELITE_EVERY = 75;

/**
 * Boss 间隔（秒）。
 *
 * 2.5 分钟一个节点，比精英稀疏得多——它是"这一局打到哪了"的刻度，
 * 不是压力来源。两只 Boss 不会同时在场：场上还有 Boss 时跳过这一轮。
 */
export const BOSS_EVERY = 150;

/**
 * Boss 登场后让精英停手的帧数（3 秒）。
 *
 * 为什么需要这个数：75 和 150 是整数倍关系，150 / 300 / 450 秒都会**同帧**
 * 同时满足"该出精英"和"该出 Boss"。Boss 出场要占 160 帧公告 + 一声低吼，
 * 精英出场也是一声专属音效——两声"大的来了"叠在同一帧，玩家的听感里
 * 只有一个事件，等 Boss 打到一半突然发现身边多了个精英，会觉得自己被耍了。
 *
 * 所以撞车时让精英**让位而不是消失**：不推进 elitesSpawned（欠账还在），
 * 只推迟 180 帧，等 Boss 的公告收尾，节奏上就是"大的先落地，小的随后跟上"。
 */
export const ELITE_HOLD_AFTER_BOSS = 180;

/** 刷怪间隔的下限：再快就是"排队送死"，没有对抗感 */
const MIN_INTERVAL = 26;

/** 当前处在哪个阶段。阶段只前进不后退，所以用"最后一个 at ≤ seconds" */
export function phaseAt(seconds) {
  let cur = PHASES[0];
  for (const ph of PHASES) {
    if (seconds >= ph.at) cur = ph;
  }
  return cur;
}

/**
 * 血量系数。走完最后一个阶段之后仍然继续涨——否则四分钟以后
 * 玩家卡组成型，一枪一片，游戏就结束了。
 */
export function hpScaleAt(seconds) {
  const ph = phaseAt(seconds);
  const over = Math.max(0, seconds - LAST_AT) / 60;
  return ph.hpMul + over * 0.2;
}

/** 刷怪间隔（帧）。同样在最后阶段之后继续收窄，但有下限 */
export function intervalAt(seconds) {
  const ph = phaseAt(seconds);
  const over = Math.max(0, seconds - LAST_AT) / 60;
  return Math.max(MIN_INTERVAL, Math.round(ph.interval - over * 5));
}

/**
 * 按权重挑一种怪。
 * @param {object} phase
 * @param {() => number} random 返回 [0,1) 的函数（注入以便测试）
 */
export function pickType(phase, random) {
  let total = 0;
  for (const [, w] of phase.types) total += w;
  let r = random() * total;
  for (const [key, w] of phase.types) {
    r -= w;
    if (r <= 0) return key;
  }
  // 浮点误差兜底：落到最后一个
  return phase.types[phase.types.length - 1][0];
}

/**
 * 本帧该刷哪些怪。
 *
 * 会就地更新 `gs.spawnTimer` 和 `gs.elitesSpawned`——这两者是导演自己的
 * 状态，不属于任何实体。除此之外不碰 gs。
 *
 * @returns {string[]} 类型 key 列表，可能是空数组
 */
export function tickDirector(gs, random = Math.random) {
  const seconds = gs.time / 60;
  const out = [];

  // 让位期要在 Boss 判定**之前**读出来：Boss 这一帧刚设的 180 帧是给后面的帧用的，
  // 不能在同一帧里先设再烧掉一帧，否则"3 秒"会变成 179 帧，测试和手感都对不上
  const holdBefore = gs.eliteHold || 0;

  // ── Boss：场上只能有一只，且优先级高于精英 ──
  // 和精英一样不占同屏上限，但多一条限制：上一只还活着就不刷下一只。
  // 否则玩家可以靠"不打"把三只 Boss 攒在场上，那是灾难不是挑战。
  // 判定放在精英前面，是因为 150 秒这种整数倍时间点两者会撞车，要让 Boss 先走
  const wantBoss = Math.floor(seconds / BOSS_EVERY);
  const bossSpawned = gs.bossesSpawned || 0;
  const bossComing = wantBoss > bossSpawned && !gs.enemies.some((e) => e.tier === 'boss');
  if (bossComing) {
    gs.bossesSpawned = wantBoss;
    out.push('boss');
    // 撞车时把精英往后推（见 ELITE_HOLD_AFTER_BOSS 的注释）
    gs.eliteHold = ELITE_HOLD_AFTER_BOSS;
  }

  // ── 精英：不占同屏上限 ──
  // 如果精英也参与 cap 判定，后期普通怪塞满时它就永远刷不出来，
  // "每 75 秒一个节点"的节奏感会悄悄消失
  const wantElite = Math.floor(seconds / ELITE_EVERY);
  const spawned = gs.elitesSpawned || 0;
  if (holdBefore > 0) {
    // 让位期：只烧计时，不动 elitesSpawned —— 欠的这只下一帧还在
    gs.eliteHold = holdBefore - 1;
  } else if (!bossComing && wantElite > spawned) {
    // `!bossComing` 不能省：Boss 刚登场的那一帧 holdBefore 还是 0，
    // 少了这个判断两只怪照样会挤在同一帧
    // 一次只补一只：正常游玩时 wantElite 每次只 +1，但调试/读档把 time 直接
    // 跳到 300 秒的话，这里会差出 4 个节点——一帧蹦出四只精英比不刷更糟。
    // 直接对齐到 wantElite，跳过的节点就当没发生过
    gs.elitesSpawned = wantElite;
    out.push('elite');
  }

  // ── 普通怪 ──
  const ph = phaseAt(seconds);
  gs.spawnTimer = (gs.spawnTimer || 0) + 1;
  if (gs.spawnTimer >= intervalAt(seconds) && gs.enemies.length + out.length < ph.cap) {
    gs.spawnTimer = 0;
    out.push(pickType(ph, random));
  }

  return out;
}

/** 给 HUD / 结算页用的进度描述 */
export function phaseInfo(gs) {
  const seconds = gs.time / 60;
  const ph = phaseAt(seconds);
  const next = PHASES.find((p) => p.at > seconds);
  return {
    tag: ph.tag,
    seconds: Math.floor(seconds),
    nextAt: next ? next.at : null,
  };
}
