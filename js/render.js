'use strict';

// ==================== DRAW HELPERS ====================
function imgAt(key, x, y, w, h, alpha=1) {
  const img = IMGS[key];
  if (!img.complete || !img.naturalWidth) return;
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.drawImage(img, x-w/2, y-h/2, w, h);
  ctx.restore();
}
function txt(str, x, y, { size=16, color='#fff', align='center', bold=false, shadow=false }={}) {
  ctx.save();
  ctx.font = `${bold?'bold ':''}${size}px 微软雅黑,sans-serif`;
  ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillStyle = color;
  if (shadow) { ctx.shadowColor='rgba(0,0,0,0.9)'; ctx.shadowBlur=6; }
  ctx.fillText(str, x, y); ctx.restore();
}
function rrect(x, y, w, h, r, fill, stroke, lw=1) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
  if (fill)   { ctx.fillStyle   = fill;   ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
function bg() {
  const bgi = IMGS['background'];
  if (bgi && bgi.complete && bgi.naturalWidth) {
    ctx.drawImage(bgi, 0, 0, W, H);
  } else {
    ctx.fillStyle = '#2d5a27'; ctx.fillRect(0,0,W,H);
    ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 1;
    for (let x=0; x<W; x+=40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y=0; y<H; y+=40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
  }
}

// ==================== DRAW GAME ====================
function drawGame() {
  bg();
  const p = gs.player;

  // Items
  ctx.font = '20px serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  for (const it of gs.items) {
    ctx.save();
    ctx.fillStyle = ITEM_CLR[it.type];
    ctx.shadowColor = ITEM_CLR[it.type]; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(it.x, it.y, 16, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = '#fff'; ctx.font = '16px serif';
    ctx.fillText(ITEM_ICON[it.type], it.x, it.y);
    ctx.restore();
  }

  // Particles
  for (const pt of gs.particles) {
    ctx.save(); ctx.globalAlpha = pt.life/50; ctx.fillStyle = pt.color;
    ctx.beginPath(); ctx.arc(pt.x, pt.y, 3, 0, Math.PI*2); ctx.fill(); ctx.restore();
  }

  // Specials
  ctx.font = '26px serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  const SEMOJIS = { candy:'🍬', star:'⭐', icecream:'🍦' };
  const SCLRS   = { candy:'#ff69b4', star:'#ffd700', icecream:'#87ceeb' };
  for (const sp of gs.specials) {
    ctx.save();
    ctx.shadowColor = SCLRS[sp.type]; ctx.shadowBlur = 14;
    ctx.fillText(SEMOJIS[sp.type], sp.x, sp.y);
    ctx.restore();
  }

  // Enemies
  for (const e of gs.enemies) {
    imgAt('enemy', e.x, e.y, e.w, e.h, e.frozen > 0 ? 0.55 : 1);
    if (e.frozen > 0) {
      ctx.save(); ctx.globalAlpha=0.4; ctx.fillStyle='#87ceeb';
      ctx.beginPath(); ctx.ellipse(e.x, e.y, e.w/2, e.h/2, 0, 0, Math.PI*2); ctx.fill(); ctx.restore();
    }
    ctx.fillStyle='#333'; ctx.fillRect(e.x-e.w/2, e.y-e.h/2-8, e.w, 4);
    ctx.fillStyle='#e74c3c'; ctx.fillRect(e.x-e.w/2, e.y-e.h/2-8, e.w*(e.hp/e.maxHp), 4);
  }

  // Shield ring
  if (p.shield > 0) {
    ctx.save();
    ctx.globalAlpha = 0.38 + 0.12*Math.sin(gs.frame*0.18);
    ctx.strokeStyle='#3498db'; ctx.lineWidth=3;
    ctx.shadowColor='#3498db'; ctx.shadowBlur=12;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.w/2+12, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
  }

  // Thorns triangles (4 orbiting around player)
  if (p.thorns > 0) {
    const radius = p.w;          // orbit radius = character image side length
    const ts = p.w / 2;          // triangle half-size
    const baseAngle = gs.frame * 0.04;
    ctx.fillStyle='#f1c40f'; ctx.strokeStyle='#e67e22'; ctx.lineWidth=1;
    for (let i = 0; i < 4; i++) {
      const angle = baseAngle + i * Math.PI / 2;
      const cx = p.x + Math.cos(angle) * radius;
      const cy = p.y + Math.sin(angle) * radius;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle + Math.PI / 2); // tip points outward
      ctx.beginPath();
      ctx.moveTo(0, -ts/2); ctx.lineTo(ts/2, ts/2); ctx.lineTo(-ts/2, ts/2);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }

  // Player sprite (flash when hit)
  const flash = p.invincible > 0 && p.shield <= 0 && Math.floor(p.invincible/5)%2===0;
  imgAt(CHARS[gs.charKey].imgKey, p.x, p.y, p.w, p.h, flash ? 0.3 : 1);

  // Skill bar above player
  const bw = p.w, bh = 5;
  const bx = p.x - bw/2, by = p.y - p.h/2 - 11;
  ctx.fillStyle='#444'; ctx.fillRect(bx, by, bw, bh);
  if (p.skillCharge > 0) {
    ctx.fillStyle='#ffd700';
    ctx.fillRect(bx, by, bw*(p.skillCharge/100), bh);
  }
  ctx.strokeStyle='#222'; ctx.lineWidth=1; ctx.strokeRect(bx, by, bw, bh);
  if (p.skillCharge >= 100) {
    ctx.font='14px serif'; ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.fillText('💡', p.x + p.w/2 - 12, p.y - p.h/2 - 9);
  }

  // Bullets
  for (const b of gs.bullets) {
    ctx.save();
    ctx.fillStyle  = b.tracking ? '#ff69b4' : b.pierce ? '#87ceeb' : '#ffd700';
    ctx.shadowColor= b.tracking ? '#ff1493' : b.pierce ? '#00bfff' : '#ff0';
    ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.pierce?7:5, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  // HUD
  drawHUD();

  // Skill banner overlay
  if (p.bannerTimer > 0) {
    // bannerTimer counts down from 180 (3s):
    //   elapsed 0–30f  (0.0–0.5s) → slide in from left
    //   elapsed 30–120f (0.5–2.0s) → hold center
    //   elapsed 120–180f(2.0–3.0s) → slide out to right
    const elapsed = 180 - p.bannerTimer;
    const bw2 = 520;
    let bannerX;
    if (elapsed < 30) {
      const t = elapsed / 30;
      const eased = 1 - (1 - t) * (1 - t); // ease-out
      bannerX = -(bw2 / 2) + eased * (W / 2 + bw2 / 2);
    } else if (elapsed < 120) {
      bannerX = W / 2;
    } else {
      const t = (elapsed - 120) / 60;
      const eased = t * t; // ease-in
      bannerX = W / 2 + eased * (W / 2 + bw2 / 2);
    }

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H);
    const bannerKey = CHARS[gs.charKey].bannerKey;
    const bi = IMGS[bannerKey];
    if (bi.complete && bi.naturalWidth) {
      const bh2 = bi.naturalHeight * (bw2 / bi.naturalWidth) || 200;
      imgAt(bannerKey, bannerX, H / 2, bw2, Math.min(bh2, 260), 0.9);
    } else {
      txt(CHARS[gs.charKey].name + ' 技能！', bannerX, H / 2,
          { size: 60, color: '#ffd700', bold: true, shadow: true });
    }
    ctx.restore();
  }
}

function drawHUD() {
  const p = gs.player;
  const t = gs.endTime ? gs.endTime : Date.now();
  const elapsed = Math.floor((t - gs.startTime)/1000);

  // Top bar
  ctx.fillStyle='rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, W, 38);

  // Char name
  txt(CHARS[gs.charKey].name, 10, 19, { size:14, color:'#ffd700', align:'left', bold:true });

  // HP hearts
  for (let i=0; i<p.maxHp; i++) {
    txt(i < p.hp ? '♥' : '♡', 60+i*22, 19,
        { size:17, color: i < p.hp ? '#e74c3c':'#555', align:'left' });
  }

  // Status badges
  let sx = 150;
  if (p.shield  > 0) { txt(`🛡${Math.ceil(p.shield/60)}s`,  sx, 19, { size:12, color:'#3498db', align:'left' }); sx+=55; }
  if (p.thorns  > 0) { txt(`🌵${Math.ceil(p.thorns/60)}s`,  sx, 19, { size:12, color:'#f1c40f', align:'left' }); sx+=55; }
  if (p.skillActive > 0) { txt(`✨${Math.ceil(p.skillActive/60)}s`, sx, 19, { size:12, color:'#ffd700', align:'left' }); }

  // Right side
  txt(`击杀: ${gs.kills}`, W-10, 13, { size:13, color:'#fff', align:'right' });
  txt(`${elapsed}s`,       W-10, 28, { size:12, color:'#aaa', align:'right' });
}

// ==================== DRAW TITLE ====================
function drawTitle() {
  ctx.fillStyle='#1a1a2e'; ctx.fillRect(0,0,W,H);
  ctx.fillStyle='rgba(255,255,255,0.5)';
  for (let i=0; i<100; i++) {
    ctx.beginPath();
    ctx.arc((i*137.5)%W, (i*73.1+Date.now()*0.01)%H, 1.2, 0, Math.PI*2);
    ctx.fill();
  }
  txt('一个魂的试炼', W/2, H/2-90, { size:52, color:'#ffd700', bold:true, shadow:true });
  txt('The Trial of A-Soul ', W/2, H/2-34, { size:18, color:'#888' });

  const menuItems = ['开始游戏', '设置'];
  menuItems.forEach((label, idx) => {
    const by = H/2 + 30 + idx * 56;
    const sel = idx === titleMenuIdx;
    rrect(W/2-110, by-22, 220, 44, 10,
          sel ? 'rgba(255,215,0,0.25)' : 'rgba(255,255,255,0.06)',
          sel ? '#ffd700' : '#444', sel?2:1);
    txt(label, W/2, by, { size:20, color: sel?'#ffd700':'#ccc', bold:sel });
    if (sel) { txt('►', W/2-95, by, { size:14, color:'#ffd700' }); }
  });

  txt('WASD 移动   方向键 射击   空格 技能', W/2, H-28, { size:13, color:'#555' });
}

// ==================== DRAW CHAR SELECT ====================
function drawCharSelect() {
  ctx.fillStyle='#1a1a2e'; ctx.fillRect(0,0,W,H);
  txt('选择角色', W/2, 56, { size:34, color:'#ffd700', bold:true, shadow:true });
  txt('← → 选择   空格确认   点击角色卡', W/2, 92, { size:14, color:'#777' });

  const CW=176, CH=256, gap=20;
  const totalW = CHAR_KEYS.length*(CW+gap)-gap;
  const startX = (W-totalW)/2;

  CHAR_KEYS.forEach((key, idx) => {
    const ch = CHARS[key];
    const cx = startX + idx*(CW+gap) + CW/2;
    const cy = H/2 + 30;
    const sel = idx === charSelectIdx;

    // Glow
    if (sel) {
      ctx.save(); ctx.shadowColor='#ffd700'; ctx.shadowBlur=20;
      rrect(cx-CW/2-2, cy-CH/2-2, CW+4, CH+4, 14, null, '#ffd700', 2);
      ctx.restore();
    }

    rrect(cx-CW/2, cy-CH/2, CW, CH, 12,
          sel ? 'rgba(255,215,0,0.18)' : 'rgba(255,255,255,0.05)',
          sel ? '#ffd700' : '#444', sel?2:1);

    // Character image
    const imgH = CH - 80;
    const img = IMGS[ch.imgKey];
    if (img.complete && img.naturalWidth) {
      ctx.save();
      ctx.beginPath(); ctx.roundRect(cx-CW/2+8, cy-CH/2+8, CW-16, imgH, 8); ctx.clip();
      ctx.drawImage(img, cx-CW/2+8, cy-CH/2+8, CW-16, imgH);
      ctx.restore();
    } else {
      rrect(cx-CW/2+8, cy-CH/2+8, CW-16, imgH, 8, '#2a2a4a', null);
      txt('?', cx, cy-CH/2+8+imgH/2, { size:40, color:'#555' });
    }

    // Name + desc
    txt(ch.name, cx, cy+CH/2-54, { size:20, color:sel?'#ffd700':'#eee', bold:true });
    txt(ch.desc, cx, cy+CH/2-28, { size:11, color:'#999' });

    if (sel) txt('▼ 选择', cx, cy+CH/2+14, { size:13, color:'#ffd700' });
  });
}

// ==================== DRAW GAME OVER ====================
function drawGameOver() {
  ctx.fillStyle='rgba(0,0,0,0.76)'; ctx.fillRect(0,0,W,H);
  txt('游戏结束', W/2, H/2-100, { size:48, color:'#e74c3c', bold:true, shadow:true });

  const elapsed = gs ? Math.floor(((gs.endTime||Date.now()) - gs.startTime)/1000) : 0;
  txt(`击杀敌人：${gs?.kills ?? 0}`, W/2, H/2-30, { size:22, color:'#f0e68c' });
  txt(`存活时间：${elapsed} 秒`,      W/2, H/2+12, { size:22, color:'#f0e68c' });

  ['重新开始','回到主菜单'].forEach((label, idx) => {
    const by = H/2 + 70 + idx*52;
    const sel = idx === gameOverMenuIdx;
    rrect(W/2-105, by-22, 210, 44, 10,
          sel ? 'rgba(231,76,60,0.8)' : 'rgba(255,255,255,0.08)',
          sel ? '#e74c3c' : '#555', 2);
    txt(label, W/2, by, { size:18, color:sel?'#fff':'#999' });
    if (sel) { txt('►', W/2-90, by, { size:14, color:'#e74c3c' }); }
  });

  txt('↑↓ / WS 选择   空格 / 点击 确认', W/2, H-28, { size:13, color:'#444' });
}

// ==================== DRAW PAUSE ====================
function drawPause() {
  ctx.fillStyle='rgba(0,0,0,0.65)'; ctx.fillRect(0,0,W,H);
  txt('游戏暂停', W/2, H/2-100, { size:42, color:'#ffd700', bold:true, shadow:true });

  const menuItems = ['继续游戏', '返回主菜单', '设置'];
  menuItems.forEach((label, idx) => {
    const by = H/2 - 20 + idx * 54;
    const sel = idx === pauseMenuIdx;
    rrect(W/2-115, by-22, 230, 44, 10,
          sel ? 'rgba(255,215,0,0.25)' : 'rgba(255,255,255,0.07)',
          sel ? '#ffd700' : '#555', sel?2:1);
    txt(label, W/2, by, { size:19, color: sel?'#ffd700':'#bbb', bold:sel });
    if (sel) { txt('►', W/2-98, by, { size:13, color:'#ffd700' }); }
  });

  txt('ESC 继续游戏', W/2, H-28, { size:13, color:'#444' });
}

// ==================== DRAW SETTINGS ====================
function drawSettings() {
  ctx.fillStyle='#1a1a2e'; ctx.fillRect(0,0,W,H);
  txt('设置 / Settings', W/2, 68, { size:34, color:'#ffd700', bold:true, shadow:true });

  const volPct = Math.round(SETTINGS.volume * 100);
  const rows = [
    { label:'音量', value: `${volPct}%` },
    { label:'音效', value: SETTINGS.sfx ? '开启' : '关闭' },
    { label:'语言', value: '简体中文 / Simplified Chinese' },
  ];

  rows.forEach((row, idx) => {
    const ry = 190 + idx * 72;
    const sel = idx === settingsMenuIdx;

    rrect(W/2-240, ry-28, 480, 56, 10,
          sel ? 'rgba(255,215,0,0.12)' : 'rgba(255,255,255,0.04)',
          sel ? '#ffd700' : '#333', sel?2:1);

    txt(row.label, W/2-160, ry, { size:18, color: sel?'#ffd700':'#aaa', align:'left', bold:sel });

    if (idx === 0) {
      // Volume bar
      const bx = W/2-20, barW = 140, barH = 12, by = ry - barH/2;
      ctx.fillStyle='#333'; ctx.fillRect(bx, by, barW, barH);
      ctx.fillStyle='#ffd700'; ctx.fillRect(bx, by, barW*(SETTINGS.volume), barH);
      ctx.strokeStyle='#555'; ctx.lineWidth=1; ctx.strokeRect(bx, by, barW, barH);
      if (sel) {
        txt('◄', bx-18, ry, { size:14, color:'#ffd700', align:'center' });
        txt('►', bx+barW+10, ry, { size:14, color:'#ffd700', align:'left' });
      }
      txt(row.value, bx+barW+26, ry, { size:14, color:'#ccc', align:'left' });
    } else if (idx === 1) {
      const sfxCol = SETTINGS.sfx ? '#2ecc71' : '#e74c3c';
      rrect(W/2+40, ry-16, 90, 32, 8,
            SETTINGS.sfx ? 'rgba(46,204,113,0.25)' : 'rgba(231,76,60,0.25)',
            sfxCol, 1.5);
      txt(row.value, W/2+85, ry, { size:15, color:sfxCol });
    } else {
      txt(row.value, W/2+20, ry, { size:14, color:'#aaa', align:'left' });
    }
  });

  // Back button
  const backY = 190 + 3 * 72;
  const backSel = settingsMenuIdx === 3;
  rrect(W/2-110, backY-22, 220, 44, 10,
        backSel ? 'rgba(255,215,0,0.2)' : 'rgba(255,255,255,0.06)',
        backSel ? '#ffd700' : '#444', backSel?2:1);
  txt('返回', W/2, backY, { size:18, color:backSel?'#ffd700':'#ccc', bold:backSel });
  if (backSel) { txt('►', W/2-95, backY, { size:13, color:'#ffd700' }); }

  txt('↑↓ 选择   ← → 调整   ESC 返回', W/2, H-28, { size:13, color:'#444' });
}
