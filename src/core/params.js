/**
 * URL 查询串里的两个开发参数。
 *
 *   ?debug=1     打开调试面板（见 ui/debug.js）
 *   ?seed=12345  固定随机种子，用来复现某一局的刷怪/掉落序列
 *
 * 为什么单独一个文件：这两项要同时被 `main.js`（决定要不要挂调试钩子）、
 * `flow.js`（开局播种）和 `ui/debug.js`（显示 seed）读。散着写会出现
 * "面板显示的 seed 和真正用的 seed 不是同一个"这种事，所以只解析一次。
 *
 * 注意 `location` 在 Node 测试里不存在：整段都要能安全降级。
 */

function parse() {
  const out = { debug: false, seed: null };
  try {
    const s = typeof location !== 'undefined' ? location.search : '';
    if (!s) return out;
    const q = new URLSearchParams(s);
    out.debug = q.get('debug') === '1' || q.get('debug') === 'true';
    const seed = parseInt(q.get('seed'), 10);
    // 只接受正整数：mulberry32 内部会 >>> 0，负数/NaN 会让"复现"这件事悄悄失效
    if (Number.isFinite(seed) && seed > 0) out.seed = seed >>> 0;
  } catch (e) {
    /* 拿不到查询串就当没有 */
  }
  return out;
}

export const PARAMS = parse();
