/**
 * 升级三选一。
 *
 * 视觉上刻意**不切成独立场景**：战场在背后压暗继续显示，卡面从下方浮起。
 * 这样玩家一眼知道"游戏只是暂停了一下"，而不是"我进了另一个页面"——
 * 肉鸽类游戏的节奏感很大程度取决于这一点。
 *
 * 布局函数 `cardRect()` 同时给绘制和点击命中共用，避免"看到的位置"和
 * "点得到的位置"对不上（这类 bug 在触屏上特别难发现）。
 */
import { ctx, VIEW_W, VIEW_H } from '../gfx/canvas.js';
import { txt, rrect } from '../gfx/draw.js';
import { app } from '../game/app.js';
import { TIER_STYLE } from '../data/cards.js';

export const CARD_W = 208;
export const CARD_H = 268;
const CARD_GAP = 22;
/** 卡面顶部（相对屏幕中线再往上一截，给底部提示留位置） */
const CARD_TOP = VIEW_H / 2 - 46;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * 第 idx 张卡（共 count 张）的矩形。count 会变（卡池快抽干时只有 2 张），
 * 所以按实际张数居中排，而不是写死三张。
 */
export function cardRect(idx, count) {
  const n = Math.max(1, count);
  const total = n * CARD_W + (n - 1) * CARD_GAP;
  const x = (VIEW_W - total) / 2 + idx * (CARD_W + CARD_GAP);
  return {
    x,
    y: CARD_TOP,
    w: CARD_W,
    h: CARD_H,
    cx: x + CARD_W / 2,
    cy: CARD_TOP + CARD_H / 2,
  };
}

/**
 * 说明文字折行。
 * 中文按字数硬折就够用（卡面宽度固定、字号固定），但先按「，」切开，
 * 免得把"生命上限 +1，并回复 1 点"从中间劈成两半。
 */
function wrapDesc(desc) {
  const lines = [];
  for (const seg of desc.split('，')) {
    if (seg.length <= 13) {
      lines.push(seg);
    } else {
      const half = Math.ceil(seg.length / 2);
      lines.push(seg.slice(0, half), seg.slice(half));
    }
  }
  return lines;
}

function drawCard(card, idx, count, owned, t) {
  const r = cardRect(idx, count);
  const style = TIER_STYLE[card.tier] || TIER_STYLE.stat;
  const sel = idx === app.upgradeIdx;

  // 入场：从下方 26px 浮起 + 淡入，三张依次错开 60ms
  const ease = 1 - (1 - t) * (1 - t);
  const oy = (1 - ease) * 26;
  const y = r.y + oy;

  ctx.save();
  ctx.globalAlpha = ease;

  // 选中态外发光
  if (sel) {
    ctx.shadowColor = style.color;
    ctx.shadowBlur = 22;
  }
  rrect(
    r.x, y, CARD_W, CARD_H, 14,
    style.bg,
    sel ? style.color : 'rgba(255,255,255,0.16)',
    sel ? 2.5 : 1
  );
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = ease;

  // 顶部色条：整张卡的"身份色"，隔着半屏也能分出数值/质变
  rrect(r.x + 1, y + 1, CARD_W - 2, 44, 13, style.color + '22', null);

  txt(style.label, r.x + CARD_W - 14, y + 22, {
    size: 11, color: style.color, align: 'right', bold: true,
  });

  // 层数：已经拿过就显示 当前/上限，没拿过不显示，避免卡面堆字
  if (owned > 0) {
    txt(`${owned} / ${card.max}`, r.x + 14, y + 22, {
      size: 11, color: 'rgba(255,255,255,0.45)', align: 'left',
    });
  }

  txt(card.icon, r.cx, y + 88, { size: 44, color: '#fff' });
  txt(card.name, r.cx, y + 142, { size: 21, color: style.color, bold: true });

  // 分隔线
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(r.x + 20, y + 162, CARD_W - 40, 1);

  let ly = y + 188;
  for (const line of wrapDesc(card.desc)) {
    txt(line, r.cx, ly, { size: 13, color: '#d3d8e6' });
    ly += 21;
  }

  if (sel) {
    txt('▲ 空格选择', r.cx, y + CARD_H - 18, { size: 12, color: style.color });
  }
  ctx.restore();
}

export function drawUpgrade() {
  const gs = app.gs;
  const list = app.upgradeChoices || [];

  // 压暗而不是盖死：底下的战场还在，玩家知道自己在哪
  ctx.fillStyle = 'rgba(6,8,18,0.72)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const lv = gs ? gs.player.level : 1;
  txt('升 级', VIEW_W / 2, 74, { size: 40, color: '#ffd700', bold: true, shadow: true });
  txt(`Lv.${lv}    选择一项强化`, VIEW_W / 2, 112, { size: 14, color: '#9aa3b8' });

  const now = performance.now();
  const age = now - (app.upgradeAt || 0);
  list.forEach((card, idx) => {
    const t = clamp((age - idx * 60) / 220, 0, 1);
    const owned = gs ? gs.player.upgrades[card.id] || 0 : 0;
    drawCard(card, idx, list.length, owned, t);
  });

  txt(
    '← → 选择    空格 / 点击 确认    1 2 3 快选',
    VIEW_W / 2, VIEW_H - 34,
    { size: 12, color: '#5b6478' }
  );
}
