import { app } from './app.js';
import { initGS, elapsedSeconds, syncSpeed } from './state.js';
import { SFX } from '../gfx/assets.js';
import { rng } from '../core/rng.js';
import { push, pop, reset } from '../ui/screen.js';
import { recordRun } from '../data/save.js';
import { resetUpgrade } from './level.js';
import { resetPose } from '../gfx/pose.js';
import { BASE_W, BOX_H } from '../data/appearance.js';
import { grantGuard } from './guard.js';
import { PARAMS } from '../core/params.js';

export function startGame(charKey) {
  // ?seed=12345 时用固定种子，方便复现"这一局为什么这么难"
  rng.seed(PARAMS.seed != null ? PARAMS.seed : Date.now());
  app.gs = initGS(charKey);
  app.gs.seed = rng.value;
  resetUpgrade();
  resetPose(); // 清掉上一局残留的颠步相位，否则新角色开局会歪一下
  reset('game'); // 新的一局是新的根，标题和角色选择从栈里清掉
}

export function activateSkill() {
  const gs = app.gs;
  if (!gs || app.screen !== 'game') return;
  const p = gs.player;
  if (p.skillCharge < 100 || p.skillActive > 0 || p.bannerTimer > 0) return;

  p.skillCharge = 0;
  p.bannerTimer = 180; // 3s：0.5s 滑入 + 1.5s 停留 + 1s 滑出
  // 技能护体（13 秒）走 guard.js：它会顺手清掉护盾/荆棘，保证"同一时刻只有一个"
  grantGuard(p, 'skill');
  SFX.skillUse();
  SFX.skillAudio(gs.charKey);
}

export function onBannerEnd() {
  const gs = app.gs;
  const p = gs.player;
  p.skillActive = 600; // 10s
  if (gs.charKey === 'bella') {
    // 体型放大 1.5 倍：宽高一起长，碰撞盒底边仍贴脚底（playerBox 负责）
    p.w = BASE_W * 1.5;
    p.h = BOX_H * 1.5;
    syncSpeed(p, gs.charKey);
  }
}

export function onSkillEnd() {
  const gs = app.gs;
  const p = gs.player;
  if (gs.charKey === 'bella') {
    p.w = BASE_W;
    p.h = BOX_H;
    syncSpeed(p, gs.charKey);
  }
}

export function endGame() {
  const gs = app.gs;
  gs.endTime = gs.time;
  gs.newBest = recordRun(gs.kills, elapsedSeconds(gs)); // 存最佳记录，结算页可以显示"新纪录"
  app.gameOverMenuIdx = 0;
  push('gameOver');
  SFX.gameOver();
}

export function confirmGameOver() {
  SFX.confirm();
  if (app.gameOverMenuIdx === 0) startGame(app.gs.charKey);
  else {
    app.gs = null;
    resetUpgrade();
    reset('title');
  }
}

export function confirmPause() {
  SFX.confirm();
  if (app.pauseMenuIdx === 0) {
    pop(); // 回到游戏
  } else if (app.pauseMenuIdx === 1) {
    app.gs = null;
    resetUpgrade();
    reset('title'); // 回主菜单要清栈，否则暂停和游戏残留在下面
  } else if (app.pauseMenuIdx === 2) {
    app.settingsMenuIdx = 0;
    push('settings'); // 从暂停进设置，返回时 pop 自然回到暂停
  }
}

export function closeSettings() {
  SFX.confirm();
  pop();
}
