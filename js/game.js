'use strict';

// ==================== STATE ====================
let screen = 'title';       // 'title' | 'charSelect' | 'game' | 'paused' | 'settings' | 'gameOver'
let titleMenuIdx = 0;
let charSelectIdx = 0;
let pauseMenuIdx = 0;
let settingsMenuIdx = 0;
let settingsFrom = 'title'; // 'title' | 'paused'
let gameOverMenuIdx = 0;
let gs = null;

function mkPlayer(charKey) {
  const ch = CHARS[charKey];
  return {
    x: W/2, y: H/2, w: 40, h: 40,
    baseSpeed: ch.speed, speed: ch.speed,
    hp: ch.hp, maxHp: ch.hp, atk: ch.atk,
    invincible: 0, shield: 0, thorns: 0,
    skillCharge: 0, bannerTimer: 0, skillActive: 0,
  };
}

function initGS(charKey) {
  return {
    charKey, frame: 0,
    player: mkPlayer(charKey),
    bullets: [], enemies: [], items: [], specials: [], particles: [],
    kills: 0, startTime: Date.now(), endTime: 0,
    spawnTimer: 0, spawnInterval: 120,
    itemTimer: 0, itemInterval: 300,
    shootCD: 0, eid: 0,
  };
}

// ==================== INPUT ====================
const keys = {};
document.addEventListener('keydown', e => {
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' ','Escape'].includes(e.key)) e.preventDefault();
  if (!keys[e.code]) onKeyPress(e.code);
  keys[e.code] = true;
});
document.addEventListener('keyup', e => { keys[e.code] = false; });

canvas.addEventListener('click', e => {
  const r = canvas.getBoundingClientRect();
  const mx = (e.clientX - r.left) * (W / r.width);
  const my = (e.clientY - r.top) * (H / r.height);
  onCanvasClick(mx, my);
});

function onKeyPress(code) {
  if (screen === 'title') {
    if (code === 'ArrowUp'   || code === 'KeyW') { titleMenuIdx = (titleMenuIdx + 1) % 2; SFX.select(); }
    if (code === 'ArrowDown' || code === 'KeyS') { titleMenuIdx = (titleMenuIdx + 1) % 2; SFX.select(); }
    if (code === 'Space' || code === 'Enter') {
      SFX.confirm();
      if (titleMenuIdx === 0) screen = 'charSelect';
      else { settingsFrom = 'title'; settingsMenuIdx = 0; screen = 'settings'; }
    }
  } else if (screen === 'charSelect') {
    if (code === 'ArrowLeft'  || code === 'KeyA') { charSelectIdx = (charSelectIdx + 2) % 3; SFX.select(); }
    if (code === 'ArrowRight' || code === 'KeyD') { charSelectIdx = (charSelectIdx + 1) % 3; SFX.select(); }
    if (code === 'Space' || code === 'Enter') { startGame(CHAR_KEYS[charSelectIdx]); SFX.confirm(); }
    if (code === 'Escape') { screen = 'title'; SFX.select(); }
  } else if (screen === 'game') {
    if (code === 'Space') activateSkill();
    if (code === 'Escape') { screen = 'paused'; pauseMenuIdx = 0; SFX.select(); }
  } else if (screen === 'paused') {
    if (code === 'ArrowUp'   || code === 'KeyW') { pauseMenuIdx = (pauseMenuIdx + 2) % 3; SFX.select(); }
    if (code === 'ArrowDown' || code === 'KeyS') { pauseMenuIdx = (pauseMenuIdx + 1) % 3; SFX.select(); }
    if (code === 'Space' || code === 'Enter') confirmPause();
    if (code === 'Escape') { screen = 'game'; SFX.select(); }
  } else if (screen === 'settings') {
    if (code === 'ArrowUp'   || code === 'KeyW') { settingsMenuIdx = (settingsMenuIdx + 3) % 4; SFX.select(); }
    if (code === 'ArrowDown' || code === 'KeyS') { settingsMenuIdx = (settingsMenuIdx + 1) % 4; SFX.select(); }
    if (code === 'ArrowLeft') {
      if (settingsMenuIdx === 0) SETTINGS.volume = Math.max(0, SETTINGS.volume - 0.05);
    }
    if (code === 'ArrowRight') {
      if (settingsMenuIdx === 0) SETTINGS.volume = Math.min(1, SETTINGS.volume + 0.05);
    }
    if (code === 'Space' || code === 'Enter') {
      if (settingsMenuIdx === 1) { SETTINGS.sfx = !SETTINGS.sfx; SFX.select(); }
      else if (settingsMenuIdx === 3) closeSettings();
    }
    if (code === 'Escape') closeSettings();
  } else if (screen === 'gameOver') {
    if (code === 'ArrowUp'   || code === 'KeyW') { gameOverMenuIdx = 0; SFX.select(); }
    if (code === 'ArrowDown' || code === 'KeyS') { gameOverMenuIdx = 1; SFX.select(); }
    if (code === 'Space' || code === 'Enter') confirmGameOver();
  }
}

