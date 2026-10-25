/**
 * Boss 三阶段。
 *
 * 为什么要分阶段：Boss 有 220 血，一场战斗要打 30~40 秒。如果整场都是
 * 同一种"三连扇形"，30 秒之后玩家已经把它当背景了——**威胁一旦可预测就不再是威胁**。
 * 血量把它切成三段，每段换一次节奏：弹数变多、间隔变短、速度变快，
 * 玩家在同一个 Boss 身上要重新学三次怎么躲。
 *
 * ── 为什么不是"加新弹型"而是"加密度" ──
 * 加新弹型（环形弹、追踪弹、激光）看起来很炫，但每加一种就要重新教玩家
 * 怎么读。分阶段只改数量和节奏，规则没变，压力却实打实上去了。
 * 唯一新增的是第三阶段的"补一轮"，那也是同一套扇形，只是要求玩家
 * 躲完第一层后**换个方向**，而不是站定让一次就过。
 *
 * 弹幕始终朝玩家方向摊开，所以永远可读：看到几道弹道就知道往哪边走。
 */

/**
 * 阶段表。`at` 是血量比例下限（含），按顺序从高到低匹配。
 *
 *   字段    含义
 *   shots   一次齐射几发（奇数，围绕瞄准方向对称摊开）
 *   spread  相邻两发的夹角（弧度）。发数变多时夹角会收窄，否则整个扇面太宽，
 *           玩家站在正前方反而没压力
 *   speed   弹速
 *   cd      两次齐射之间的间隔（帧）
 *   speedMul 移动速度倍率（越怒越追得紧）
 *   double  是否在同一轮后补一次齐射
 */
export const BOSS_PHASES = [
  {
    key: 'calm',
    name: '符王·本相',
    at: 1,
    shots: 3,
    spread: 0.24,
    speed: 3.4,
    cd: 140,
    speedMul: 1,
    double: false,
  },
  {
    key: 'anger',
    name: '符王·本相 · 怒',
    at: 0.66,
    shots: 5,
    spread: 0.19,
    speed: 3.9,
    cd: 118,
    speedMul: 1.15,
    double: false,
  },
  {
    key: 'rage',
    name: '符王·本相 · 狂怒',
    at: 0.33,
    shots: 7,
    spread: 0.15,
    speed: 4.4,
    cd: 96,
    speedMul: 1.3,
    double: true,
  },
];

/**
 * 当前该是第几阶段（0 起）。
 *
 * 用**血量比例**判定而不是"掉了多少血"：这样无论血量被卡牌/难度曲线
 * 膨胀到多少，阶段切换点永远在同一个百分比上，节奏不会随数值漂移。
 */
export function bossPhaseIndex(e) {
  if (!e || !(e.maxHp > 0)) return 0;
  const ratio = Math.max(0, e.hp) / e.maxHp;
  let idx = 0;
  for (let i = 0; i < BOSS_PHASES.length; i++) {
    if (ratio <= BOSS_PHASES[i].at) idx = i;
  }
  return idx;
}

export function bossPhase(e) {
  return BOSS_PHASES[bossPhaseIndex(e)];
}
