import { ctx, VIEW_W, VIEW_H } from '../gfx/canvas.js';
import { imgAt, txt, rrect } from '../gfx/draw.js';
import { IMGS } from '../gfx/assets.js';
import { CHARS, CHAR_KEYS } from '../data/chars.js';
import { SETTINGS } from '../data/settings.js';
import { SAVE, persistent } from '../data/save.js';
import { CARD_BY_ID } from '../data/cards.js';
import { app } from '../game/app.js';
import { elapsedSeconds } from '../game/state.js';
import { VERSION } from '../data/version.js';

export function drawTitle() {
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (let i = 0; i < 100; i++) {
    ctx.beginPath();
    ctx.arc((i * 137.5) % VIEW_W, (i * 73.1 + performance.now() * 0.01) % VIEW_H, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }

  txt('一个魂的试炼', VIEW_W / 2, VIEW_H / 2 - 90, { size: 52, color: '#ffd700', bold: true, shadow: true });
  txt('The Trial of A-Soul', VIEW_W / 2, VIEW_H / 2 - 34, { size: 18, color: '#888' });

  ['开始游戏', '设置'].forEach((label, idx) => {
    const by = VIEW_H / 2 + 30 + idx * 56;
    const sel = idx === app.titleMenuIdx;
    rrect(
      VIEW_W / 2 - 110, by - 22, 220, 44, 10,
      sel ? 'rgba(255,215,0,0.25)' : 'rgba(255,255,255,0.06)',
      sel ? '#ffd700' : '#444',
      sel ? 2 : 1
    );
    txt(label, VIEW_W / 2, by, { size: 20, color: sel ? '#ffd700' : '#ccc', bold: sel });
    if (sel) txt('►', VIEW_W / 2 - 95, by, { size: 14, color: '#ffd700' });
  });

  if (SAVE.best.kills > 0) {
    txt(
      `最佳记录：${SAVE.best.kills} 杀 / ${SAVE.best.time} 秒`,
      VIEW_W / 2, VIEW_H - 52,
      { size: 13, color: '#7f6a1f' }
    );
  }

  txt('WASD 移动   方向键 射击   空格 技能', VIEW_W / 2, VIEW_H - 28, { size: 13, color: '#555' });
  // 版本号放右下角：不抢主标题的视线，但截图反馈时一眼能看出是哪个迭代
  txt('v' + VERSION, VIEW_W - 12, VIEW_H - 12, { size: 11, color: '#3f3f55', align: 'right' });
}

export function drawCharSelect() {
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  txt('选择角色', VIEW_W / 2, 56, { size: 34, color: '#ffd700', bold: true, shadow: true });
  txt('← → 选择   空格确认   点击角色卡', VIEW_W / 2, 92, { size: 14, color: '#777' });

  const CW = 176;
  const CH = 256;
  const gap = 20;
  const totalW = CHAR_KEYS.length * (CW + gap) - gap;
  const startX = (VIEW_W - totalW) / 2;

  CHAR_KEYS.forEach((key, idx) => {
    const ch = CHARS[key];
    const cx = startX + idx * (CW + gap) + CW / 2;
    const cy = VIEW_H / 2 + 30;
    const sel = idx === app.charSelectIdx;

    if (sel) {
      ctx.save();
      ctx.shadowColor = '#ffd700';
      ctx.shadowBlur = 20;
      rrect(cx - CW / 2 - 2, cy - CH / 2 - 2, CW + 4, CH + 4, 14, null, '#ffd700', 2);
      ctx.restore();
    }

    rrect(
      cx - CW / 2, cy - CH / 2, CW, CH, 12,
      sel ? 'rgba(255,215,0,0.18)' : 'rgba(255,255,255,0.05)',
      sel ? '#ffd700' : '#444',
      sel ? 2 : 1
    );

    const imgH = CH - 80;
    const img = IMGS[ch.imgKey];
    if (img && img.complete && img.naturalWidth) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(cx - CW / 2 + 8, cy - CH / 2 + 8, CW - 16, imgH, 8);
      ctx.clip();
      ctx.drawImage(img, cx - CW / 2 + 8, cy - CH / 2 + 8, CW - 16, imgH);
      ctx.restore();
    } else {
      rrect(cx - CW / 2 + 8, cy - CH / 2 + 8, CW - 16, imgH, 8, '#2a2a4a', null);
      txt('?', cx, cy - CH / 2 + 8 + imgH / 2, { size: 40, color: '#555' });
    }

    txt(ch.name, cx, cy + CH / 2 - 54, { size: 20, color: sel ? '#ffd700' : '#eee', bold: true });
    txt(ch.desc, cx, cy + CH / 2 - 28, { size: 11, color: '#999' });
    if (sel) txt('▼ 选择', cx, cy + CH / 2 + 14, { size: 13, color: '#ffd700' });
  });
}

