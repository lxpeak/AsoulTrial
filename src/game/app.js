/**
 * 全局应用状态。
 *
 * `screen` / `stack` 由 ui/screen.js 维护，这里只保留字段初值：
 * 想切界面请用 screen.js 里的 push / pop / replace / reset，直接赋值
 * 只会改字段、不会同步栈，界面就错位了。
 */
export const app = {
  screen: 'title',
  stack: ['title'],
  gs: null,
  titleMenuIdx: 0,
  charSelectIdx: 0,
  pauseMenuIdx: 0,
  settingsMenuIdx: 0,
  gameOverMenuIdx: 0,
  // 升级三选一的当前选项与动画起点（纯界面状态，不影响逻辑）
  upgradeChoices: null,
  upgradeIdx: 0,
  upgradeAt: 0,
};
