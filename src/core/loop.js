const STEP = 1000 / 60;

/**
 * 固定步长主循环：逻辑恒定 60Hz，渲染跟随刷新率。
 * 这样 144Hz 屏幕上游戏速度不会翻倍，所有"按帧计时"的语义保持正确。
 */
export function createLoop({ update, render }) {
  let acc = 0;
  let last = 0;
  let raf = 0;
  let running = false;

  function frame(now) {
    if (!running) return;
    let dt = now - last;
    last = now;
    if (dt > 250) dt = 250; // 切后台回来不追帧，避免一次补几十步
    acc += dt;

    let guard = 0;
    while (acc >= STEP && guard++ < 5) {
      update();
      acc -= STEP;
    }

    render();
    raf = requestAnimationFrame(frame);
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = performance.now();
      acc = 0;
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
  };
}

export const STEP_MS = STEP;