export function drawPause() {
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  txt('游戏暂停', VIEW_W / 2, VIEW_H / 2 - 100, { size: 42, color: '#ffd700', bold: true, shadow: true });

  ['继续游戏', '返回主菜单', '设置'].forEach((label, idx) => {
    const by = VIEW_H / 2 - 20 + idx * 54;
    const sel = idx === app.pauseMenuIdx;
    rrect(
      VIEW_W / 2 - 115, by - 22, 230, 44, 10,
      sel ? 'rgba(255,215,0,0.25)' : 'rgba(255,255,255,0.07)',
      sel ? '#ffd700' : '#555',
      sel ? 2 : 1
    );
    txt(label, VIEW_W / 2, by, { size: 19, color: sel ? '#ffd700' : '#bbb', bold: sel });
    if (sel) txt('►', VIEW_W / 2 - 98, by, { size: 13, color: '#ffd700' });
  });

  txt('ESC 继续游戏', VIEW_W / 2, VIEW_H - 28, { size: 13, color: '#444' });

  // 已获强化一览：三选一选过什么，暂停时得能查得到。
  // 不做成独立面板，一排图标就够——玩家只是想确认"我这局堆了什么"。
  const p = app.gs && app.gs.player;
  const owned = p ? Object.entries(p.upgrades).filter(([, n]) => n > 0) : [];
  if (owned.length) {
    txt('本局强化', VIEW_W / 2, VIEW_H - 104, { size: 11, color: '#555' });
    const step = 46;
    const left = VIEW_W / 2 - ((owned.length - 1) * step) / 2;
    owned.forEach(([id, n], i) => {
      const card = CARD_BY_ID[id];
      if (!card) return;
      const cx = left + i * step;
      txt(card.icon, cx, VIEW_H - 78, { size: 20, color: '#ddd' });
      txt(`×${n}`, cx + 13, VIEW_H - 64, { size: 9, color: '#777' });
    });
  }
}