function onCanvasClick(mx, my) {
  if (screen === 'title') {
    // Click on menu buttons
    [0, 1].forEach(idx => {
      const by = H/2 + 30 + idx * 56;
      if (Math.abs(mx - W/2) < 110 && Math.abs(my - by) < 22) {
        titleMenuIdx = idx;
        SFX.confirm();
        if (idx === 0) screen = 'charSelect';
        else { settingsFrom = 'title'; settingsMenuIdx = 0; screen = 'settings'; }
      }
    });
    return;
  }
  if (screen === 'charSelect') {
    CHAR_KEYS.forEach((key, idx) => {
      const cx = W/2 - 200 + idx * 200;
      if (Math.abs(mx - cx) < 90 && Math.abs(my - H/2 - 20) < 130) {
        charSelectIdx = idx;
        startGame(CHAR_KEYS[charSelectIdx]);
        SFX.confirm();
      }
    });
  } else if (screen === 'paused') {
    [0, 1, 2].forEach(idx => {
      const by = H/2 - 20 + idx * 54;
      if (Math.abs(mx - W/2) < 115 && Math.abs(my - by) < 22) {
        pauseMenuIdx = idx; confirmPause();
      }
    });
  } else if (screen === 'settings') {
    // Volume row clicks (left/right arrows)
    const vol0y = 190;
    if (Math.abs(my - vol0y) < 30) {
      settingsMenuIdx = 0;
      const bx = W/2-20, barW = 140;
      if (mx >= bx && mx <= bx+barW) {
        SETTINGS.volume = Math.max(0, Math.min(1, (mx-bx)/barW));
      } else if (mx < bx) {
        SETTINGS.volume = Math.max(0, SETTINGS.volume - 0.05);
      } else {
        SETTINGS.volume = Math.min(1, SETTINGS.volume + 0.05);
      }
    }
    // SFX toggle
    if (Math.abs(my - (190+72)) < 30 && mx > W/2+30 && mx < W/2+140) {
      SETTINGS.sfx = !SETTINGS.sfx; SFX.select();
    }
    // Back button
    const backY = 190 + 3 * 72;
    if (Math.abs(mx - W/2) < 110 && Math.abs(my - backY) < 22) closeSettings();
  } else if (screen === 'gameOver') {
    const bx = W/2, by0 = H/2 + 70, by1 = H/2 + 122;
    if (Math.abs(mx - bx) < 100 && Math.abs(my - by0) < 20) { gameOverMenuIdx = 0; confirmGameOver(); }
    if (Math.abs(mx - bx) < 100 && Math.abs(my - by1) < 20) { gameOverMenuIdx = 1; confirmGameOver(); }
  }
}

function confirmGameOver() {
  SFX.confirm();
  if (gameOverMenuIdx === 0) startGame(gs.charKey);
  else screen = 'title';
}

