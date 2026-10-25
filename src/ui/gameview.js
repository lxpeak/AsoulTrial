import { ctx, VIEW_W, VIEW_H } from '../gfx/canvas.js';
import { imgAt, txt, worldBackground, worldBorder } from '../gfx/draw.js';
import { IMGS } from '../gfx/assets.js';
import { getAvatar } from '../gfx/avatar.js';
import { playerPose } from '../gfx/pose.js';
import { CHARS } from '../data/chars.js';
import { SPRITE_SHEETS, rectOf, frameRect } from '../data/sprites.js';
import { ITEM_ICON, ITEM_CLR } from '../data/items.js';
import { app } from '../game/app.js';
import { elapsedSeconds } from '../game/state.js';
import { xpNeed } from '../game/level.js';
import { lastingGuard, guardKind, THORN_RING, THORN_SIZE } from '../game/guard.js';
import { cam, beginWorld, endWorld } from '../game/camera.js';
import { input, SKILL_BTN, STICK_R } from '../core/input.js';
import { FRAME_DRAW_H, BASE_W, playerCenterY } from '../data/appearance.js';
import {
  ENEMY_SHEETS,
  enemyAnim,
  enemyDrawH,
  enemyFrameIdx,
  enemyType,
} from '../data/enemies.js';
import { BOSS_PHASES, bossPhase, bossPhaseIndex } from '../data/boss.js';
import { tintedSprite } from '../gfx/tint.js';

const SEMOJI = { candy: '🍬', star: '⭐', icecream: '🍦' };
const SCLR = { candy: '#ff69b4', star: '#ffd700', icecream: '#87ceeb' };

/** 视口裁剪：世界比视口大，屏幕外的东西没必要画 */
function onScreen(x, y, pad = 60) {
  return (
    x > cam.x - pad &&
    x < cam.x + VIEW_W + pad &&
    y > cam.y - pad &&
    y < cam.y + VIEW_H + pad
  );
}

/** 上一次的水平朝向，只在左/右键按下时翻转（纯视觉状态，不进游戏状态） */
let faceX = 1;

/**
 * 敌人血条。单独一遍画在所有世界实体之上。
 *
 * 之前跟身体一起画，玩家从下往上靠近时自己的头顶会挡掉敌人血条——
 * 割草游戏里"哪只快死了"是最关键的信息之一，被自己的贴图盖住就很难受。
 */
function drawEnemyBars(bars) {
  for (const { e, type, barY, dw, alpha } of bars) {
    const elite = type.tier === 'elite';
    const ratio = Math.max(0, Math.min(1, e.hp / e.maxHp));
    // 满血的普通怪不画血条：二十只怪围上来时，二十条满格红条会糊成一片，
    // 反而看不出"哪只快死了"。挨过打才出现，信息密度立刻降下来。
    // 精英始终显示——它是场上的焦点，玩家需要随时知道它还剩多少。
    // Boss 也不画：它有自己的屏幕顶部大血条，头顶再来一条纯属重复
    if (type.tier === 'boss') continue;
    if (!elite && ratio >= 0.999) continue;
    // 精英血条更宽更厚：混战里一条金边粗条比细红条快得多
    const bw = elite ? Math.max(52, dw * 0.78) : Math.max(30, dw * 0.62);
    const bh = elite ? 6 : 4;
    const x = e.x - bw / 2;

    ctx.globalAlpha = alpha;
    // 底槽比血量条外扩 1px：草地是黄绿杂色，不留这道边会糊成一片
    ctx.fillStyle = 'rgba(18,14,24,0.85)';
    ctx.fillRect(x - 1, barY - 1, bw + 2, bh + 2);
    ctx.fillStyle = elite ? '#ffb340' : '#e74c3c';
    ctx.fillRect(x, barY, bw * ratio, bh);
    if (elite) {
      ctx.strokeStyle = 'rgba(255,214,102,0.9)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 1.5, barY - 1.5, bw + 3, bh + 3);
    }
    ctx.globalAlpha = 1;
  }
}

