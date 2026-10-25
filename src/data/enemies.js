/**
 * 敌人：外观 + 玩法数值。
 *
 * 为什么和 chars.js 分开：角色是"玩家可选的三个"，敌人是"按波次刷出来的类型"，
 * 这张表会一直加行，而 chars.js 不会。
 *
 * 帧表走的是和主角**同一条管线**（tools/sprite-sheet.mjs）：AI 一次出 4×2 格，
 * 脚本抠底 + 按脚底基线对齐。这样敌人和主角的描边粗细、赛璐璐色块、
 * 头身比是同一套语言，不会出现"Q 版小人打一个圆形色块"的割裂感。
 *
 * ── 分级的做法：一张素材，四种读法 ──
 * 目前四种敌人共用同一张青蛙帧表，靠**体型 + 色相**区分。这是有意的取舍：
 * 每种怪单独出一张 sheet 意味着加载体积翻倍、AI 生成成本翻倍，而"快怪更快、
 * 肉盾更厚"这件事玩家是能从行为读出来的，视觉只需要帮忙确认"这是哪一种"。
 * 体型差（0.82 / 1.0 / 1.42 / 1.9）本身就已经是最强的区分信号，
 * 色相只是补一道保险，让玩家在混战里不用数血条。
 *
 * 以后真要专属美术，只需要给某个类型换 `sheet`，其他一行都不用动。
 */
import { SHEET_LAYOUT } from './sprites.js';

/**
 * 基准视觉高度（像素）。各类型再乘以自己的 `visual` 系数。
 *
 * 玩家是 132（本体约 112），基准怪取 78（本体约 66）：
 * 视觉上明显是"小怪围着主角"，围上来也不至于把玩家埋掉。
 * 早先取 96 时，二十只怪挤在贴身圈里，玩家整个人被盖住找不到自己——
 * 割草游戏里"主角大、杂兵小"不只是审美，更是可读性：玩家必须一眼看到自己在哪。
 */
export const ENEMY_BASE_H = 78;

/** 基准步频：每多少逻辑帧换一格走路帧。4 格 → 40 帧一轮（0.67 秒） */
export const ENEMY_FRAME_STEP = 10;

/** 走路帧的"标准速度"，用来把 speed 折算成步频（跑得快的怪步子也得迈得快） */
const STRIDE_REF_SPEED = 1.3;

/**
 * 敌人帧表登记。
 *
 * 布局和主角完全一致：行 0 走路 4 帧，行 1 待机 2 帧 + 受击 + 攻击。
 */
export const ENEMY_SHEETS = {
  frog: {
    key: 'enemy_q',
    src: 'assets/character/enemy-q-sheet.png',
    ...SHEET_LAYOUT,
    /** 帧顶到头顶的距离（脚本输出的 dy 平均值 × 0.75 缩放比），血条挂这里 */
    headInset: 47,
    facing: -1,
    anims: {
      walk: [
        { c: 0, r: 0 },
        { c: 1, r: 0 },
        { c: 2, r: 0 },
        { c: 3, r: 0 },
      ],
      idle: [
        { c: 0, r: 1 },
        { c: 1, r: 1 },
      ],
      hurt: [{ c: 2, r: 1 }],
      // 行 1 第 4 格（扑咬）**故意不登记**：那张嘴里的浅色口腔被抠底判成背景，
      // 在草地上会漏出一个透明洞。等玩法真需要"攻击前摇"时按同一版式重出一张。
    },
  },
};

/**
 * 敌人类型表。
 *
 * 字段说明：
 *   w / h    碰撞盒，**不是视觉尺寸**——和玩家一样"看起来大、挨打准"
 *   visual   视觉缩放，乘在 ENEMY_BASE_H 上
 *   hue      色相旋转（度）。0 = 原色。用 canvas filter 做，白色部分不受影响，
 *            所以白眼球和白衬衫不会被染脏
 *   saturate 饱和度倍率，配合 hue 用
 *   tier     'normal' | 'elite'。精英会额外掉道具、血条样式也不同
 *
 * 数值设计：血量涨得比攻击快得多。攻击一律 1~2——玩家 3~5 颗心，
 * 攻击再涨就变成"两下秒"，而割草游戏的爽点应该在"清屏"而不是"别挨打"。
 */
