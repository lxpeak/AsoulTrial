/**
 * 序列帧表登记。
 *
 * 素材来源：AI 一次性生成「同一角色的 8 个姿势」贴在 4×2 网格里，
 * 再由 tools/sprite-sheet.mjs 抠底、切帧、按脚底基线对齐。
 *
 * 为什么坚持一张图出 8 帧：分开生成 8 次的话，每帧的发型、配色、
 * 脸型都会微妙地漂移，动起来像"8 个不同的人"。同一张画布里生成，
 * 一致性由模型自己保证，代价是格子边界得靠脚本处理。
 *
 * frameW/frameH 是**格子**尺寸，不是角色尺寸——每帧内容已按
 * "包围盒底部对齐 + 水平居中"重排过，运行时按格子整块取即可。
 */

/**
 * 三个角色 + 敌人共用同一套网格布局（出图时在 prompt 里就要求了这个版式），
 * 所以敌人帧表也直接展开这一份，改尺寸只需改这里。
 */
export const SHEET_LAYOUT = {
  cols: 4,
  rows: 2,
  /**
   * 格子尺寸。
   *
   * 素材是 1536×1024 出的图，但绘制时角色本体只有 99~126px 高——源帧 512px 高，
   * 九成像素从来没被采到。用 tools/sheet-shrink.mjs 按 0.75 缩到 288×384 之后，
   * 四张 sheet 从 7.4MB 降到 3.6MB，而玩家仍有 1.45 倍、精英 1.5 倍的 DPR2 余量。
   * 改这个数必须同步改素材文件本身的尺寸（测试会校验，改图忘改登记会当场炸）。
   */
  frameW: 288,
  frameH: 384,
  /** 帧内底部留白（脚本 --pad-bottom 的值 × 缩放比），绘制时要抵消掉才能贴地 */
  footPad: 15,
};

const LAYOUT = SHEET_LAYOUT;

/**
 * 行 0 是一个完整走路循环，行 1 依次是 待机 / 待机 / 受击 / 施法。
 * 这个版式是出图时跟模型约定好的，换角色照抄即可。
 *
 * @param {number} headInset 帧顶到角色头顶的距离
 * @param {number} facing 素材的**默认朝向**：1 = 原图朝右，-1 = 原图朝左
 */
function makeSheet(key, headInset, facing = -1) {
  return {
    key: `${key}_q`,
    src: `assets/character/${key}-q-sheet.png`,
    ...LAYOUT,
    /** 帧顶到角色头顶的距离，技能条挂这里才不会飘在半空（各角色 bbox 高度不同） */
    headInset,
    /**
     * 素材默认朝左。为什么不是 1：出图时 prompt 只要求"略微 3/4 正面"，
     * 没指定左右，实测三套行走帧的前脚都在画面左侧、身体略向左倾。
     * 绘制端按 faceX × facing 决定翻不翻，所以只要这里有值，
     * "向右走却在向左迈步"就不会再出现。
     * 换一批素材后如果角色反了，只改这一个数字。
     */
    facing,
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
      cast: [{ c: 3, r: 1 }],
    },
  };
}

export const SPRITE_SHEETS = {
  jiaran: (() => {
    // headInset 是"帧顶到角色头顶"的像素数，必须跟着素材尺寸一起缩（原 57 × 0.75）
    const s = makeSheet('jiaran', 43);
    // 嘉然这批出图时要求了施法带光晕，结果是烘死在像素里的一团黄雾，
    // 把角色糊得看不清细节，只能弃用；技能已有 banner + 金光 + 语音。
    // 没有 cast 帧时绘制端会自动回落到 idle，不用特判。
    delete s.anims.cast;
    return s;
  })(),
  bella: makeSheet('bella', 56),
  eileen: makeSheet('eileen', 47),
};

/** 某个角色有没有序列帧 */
export function hasFrames(charKey) {
  return !!SPRITE_SHEETS[charKey];
}

/**
 * 从任意一张已登记的帧表里取一帧的源矩形。
 *
 * 玩家和敌人共用这一份逻辑：敌人也会缺某个动画（比如没出扑咬帧），
 * 到时候同样靠调用处兜底，而不是各自写一遍取模。
 *
 * @param {object} sheet 帧表对象（含 frameW/frameH/anims）
 * @returns {{sx:number, sy:number, sw:number, sh:number, sheet:object}|null}
 */
export function rectOf(sheet, anim, idx) {
  if (!sheet) return null;
  const list = sheet.anims[anim];
  if (!list || !list.length) return null;
  const f = list[idx % list.length];
  return {
    sx: f.c * sheet.frameW,
    sy: f.r * sheet.frameH,
    sw: sheet.frameW,
    sh: sheet.frameH,
    sheet,
  };
}

/**
 * 取某个角色的一帧。
 * @returns {{sx:number, sy:number, sw:number, sh:number, sheet:object}|null}
 */
export function frameRect(charKey, anim, idx) {
  return rectOf(SPRITE_SHEETS[charKey], anim, idx);
}
