/**
 * 界面注册与输入分发。
 *
 * 这里只做两件事：把每个界面的"怎么画、怎么响应按键/点击"登记到界面栈，
 * 然后把按键和点击直接转交给栈顶。没有 if-else 链，加界面 = 加一个
 * `register('xxx', {...})`，不用改任何已有代码。
 */
import { VIEW_W, VIEW_H } from '../gfx/canvas.js';
import { SFX } from '../gfx/assets.js';
import { SETTINGS } from '../data/settings.js';
import { CHAR_KEYS } from '../data/chars.js';
import { app } from '../game/app.js';
import { dispatchClick, dispatchKey, pop, push, register } from './screen.js';
import { persistSettings } from '../data/save.js';
import {
  activateSkill, closeSettings, confirmGameOver, confirmPause, startGame,
} from '../game/flow.js';
import { chooseCard } from '../game/level.js';
import {
  drawCharSelect, drawGameOver, drawPause, drawSettings, drawTitle,
} from './menus.js';
import { drawGame } from './gameview.js';
import { cardRect, drawUpgrade } from './upgrade.js';

const isConfirm = (code) => code === 'Space' || code === 'Enter';
const isUp = (code) => code === 'ArrowUp' || code === 'KeyW';
const isDown = (code) => code === 'ArrowDown' || code === 'KeyS';

// ==================== 设置项改动的统一出口（改完顺手落盘） ====================
function setVolume(v) {
  SETTINGS.volume = Math.max(0, Math.min(1, v));
  persistSettings();
}

function nudgeVolume(d) {
  setVolume(Math.round((SETTINGS.volume + d) * 100) / 100);
}

function toggleSfx() {
  SETTINGS.sfx = !SETTINGS.sfx;
  persistSettings();
  if (SETTINGS.sfx) SFX.select(); // 关的时候不要出声
}

// ==================== 标题 ====================
const TITLE_ROWS = ['开始游戏', '设置'];

function enterTitleRow(idx) {
  app.titleMenuIdx = idx;
  SFX.confirm();
  if (idx === 0) push('charSelect');
  else {
    app.settingsMenuIdx = 0;
    push('settings');
  }
}

register('title', {
  draw: drawTitle,
  onKey(code) {
    if (isUp(code) || isDown(code)) {
      app.titleMenuIdx = (app.titleMenuIdx + 1) % TITLE_ROWS.length;
      SFX.select();
      return;
    }
    if (isConfirm(code)) enterTitleRow(app.titleMenuIdx);
  },
  onClick(mx, my) {
    TITLE_ROWS.forEach((_, idx) => {
      const by = VIEW_H / 2 + 30 + idx * 56;
      if (Math.abs(mx - VIEW_W / 2) < 110 && Math.abs(my - by) < 22) enterTitleRow(idx);
    });
  },
});

// ==================== 角色选择 ====================
register('charSelect', {
  draw: drawCharSelect,
  onKey(code) {
    if (code === 'ArrowLeft' || code === 'KeyA') {
      app.charSelectIdx = (app.charSelectIdx + CHAR_KEYS.length - 1) % CHAR_KEYS.length;
      SFX.select();
      return;
    }
    if (code === 'ArrowRight' || code === 'KeyD') {
      app.charSelectIdx = (app.charSelectIdx + 1) % CHAR_KEYS.length;
      SFX.select();
      return;
    }
    if (isConfirm(code)) {
      SFX.confirm();
      startGame(CHAR_KEYS[app.charSelectIdx]);
      return;
    }
    if (code === 'Escape') {
      SFX.select();
      pop(); // 回到标题
    }
  },
  onClick(mx, my) {
    CHAR_KEYS.forEach((key, idx) => {
      const cx = VIEW_W / 2 - 200 + idx * 200;
      if (Math.abs(mx - cx) < 90 && Math.abs(my - VIEW_H / 2 - 20) < 130) {
        app.charSelectIdx = idx;
        SFX.confirm();
        startGame(key);
      }
    });
  },
});

// ==================== 战斗中（不透明，点击交给摇杆层） ====================
register('game', {
  draw: drawGame,
  onKey(code) {
    if (code === 'Space') activateSkill();
    if (code === 'Escape') {
      app.pauseMenuIdx = 0;
      SFX.select();
      push('paused');
    }
  },
});

// ==================== 暂停（半透明，底下继续画战场） ====================
const PAUSE_ROWS = ['继续游戏', '返回主菜单', '设置'];

register('paused', {
  opaque: false,
  draw: drawPause,
  onKey(code) {
    if (isUp(code)) {
      app.pauseMenuIdx = (app.pauseMenuIdx + PAUSE_ROWS.length - 1) % PAUSE_ROWS.length;
      SFX.select();
      return;
    }
    if (isDown(code)) {
      app.pauseMenuIdx = (app.pauseMenuIdx + 1) % PAUSE_ROWS.length;
      SFX.select();
      return;
    }
    if (isConfirm(code)) {
      confirmPause();
      return;
    }
    if (code === 'Escape') {
      SFX.select();
      pop();
    }
  },
  onClick(mx, my) {
    PAUSE_ROWS.forEach((_, idx) => {
      const by = VIEW_H / 2 - 20 + idx * 54;
      if (Math.abs(mx - VIEW_W / 2) < 115 && Math.abs(my - by) < 22) {
        app.pauseMenuIdx = idx;
        confirmPause();
      }
    });
  },
});

