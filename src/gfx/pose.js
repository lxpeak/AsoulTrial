/**
 * 程序化姿态：没有序列帧时，用变换让静态立绘"活"起来。
 *
 * 现有素材只有一张半身 Q 版头像，做不出迈腿走路的逐帧动画（图里也没腿）。
 * 但 2D 游戏里"角色是否有生命感"大部分来自这几件事，都只需要变换：
 *   待机呼吸（缓慢的纵向缩放 + 微浮动）
 *   移动颠步（|sin| 的上下跳 + 左右轻摆）
 *   受击挤压（squash & stretch + 高频抖动）
 *   技能脉动（整体缩放 + 光晕）
 *   朝向镜像（向左走时水平翻转）
 *
 * 所有输出都是纯视觉参数，不写回游戏状态，因此不会影响判定和存档。
 *
 * 相位全部按**真实时间**推进，不用帧数：144Hz 屏幕上颠步速度不会翻倍。
 */

/** 移动时的颠步相位（只在移动时推进，停下就停在当前姿态，不会突然跳相） */
let walkPhase = 0;
let lastT = 0;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * @param {object} p 玩家状态
 * @param {{moving?: boolean, now?: number, framed?: boolean}} opts
 *   framed: 该角色已有序列帧。帧里本身就画了迈腿抬身，再叠满程序化位移
 *   会变成"一边走路一边蹦迪"，所以位移量按比例压下去，只留一点让帧与帧
 *   之间的过渡不生硬。
 * @returns {{rot:number, sx:number, sy:number, ox:number, oy:number,
 *            scale:number, glow:number, shadow:number,
 *            anim:string, frameIdx:number, phase:number}}
 */
export function playerPose(p, { moving = false, now = performance.now(), framed = false } = {}) {
  const dt = lastT ? clamp(now - lastT, 0, 64) : 16.7;
  lastT = now;

  const pose = {
    rot: 0,
    sx: 1,
    sy: 1,
    ox: 0,
    oy: 0,
    scale: 1,
    glow: 0,
    shadow: 1,
    anim: 'idle',
    frameIdx: 0,
  };

  // 有序列帧时把程序化位移压到 26%
  const k = framed ? 0.26 : 1;

  // 受击帧只在挨打那一瞬间播：invincible 从 60 往下掉，40 以上算"刚被打到"。
  // 技能护体现在走独立的 skillGuard 字段（见 game/guard.js），不会再污染 invincible，
  // 所以这里不需要再拿上限去卡"整段技能都在放挨打姿势"
  const hurt = framed && p.invincible > 40 && p.invincible <= 100;
  if (hurt) {
    pose.anim = 'hurt';
    pose.frameIdx = 0;
  } else if (framed && p.skillActive > 0) {
    // 技能期间举起手。没有 cast 帧的角色由绘制端回落到 idle，
    // 这里仍然给一个随时间变化的帧号，回落过去才不会是张定格图
    pose.anim = 'cast';
    pose.frameIdx = Math.floor(now / 550) % 2;
  } else if (moving) {
    pose.anim = 'walk';
  } else {
    pose.anim = 'idle';
    // 待机两帧轮流，550ms 一换 —— 比呼吸曲线慢一点，看起来像在换气
    pose.frameIdx = Math.floor(now / 550) % 2;
  }

  if (moving) {
    walkPhase += dt * 0.0095; // 约 3 步/秒
    const hop = Math.abs(Math.sin(walkPhase));
    pose.oy = -hop * 6.2 * k;
    pose.rot = Math.sin(walkPhase * 2) * 0.095 * k;
    pose.sy = 1 + (hop - 0.45) * 0.13 * k;
    pose.sx = 1 - (hop - 0.45) * 0.13 * k;
    pose.shadow = 1 - hop * 0.28 * k;
    // 一个完整循环是 2π（|sin| 的周期只有 π，用它取帧会左右脚不分），
    // 均分给 4 帧 → 每帧 π/2。施法时可以边移动，但帧保持施法帧
    if (pose.anim === 'walk') pose.frameIdx = Math.floor(walkPhase / (Math.PI / 2)) % 4;
  } else {
    const breathe = Math.sin(now * 0.0032);
    const bk = framed ? 0.4 : 1;
    pose.oy = breathe * 1.6 * bk;
    pose.sy = 1 + breathe * 0.032 * bk;
    pose.sx = 1 - breathe * 0.018 * bk;
    pose.rot = Math.sin(now * 0.0009) * 0.016;
  }

  // 受击：invincible 从 60 递减，前 12 帧最强，之后迅速衰减
  if (p.invincible > 48) {
    const k = clamp((p.invincible - 48) / 12, 0, 1);
    pose.ox += Math.sin(now * 0.09) * 4 * k;
    pose.sx *= 1 + 0.22 * k;
    pose.sy *= 1 - 0.18 * k;
  }

  // 技能生效：脉动 + 金色光晕（用状态帧数，天然与帧率无关）
  // 序列帧的施法图里已经烘了一层金光，这里就收着点，否则叠成一片死白
  if (p.skillActive > 0) {
    const pulse = Math.sin(p.skillActive * 0.13);
    pose.scale = 1 + pulse * 0.035;
    pose.glow = (framed ? 0.4 : 0.55) + pulse * 0.3;
  }

  // 颠步相位给绘制端复用（跑步扬尘要跟上脚步节奏）
  pose.phase = walkPhase;

  return pose;
}

/** 切界面/换局时清相位，避免上一局残留的颠步角度带进新角色 */
export function resetPose() {
  walkPhase = 0;
  lastT = 0;
}
