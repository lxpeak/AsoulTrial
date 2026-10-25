/**
 * 角色基础属性。
 *
 * 三个人的差异**故意不做在移动速度上**：速度是最影响手感的一项，
 * 谁慢半拍都会被骂"这角色是不是有问题"。差异化放在攻击节奏、血量、
 * 射程这些不影响操作直觉的维度。
 *   - 嘉然：射得快、暴击高，靠频率和糖果
 *   - 贝拉：血厚、单发伤害高，靠体型和星星
 *   - 乃琳：子弹快而远、能穿透，靠距离和冻结
 *
 * fireCD 只是"基准值"，实际射击间隔取 player.fireCD（可被升级卡缩短）。
 */
export const CHARS = {
  jiaran: {
    name: '嘉然', imgKey: 'jiaran', bannerKey: 'b_jiaran',
    desc: '追踪子弹·糖果连爆',
    atk: 1, speed: 3, hp: 3, fireCD: 15, crit: 0.10,
    bulletSpeed: 1, bulletLife: 1,
  },
  bella: {
    name: '贝拉', imgKey: 'bella', bannerKey: 'b_bella',
    desc: '体型速度UP·星星引力',
    atk: 1.2, speed: 3, hp: 4, fireCD: 20, crit: 0.05,
    bulletSpeed: 1, bulletLife: 1,
  },
  eileen: {
    name: '乃琳', imgKey: 'eileen', bannerKey: 'b_eileen',
    desc: '激光穿透·冻结',
    atk: 1, speed: 3, hp: 3, fireCD: 18, crit: 0.06,
    bulletSpeed: 1.35, bulletLife: 1.3,
  },
};

export const CHAR_KEYS = ['jiaran', 'bella', 'eileen'];