function confirmPause() {
  SFX.confirm();
  if (pauseMenuIdx === 0) { screen = 'game'; }
  else if (pauseMenuIdx === 1) { screen = 'title'; gs = null; }
  else if (pauseMenuIdx === 2) { settingsFrom = 'paused'; settingsMenuIdx = 0; screen = 'settings'; }
}

function closeSettings() {
  SFX.confirm();
  screen = settingsFrom === 'paused' ? 'paused' : 'title';
}

// ==================== GAME FLOW ====================
function startGame(charKey) {
  gs = initGS(charKey);
  screen = 'game';
}

function activateSkill() {
  if (!gs || screen !== 'game') return;
  const p = gs.player;
  if (p.skillCharge < 100 || p.skillActive > 0 || p.bannerTimer > 0) return;
  p.skillCharge = 0;
  p.bannerTimer = 180;          // 3s: 0.5s slide-in + 1.5s hold + 1s slide-out
  p.invincible = 780;           // safe during banner (180f) + skill (600f)
  SFX.skillUse();
  SFX.skillAudio(gs.charKey);
}

function onBannerEnd() {
  const p = gs.player;
  p.skillActive = 600;          // 10s skill
  if (gs.charKey === 'bella') { p.w = 60; p.h = 60; p.speed = p.baseSpeed * 1.5; }
}

function onSkillEnd() {
  const p = gs.player;
  if (gs.charKey === 'bella') { p.w = 40; p.h = 40; p.speed = p.baseSpeed; }
}

function endGame() {
  gs.endTime = Date.now();
  screen = 'gameOver';
  gameOverMenuIdx = 0;
  SFX.gameOver();
}