export const ENEMY_TYPES = {
  /** 基础小兵。存在感靠数量，3 血对应开局 1 点攻击 = 三枪一只 */
  frog: {
    name: '纸符青蛙',
    sheet: 'frog',
    tier: 'normal',
    w: 40,
    h: 40,
    hp: 3,
    atk: 1,
    xp: 1,
    speedMin: 1,
    speedMax: 1.6,
    visual: 1,
    hue: 0,
    saturate: 1,
  },

  /**
   * 快怪。血少、体小、速度快一倍。
   * 它的作用是**逼玩家动起来**——站在原地点射会被几只快怪同时摸到。
   * 色相往青绿偏，和慢吞吞的黄绿青蛙区分开。
   */
  runner: {
    name: '疾行蛙',
    sheet: 'frog',
    tier: 'normal',
    w: 32,
    h: 32,
    hp: 2,
    atk: 1,
    xp: 1,
    speedMin: 2.2,
    speedMax: 2.9,
    visual: 0.82,
    hue: 58,
    saturate: 2.6,
  },

  /**
   * 肉盾。血厚、体大、极慢。
   * 它是"你打不动我"的压力源，也是**穿透/暴击卡的价值证明**——
   * 没有它，纯堆攻速就能解决一切。
   */
  brute: {
    name: '铁符蛙',
    sheet: 'frog',
    tier: 'normal',
    w: 56,
    h: 56,
    hp: 14,
    atk: 2,
    xp: 3,
    speedMin: 0.55,
    speedMax: 0.85,
    visual: 1.44,
    hue: 158,
    saturate: 2.4,
  },

  /**
   * 精英。每 75 秒一只，血厚到需要专门处理，但给 8 点经验 + 必掉道具。
   * 体型接近主角的 1.4 倍，配金色光环——**在混战里必须一眼认出来**。
   */
  elite: {
    name: '符王',
    sheet: 'frog',
    tier: 'elite',
    w: 72,
    h: 72,
    hp: 52,
    atk: 2,
    xp: 8,
    speedMin: 0.7,
    speedMax: 0.95,
    visual: 1.62,
    hue: -84,
    saturate: 2.8,
  },

  /**
   * Boss。每 150 秒一只，是"这一局打到哪了"的刻度。
   *
   * 行为和普通怪完全不同：它**保持中距离**、周期发射扇形弹幕，
   * 而不是贴脸蹭伤害。所以它在 update.js 里走的是另一条分支。
   *
   * 素材仍然是青蛙那张表，放大 2.5 倍 + 深蓝紫染色。
   * 这是有意的：先把"打 Boss"这条玩法闭环跑通，专属立绘和弹幕形态
   * 可以之后再补——现在缺的是节奏，不是美术。
   */
  boss: {
    name: '符王·本相',
    sheet: 'frog',
    tier: 'boss',
    w: 96,
    h: 96,
    hp: 220,
    atk: 2,
    xp: 32,
    speedMin: 0.75,
    speedMax: 0.9,
    visual: 2.5,
    hue: 196,
    saturate: 2.2,
  },
};

/** 类型兜底：敌人对象上的 type 万一没登记，别让整帧渲染炸掉 */
export function enemyType(e) {
  return ENEMY_TYPES[e && e.type] || ENEMY_TYPES.frog;
}

/**
 * 能不能被「斩杀 / 秒杀」类效果处理掉。
 *
 * 只有普通小兵可以。精英和 Boss **免疫**——它们是"一段战斗的节点"，
 * 一颗追踪弹或一次撞击就带走，等于把打精英这件事整个抹掉了：
 * 玩家会学会"攒着技能等精英"，而技能本来是清场用的爽点。
 *
 * 免疫不等于无效：调用方要退化成普通伤害（追踪弹 = 普通弹伤害，
 * 贝拉撞击 = 一记重击），这样技能对精英依然有用，只是不再一键清场。
 */
export function canExecute(e) {
  if (!e) return false;
  const tier = e.tier || enemyType(e).tier;
  return tier === 'normal';
}

/** 某只敌人这一帧的实际视觉高度（像素） */
export function enemyDrawH(e) {
  return ENEMY_BASE_H * enemyType(e).visual;
}

/**
 * 受击盒（子弹 / 特殊物判定用）。
 *
 * 为什么不能直接用 e.w / e.h：那是**脚下底盘**，给移动、接触伤害、分离力用的，
 * 只有 40 高；而视觉body有 65~165 高。拿底盘判命中，表现就是
 * "子弹从青蛙头顶穿过去了"——上半身完全打不到，看着像判定丢了。
 *
 * 这个盒子按着**真实渲染出来的身体**算：
 *   底边 = 脚底（碰撞盒底边）
 *   顶边 = 帧顶 + headInset（角色头顶），也就是扣掉帧内的上下留白
 *   宽度 ≥ 碰撞盒，同时跟着体型走
 * 所以视觉和判定是同一套尺寸推导出来的，改素材尺寸或体型系数不会分家。
 */
export function enemyHurtBox(e) {
  const type = enemyType(e);
  const sheet = ENEMY_SHEETS[type.sheet];
  const drawH = enemyDrawH(e);
  const feet = e.y + e.h / 2;
  if (!sheet) return { x: e.x, y: feet - e.h / 2, w: e.w, h: e.h };

  const scale = drawH / sheet.frameH;
  // 帧内上下留白都要扣掉：footPad 是脚底以下的空白，headInset 是头顶以上的空白
  const h = drawH - (sheet.footPad + sheet.headInset) * scale;
  // 0.72 是帧宽里角色实际占的比例（两侧各留一点空隙）
  const w = Math.max(e.w, sheet.frameW * scale * 0.72);
  return { x: e.x, y: feet - h / 2, w, h };
}

/** 某个敌人当前该播哪个动画：冻住时站着不动 */
export function enemyAnim(e) {
  return e.frozen > 0 ? 'idle' : 'walk';
}

/**
 * 取敌人这一帧的序号。
 *
 * 用 e.age 而不是全局帧：每只怪都有自己的步频相位，一群怪同手同脚
 * 看起来像复制粘贴。age 从出生开始累加，天然错开。
 *
 * `stride`（每格帧数）在生成时按速度算好存进敌人对象：
 * 疾行蛙跑两倍速，步子也得迈两倍快，否则看起来像在冰上滑行。
 */
export function enemyFrameIdx(e) {
  return Math.floor((e.age || 0) / (e.stride || ENEMY_FRAME_STEP));
}

/** 按速度折算步频。快怪 stride 小 → 换帧快 */
export function strideFor(speed) {
  return Math.max(5, Math.round(ENEMY_FRAME_STEP / (speed / STRIDE_REF_SPEED)));
}
