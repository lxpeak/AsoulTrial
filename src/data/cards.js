/**
 * 升级卡池。
 *
 * 两类卡的分工是刻意的：
 *   stat   纯数值，可以叠很多层   —— 负责"越打越强"的成长曲线
 *   special 解锁新机制，只能拿 1~2 次 —— 负责构筑分叉，决定这一局怎么玩
 *
 * 早期抽到数值卡的概率更高（见 level.js 的 weightOf），局面稳住之后
 * 质变卡权重慢慢超过数值卡，避免"打了十分钟还在堆 +20% 攻击"。
 *
 * 每张卡的字段：
 *   id     唯一键，同时是 player.upgrades 里的计数键
 *   name   卡名
 *   icon   单个 emoji（卡面大字，不用图片素材）
 *   tier   'stat' | 'special'
 *   max    最多拿几次；抽卡时到上限的卡会自动从池子里剔除
 *   weight 基础权重
 *   desc   一句话说明，绘制端按「，」分段换行
 *   apply(p, gs) 生效。**只改 player 上的字段**，不碰界面、不碰敌人，
 *          这样卡的效果在一个地方就能看全，也方便写测试
 */

const r2 = (v) => Math.round(v * 100) / 100;

export const CARD_LIST = [
  // ==================== 数值卡 ====================
  {
    id: 'atk', name: '力量', icon: '⚔', tier: 'stat', max: 8, weight: 3,
    desc: '攻击力 +20%',
    apply(p) {
      p.atk = r2(p.atk * 1.2);
    },
  },
  {
    id: 'rate', name: '疾风', icon: '⚡', tier: 'stat', max: 8, weight: 3,
    desc: '射击间隔 -13%',
    apply(p) {
      // 保住下限：无限叠会变成一帧一发，弹幕糊死屏幕也糊死手机
      p.fireCD = Math.max(5, r2(p.fireCD * 0.87));
    },
  },
  {
    id: 'spd', name: '轻身', icon: '👟', tier: 'stat', max: 6, weight: 2,
    desc: '移动速度 +10%',
    apply(p) {
      p.baseSpeed = r2(p.baseSpeed * 1.1);
      // 贝拉技能期间 speed 是 baseSpeed 的 1.5 倍，这里不能直接覆盖，
      // 等技能结束由 flow.js 统一还原
      if (p.skillActive <= 0) p.speed = p.baseSpeed;
    },
  },
  {
    id: 'hp', name: '坚韧', icon: '❤', tier: 'stat', max: 6, weight: 3,
    desc: '生命上限 +1，并回复 1 点',
    apply(p) {
      p.maxHp += 1;
      p.hp = Math.min(p.maxHp, p.hp + 1);
    },
  },
  {
    id: 'luck', name: '幸运', icon: '🍀', tier: 'stat', max: 6, weight: 2,
    desc: '暴击率 +8%，暴击双倍伤害',
    apply(p) {
      p.critChance = r2(p.critChance + 0.08);
    },
  },
  {
    id: 'range', name: '远射', icon: '🎯', tier: 'stat', max: 5, weight: 2,
    desc: '子弹速度与射程 +15%',
    apply(p) {
      p.bulletSpeed = r2(p.bulletSpeed * 1.15);
      p.bulletLife = r2(p.bulletLife * 1.15);
    },
  },

  // ==================== 质变卡 ====================
  {
    id: 'pierce', name: '穿透弹', icon: '🗡', tier: 'special', max: 2, weight: 1.2,
    desc: '子弹多穿透 1 个敌人',
    apply(p) {
      p.pierce += 1;
    },
  },
  {
    id: 'multi', name: '分裂射击', icon: '✳', tier: 'special', max: 2, weight: 1.2,
    desc: '每次射击 +1 发子弹',
    apply(p) {
      p.multishot += 1;
    },
  },
  {
    id: 'vamp', name: '嗜血', icon: '🩸', tier: 'special', max: 2, weight: 1,
    desc: '每 15 杀回复 1 点生命',
    apply(p) {
      // 第二层直接把门槛砍半，比"再生叠两遍"直观
      p.vampEvery = p.vampEvery ? 8 : 15;
    },
  },
  {
    id: 'reflect', name: '反伤', icon: '🛡', tier: 'special', max: 2, weight: 1,
    desc: '受伤时反伤周围敌人 3 点',
    apply(p) {
      p.reflect += 3;
    },
  },
  {
    id: 'candy', name: '追击', icon: '🍬', tier: 'special', max: 1, weight: 0.8,
    desc: '击杀 20% 概率掉落糖果',
    apply(p) {
      p.candyChance = 0.2;
    },
  },
  {
    id: 'critdmg', name: '暴击强化', icon: '💥', tier: 'special', max: 2, weight: 1,
    desc: '暴击伤害 → 2.6 倍',
    apply(p) {
      p.critMult = r2(p.critMult + 0.6);
    },
  },
];

export const CARD_BY_ID = Object.fromEntries(CARD_LIST.map((c) => [c.id, c]));

/** 卡面配色：数值卡偏蓝、质变卡偏紫，一眼分出"涨数值"和"改玩法" */
export const TIER_STYLE = {
  stat: { color: '#5eb0f0', label: '数值', bg: 'rgba(30,44,64,0.96)' },
  special: { color: '#c37bff', label: '质变', bg: 'rgba(42,30,60,0.96)' },
};
