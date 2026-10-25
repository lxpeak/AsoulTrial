/**
 * 图片预加载闸门：跑完才允许开游戏循环、才允许收起加载层。
 *
 * 之前 `main.js` 是这么写的：
 *
 *     createLoop({ ... }).start();
 *     boot.classList.add('hide');   // 立刻收起"加载中"
 *
 * 而图片是 `assets.js` 在模块初始化时 `new Image()` 后**异步**下的。
 * 也就是说加载层撤掉的时刻，18 张图大概率一张都没到——弱网下前 2~4 秒
 * 能看到标题界面上出现"旧头像 / 贴图逐张冒出来 / 一片空白"。
 * 玩家第一眼看到的不是游戏，是"这玩意好像还没加载好"。
 *
 * ── 两个刻意的取舍 ──
 *
 * 1. **单张失败不阻塞**。任何一张 404 或超时，都只是记进 `failed` 并继续，
 *    因为"缺一张图但是能玩"永远好过"永远停在加载中"。缺图的事交给
 *    console.warn 和 test/smoke.mjs 里的素材存在性测试去管。
 * 2. **超时 12 秒**。移动网络下真的会卡死某一张请求（连接建立了但没数据），
 *    没有超时的话玩家面对的是无限加载。12 秒后当作失败放行。
 */

import { IMGS } from './assets.js';

/** 单张图的容忍上限。局域网/城市宽带正常 <1 秒，12 秒已经很宽松 */
const IMG_TIMEOUT_MS = 12000;

/**
 * 等一张图就位。
 * @returns {Promise<boolean>} 是否可用
 */
function waitOne(img) {
  // `complete` 为真时也要看 naturalWidth：加载失败也是 complete，
  // 那时候 naturalWidth 是 0。这个区分不做，坏图会被当成好图放过去。
  if (img.complete) return Promise.resolve(img.naturalWidth > 0);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (img.removeEventListener) {
        img.removeEventListener('load', onLoad);
        img.removeEventListener('error', onError);
      }
      resolve(ok);
    };

    const onLoad = () => {
      // 下载完 ≠ 解码完。先 decode 一下，避免第一帧绘制时同步解码卡一下
      // （第一次进标题界面的"顿一下"就是这么来的）。decode 失败也不影响显示
      if (img.decode) {
        img.decode().then(() => finish(true), () => finish(true));
      } else {
        finish(true);
      }
    };
    const onError = () => finish(false);
    const timer = setTimeout(() => finish(false), IMG_TIMEOUT_MS);

    img.addEventListener('load', onLoad);
    img.addEventListener('error', onError);
    // 挂完监听再补一次检查：万一在"检查 complete"和"挂监听"之间已经下完
    // （同一 tick 内理论上不会，但浏览器实现差异不值得赌），否则会白等 12 秒
    if (img.complete) finish(img.naturalWidth > 0);
  });
}

/**
 * 等所有图片，边等边回报进度。
 *
 * @param {(p: { done: number, total: number, failed: string[] }) => void} [onProgress]
 * @returns {Promise<{ total: number, failed: string[], ok: boolean }>}
 */
export async function preloadImages(onProgress) {
  const entries = Object.entries(IMGS);
  const total = entries.length;
  let done = 0;
  const failed = [];

  // 并行等，不是串行：18 张串行下载会把首屏拖到十几秒
  await Promise.all(
    entries.map(async ([key, img]) => {
      const ok = await waitOne(img);
      if (!ok) failed.push(key);
      done++;
      if (onProgress) onProgress({ done, total, failed: failed.slice() });
    })
  );

  return { total, failed, ok: failed.length === 0 };
}