/** 接地阴影：跳得越高越小，"贴地感"全靠它 */
function drawShadow(cx, cy, halfW, pose) {
  ctx.save();
  ctx.globalAlpha = 0.28 * pose.shadow;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(cx, cy, halfW * pose.shadow, 6 * pose.shadow, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * 跑步扬尘：不用粒子系统，用颠步相位算出四个循环飘散的小点。
 * 纯视觉、零状态，是"他真的在跑"最直接的信号。
 */
function drawDust(cx, feetY, spread, pose) {
  ctx.save();
  ctx.fillStyle = '#f2ecd6';
  for (let i = 0; i < 4; i++) {
    const t = (pose.phase * 0.62 + i * 0.26) % 1;
    ctx.globalAlpha = (1 - t) * 0.5;
    ctx.beginPath();
    ctx.arc(
      cx - faceX * (spread * 0.42 + t * spread * 0.55) + Math.sin(t * 7) * 2.5,
      feetY + 2 - t * 6,
      2 + t * 4.6,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
  ctx.restore();
}

/**
 * 玩家脚下的淡白光环。
 *
 * 混战时十几只怪贴身围成一圈，只保证玩家"画在最上层"还不够——
 * 大家都有黑描边、都是小圆脸，混在一起就分不出哪个是自己。
 * 这一圈暖白是全场唯一的暖白，金色留给精英，两种环不会混。
 */
function drawPlayerRing(cx, cy, rx) {
  const breath = 0.55 + 0.45 * Math.sin(app.gs.frame * 0.05);
  ctx.save();
  ctx.globalAlpha = 0.3 + 0.18 * breath;
  ctx.strokeStyle = '#fdf6e3';
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(255,252,235,0.95)';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.ellipse(cx, cy - 1, rx, rx * 0.32, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** 暗描边让角色从杂乱的草地上分离出来；技能期间换成金色光晕 */
function applyGlow(pose) {
  if (pose.glow > 0) {
    ctx.shadowColor = 'rgba(255,215,0,0.95)';
    ctx.shadowBlur = 24 * pose.glow;
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 8;
  }
}

/** 技能条：贴着头顶画，宽度跟随视觉尺寸（否则会被放大后的贴图盖住） */
function drawSkillBar(p, cx, topY) {
  // 空槽不画。开局/刚放完技能时这一条是纯黑的，挂在头顶像块 UI 残留，
  // 玩家既读不出信息也容易以为是渲染 bug；攒到第一格再出现更干净
  if (p.skillCharge <= 0 && p.skillActive <= 0) return;
  const bw = Math.max(46, p.w * 1.15);
  const bh = 5;
  const bx = cx - bw / 2;
  const by = topY - 8;
  ctx.fillStyle = '#444';
  ctx.fillRect(bx, by, bw, bh);
  if (p.skillCharge > 0) {
    ctx.fillStyle = '#ffd700';
    ctx.fillRect(bx, by, bw * (p.skillCharge / 100), bh);
  }
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 1;
  ctx.strokeRect(bx, by, bw, bh);
  if (p.skillCharge >= 100) {
    ctx.font = '14px serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('💡', bx + bw + 4, by + bh / 2);
  }
}

/**
 * 画玩家：优先序列帧，没有帧时退回"抠底头像 + 程序化姿态"。
 *
 * 两条路都锚在"脚底"而不是图片中心——旋转、挤压都绕脚底做，看起来才像
 * 站在地上；绕中心做会像吊在半空中被人晃。
 */
function drawPlayerSprite(p) {
  const charKey = app.gs.charKey;
  const key = CHARS[charKey].imgKey;
  const moving = Math.hypot(input.move.x, input.move.y) > 0.05;
  if (Math.abs(input.move.x) > 0.05) faceX = input.move.x > 0 ? 1 : -1;

  // 只有"挨打后的无敌帧"才闪烁。技能护体是技能护体，闪 13 秒会像卡了 bug
  const blink = p.invincible > 0 && guardKind(p) === 'iframe' && Math.floor(p.invincible / 5) % 2 === 0;
  // p.y 就是脚底，直接拿来当锚点
  const feetY = p.y;

  // ── 路线一：有序列帧（AI 生成的 Q 版全身小人）──
  const sheet = SPRITE_SHEETS[charKey];
  const sheetImg = sheet ? IMGS[sheet.key] : null;
  if (sheet && sheetImg && sheetImg.complete && sheetImg.naturalWidth) {
    const pose = playerPose(p, { moving, framed: true });
    // 贝拉开技能会把体型撑大（p.w 40 → 60），视觉尺寸得跟着走，
    // 否则"技能变大"这个设定在有序列帧之后会悄悄失效
    const scale = (FRAME_DRAW_H * (p.w / BASE_W)) / sheet.frameH;
    const dw = sheet.frameW * scale;
    const drawH = sheet.frameH * scale;
    // 帧底留了 footPad 像素空白，扣掉它脚才真的踩在地上
    const up = drawH - sheet.footPad * scale;

    drawShadow(p.x, feetY, dw * 0.3, pose);
    // 脚下常驻的淡白光环：混战时敌人贴身围成一圈，光靠"画在最上层"仍会
    // 和敌人糊在一起——玩家经常找不到自己的头。这一圈白光是全场唯一的暖白，
    // 一眼就能定位。金色留给精英，不会混
    drawPlayerRing(p.x, feetY, dw * 0.44);
    if (moving) drawDust(p.x, feetY, dw, pose);

    // 没有对应动画的角色（比如嘉然没出施法帧）回落到待机，不特判
    const r =
      frameRect(charKey, pose.anim, pose.frameIdx) || frameRect(charKey, 'idle', pose.frameIdx);
    // facing 是**素材的默认朝向**（-1 = 原图朝左）。AI 每次出图朝哪边不保证，
    // 所以"往右走要不要翻转"必须按角色配置，不能全局写死一个符号。
    const dir = faceX * (sheet.facing ?? 1);
    ctx.save();
    ctx.translate(p.x + pose.ox, feetY + pose.oy);
    ctx.rotate(pose.rot);
    ctx.scale(dir * pose.sx * pose.scale, pose.sy * pose.scale);
    // 无敌帧闪烁。0.45 而不是更低的 0.35：怪一多，玩家一挨打就"半隐身"，
    // 在贴身包围里等于彻底找不到自己——这个反馈的代价太高了
    ctx.globalAlpha = blink ? 0.45 : 1;
    applyGlow(pose);
    // 384 宽缩到 84 是大幅缩小，不开高质量插值会出一圈锯齿
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(sheetImg, r.sx, r.sy, r.sw, r.sh, -dw / 2, -up, dw, drawH);
    ctx.restore();

    // 技能条挂在角色头顶，不是帧顶——帧顶还留着一截空白
    const headY = feetY + pose.oy - up + (sheet.headInset || 0) * scale;
    drawSkillBar(p, p.x, headY);
    return;
  }

  // ── 路线二：只有一张头像（另外两个角色，等有素材再补帧）──
  const sprite = getAvatar(key);
  // 贴图还没处理好（首帧 / 抠底失败）就退回原本的方图，保证能玩
  if (!sprite) {
    imgAt(key, p.x, p.y, p.w, p.h, blink ? 0.3 : 1);
    return;
  }

  const pose = playerPose(p, { moving });
  // 素材是半身像，按碰撞盒等尺寸画会小成一团色块；视觉放大到 2 倍多，
  // 判定仍然用 40×40 —— "看起来大、挨打准"是这类游戏的标准做法
  const size = p.w * 2.15;

  drawShadow(p.x, feetY, size * 0.29, pose);
  if (moving) drawDust(p.x, feetY, size, pose);

  ctx.save();
  ctx.translate(p.x + pose.ox, feetY + pose.oy + size * 0.05);
  ctx.rotate(pose.rot);
  ctx.scale(faceX * pose.sx * pose.scale, pose.sy * pose.scale);
  ctx.globalAlpha = blink ? 0.45 : 1;
  applyGlow(pose);
  // 半身像的底部是截断的，往下压一点点，让截断线藏进阴影里
  ctx.drawImage(sprite, -size / 2, -size, size, size);
  ctx.restore();

  drawSkillBar(p, p.x, feetY + pose.oy - size);
}

export function drawGame() {
  const p = app.gs.player;

  // 背景在屏幕空间平铺（偏移取自摄像机），不进入世界坐标系
  worldBackground(cam.x, cam.y);

  beginWorld();

  worldBorder();

  // 道具
  for (const it of app.gs.items) {
    if (!onScreen(it.x, it.y)) continue;
    ctx.save();
    ctx.fillStyle = ITEM_CLR[it.type];
    ctx.shadowColor = ITEM_CLR[it.type];
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(it.x, it.y, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.font = '16px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ITEM_ICON[it.type], it.x, it.y);
    ctx.restore();
  }

  // 粒子
  for (const pt of app.gs.particles) {
    if (!onScreen(pt.x, pt.y, 20)) continue;
    ctx.save();
    ctx.globalAlpha = pt.life / 50;
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 特殊物
  for (const sp of app.gs.specials) {
    if (!onScreen(sp.x, sp.y)) continue;
    ctx.save();
    ctx.font = '26px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = SCLR[sp.type];
    ctx.shadowBlur = 14;
    ctx.fillText(SEMOJI[sp.type], sp.x, sp.y);
    ctx.restore();
  }

  // 敌人
  // 血条不在这里画，只把位置收集起来：玩家从下往上靠近时，自己的头顶会
  // 压住敌人血条，"哪只快死了"就读不出来。等玩家画完再统一铺一遍（见 drawEnemyBars）
  const bars = [];
  // 按脚底 y 排序再画：站在下面的盖住上面的，一群怪才有前后层次。
  // 玩家**不参与**这个排序、始终画在最上层——"看不到自己在哪"比"缺层次感"严重得多
  const enemyDrawList = app.gs.enemies
    .slice()
    .sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  for (const e of enemyDrawList) {
    if (!onScreen(e.x, e.y)) continue;
    // 出生淡入：世界变大后刷怪点偶尔会贴视口边缘，淡入比硬出现自然
    const fade = Math.min(1, (e.age == null ? 99 : e.age) / 12);
    const alpha = (e.frozen > 0 ? 0.55 : 1) * fade;
    const type = enemyType(e);
    const sheet = ENEMY_SHEETS[type.sheet];
    const img = sheet ? IMGS[sheet.key] : null;
    // 脚底锚点 = 碰撞盒底边，和玩家同一套约定
    const feetY = e.y + e.h / 2;

    if (img && img.complete && img.naturalWidth) {
      // 每种类型有自己的体型系数：疾行蛙小一号、铁符蛙大一号、符王接近主角的 1.4 倍
      const drawH = enemyDrawH(e);
      const scale = drawH / sheet.frameH;
      const dw = sheet.frameW * scale;
      // 帧底留了 footPad 的空白，扣掉它脚才真的踩在地上
      const up = drawH - sheet.footPad * scale;
      // 色相染色：四种怪共用同一张帧表，靠颜色在混战里一眼分出类型。
      // 只染一次、之后是普通 drawImage（见 gfx/tint.js）
      const body = tintedSprite(sheet.key, img, type.hue, type.saturate);
      const r = rectOf(sheet, enemyAnim(e), enemyFrameIdx(e));
      // 一直面向玩家：追着谁就朝谁，和"这群怪是冲你来的"直觉一致
      const dir = (app.gs.player.x >= e.x ? 1 : -1) * (sheet.facing ?? 1);

      // 接地阴影。没有它 Q 版小人会像贴纸浮在草地上
      ctx.save();
      ctx.globalAlpha = 0.24 * alpha;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(e.x, feetY, dw * 0.27, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(e.x, feetY);
      ctx.scale(dir, 1);
      // 384 宽缩到 72 是大幅缩小，不开高质量插值会出一圈锯齿
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(body, r.sx, r.sy, r.sw, r.sh, -dw / 2, -up, dw, drawH);
      ctx.restore();

      // 精英地环：画在身体**之后**，让环压在脚踝上——"站在法阵里"，
      // 而不是"贴纸浮在一圈光上"。只描边不填充，所以不会糊住脚。
      // 环上绕转的三个亮点是必要的：静态圆环在草地里会被读成地面装饰，
      // 只有动起来才是"这东西在追你"的信号
      if (type.tier === 'elite') {
        const spin = app.gs.frame * 0.035;
        const rx = dw * 0.5;
        const ry = dw * 0.16;
        ctx.save();
        ctx.globalAlpha = 0.85 * fade;
        ctx.strokeStyle = '#ffc24d';
        ctx.lineWidth = 3.5;
        ctx.shadowColor = '#ff9a1f';
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.ellipse(e.x, feetY - 2, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#fff2cc';
        ctx.shadowBlur = 10;
        for (let i = 0; i < 3; i++) {
          const a = spin + (i * Math.PI * 2) / 3;
          ctx.beginPath();
          ctx.arc(e.x + Math.cos(a) * rx, feetY - 2 + Math.sin(a) * ry, 3.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      const headY = feetY - up + (sheet.headInset || 0) * scale;

      // 冻结：浅蓝罩住整个身体（原来是只盖住头的椭圆）。
      // 0.42 是试出来的——0.3 在草地上几乎读不出"被冻住了"，只像掉帧变淡
      if (e.frozen > 0) {
        ctx.save();
        ctx.globalAlpha = 0.42 * fade;
        ctx.fillStyle = '#7fd8ff';
        ctx.beginPath();
        ctx.ellipse(e.x, (headY + feetY) / 2, dw * 0.36, (feetY - headY) / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 受击闪白：把同一帧再画一遍，用 lighter 混合把颜色提亮。
      // 一开始是用椭圆遮罩叠白，实测两个问题：一是形状生硬（一块椭圆光斑浮在身上），
      // 二是 0.25 的 alpha 在草地上几乎读不出来。重绘能完全贴合轮廓，且只贵 4 帧
      if (e.flash > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (e.flash / 4) * 0.8;
        ctx.translate(e.x, feetY);
        ctx.scale(dir, 1);
        ctx.drawImage(body, r.sx, r.sy, r.sw, r.sh, -dw / 2, -up, dw, drawH);
        ctx.restore();
      }

      // 血条留到玩家之后统一铺（drawEnemyBars），否则会被玩家身体压住
      bars.push({ e, type, barY: headY - 7, dw, alpha });
      continue;
    }

    // 降级：帧表还没解码完（首帧）时用旧贴图顶上，保证一开局就能玩
    imgAt('enemy', e.x, e.y, e.w, e.h, alpha);
    if (e.frozen > 0) {
      ctx.save();
      ctx.globalAlpha = 0.4 * fade;
      ctx.fillStyle = '#87ceeb';
      ctx.beginPath();
      ctx.ellipse(e.x, e.y, e.w / 2, e.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = fade;
    ctx.fillStyle = '#333';
    ctx.fillRect(e.x - e.w / 2, e.y - e.h / 2 - 8, e.w, 4);
    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(e.x - e.w / 2, e.y - e.h / 2 - 8, e.w * (e.hp / e.maxHp), 4);
    ctx.globalAlpha = 1;
    bars.push({ e, type, barY: e.y - e.h / 2 - 8, dw: e.w, alpha: fade });
  }

  // 护盾
  if (p.shield > 0) {
    ctx.save();
    ctx.globalAlpha = 0.38 + 0.12 * Math.sin(app.gs.frame * 0.18);
    ctx.strokeStyle = '#3498db';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#3498db';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(p.x, playerCenterY(p), p.w / 2 + 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 荆棘三角（绕身体中心转，不是绕脚底）
  // 耐久用"实心/空心"区分：挡掉一次就少一个实心三角，玩家不用看 HUD 也知道还能撑几次
  //
  // 分两批画：上半圈（sin < 0）在角色**身后**，下半圈在角色**身前**。
  // 以前四个都画在角色之前，上方那个正好卡在头顶被身体挡掉一半——
  // 耐久少一层时玩家会以为"少的是被挡住的这个"。按 y 分前后就没有这种歧义。
  const thornBlades = [];
  if (p.thorns > 0) {
    // 半径与边长都取 guard.js 的常量：判定端用的也是同一份，
    // 改"范围"的时候不会出现"看着碰到了却不掉血"
    const radius = p.w * THORN_RING;
    const ts = p.w * THORN_SIZE;
    const baseAngle = app.gs.frame * 0.04;
    const bodyY = playerCenterY(p);
    const live = p.thornCharges == null ? 4 : p.thornCharges;
    for (let i = 0; i < 4; i++) {
      const angle = baseAngle + (i * Math.PI) / 2;
      thornBlades.push({
        cx: p.x + Math.cos(angle) * radius,
        cy: bodyY + Math.sin(angle) * radius,
        angle,
        ts,
        alive: i < live,
        behind: Math.sin(angle) < 0,
      });
    }
  }

  const drawThornBlade = (b) => {
    ctx.save();
    ctx.globalAlpha = b.alive ? 1 : 0.28;
    ctx.translate(b.cx, b.cy);
    ctx.rotate(b.angle + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, -b.ts / 2);
    ctx.lineTo(b.ts / 2, b.ts / 2);
    ctx.lineTo(-b.ts / 2, b.ts / 2);
    ctx.closePath();
    if (b.alive) {
      ctx.fillStyle = '#f1c40f';
      ctx.fill();
    }
    ctx.strokeStyle = b.alive ? '#e67e22' : '#f1c40f';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  };

  for (const b of thornBlades) if (b.behind) drawThornBlade(b);

  // 玩家：抠底立绘 + 程序化姿态（技能条也在这里面，跟着头顶走）
  drawPlayerSprite(p);

  for (const b of thornBlades) if (!b.behind) drawThornBlade(b);

  // 玩家：抠底立绘 + 程序化姿态（技能条也在这里面，跟着头顶走）
  drawPlayerSprite(p);

  // 子弹
  for (const b of app.gs.bullets) {
    if (!onScreen(b.x, b.y, 30)) continue;
    ctx.save();
    // 有射程的弹（技能追踪弹）在最后 30% 路程里淡出：
    // 硬消失会被误读成"打空了"，淡出读起来是"飞到头了"
    if (b.range) {
      const left = 1 - (b.traveled || 0) / b.range;
      ctx.globalAlpha = Math.max(0.15, Math.min(1, left / 0.3));
      ctx.shadowBlur = 8 * ctx.globalAlpha;
    }
    ctx.fillStyle = b.tracking ? '#ff69b4' : b.pierce ? '#87ceeb' : '#ffd700';
    ctx.shadowColor = b.tracking ? '#ff1493' : b.pierce ? '#00bfff' : '#ff0';
    if (!b.range) ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.pierce ? 7 : 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Boss 弹幕：画在玩家之后，保证它永远压在角色身上而不是被挡住——
  // 躲弹幕靠的就是"看清它现在在哪"，被自己的贴图遮住就没法玩了
  for (const b of app.gs.eBullets) {
    if (!onScreen(b.x, b.y, 30)) continue;
    ctx.save();
    ctx.shadowColor = '#a855f7';
    ctx.shadowBlur = 12;
    // 内亮外暗两层，比单色圆更容易在一片绿草里认出来
    ctx.fillStyle = '#7b2fb5';
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e7c6ff';
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 敌人血条：等所有世界实体画完再统一铺一遍。
  // 放在子弹之后，是因为"谁快死了"比弹道位置更重要——信息层要压住表现层
  drawEnemyBars(bars);

  // ── 飘字：世界层最上面 ──
  // 必须是最后一层，否则会被敌人血条压住一半；也不能用 shadow 做描边——
  // 14px 中文叠 6px 黑色阴影，在草地上只剩一团发暗的糊字。用深色 stroke 才清楚。
  for (const f of app.gs.floats) {
    if (!onScreen(f.x, f.y, 20)) continue;
    ctx.save();
    // 前 2/3 寿命全亮，最后 1/3 才淡出：一直半透明的话根本注意不到
    ctx.globalAlpha = Math.min(1, f.life / (f.max * 0.35));
    ctx.font = 'bold 16px 微软雅黑,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(20,14,0,0.85)';
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
    ctx.restore();
  }

  endWorld();

  // ── 以下是屏幕空间：HUD 和 banner 不跟着摄像机走 ──
  drawHUD();
  drawBossBar();
  drawAnnounce();
  drawTouchHUD();

  if (p.bannerTimer > 0) drawBanner(p);
}

function drawBanner(p) {
  const elapsed = 180 - p.bannerTimer;
  const bw = 520;
  let bannerX;
  if (elapsed < 30) {
    const t = elapsed / 30;
    const eased = 1 - (1 - t) * (1 - t);
    bannerX = -(bw / 2) + eased * (VIEW_W / 2 + bw / 2);
  } else if (elapsed < 120) {
    bannerX = VIEW_W / 2;
  } else {
    const t = (elapsed - 120) / 60;
    const eased = t * t;
    bannerX = VIEW_W / 2 + eased * (VIEW_W / 2 + bw / 2);
  }

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const key = CHARS[app.gs.charKey].bannerKey;
  const img = IMGS[key];
  if (img && img.complete && img.naturalWidth) {
    const bh = img.naturalHeight * (bw / img.naturalWidth) || 200;
    imgAt(key, bannerX, VIEW_H / 2, bw, Math.min(bh, 260), 0.9);
  } else {
    txt(`${CHARS[app.gs.charKey].name} 技能！`, bannerX, VIEW_H / 2, {
      size: 60, color: '#ffd700', bold: true, shadow: true,
    });
  }
  ctx.restore();
}

/**
 * Boss 血条：屏幕顶部一条，不跟摄像机。
 *
 * 为什么不挂在 Boss 头上：它保持 200px 距离、体型又大 2.5 倍，
 * 头顶那条血条经常顶出画面或被自己的身体挡住。而 Boss 的血量是
 * "这场还要打多久"的唯一刻度，必须常驻可见。
 */
function drawBossBar() {
  const boss = app.gs.enemies.find((e) => e.tier === 'boss');
  if (!boss) return;

  const w = VIEW_W * 0.58;
  const h = 12;
  const x = (VIEW_W - w) / 2;
  const y = 48;
  const ratio = Math.max(0, Math.min(1, boss.hp / boss.maxHp));
  const phase = bossPhase(boss);

  ctx.fillStyle = 'rgba(10,6,16,0.9)';
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);

  // 血条配色跟着阶段走：紫 → 品红 → 血红。
  // 远看颜色就知道它现在第几阶段，不用去数弹幕
  const GRAD = [
    ['#c86bff', '#6d27c9'],
    ['#ff8ad1', '#a11f7a'],
    ['#ff6b6b', '#b31b1b'],
  ][bossPhaseIndex(boss)];
  const grad = ctx.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, GRAD[0]);
  grad.addColorStop(1, GRAD[1]);
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w * ratio, h);

  // 阶段刻度（66% / 33%）比普通刻度更亮：这是"马上要变招"的预警线，
  // 玩家能提前知道"再打几下它就要换招了"
  ctx.strokeStyle = 'rgba(255,214,102,0.65)';
  ctx.lineWidth = 2;
  for (const at of BOSS_PHASES.slice(1)) {
    ctx.beginPath();
    ctx.moveTo(x + w * at.at, y);
    ctx.lineTo(x + w * at.at, y + h);
    ctx.stroke();
  }
  // 每 25% 一道暗刻度：补足"还剩几成"的读数
  ctx.strokeStyle = 'rgba(20,10,30,0.45)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    if (BOSS_PHASES.some((ph) => Math.abs(ph.at - i / 4) < 0.01)) continue;
    ctx.beginPath();
    ctx.moveTo(x + (w * i) / 4, y);
    ctx.lineTo(x + (w * i) / 4, y + h);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(206,164,255,0.95)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x - 1.5, y - 1.5, w + 3, h + 3);

  // 名字挂在血条**下方**而不是上方：血条紧贴 HUD，上面只有 40px 的余量，
  // 而 Boss 本体 195 高、常在中近距离，名字放上面会和它的头叠在一起看不清。
  // 文字下面垫一块暗底 —— 它会压在草地、也会压在 Boss 的白色大眼球上，
  // 光靠描边在那张白脸上是读不出来的
  const label = phase.name;
  const labelY = y + h + 11;
  ctx.save();
  ctx.font = 'bold 12px 微软雅黑,sans-serif';
  const labelW = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(12,8,20,0.74)';
  ctx.fillRect(VIEW_W / 2 - labelW / 2 - 7, labelY - 9, labelW + 14, 18);
  ctx.restore();
  txt(label, VIEW_W / 2, labelY, { size: 12, color: '#e3c6ff', bold: true });
}

/**
 * 屏幕中央的大字提示（目前只有 Boss 降临用）。
 *
 * 分段做透明度：前 15% 淡入、中间全亮、最后 25% 淡出。
 * 直接线性淡出会让"降临"两个字一闪就没了，玩家还没反应过来。
 */
function drawAnnounce() {
  const gs = app.gs;
  if (!gs || !(gs.announceTimer > 0)) return;
  // 时长由发起方决定（降临 160 帧、Boss 变招 110 帧），淡入淡出按比例算
  const TOTAL = gs.announceTotal || 160;
  const t = 1 - gs.announceTimer / TOTAL;
  const alpha = Math.min(1, t / 0.15) * Math.min(1, (1 - t) / 0.25);
  const y = 132;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 字描边用深紫而不是纯黑：和 Boss 的紫调呼应，也压得住绿色草地
  ctx.font = 'bold 30px 微软雅黑,sans-serif';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(30,10,44,0.9)';
  ctx.strokeText(gs.announceText, VIEW_W / 2, y);
  ctx.fillStyle = '#ecd9ff';
  ctx.fillText(gs.announceText, VIEW_W / 2, y);

  // 两侧光带：把视线从杂乱的战场"吸"到画面中央
  const half = ctx.measureText(gs.announceText).width / 2;
  const grad = ctx.createLinearGradient(0, 0, VIEW_W, 0);
  grad.addColorStop(0, 'rgba(200,140,255,0)');
  grad.addColorStop(0.5, 'rgba(200,140,255,0.85)');
  grad.addColorStop(1, 'rgba(200,140,255,0)');
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2;
  for (const dy of [-22, 22]) {
    ctx.beginPath();
    ctx.moveTo(VIEW_W / 2 - half - 120, y + dy);
    ctx.lineTo(VIEW_W / 2 + half + 120, y + dy);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHUD() {
  const gs = app.gs;
  const p = gs.player;

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, VIEW_W, 44);

  txt(CHARS[gs.charKey].name, 10, 16, { size: 13, color: '#ffd700', align: 'left', bold: true });

  // 心数跟着最大生命走：坚韧卡能把它堆到 9 颗，所以后面的 buff 图标起点是算出来的
  const HEART_X = 54;
  const HEART_STEP = 20;
  for (let i = 0; i < p.maxHp; i++) {
    txt(i < p.hp ? '♥' : '♡', HEART_X + i * HEART_STEP, 16, {
      size: 15, color: i < p.hp ? '#e74c3c' : '#555', align: 'left',
    });
  }

  let sx = HEART_X + p.maxHp * HEART_STEP + 8;
  // 护体只显示"当前生效的那一个"：同一时刻只有一个（见 game/guard.js），
  // 之前护盾/荆棘/技能三个图标能同时挂出来，玩家会以为自己有三层金身。
  // 用 lastingGuard 而不是 guardKind：荆棘格挡后的 20 帧无敌会把图标闪掉
  const guard = lastingGuard(p);
  if (guard === 'skill' || p.skillActive > 0) {
    // 技能护体 13 秒和技能生效 10 秒是同时结束的，取大的那个就不会跳数
    const left = Math.max(p.skillGuard || 0, p.skillActive || 0);
    txt(`✨${Math.ceil(left / 60)}s`, sx, 16, { size: 12, color: '#ffd700', align: 'left' });
  } else if (guard === 'shield') {
    txt(`🛡${Math.ceil(p.shield / 60)}s`, sx, 16, { size: 12, color: '#3498db', align: 'left' });
  } else if (guard === 'thorns') {
    // 荆棘显示的是**还剩几次**，不是还剩几秒——它已经不是"无敌 5 秒"了
    txt(`🌵×${p.thornCharges}`, sx, 16, { size: 12, color: '#f1c40f', align: 'left' });
  }

  // ── 等级与经验 ──
  // 经验条放在血条下一行、靠左，用蓝色和红色的血量区分开；
  // 数字紧跟在条尾，玩家能算出"再杀两只就升级"——这直接决定他要不要冒险贴脸
  txt(`Lv.${p.level}`, 10, 33, { size: 11, color: '#ffd700', align: 'left', bold: true });
  const need = xpNeed(p.level);
  const bx = 46;
  const bw = 150;
  const by = 30;
  ctx.fillStyle = '#22242e';
  ctx.fillRect(bx, by, bw, 6);
  ctx.fillStyle = '#5eb0f0';
  ctx.fillRect(bx, by, bw * Math.min(1, p.xp / need), 6);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1;
  ctx.strokeRect(bx, by, bw, 6);
  txt(`${p.xp}/${need}`, bx + bw + 6, 33, { size: 10, color: '#8a93a6', align: 'left' });

  txt(`击杀 ${gs.kills}`, VIEW_W - 10, 14, { size: 12, color: '#fff', align: 'right' });
  txt(`${elapsedSeconds(gs)}s`, VIEW_W - 10, 31, { size: 11, color: '#9a9a9a', align: 'right' });
}

const isTouchDevice = (() => {
  try {
    return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  } catch (e) {
    return false;
  }
})();

function drawTouchHUD() {
  if (!isTouchDevice) return;

  for (const side of ['left', 'right']) {
    const st = input.sticks[side];
    if (!st) continue;
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = side === 'left' ? '#ffffff' : '#ffd700';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(st.baseX, st.baseY, STICK_R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = side === 'left' ? '#ffffff' : '#ffd700';
    ctx.beginPath();
    ctx.arc(st.x, st.y, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const p = app.gs.player;
  const ready = p.skillCharge >= 100 && p.skillActive <= 0 && p.bannerTimer <= 0;
  ctx.save();
  ctx.globalAlpha = ready ? 0.85 : 0.3;
  ctx.fillStyle = input.skillGlow > 0 ? 'rgba(255,215,0,0.45)' : 'rgba(0,0,0,0.35)';
  ctx.strokeStyle = ready ? '#ffd700' : '#666';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(SKILL_BTN.x, SKILL_BTN.y, SKILL_BTN.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  txt('技', SKILL_BTN.x, SKILL_BTN.y, { size: 18, color: ready ? '#ffd700' : '#888', bold: true });
  ctx.restore();
}
