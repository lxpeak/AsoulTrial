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
  ctx.fillStyle = '#2d5a27'; ctx.fillRect(0,0,W,H);
  ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 1;
  for (let x=0; x<W; x+=40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for (let y=0; y<H; y+=40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
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
    ctx.save();
    ctx.fillStyle='rgba(0,0,0,0.35)'; ctx.fillRect(0,0,W,H);
    const bannerKey = CHARS[gs.charKey].bannerKey;
    const bi = IMGS[bannerKey];
    if (bi.complete && bi.naturalWidth) {
      const bw2=520, bh2=bi.naturalHeight*(520/bi.naturalWidth)||200;
      imgAt(bannerKey, W/2, H/2, bw2, Math.min(bh2,260), 0.75);
    } else {
      txt(CHARS[gs.charKey].name + ' 技能！', W/2, H/2,
          { size:60, color:'#ffd700', bold:true, shadow:true });
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
  txt('一个魂的试炼', W/2, H/2-80, { size:52, color:'#ffd700', bold:true, shadow:true });
  txt('The Trial of A-Soul ', W/2, H/2-24, { size:18, color:'#888' });
  if (Math.floor(Date.now()/500)%2===0)
    txt('按空格 / 点击 开始', W/2, H/2+42, { size:20, color:'#ccc', shadow:true });
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