export function drawSettings() {
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  txt('设置 / Settings', VIEW_W / 2, 68, { size: 34, color: '#ffd700', bold: true, shadow: true });

  const rows = [
    { label: '音量', value: `${Math.round(SETTINGS.volume * 100)}%` },
    { label: '音效', value: SETTINGS.sfx ? '开启' : '关闭' },
    { label: '语言', value: '简体中文 / Simplified Chinese' },
  ];

  rows.forEach((row, idx) => {
    const ry = 190 + idx * 72;
    const sel = idx === app.settingsMenuIdx;

    rrect(
      VIEW_W / 2 - 240, ry - 28, 480, 56, 10,
      sel ? 'rgba(255,215,0,0.12)' : 'rgba(255,255,255,0.04)',
      sel ? '#ffd700' : '#333',
      sel ? 2 : 1
    );
    txt(row.label, VIEW_W / 2 - 160, ry, { size: 18, color: sel ? '#ffd700' : '#aaa', align: 'left', bold: sel });

    if (idx === 0) {
      const bx = VIEW_W / 2 - 20;
      const barW = 140;
      const barH = 12;
      const by = ry - barH / 2;
      ctx.fillStyle = '#333';
      ctx.fillRect(bx, by, barW, barH);
      ctx.fillStyle = '#ffd700';
      ctx.fillRect(bx, by, barW * SETTINGS.volume, barH);
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, barW, barH);
      if (sel) {
        txt('◄', bx - 18, ry, { size: 14, color: '#ffd700' });
        txt('►', bx + barW + 10, ry, { size: 14, color: '#ffd700', align: 'left' });
      }
      txt(row.value, bx + barW + 26, ry, { size: 14, color: '#ccc', align: 'left' });
    } else if (idx === 1) {
      const col = SETTINGS.sfx ? '#2ecc71' : '#e74c3c';
      rrect(
        VIEW_W / 2 + 40, ry - 16, 90, 32, 8,
        SETTINGS.sfx ? 'rgba(46,204,113,0.25)' : 'rgba(231,76,60,0.25)',
        col,
        1.5
      );
      txt(row.value, VIEW_W / 2 + 85, ry, { size: 15, color: col });
    } else {
      txt(row.value, VIEW_W / 2 + 20, ry, { size: 14, color: '#aaa', align: 'left' });
    }
  });

  const backY = 190 + 3 * 72;
  const backSel = app.settingsMenuIdx === 3;
  rrect(
    VIEW_W / 2 - 110, backY - 22, 220, 44, 10,
    backSel ? 'rgba(255,215,0,0.2)' : 'rgba(255,255,255,0.06)',
    backSel ? '#ffd700' : '#444',
    backSel ? 2 : 1
  );
  txt('返回', VIEW_W / 2, backY, { size: 18, color: backSel ? '#ffd700' : '#ccc', bold: backSel });
  if (backSel) txt('►', VIEW_W / 2 - 95, backY, { size: 13, color: '#ffd700' });

  txt('↑↓ 选择   ← → 调整   ESC 返回', VIEW_W / 2, VIEW_H - 28, { size: 13, color: '#444' });
  if (!persistent) {
    txt('⚠ 当前浏览器禁止本地存储（无痕模式），设置与记录不会被保存', VIEW_W / 2, VIEW_H - 52,
      { size: 12, color: '#8a5a3a' });
  }
}

export function drawGameOver() {
  ctx.fillStyle = 'rgba(0,0,0,0.76)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  txt('游戏结束', VIEW_W / 2, VIEW_H / 2 - 112, { size: 48, color: '#e74c3c', bold: true, shadow: true });

  const gs = app.gs;
  const lvTag = gs && gs.player ? `　Lv.${gs.player.level}` : '';
  txt(`击杀敌人：${gs ? gs.kills : 0}${lvTag}`, VIEW_W / 2, VIEW_H / 2 - 30, { size: 22, color: '#f0e68c' });
  txt(`存活时间：${gs ? elapsedSeconds(gs) : 0} 秒`, VIEW_W / 2, VIEW_H / 2 + 12, { size: 22, color: '#f0e68c' });

  if (gs && gs.newBest) {
    txt('★ 新纪录 ★', VIEW_W / 2, VIEW_H / 2 - 60, { size: 15, color: '#ffd700', bold: true });
  } else if (SAVE.best.kills > 0) {
    txt(
      `最佳：${SAVE.best.kills} 杀 / ${SAVE.best.time} 秒`,
      VIEW_W / 2, VIEW_H / 2 - 60,
      { size: 13, color: '#777' }
    );
  }

  ['重新开始', '回到主菜单'].forEach((label, idx) => {
    const by = VIEW_H / 2 + 70 + idx * 52;
    const sel = idx === app.gameOverMenuIdx;
    rrect(
      VIEW_W / 2 - 105, by - 22, 210, 44, 10,
      sel ? 'rgba(231,76,60,0.8)' : 'rgba(255,255,255,0.08)',
      sel ? '#e74c3c' : '#555',
      2
    );
    txt(label, VIEW_W / 2, by, { size: 18, color: sel ? '#fff' : '#999' });
    if (sel) txt('►', VIEW_W / 2 - 90, by, { size: 14, color: '#e74c3c' });
  });

  txt('↑↓ / WS 选择   空格 / 点击 确认', VIEW_W / 2, VIEW_H - 28, { size: 13, color: '#444' });
}
