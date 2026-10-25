import { worldCenter } from '../data/world.js';
import { CHARS } from '../data/chars.js';
import { BASE_W, BOX_H } from '../data/appearance.js';

/**
 * 造一个玩家。
 *
 * 这里出现了第二次"属性底座"：chars.js 是**角色差异**，升级卡是**当局成长**。
 * 两者都写在同一批字段上（p.atk / p.fireCD / ...），所以卡只需要做
 * 「在当前值上再叠一点」，不用关心是谁的初始值。
 *
 * **p.x / p.y 是脚底坐标**，不是碰撞盒中心。绘制、判定、枪口、摄像机
 * 全部由它派生（见 data/appearance.js）。p.w / p.h 是碰撞盒尺寸，
 * 贝拉技能期间会被放大，所以别把它当常量用。
 */
export function mkPlayer(charKey) {
  const ch = CHARS[charKey];
  const c = worldCenter();
  return {
    x: c.x,
    y: c.y, // 脚底
    w: BASE_W,
    h: BOX_H,

    // ── 五属性底座 ──
    baseSpeed: ch.speed,
    speed: ch.speed, // 派生值：baseSpeed × 技能倍率，改动一律走 syncSpeed
    hp: ch.hp,
    maxHp: ch.hp,
    atk: ch.atk,
    fireCD: ch.fireCD, // 射击间隔（帧），越小越快
    critChance: ch.crit,
    critMult: 2,

    // ── 子弹参数（远射卡/角色差异都改这里）──
    bulletSpeed: ch.bulletSpeed,
    bulletLife: ch.bulletLife,

    // ── 质变卡的开关，默认全关 ──
    pierce: 0,
    multishot: 0,
    vampEvery: 0,
    killCount: 0,
    reflect: 0,
    candyChance: 0,

    // ── 成长 ──
    level: 1,
    xp: 0,
    pendingLevels: 0, // 已经升级但还没选卡的次数
    upgrades: {},

    // ── 临时状态 ──
    // 四种护体见 game/guard.js：同一时刻只有一个生效，别再让它们叠加
    invincible: 0,    // 受伤后的无敌帧（1 秒）
    skillGuard: 0,    // 技能护体（banner + 技能全程，13 秒）
    shield: 0,        // 护盾（10 秒）
    thorns: 0,        // 荆棘三角的存在时间（5 秒，打光耐久会提前结束）
    thornCharges: 0,  // 荆棘耐久：挡 4 次
    god: 0,           // 调试面板的无敌开关，只有 ?debug=1 时可能为真
    skillCharge: 0,
    bannerTimer: 0,
    skillActive: 0,
  };
}

/**
 * 重算派生速度。
 *
 * 贝拉技能会把速度乘 1.5，但 baseSpeed 不能被改——否则技能结束后
 * "还原"会还原到一个被污染的值。速度加成、技能加成、升级卡三者叠加时
 * 只有这一个出口，才不会出现"放完技能跑得比以前快"这类脏数据。
 */
export function syncSpeed(p, charKey) {
  const boost = charKey === 'bella' && p.skillActive > 0 ? 1.5 : 1;
  p.speed = p.baseSpeed * boost;
}

export function initGS(charKey) {
  return {
    charKey,
    frame: 0,
    time: 0, // 逻辑帧计数，替代 Date.now()：暂停时不会继续累加
    // 本局随机种子（flow.startGame 写入）。只在调试面板显示 + 复现用，
    // 不参与任何判定
    seed: 0,
    player: mkPlayer(charKey),
    bullets: [],
    /** Boss 的弹幕。和玩家子弹分开存：命中规则、归属、绘制都不同，混在一起只会到处特判 */
    eBullets: [],
    enemies: [],
    items: [],
    specials: [],
    particles: [],
    floats: [], // 飘字（暴击/回血），纯视觉
    kills: 0,
    endTime: 0,
    // 刷怪节奏归导演管（game/director.js）：spawnTimer 是它的计时器，
    // elitesSpawned 记已经放过几只精英
    spawnTimer: 0,
    elitesSpawned: 0,
    bossesSpawned: 0,
    // 精英让位计时（帧）：Boss 登场的瞬间置 180，让精英晚 3 秒再出，
    // 免得两声"大的来了"叠在同一帧（见 director.js 的 ELITE_HOLD_AFTER_BOSS）
    eliteHold: 0,
    itemTimer: 0,
    itemInterval: 300,
    // 屏幕中央的大字提示（Boss 降临 / 阶段切换）。纯表现，不影响任何逻辑，
    // 但没有它玩家只会觉得"突然冒出个大怪"或"弹幕怎么突然变密了"
    announceText: '',
    announceTimer: 0,
    /** 本条提示的总时长：不同场合不一样（降临 160 帧、变招 110 帧），淡入淡出按它算 */
    announceTotal: 160,
    shootCD: 0,
    eid: 0,
  };
}

export function elapsedSeconds(gs) {
  return Math.floor((gs.endTime || gs.time) / 60);
}
