/**
 * 防御类状态的唯一判定处（TECH_PLAN「三、不变量 · 3 护体同一时刻只有一个」）。
 *
 * ── 为什么要单独一个模块 ──
 *
 * 之前"能不能挨打"写在 `combat.js` 的 `canTakeDamage` 里，一行与运算：
 *
 *     return p.invincible <= 0 && p.shield <= 0 && p.thorns <= 0;
 *
 * 单独看没错，问题是**四个状态各自都是"完全免伤"，而且能叠**：
 * 受击无敌帧 1 秒 + 技能 banner 3 秒 + 技能生效 10 秒 + 护盾 10 秒 + 荆棘 5 秒，
 * 再加上地图上随时能捡到的护盾/荆棘，实战能连续 28 秒不掉血。
 * 难度曲线在这里是断的——不是数值没调好，是需求自己叠出来的洞。
 *
 * 收紧成两条规则：
 *
 *   1. **同一时刻只有一个护体来源**。开技能会清掉身上的护盾/荆棘；
 *      捡到新的防御道具会顶掉旧的（护盾 ⇄ 荆棘互斥）。
 *   2. **荆棘从"无敌"改成"格挡"**：四个三角各有一次耐久，挡一次伤害少一个。
 *      "5 秒无敌"变成"挡 4 下"，玩家要算着用，而不是按了就往前冲。
 *
 * 一条刻意的规则：**技能护体期间拾取防御道具不覆盖技能**
 * （`grantGuard` 返回 false，道具留在地上）。
 * 技能是攒 25 杀换来的 13 秒，被地上一个护盾顶掉会让玩家当场骂人；
 * 留在地上等于"技能结束后还能回来捡"，既没浪费也没降级。
 *
 * 这个文件不 import 任何东西，`combat.js` / `update.js` / `flow.js` / `ui` 都能
 * 直接引用，不会绕出循环依赖，也方便在测试里单独跑规则表。
 */

/** 护盾：10 秒 */
export const SHIELD_FRAMES = 600;

/** 荆棘：三角存在 5 秒（打光耐久会提前结束） */
export const THORNS_FRAMES = 300;

/** 荆棘耐久：挡 4 次 */
export const THORN_CHARGES = 4;

/**
 * 荆棘：每挡下一次伤害给 **1 秒**无敌。
 *
 * 20 帧（0.33s）太短——怪是成堆贴上来的，间隔一过就会被第二只立刻打中，
 * 四层耐久在一秒内被耗光，"挡 4 次"和"挡 1 次"没区别。
 * 给满 1 秒之后，每次格挡都真的换到一次脱身机会，手感才对得上"荆棘护体"。
 */
export const THORN_IFRAMES = 60;

/** 荆棘攻击力。0.2V 原文是 2，按"伤害增加"的要求翻到 4 */
export const THORN_DMG = 4;

/** 三角环半径 = 玩家碰撞盒宽 × 这个倍数（原来 1.0，按"范围增大"放到 1.45） */
export const THORN_RING = 1.45;

/** 三角边长 = 玩家碰撞盒宽 × 这个倍数（原来 0.5） */
export const THORN_SIZE = 0.6;

/**
 * 三角命中半径 = 玩家碰撞盒宽 × 这个倍数（原来 0.4）。
 *
 * 放到 0.75 是为了补上"环变大之后留下的缝"：半径从 40 涨到 58，
 * 而敌人贴身圈只有 35——站在两个三角斜角之间的敌人，到最近三角的距离会到
 * 41 左右，按 0.4 的老数值就打不到了，玩家会觉得"贴脸了荆棘却没反应"。
 * 绘制与判定共用这一个数，别各写一份。
 */
export const THORN_REACH = 0.75;

/** 技能护体：banner 180 帧 + 技能 600 帧 = 13 秒，和原来 `invincible = 780` 一致 */
export const SKILL_GUARD_FRAMES = 780;

/** 挨打后的无敌帧：1 秒 */
export const HIT_IFRAMES = 60;

/**
 * 当前生效的护体来源。
 *
 * 优先级写死在这里，调用点只判断"是不是 null"，不再各自拼与运算——
 * 以后加"减伤装备"要改的也只有这一处。
 *
 * @returns {'god'|'iframe'|'skill'|'shield'|'thorns'|null}
 */
export function guardKind(p) {
  if (p.god) return 'god'; // 调试面板的无敌开关，仅 ?debug=1 时可能为真
  if (p.invincible > 0) return 'iframe';
  if (p.skillGuard > 0) return 'skill';
  if (p.shield > 0) return 'shield';
  if (p.thorns > 0 && p.thornCharges > 0) return 'thorns';
  return null;
}

/**
 * 只要"有护体"就返回真。给"要不要扣血"之外的逻辑用（比如 UI 判断要不要画光效）
 */
export function hasGuard(p) {
  return guardKind(p) !== null;
}

/**
 * 去掉"挨打后的无敌帧"之后的护体类型，只看**有持续时间的那种**。
 *
 * 为什么 HUD 要用这个而不是 `guardKind`：荆棘挡一下会把 `invincible` 置 20 帧，
 * 那 20 帧里 `guardKind` 返回 'iframe'，HUD 就会从「🌵×2」闪成「护体 iframe」再闪回来。
 * 玩家看到的是"图标在抽"，读不出还剩几层。护盾/荆棘/技能才是玩家该盯的东西。
 *
 * @returns {'skill'|'shield'|'thorns'|null}
 */
export function lastingGuard(p) {
  if (p.skillGuard > 0) return 'skill';
  if (p.shield > 0) return 'shield';
  if (p.thorns > 0 && p.thornCharges > 0) return 'thorns';
  return null;
}

/** 清空护盾 + 荆棘（含耐久）。技能护体不在这里，它有自己的计时 */
export function clearDefense(p) {
  p.shield = 0;
  p.thorns = 0;
  p.thornCharges = 0;
}

/**
 * 上一个新的护体。
 *
 * @param {object} p
 * @param {'skill'|'shield'|'thorns'} kind
 * @returns {boolean} false 表示"没吃下去"（技能护体期间捡到低级道具），
 *                    调用方应该把道具留在地上，别 splice
 */
export function grantGuard(p, kind) {
  if (kind === 'skill') {
    // 技能比两种道具都强，直接顶掉它们（"同一时刻只有一个"从这边也成立）
    clearDefense(p);
    p.skillGuard = SKILL_GUARD_FRAMES;
    return true;
  }
  if (p.skillGuard > 0) return false; // 不降级，见文件头的说明

  clearDefense(p);
  if (kind === 'shield') {
    p.shield = SHIELD_FRAMES;
    return true;
  }
  if (kind === 'thorns') {
    p.thorns = THORNS_FRAMES;
    p.thornCharges = THORN_CHARGES;
    return true;
  }
  return false;
}

/**
 * 消耗一个荆棘耐久。打光时三角一起消失（`thorns = 0`），
 * 而不是留一个"看得见但不挡事"的空壳。
 * @returns {number} 剩余耐久
 */
export function consumeThorn(p) {
  if (p.thornCharges > 0) p.thornCharges--;
  if (p.thornCharges <= 0) {
    p.thornCharges = 0;
    p.thorns = 0;
  }
  return p.thornCharges;
}