// ==================== 设置（整屏铺满，所以总是 opaque） ====================
const SETTINGS_ROWS = 4; // 音量 / 音效 / 语言 / 返回
const SETTINGS_TOP = 190;
const SETTINGS_GAP = 72;

register('settings', {
  draw: drawSettings,
  onKey(code) {
    if (isUp(code)) {
      app.settingsMenuIdx = (app.settingsMenuIdx + SETTINGS_ROWS - 1) % SETTINGS_ROWS;
      SFX.select();
      return;
    }
    if (isDown(code)) {
      app.settingsMenuIdx = (app.settingsMenuIdx + 1) % SETTINGS_ROWS;
      SFX.select();
      return;
    }
    if (app.settingsMenuIdx === 0 && code === 'ArrowLeft') {
      nudgeVolume(-0.05);
      SFX.select();
      return;
    }
    if (app.settingsMenuIdx === 0 && code === 'ArrowRight') {
      nudgeVolume(0.05);
      SFX.select();
      return;
    }
    if (isConfirm(code)) {
      if (app.settingsMenuIdx === 1) toggleSfx();
      else if (app.settingsMenuIdx === 3) closeSettings();
      return;
    }
    if (code === 'Escape') closeSettings();
  },
  onClick(mx, my) {
    const volY = SETTINGS_TOP;
    if (Math.abs(my - volY) < 30) {
      app.settingsMenuIdx = 0;
      const bx = VIEW_W / 2 - 20;
      const barW = 140;
      if (mx >= bx && mx <= bx + barW) setVolume((mx - bx) / barW);
      else if (mx < bx) nudgeVolume(-0.05);
      else nudgeVolume(0.05);
    }

    const sfxY = SETTINGS_TOP + SETTINGS_GAP;
    if (Math.abs(my - sfxY) < 30 && mx > VIEW_W / 2 + 30 && mx < VIEW_W / 2 + 140) {
      toggleSfx();
    }

    const backY = SETTINGS_TOP + 3 * SETTINGS_GAP;
    if (Math.abs(mx - VIEW_W / 2) < 110 && Math.abs(my - backY) < 22) closeSettings();
  },
});

// ==================== 升级三选一（半透明，底下继续画战场） ====================
/**
 * 没有"关闭"这个出口：不做倒计时、也不许 ESC 跳过。
 * 三选一是这一局唯一的成长机会，跳过等于白打一级，所以规则上是强制的。
 */
register('upgrade', {
  opaque: false,
  draw: drawUpgrade,
  onKey(code) {
    const n = (app.upgradeChoices || []).length;
    if (!n) return;

    if (code === 'ArrowLeft' || code === 'KeyA') {
      app.upgradeIdx = (app.upgradeIdx + n - 1) % n;
      SFX.select();
      return;
    }
    if (code === 'ArrowRight' || code === 'KeyD') {
      app.upgradeIdx = (app.upgradeIdx + 1) % n;
      SFX.select();
      return;
    }
    // 1/2/3 直接选：手机上点卡片更快，但桌面端老玩家更习惯按数字
    if (code === 'Digit1' || code === 'Digit2' || code === 'Digit3') {
      const i = Number(code.slice(5)) - 1;
      if (i < n) {
        app.upgradeIdx = i;
        chooseCard(i);
      }
      return;
    }
    if (isConfirm(code)) chooseCard(app.upgradeIdx);
  },
  onClick(mx, my) {
    const n = (app.upgradeChoices || []).length;
    for (let i = 0; i < n; i++) {
      const r = cardRect(i, n);
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
        app.upgradeIdx = i;
        chooseCard(i);
        return;
      }
    }
  },
});

// ==================== 结算（半透明，底下继续画战场） ====================
register('gameOver', {
  opaque: false,
  draw: drawGameOver,
  onKey(code) {
    if (isUp(code)) {
      app.gameOverMenuIdx = 0;
      SFX.select();
      return;
    }
    if (isDown(code)) {
      app.gameOverMenuIdx = 1;
      SFX.select();
      return;
    }
    if (isConfirm(code)) confirmGameOver();
  },
  onClick(mx, my) {
    if (Math.abs(mx - VIEW_W / 2) < 100 && Math.abs(my - (VIEW_H / 2 + 70)) < 20) {
      app.gameOverMenuIdx = 0;
      confirmGameOver();
    }
    if (Math.abs(mx - VIEW_W / 2) < 100 && Math.abs(my - (VIEW_H / 2 + 122)) < 20) {
      app.gameOverMenuIdx = 1;
      confirmGameOver();
    }
  },
});

// ==================== 对外入口（main.js 与测试用） ====================
export function onKeyPress(code) {
  dispatchKey(code);
}

export function onCanvasClick(mx, my) {
  dispatchClick(mx, my);
}