// ==================== HELPERS ====================
function overlaps(a, b) {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 &&
         Math.abs(a.y - b.y) < (a.h + b.h) / 2;
}
function nearestEnemy(x, y) {
  let best = null, bd = Infinity;
  for (const e of gs.enemies) {
    const d = Math.hypot(e.x - x, e.y - y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
function spawnFX(x, y, color, n, sm = 1) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = (1 + Math.random() * 3) * sm;
    gs.particles.push({ x, y, dx: Math.cos(a)*s, dy: Math.sin(a)*s,
                         life: 30 + Math.random()*20, color });
  }
}
function addSkillCharge() {
  const p = gs.player;
  if (p.skillActive > 0) return;
  const prev = p.skillCharge;
  p.skillCharge = Math.min(100, p.skillCharge + 10);
  if (prev < 100 && p.skillCharge >= 100) SFX.skillReady();
}

// ==================== SPAWN ====================
function spawnEnemy() {
  const side = Math.floor(Math.random() * 4);
  let x, y;
  if (side === 0) { x = Math.random()*W;  y = -25; }
  else if (side===1) { x = W+25; y = Math.random()*H; }
  else if (side===2) { x = Math.random()*W; y = H+25; }
  else { x = -25; y = Math.random()*H; }
  gs.enemies.push({ id: gs.eid++, x, y, w:40, h:40, hp:3, maxHp:3, atk:1,
                    speed: 1 + Math.random()*0.6, frozen:0, dmgCD:0 });
}

const ITEM_TYPES = ['heal','bomb','shield','thorns'];
const ITEM_ICON  = { heal:'💊', bomb:'💣', shield:'🛡', thorns:'🌵' };
const ITEM_CLR   = { heal:'#2ecc71', bomb:'#e67e22', shield:'#3498db', thorns:'#f1c40f' };

function spawnItem() {
  const type = ITEM_TYPES[Math.floor(Math.random() * ITEM_TYPES.length)];
  gs.items.push({
    x: 50 + Math.random() * (W - 100),
    y: 60 + Math.random() * (H - 120),
    w: 30, h: 30, type,
  });
}

function applyItem(type) {
  const p = gs.player;
  if (type === 'heal') {
    p.hp = Math.min(p.maxHp, p.hp + 1); SFX.heal();
  } else if (type === 'bomb') {
    for (const e of gs.enemies) { e.hp -= 5; spawnFX(e.x, e.y, '#e67e22', 8); }
    spawnFX(W/2, H/2, '#ff9800', 50, 2.5);
    gs.enemies = gs.enemies.filter(e => {
      if (e.hp <= 0) { gs.kills++; addSkillCharge(); SFX.enemyDie(); return false; }
      return true;
    });
    SFX.bomb();
  } else if (type === 'shield') {
    p.shield = 600; SFX.shield();
  } else if (type === 'thorns') {
    p.thorns = 300; SFX.thorns();
  }
}

// ==================== UPDATE ====================
function update() {
  if (screen !== 'game' || !gs) return;
  const p = gs.player;
  gs.frame++;

  // Timers
  if (p.invincible > 0) p.invincible--;
  if (p.shield > 0)     p.shield--;
  if (p.thorns > 0)     p.thorns--;
  if (p.bannerTimer > 0) {
    p.bannerTimer--;
    if (p.bannerTimer === 0) onBannerEnd();
  }
  if (p.skillActive > 0) {
    p.skillActive--;
    if (p.skillActive === 0) onSkillEnd();
  }

  // Movement (block input during banner)
  if (p.bannerTimer <= 0) {
    let mx = 0, my = 0;
    if (keys['KeyW']) my -= p.speed;
    if (keys['KeyS']) my += p.speed;
    if (keys['KeyA']) mx -= p.speed;
    if (keys['KeyD']) mx += p.speed;
    if (mx && my) { mx *= 0.707; my *= 0.707; }
    p.x = Math.max(p.w/2, Math.min(W-p.w/2, p.x + mx));
    p.y = Math.max(p.h/2, Math.min(H-p.h/2, p.y + my));
  }

  // Shooting
  if (gs.shootCD > 0) gs.shootCD--;
  if (gs.shootCD === 0 && p.bannerTimer <= 0) {
    let sdx = 0, sdy = 0;
    if (keys['ArrowUp'])    sdy = -1;
    if (keys['ArrowDown'])  sdy =  1;
    if (keys['ArrowLeft'])  sdx = -1;
    if (keys['ArrowRight']) sdx =  1;
    if (sdx || sdy) {
      const len = Math.hypot(sdx, sdy);
      const tracking = gs.charKey === 'jiaran' && p.skillActive > 0;
      const bellaSkill = gs.charKey === 'bella' && p.skillActive > 0;
      const eileenSkill = gs.charKey === 'eileen' && p.skillActive > 0;

      if (eileenSkill) {
        // 乃琳技能：同时向四个方向发射
        [[0,-1],[0,1],[-1,0],[1,0]].forEach(([bx, by]) => {
          gs.bullets.push({
            x: p.x, y: p.y, dx: bx, dy: by,
            speed: 7, w: 10, h: 10,
            atk: p.atk, life: 80,
            tracking: false, pierce: true, hitIds: new Set(),
          });
        });
        SFX.shoot();
        gs.shootCD = 18;
      } else {
        const bSpeed = bellaSkill ? 7 * 2 : 7;
        const bSize  = bellaSkill ? 10 * 3 : 10;
        gs.bullets.push({
          x: p.x, y: p.y, dx: sdx/len, dy: sdy/len,
          speed: bSpeed, w: bSize, h: bSize,
          atk: p.atk, life: tracking ? 180 : 80,
          tracking, pierce: false, hitIds: new Set(),
        });
        SFX.shoot();
        gs.shootCD = 18;
      }
    }
  }

  // Bullets
  if (p.bannerTimer > 0) return;   // world frozen during skill banner
  gs.bullets = gs.bullets.filter(b => {
    // Homing
    if (b.tracking && gs.enemies.length > 0) {
      const ne = nearestEnemy(b.x, b.y);
      if (ne) {
        const d = Math.hypot(ne.x - b.x, ne.y - b.y) || 1;
        b.dx += (ne.x - b.x) / d * 0.35;
        b.dy += (ne.y - b.y) / d * 0.35;
        const sp = Math.hypot(b.dx, b.dy);
        b.dx /= sp; b.dy /= sp;
      }
    }
    b.x += b.dx * b.speed;
    b.y += b.dy * b.speed;
    b.life--;
    if (b.x < -30 || b.x > W+30 || b.y < -30 || b.y > H+30 || b.life <= 0) return false;

    if (b.fromPlayer !== false) {
      let consumed = false;
      for (let i = gs.enemies.length - 1; i >= 0; i--) {
        const e = gs.enemies[i];
        if (b.hitIds.has(e.id) || !overlaps(b, e)) continue;
        b.hitIds.add(e.id);

        if (b.tracking) {
          // Enemy → Candy
          spawnFX(e.x, e.y, '#ff69b4', 8);
          gs.specials.push({ type:'candy', x:e.x, y:e.y, w:32, h:32, speed:2.5, life:240 });
          gs.enemies.splice(i, 1);
          SFX.candy();
          consumed = true; break;
        } else if (b.pierce) {
          // Pierce: damage; if dead → IceCream
          e.hp -= b.atk;
          SFX.hit();
          spawnFX(b.x, b.y, '#87ceeb', 4);
          if (e.hp <= 0) {
            gs.specials.push({ type:'icecream', x:e.x, y:e.y, w:32, h:32, life:180 });
            gs.enemies.splice(i, 1);
            gs.kills++; addSkillCharge(); SFX.icecream();
          }
          // bullet continues
        } else {
          // Normal
          e.hp -= b.atk;
          SFX.hit();
          spawnFX(b.x, b.y, '#ff6b6b', 5);
          if (e.hp <= 0) {
            spawnFX(e.x, e.y, '#e74c3c', 12);
            gs.enemies.splice(i, 1);
            gs.kills++; addSkillCharge(); SFX.enemyDie();
          }
          consumed = true; break;
        }
      }
      if (consumed) return false;
    }
    return true;
  });

  // Enemies
  for (let i = gs.enemies.length - 1; i >= 0; i--) {
    const e = gs.enemies[i];
    if (e.dmgCD > 0) e.dmgCD--;
    if (e.frozen > 0) { e.frozen--; continue; }

    // Move toward player
    const dx = p.x - e.x, dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    e.x += dx/d * e.speed;
    e.y += dy/d * e.speed;

    // Star attraction
    for (const sp of gs.specials) {
      if (sp.type === 'star') {
        const sd = Math.hypot(sp.x-e.x, sp.y-e.y);
        if (sd < 130 && sd > 1) { e.x += (sp.x-e.x)/sd*1.8; e.y += (sp.y-e.y)/sd*1.8; }
      }
    }

    // Bella body-kill
    if (gs.charKey === 'bella' && p.skillActive > 0 && overlaps(p, e)) {
      spawnFX(e.x, e.y, '#ffd700', 14);
      gs.specials.push({ type:'star', x:e.x, y:e.y, w:34, h:34, life:480 });
      gs.enemies.splice(i, 1);
      gs.kills++; addSkillCharge(); SFX.star();
      continue;
    }

    // Thorns: enemy touches any orbiting triangle
    if (p.thorns > 0 && e.dmgCD <= 0) {
      const tRadius = p.w, hitR = p.w * 0.4, baseAngle = gs.frame * 0.04;
      let hit = false;
      for (let ti = 0; ti < 4; ti++) {
        const ang = baseAngle + ti * Math.PI / 2;
        const tx = p.x + Math.cos(ang) * tRadius;
        const ty = p.y + Math.sin(ang) * tRadius;
        if (Math.hypot(e.x - tx, e.y - ty) < hitR + e.w / 2) { hit = true; break; }
      }
      if (hit) {
        e.hp -= 2; e.dmgCD = 30;
        spawnFX(e.x, e.y, '#f1c40f', 5);
        if (e.hp <= 0) {
          spawnFX(e.x, e.y, '#e74c3c', 10);
          gs.enemies.splice(i, 1);
          gs.kills++; addSkillCharge(); SFX.enemyDie();
          continue;
        }
      }
    }

    // Contact with player → player damage (invincible while thorns active)
    if (overlaps(p, e) && p.invincible <= 0 && p.shield <= 0 && p.thorns <= 0) {
      p.hp -= e.atk; p.invincible = 60;
      spawnFX(p.x, p.y, '#fff', 8);
      SFX.playerHit();
      if (p.hp <= 0) { endGame(); return; }
    }
  }

  // Specials: Candy, Star, IceCream
  for (let i = gs.specials.length - 1; i >= 0; i--) {
    const sp = gs.specials[i];
    sp.life--;
    if (sp.life <= 0) { gs.specials.splice(i, 1); continue; }

    if (sp.type === 'candy') {
      const ne = nearestEnemy(sp.x, sp.y);
      if (ne) {
        const d = Math.hypot(ne.x-sp.x, ne.y-sp.y) || 1;
        sp.x += (ne.x-sp.x)/d * sp.speed;
        sp.y += (ne.y-sp.y)/d * sp.speed;
        if (overlaps(sp, ne)) {
          ne.hp -= 10; spawnFX(sp.x, sp.y, '#ff69b4', 16);
          SFX.candy();
          if (ne.hp <= 0) {
            const idx = gs.enemies.indexOf(ne);
            if (idx !== -1) { gs.enemies.splice(idx, 1); gs.kills++; addSkillCharge(); SFX.enemyDie(); }
          }
          gs.specials.splice(i, 1); continue;
        }
      }
    } else if (sp.type === 'star') {
      for (let j = gs.enemies.length - 1; j >= 0; j--) {
        const e = gs.enemies[j];
        if (overlaps(sp, e)) {
          e.hp -= 5; spawnFX(e.x, e.y, '#ffd700', 8); SFX.star();
          if (e.hp <= 0) {
            gs.enemies.splice(j, 1); gs.kills++; addSkillCharge(); SFX.enemyDie();
          }
          gs.specials.splice(i, 1); break;
        }
      }
    } else if (sp.type === 'icecream') {
      // 0.4V: continuous freeze aura — no damage, enemies near icecream stay frozen
      for (const e of gs.enemies) {
        if (Math.hypot(e.x-sp.x, e.y-sp.y) < 110) {
          if (e.frozen <= 0) spawnFX(e.x, e.y, '#87ceeb', 4);
          e.frozen = 30; // refresh freeze each frame while in range
        }
      }
    }
  }

  // Item pickup (auto on touch)
  for (let i = gs.items.length - 1; i >= 0; i--) {
    if (overlaps(p, gs.items[i])) {
      applyItem(gs.items[i].type);
      gs.items.splice(i, 1);
    }
  }

  // Particles
  gs.particles = gs.particles.filter(pt => { pt.x+=pt.dx; pt.y+=pt.dy; return --pt.life > 0; });

  // Enemy spawn
  gs.spawnTimer++;
  if (gs.spawnTimer >= gs.spawnInterval) {
    gs.spawnTimer = 0;
    spawnEnemy();
    gs.spawnInterval = Math.max(40, 120 - Math.floor(gs.kills/5)*5);
  }
  // Item spawn
  gs.itemTimer++;
  if (gs.itemTimer >= gs.itemInterval && gs.items.length < 4) {
    gs.itemTimer = 0; spawnItem();
  }
}

// ==================== MAIN LOOP ====================
function loop() {
  update();
  if      (screen === 'title')      drawTitle();
  else if (screen === 'charSelect') drawCharSelect();
  else if (screen === 'game')       drawGame();
  else if (screen === 'paused')     { if(gs) drawGame(); drawPause(); }
  else if (screen === 'settings')   drawSettings();
  else if (screen === 'gameOver')   { if(gs) drawGame(); drawGameOver(); }
  requestAnimationFrame(loop);
}
loop();
