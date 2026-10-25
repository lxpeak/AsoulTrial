/**
 * 无浏览器烟雾测试：用最小 DOM/Canvas 桩跑真实游戏逻辑。
 * 运行：node test/smoke.mjs
 */

const noop = () => {};
const ctxStub = new Proxy(
  {},
  {
    get(target, key) {
      if (key in target) return target[key];
      // 渐变工厂必须返回带 addColorStop 的对象，否则只要有一处用了渐变
      // （Boss 血条就是）渲染测试就会炸在 undefined 上
      if (key === 'createLinearGradient' || key === 'createRadialGradient') {
        return () => ({ addColorStop: noop });
      }
      if (key === 'measureText') return () => ({ width: 10 });
      return noop;
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  }
);

const canvasStub = {
  width: 800,
  height: 600,
  style: {},
  getContext: () => ctxStub,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  addEventListener: noop,
  setPointerCapture: noop,
};

const bootStub = { classList: { add: noop, remove: noop }, textContent: '' };

globalThis.document = {
  getElementById: (id) => (id === 'gameCanvas' ? canvasStub : bootStub),
  // 背景底图会预渲染到离屏 canvas，这里给个桩，让绘制路径能跑通
  createElement: () => ({ width: 0, height: 0, getContext: () => ctxStub }),
};
Object.defineProperty(globalThis, 'navigator', {
  value: { maxTouchPoints: 0 },
  configurable: true,
  writable: true,
});

const winListeners = new Map();
globalThis.window = {
  devicePixelRatio: 1,
  addEventListener(type, fn) {
    if (!winListeners.has(type)) winListeners.set(type, []);
    winListeners.get(type).push(fn);
  },
  matchMedia: () => ({ matches: false }),
  AudioContext: class {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 44100;
      this.destination = {};
    }
    createOscillator() {
      return {
        type: 'sine',
        frequency: { setValueAtTime: noop, linearRampToValueAtTime: noop },
        connect: noop,
        start: noop,
        stop: noop,
      };
    }
    createGain() {
      return {
        gain: { setValueAtTime: noop, linearRampToValueAtTime: noop },
        connect: noop,
      };
    }
    createBuffer(ch, len) {
      return { getChannelData: () => new Float32Array(len) };
    }
    createBufferSource() {
      return { buffer: null, connect: noop, start: noop };
    }
  },
};

globalThis.Image = class {
  constructor() {
    this.complete = true;
    this.naturalWidth = 100;
    this.naturalHeight = 100;
  }
};
globalThis.Audio = class {
  constructor() {
    this.volume = 1;
    this.currentTime = 0;
    this.preload = 'auto';
  }
  play() {
    return Promise.resolve();
  }
};
globalThis.performance = { now: () => Date.now() };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = noop;
globalThis.setTimeout = globalThis.setTimeout || noop;

// localStorage 桩：验证存档读写。failWrite 用来模拟"存储写满 / 无痕模式"
class MemoryStorage {
  constructor() {
    this.map = new Map();
    this.failWrite = false;
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    if (this.failWrite) throw new Error('QuotaExceededError');
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}
const localStorageStub = new MemoryStorage();
globalThis.localStorage = localStorageStub;

function press(code) {
  for (const fn of winListeners.get('keydown') || []) fn({ code, preventDefault: noop });
}
function release(code) {
  for (const fn of winListeners.get('keyup') || []) fn({ code });
}

const { app } = await import('../src/game/app.js');
const screen = await import('../src/ui/screen.js');
const { startGame, activateSkill } = await import('../src/game/flow.js');
const { update } = await import('../src/game/update.js');
const { input } = await import('../src/core/input.js');
const { elapsedSeconds } = await import('../src/game/state.js');
const { cam } = await import('../src/game/camera.js');
const { EYE_H, FRAME_DRAW_H, MUZZLE_H, playerBox, muzzleOf } = await import('../src/data/appearance.js');

let pass = 0;
let fail = 0;

function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${extra}`);
  }
}

function run(frames) {
  for (let i = 0; i < frames; i++) update();
}

console.log('\n[1] 开局与移动');
startGame('jiaran');
check('进入 game 界面', app.screen === 'game');
check('gs 已初始化', !!app.gs);
const startX = app.gs.player.x;

press('KeyD');
run(30);
release('KeyD');
check('按 D 向右移动', app.gs.player.x > startX, `x=${app.gs.player.x}`);
check('移动速度约 3px/帧', Math.abs(app.gs.player.x - startX - 90) < 2, `dx=${app.gs.player.x - startX}`);

console.log('\n[2] 射击与刷怪');
press('ArrowRight');
run(2);
check('按方向键生成子弹', app.gs.bullets.length > 0, `bullets=${app.gs.bullets.length}`);
run(400);
check('敌人已生成', app.gs.enemies.length > 0, `enemies=${app.gs.enemies.length}`);
check('子弹在飞行', app.gs.bullets.every((b) => Number.isFinite(b.x)));
release('ArrowRight');

console.log('\n[3] 暂停不推进游戏时间');
screen.push('paused');
const tBefore = app.gs.time;
run(120);
check('暂停期间 time 不增长', app.gs.time === tBefore, `${tBefore} -> ${app.gs.time}`);
check('暂停期间敌人不移动', app.gs.enemies.every((e) => Number.isFinite(e.x)));

console.log('\n[4] 技能演出与属性还原（贝拉）');
startGame('bella');
const bella = app.gs.player;
bella.skillCharge = 100;
activateSkill();
check('banner 计时 180f', bella.bannerTimer === 180);
check('演出期间进入技能护体（13 秒）', bella.skillGuard === 780 && bella.invincible === 0);
run(181);
check('banner 结束进入技能生效', bella.skillActive > 0, `skillActive=${bella.skillActive}`);
check('贝拉体型放大', bella.w === 60, `w=${bella.w}`);
check('贝拉速度 ×1.5', Math.abs(bella.speed - 4.5) < 1e-6, `speed=${bella.speed}`);
run(600);
check('技能结束后体型还原', bella.w === 40, `w=${bella.w}`);
check('技能结束后速度还原', Math.abs(bella.speed - 3) < 1e-6, `speed=${bella.speed}`);

console.log('\n[5] 受伤与结算');
startGame('jiaran');
const p = app.gs.player;
p.hp = 1;
app.gs.enemies.push({ id: 999, x: p.x, y: p.y, w: 40, h: 40, hp: 3, maxHp: 3, atk: 1, speed: 1, frozen: 0, dmgCD: 0 });
run(2);
check('血量归零后进入 gameOver', app.screen === 'gameOver');
check('endTime 已记录', app.gs.endTime > 0);

console.log('\n[6] 击杀与计分');
startGame('jiaran');
app.gs.enemies.push({ id: 1, x: app.gs.player.x + 10, y: app.gs.player.y, w: 40, h: 40, hp: 1, maxHp: 3, atk: 1, speed: 0, frozen: 0, dmgCD: 0 });
app.gs.bullets.push({
  x: app.gs.player.x, y: app.gs.player.y, dx: 1, dy: 0, speed: 7, w: 10, h: 10,
  atk: 1, life: 80, tracking: false, pierce: false, hitIds: new Set(),
});
run(2);
check('子弹击杀计数 +1', app.gs.kills >= 1, `kills=${app.gs.kills}`);
check('击杀充能技能条', app.gs.player.skillCharge > 0, `charge=${app.gs.player.skillCharge}`);

console.log('\n[7] 世界边界（1600×1200）与摄像机钳制');
startGame('jiaran');
run(1);
app.gs.player.invincible = 1e9; // 长距离移动测试期间免伤，避免被打死后 update 提前返回
// 同时清场：跑图途中踩到荆棘/炸弹道具会杀敌升级，三选一一弹世界就冻结，
// 后面的钳制断言会变成"玩家跑到一半停住"，看上去像移动逻辑坏了
app.gs.spawnTimer = -1e9;
app.gs.itemTimer = -1e9;
app.gs.enemies.length = 0;
app.gs.items.length = 0;
check('出生在世界中心 (800,600)', app.gs.player.x === 800 && app.gs.player.y === 600, `${app.gs.player.x},${app.gs.player.y}`);
// 摄像机跟的是身体中心（脚底往上 EYE_H），不是脚底——否则角色视觉重心偏上半个身高
check(
  '摄像机对准身体中心',
  cam.x === 400 && cam.y === Math.round(600 - EYE_H - 300),
  `${cam.x},${cam.y}`
);

press('KeyD');
run(60);
release('KeyD');
check('摄像机跟随玩家', cam.x === app.gs.player.x - 400, `cam=${cam.x} p=${app.gs.player.x}`);

press('KeyA');
press('KeyW');
run(800);
release('KeyA');
release('KeyW');
check('玩家被左上角钳制在 (20,20)', app.gs.player.x === 20 && app.gs.player.y === 20, `${app.gs.player.x},${app.gs.player.y}`);
check('摄像机钳制在 (0,0)', cam.x === 0 && cam.y === 0, `${cam.x},${cam.y}`);

press('KeyS');
press('KeyD');
run(900);
release('KeyS');
release('KeyD');
check('玩家被右下角钳制在 (1580,1180)', app.gs.player.x === 1580 && app.gs.player.y === 1180, `${app.gs.player.x},${app.gs.player.y}`);
check('摄像机钳制在 (800,600)', cam.x === 800 && cam.y === 600, `${cam.x},${cam.y}`);

console.log('\n[8] 刷怪点与道具点取样');
const { pickSpawnPoint, pickItemPoint, WORLD } = await import('../src/data/world.js');
const { rng } = await import('../src/core/rng.js');

rng.seed(20261025);
let outAll = true;
let inWorldAll = true;
for (let i = 0; i < 80; i++) {
  const pt = pickSpawnPoint(800, 600, 400, 300, () => rng.next());
  const outside = pt.x < 376 || pt.x > 1224 || pt.y < 276 || pt.y > 924;
  if (!outside) outAll = false;
  if (pt.x < 20 || pt.x > WORLD.w - 20 || pt.y < 20 || pt.y > WORLD.h - 20) inWorldAll = false;
}
check('80 次取样全部落在视野外', outAll);
check('取样点全部在世界内', inWorldAll);

const corner = pickSpawnPoint(20, 20, 0, 0, () => rng.next());
check('玩家被逼到角落时刷怪仍在视野外', corner.x > 824 || corner.y > 624, `${corner.x},${corner.y}`);

const ip = pickItemPoint(800, 600, () => rng.next());
const idist = Math.hypot(ip.x - 800, ip.y - 600);
check('道具点距玩家 100–450px', idist > 100 && idist < 450, `d=${idist.toFixed(0)}`);

console.log('\n[9] 子弹按世界边界存活');
startGame('jiaran');
run(1);
app.gs.bullets.push({
  x: 1500, y: 600, dx: 1, dy: 0, speed: 7, w: 10, h: 10,
  atk: 1, life: 80, tracking: false, pierce: false, hitIds: new Set(),
});
run(1);
check('子弹能飞出画布右边界 (x>800)', app.gs.bullets.some((b) => b.x > 800), `x=${app.gs.bullets[0] && app.gs.bullets[0].x}`);
run(30);
check('子弹越过世界边界后被回收', app.gs.bullets.length === 0, `bullets=${app.gs.bullets.length}`);

console.log('\n[10] 敌人进场加速');
startGame('jiaran');
run(1);
app.gs.enemies.push({
  id: 1, x: app.gs.player.x + 700, y: app.gs.player.y, w: 40, h: 40,
  hp: 3, maxHp: 3, atk: 1, speed: 1, frozen: 0, dmgCD: 0, age: 0,
});
const ex0 = app.gs.enemies[0].x;
run(10);
const moved = ex0 - app.gs.enemies[0].x;
check('视野外敌人以 2.6 倍速进场 (>15px/10帧)', moved > 15, `moved=${moved}`);
check('加速只在视野外生效（未跑过头）', moved < 40, `moved=${moved}`);

console.log('\n[11] 统一伤害入口 combat.js');
const { damageEnemy, damagePlayer, canTakeDamage } = await import('../src/game/combat.js');

startGame('jiaran');
const cgs = app.gs;
const mkE = (id, hp) => ({
  id, x: cgs.player.x + 200, y: cgs.player.y, w: 40, h: 40,
  hp, maxHp: hp, atk: 1, speed: 0, frozen: 0, dmgCD: 0, age: 0,
});

const e1 = mkE(900, 3);
cgs.enemies.push(e1);
const k0 = cgs.kills;
check('非致命伤害返回 false', damageEnemy(cgs, e1, 1) === false);
check('非致命时敌人留在场上', cgs.enemies.includes(e1));
check('血量按量扣减', e1.hp === 2, `hp=${e1.hp}`);
check('非致命时不加击杀数', cgs.kills === k0);

check('致死伤害返回 true', damageEnemy(cgs, e1, 2) === true);
check('死亡后从敌人数组移除', !cgs.enemies.includes(e1));
check('击杀数 +1', cgs.kills === k0 + 1, `kills=${cgs.kills}`);
check('死亡触发技能条充能', cgs.player.skillCharge > 0, `charge=${cgs.player.skillCharge}`);

const e2 = mkE(901, 3);
cgs.enemies.push(e2);
check('Infinity 秒杀', damageEnemy(cgs, e2, Infinity) === true && !cgs.enemies.includes(e2));

// 子弹分支：重构后秒杀也要计分（重构前追踪弹击杀不计 kills，是个漏计数 bug）
const e3 = mkE(902, 3);
cgs.enemies.push(e3);
cgs.player.skillActive = 600;
cgs.bullets.push({
  x: e3.x, y: e3.y, dx: 1, dy: 0, speed: 0, w: 10, h: 10,
  atk: 1, life: 80, tracking: true, pierce: false, hitIds: new Set(),
});
const k1 = cgs.kills;
run(2);
check('追踪弹秒杀且计分', !cgs.enemies.includes(e3) && cgs.kills === k1 + 1, `kills=${cgs.kills}`);
check('追踪弹掉落糖果', cgs.specials.some((s) => s.type === 'candy'));

const e4 = mkE(903, 1);
cgs.enemies.push(e4);
cgs.bullets.push({
  x: e4.x, y: e4.y, dx: 1, dy: 0, speed: 0, w: 10, h: 10,
  atk: 5, life: 80, tracking: false, pierce: true, hitIds: new Set(),
});
run(2);
check('穿透弹击杀掉落冰淇淋', cgs.specials.some((s) => s.type === 'icecream'));
cgs.player.skillActive = 0;

const cp = cgs.player;
cp.invincible = 0;
cp.shield = 0;
cp.thorns = 0;
cp.thornCharges = 0;
cp.skillGuard = 0;
cp.hp = cp.maxHp;
check('无 buff 时可受伤', canTakeDamage(cp) === true);

cp.shield = 300;
check('护盾期间免伤', damagePlayer(cgs, 1) === false && cp.hp === cp.maxHp);
cp.shield = 0;
// 荆棘不再是"无敌 5 秒"：它挡一次少一层（见 game/guard.js）
cp.thorns = 300;
cp.thornCharges = 4;
check('荆棘挡下伤害且不掉血', damagePlayer(cgs, 1) === false && cp.hp === cp.maxHp);
check('荆棘挡一次掉一层耐久', cp.thornCharges === 3, `charges=${cp.thornCharges}`);
cp.thorns = 0;
cp.thornCharges = 0;
cp.invincible = 60;
check('无敌帧期间免伤', damagePlayer(cgs, 1) === false && cp.hp === cp.maxHp);

cp.invincible = 0;
const hp0 = cp.hp;
check('受伤后扣血并进入 60 帧无敌', damagePlayer(cgs, 1) === false && cp.hp === hp0 - 1 && cp.invincible === 60);

cp.invincible = 0;
cp.hp = 1;
// 上面四只怪也给了经验，这里清零，免得升级界面顶掉结算界面（那是另一段要测的逻辑）
cp.xp = 0;
cp.pendingLevels = 0;
check('致死伤害返回 true', damagePlayer(cgs, 1) === true);
check('血量归零且进入结算界面', cp.hp === 0 && app.screen === 'gameOver');

console.log('\n[12] 输入层收尾');
check('移动轴在松键后归零', input.move.x === 0 && input.move.y === 0);
check('存活秒数取自逻辑帧', elapsedSeconds(app.gs) === Math.floor(app.gs.time / 60));

console.log('\n[13] 界面渲染不抛错');
const menus = await import('../src/ui/menus.js');
const { onCanvasClick, onKeyPress } = await import('../src/ui/router.js');
const { drawScreens, current, depth, reset, push, pop } = screen;
const { CARD_LIST, CARD_BY_ID } = await import('../src/data/cards.js');

startGame('jiaran'); // 保证绘制战场时有 gs
app.upgradeChoices = CARD_LIST.slice(0, 3); // 三选一界面要有卡才画得出来
for (const name of ['title', 'charSelect', 'settings', 'game', 'paused', 'upgrade', 'gameOver']) {
  reset(name);
  let ok = true;
  let msg = '';
  try {
    drawScreens();
  } catch (e) {
    ok = false;
    msg = e.message;
  }
  check(`渲染 ${name}`, ok, msg);
}
app.upgradeChoices = null;

console.log('\n[14] 界面栈');
const order = [];
screen.register('__base', { draw: () => order.push('base') });
screen.register('__ghost', { draw: () => order.push('ghost'), opaque: false });

reset('__base');
push('__ghost');
drawScreens();
check('半透明界面会自动带出下层', order.join(',') === 'base,ghost', order.join(','));

order.length = 0;
reset('__ghost');
push('__base');
drawScreens();
check('不透明界面挡住下层', order.join(',') === 'base', order.join(','));

reset('title');
push('charSelect');
check('push 压入角色选择', current() === 'charSelect' && app.stack.join('>') === 'title>charSelect');
check('app.screen 跟随栈顶', app.screen === 'charSelect');
check('角色选择时摇杆关闭', input.sticksEnabled === false);

startGame('jiaran');
check('开局清栈为单层 game', depth() === 1 && app.stack.join('>') === 'game');
check('战斗中摇杆开启', input.sticksEnabled === true);

onKeyPress('Escape');
check('ESC 进入暂停', current() === 'paused');
check('暂停时摇杆关闭', input.sticksEnabled === false);
onKeyPress('Escape');
check('再按 ESC 回到战斗', current() === 'game' && input.sticksEnabled === true);

reset('game');
push('paused');
app.pauseMenuIdx = 2;
onKeyPress('Enter');
check('暂停 → 设置', current() === 'settings');
onKeyPress('Escape');
check('设置返回暂停而非标题', current() === 'paused' && app.stack.join('>') === 'game>paused');

const pg = app.gs.player;
pg.skillCharge = 100;
pg.bannerTimer = 0;
pg.skillActive = 0;
onKeyPress('Space');
check('暂停时空格不放技能', pg.bannerTimer === 0 && pg.skillCharge === 100);
reset('game');
onKeyPress('Space');
check('战斗中空格放技能', pg.bannerTimer === 180);

reset('title');
onCanvasClick(400, 330);
check('点击"开始游戏"进角色选择', current() === 'charSelect');
onCanvasClick(400, 360);
check('点击角色卡直接开局', current() === 'game');

reset('title');
push('settings');
onCanvasClick(400, 190 + 3 * 72);
check('点击"返回"弹出设置', current() === 'title');

console.log('\n[15] 存档骨架');
const save = await import('../src/data/save.js');
const { SETTINGS } = await import('../src/data/settings.js');

localStorageStub.clear();
save.resetSave();
check('默认最佳记录为 0', save.SAVE.best.kills === 0 && save.SAVE.best.time === 0);
check('recordRun 记录首局', save.recordRun(12, 45) === true && save.SAVE.best.kills === 12 && save.SAVE.best.time === 45);
check('较差成绩不覆盖', save.recordRun(5, 10) === false && save.SAVE.best.kills === 12);
check('同击杀更久可刷新', save.recordRun(12, 60) === true && save.SAVE.best.time === 60);
check('已写入 localStorage', !!localStorageStub.getItem('asoul-trial.save'));

save.SAVE.best.kills = 0;
save.SAVE.best.time = 0;
check('loadSave 读回记录', save.loadSave() === true && save.SAVE.best.kills === 12 && save.SAVE.best.time === 60);

SETTINGS.volume = 0.35;
SETTINGS.sfx = false;
check('persistSettings 写入成功', save.persistSettings() === true);
SETTINGS.volume = 0.9;
SETTINGS.sfx = true;
save.loadSave();
check('设置随存档恢复', Math.abs(SETTINGS.volume - 0.35) < 1e-9 && SETTINGS.sfx === false);

localStorageStub.setItem('asoul-trial.save', '{这不是 JSON');
check('坏档当无存档且不崩', save.loadSave() === false && Number.isFinite(SETTINGS.volume));

// 先建立一个"合法基线"，再看非法字段会不会被挡住
SETTINGS.volume = 0.5;
SETTINGS.sfx = true;
save.persistSettings();
localStorageStub.setItem('asoul-trial.save', JSON.stringify({
  version: 1,
  settings: { volume: 99, sfx: 'yes' },
  best: { kills: -5, time: 'x' },
  unlocks: 'not-an-array',
}));
save.loadSave();
check(
  '非法字段被钳制/忽略',
  SETTINGS.volume === 1 && SETTINGS.sfx === true
    && save.SAVE.best.kills === 0 && save.SAVE.unlocks.length === 0,
  `vol=${SETTINGS.volume} sfx=${SETTINGS.sfx} kills=${save.SAVE.best.kills} unlocks=${JSON.stringify(save.SAVE.unlocks)}`
);

check('unlock 只生效一次', save.unlock('char:nailin') === true && save.unlock('char:nailin') === false && save.isUnlocked('char:nailin'));

localStorageStub.failWrite = true;
check('存储写入失败不抛异常', save.persistSettings() === false && save.persistent === false);
localStorageStub.failWrite = false;
localStorageStub.clear();

console.log('\n[16] 程序化姿态（静态立绘怎么"动"）');
const { playerPose, resetPose } = await import('../src/gfx/pose.js');
resetPose();
const fake = { invincible: 0, shield: 0, skillActive: 0 };
let t = 1000;
const m1 = playerPose(fake, { moving: true, now: (t += 17) });
const m2 = playerPose(fake, { moving: true, now: (t += 17) });
check('移动时姿态随相位变化', m1.oy !== m2.oy || m1.rot !== m2.rot);
check('移动幅度收敛在合理范围', Math.abs(m1.rot) <= 0.1 && Math.abs(m1.oy) <= 7);

const idle = playerPose(fake, { moving: false, now: (t += 17) });
check('待机是轻微呼吸', Math.abs(idle.sy - 1) <= 0.04 && Math.abs(idle.oy) <= 1.7);
check('待机几乎不倾斜', Math.abs(idle.rot) <= 0.02);

const hit = playerPose({ ...fake, invincible: 60 }, { moving: false, now: t });
check('受击横向挤压', hit.sx > 1.05 && hit.sy < 1);

const skill = playerPose({ ...fake, skillActive: 300 }, { moving: false, now: t });
check('技能期有光晕与脉动', skill.glow > 0.2 && Math.abs(skill.scale - 1) <= 0.04);

const phaseA = playerPose(fake, { moving: false, now: t }).phase;
const phaseB = playerPose(fake, { moving: false, now: t + 100 }).phase;
check('颠步相位只在移动时推进', phaseA === phaseB);

console.log('\n[17] 序列帧（Q 版小人）');
const { SPRITE_SHEETS, SHEET_LAYOUT, frameRect, hasFrames } = await import('../src/data/sprites.js');
// 格子尺寸不写死：素材降采样过一次（384×512 → 288×384），
// 断言真正的性质是"按登记表算"，不是"等于某个具体数字"
const FW = SHEET_LAYOUT.frameW;
const FH = SHEET_LAYOUT.frameH;

check('三个角色都有序列帧，敌人没有', hasFrames('jiaran') && hasFrames('bella') && hasFrames('eileen') && !hasFrames('enemy'));
check('嘉然没有施法帧（那格光晕糊人已弃用）', frameRect('jiaran', 'cast', 0) === null);
check('贝拉有施法帧', frameRect('bella', 'cast', 0).sx === 3 * FW);

let structOk = true;
for (const s of Object.values(SPRITE_SHEETS)) {
  if (!(s.cols > 0 && s.rows > 0 && s.frameW > 0 && s.frameH > 0)) structOk = false;
  if (s.footPad >= s.frameH) structOk = false;
  for (const [name, list] of Object.entries(s.anims)) {
    if (!list.length) structOk = false;
    for (const f of list) {
      if (f.c < 0 || f.c >= s.cols || f.r < 0 || f.r >= s.rows) structOk = false;
    }
  }
}
check('帧索引都在网格内', structOk);

const r2 = frameRect('jiaran', 'walk', 2);
check('frameRect 按列算源矩形', r2.sx === 2 * FW && r2.sy === 0 && r2.sw === FW && r2.sh === FH);
check('frameRect 越界取模', frameRect('jiaran', 'hurt', 9).sx === 2 * FW);
check('未知动画返回 null', frameRect('jiaran', 'nope', 0) === null);
check('没帧的角色返回 null', frameRect('nobody', 'walk', 0) === null);

resetPose();
const walkSeen = new Set();
let walkMaxOy = 0;
let walkMaxRot = 0;
for (let i = 0; i < 120; i++) {
  const po = playerPose(fake, { moving: true, now: (t += 17), framed: true });
  walkSeen.add(po.frameIdx);
  walkMaxOy = Math.max(walkMaxOy, Math.abs(po.oy));
  walkMaxRot = Math.max(walkMaxRot, Math.abs(po.rot));
}
check('走路跑满 4 帧', walkSeen.size === 4 && [...walkSeen].every((i) => i >= 0 && i < 4));
check('有帧时程序化位移收敛到 1/4', walkMaxOy <= 6.2 * 0.26 + 0.01 && walkMaxRot <= 0.095 * 0.26 + 0.001);

const hurtPose = playerPose({ ...fake, invincible: 58 }, { moving: true, now: t, framed: true });
check('刚挨打时切到受击帧', hurtPose.anim === 'hurt');

const skillInvincible = playerPose({ ...fake, invincible: 700, skillActive: 600 }, { moving: true, now: t, framed: true });
check('技能无敌不算受击', skillInvincible.anim !== 'hurt');

resetPose();
const idleA = playerPose(fake, { moving: false, now: 0, framed: true });
const idleB = playerPose(fake, { moving: false, now: 600, framed: true });
check('待机两帧轮流', idleA.anim === 'idle' && idleA.frameIdx !== idleB.frameIdx);

// 素材文件必须真的存在，且像素尺寸与登记表一致（改了图忘了改登记会在这里炸）
const fs = await import('node:fs');
let fileOk = true;
for (const s of Object.values(SPRITE_SHEETS)) {
  if (!fs.existsSync(s.src)) {
    fileOk = false;
    console.log(`      缺文件 ${s.src}`);
    continue;
  }
  const buf = fs.readFileSync(s.src);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (w !== s.cols * s.frameW || h !== s.rows * s.frameH) {
    fileOk = false;
    console.log(`      ${s.src} 实际 ${w}x${h}，登记 ${s.cols * s.frameW}x${s.rows * s.frameH}`);
  }
}
check('素材存在且尺寸与登记一致', fileOk);

// ── 敌人帧表：和主角走同一条管线，共用 LAYOUT ──
const {
  ENEMY_SHEETS, ENEMY_TYPES, ENEMY_BASE_H, enemyAnim, enemyFrameIdx,
  enemyDrawH, enemyType, enemyHurtBox, canExecute, strideFor,
} = await import('../src/data/enemies.js');
const { rectOf } = await import('../src/data/sprites.js');

check('敌人帧表登记在案', !!ENEMY_SHEETS.frog && ENEMY_TYPES.frog.sheet === 'frog');
check(
  '敌人与主角共用格子尺寸',
  ENEMY_SHEETS.frog.frameW === FW && ENEMY_SHEETS.frog.frameH === FH
);
check('小兵视觉比主角矮一圈', ENEMY_BASE_H > 0 && ENEMY_BASE_H < 132);

let eStructOk = true;
for (const s of Object.values(ENEMY_SHEETS)) {
  for (const list of Object.values(s.anims)) {
    if (!list.length) eStructOk = false;
    for (const f of list) {
      if (f.c < 0 || f.c >= s.cols || f.r < 0 || f.r >= s.rows) eStructOk = false;
    }
  }
}
check('敌人帧索引都在网格内', eStructOk);
check('rectOf 越界取模', rectOf(ENEMY_SHEETS.frog, 'walk', 5).sx === 1 * FW);
check('敌人未登记的攻击帧返回 null', rectOf(ENEMY_SHEETS.frog, 'attack', 0) === null);

check(
  '冻住的敌人站待机帧',
  enemyAnim({ frozen: 30 }) === 'idle' && enemyAnim({ frozen: 0 }) === 'walk'
);
// 返回的是"第几个步进"，取模交给 rectOf —— 所以这里期望 10 而不是 2
check('敌人帧号随 age 推进', enemyFrameIdx({ age: 0 }) === 0 && enemyFrameIdx({ age: 100 }) === 10);

let eFileOk = true;
for (const s of Object.values(ENEMY_SHEETS)) {
  if (!fs.existsSync(s.src)) {
    eFileOk = false;
    console.log(`      缺文件 ${s.src}`);
    continue;
  }
  const buf = fs.readFileSync(s.src);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (w !== s.cols * s.frameW || h !== s.rows * s.frameH) {
    eFileOk = false;
    console.log(`      ${s.src} 实际 ${w}x${h}，登记 ${s.cols * s.frameW}x${s.rows * s.frameH}`);
  }
}
check('敌人素材存在且尺寸与登记一致', eFileOk);

// 刷出来的怪必须带上类型，数值来自类型表而不是遍布各处的字面量
startGame('jiaran');
app.gs.spawnTimer = 1e9;
run(2);
const spawned = app.gs.enemies[0];
check('刷出的怪带类型', !!spawned && spawned.type === 'frog', spawned ? spawned.type : '没刷出怪');
check(
  '刷出的怪数值来自类型表',
  !!spawned && spawned.w === ENEMY_TYPES.frog.w && spawned.maxHp === ENEMY_TYPES.frog.hp,
  spawned ? `w=${spawned.w} hp=${spawned.maxHp}` : ''
);

console.log('\n[18] 升级三选一');
const level = await import('../src/game/level.js');
const { mkPlayer } = await import('../src/game/state.js');

check('升级所需经验逐级递增', level.xpNeed(2) > level.xpNeed(1) && level.xpNeed(6) > level.xpNeed(5));

startGame('jiaran');
const lg = app.gs;
const lp = lg.player;
check('开局 Lv.1 且零经验', lp.level === 1 && lp.xp === 0 && lp.pendingLevels === 0);

const ups = level.gainXP(lg, level.xpNeed(1) + 2);
check('经验够了升一级并保留溢出', ups === 1 && lp.level === 2 && lp.xp === 2, `lv=${lp.level} xp=${lp.xp}`);
check('只加经验不会当场弹界面', app.screen === 'game', app.stack.join('>'));

lp.xp = 0;
lp.pendingLevels = 0;
level.gainXP(lg, level.xpNeed(2) + level.xpNeed(3));
check('一次给足经验可以连升两级', lp.pendingLevels === 2 && lp.level === 4, `lv=${lp.level} pend=${lp.pendingLevels}`);

run(1);
check('整帧结算完才弹三选一', app.screen === 'upgrade' && app.stack.join('>') === 'game>upgrade', app.stack.join('>'));
check('给出 3 张互不重复的卡', (app.upgradeChoices || []).length === 3
  && new Set(app.upgradeChoices.map((c) => c.id)).size === 3);
check('三选一期间摇杆关闭', input.sticksEnabled === false);

const frozenAt = lg.time;
run(30);
check('三选一期间游戏完全冻结', lg.time === frozenAt, `${frozenAt} -> ${lg.time}`);

const firstCard = app.upgradeChoices[0];
level.chooseCard(0);
check('选完记录在 player.upgrades 上', lp.upgrades[firstCard.id] === 1);
check('还欠一级时立刻续上下一轮', app.screen === 'upgrade' && lp.pendingLevels === 1, `pend=${lp.pendingLevels}`);
// 断言"和上一轮不同"是不可靠的：卡池就那么十几张，随机撞到同一张完全正常，
// 而且这里连着刷怪，rng 序列一变断言就翻。真正要保证的是"每次都给三张不重复"
check(
  '第二轮仍然给出 3 张不重复的卡',
  (app.upgradeChoices || []).length === 3 &&
    new Set(app.upgradeChoices.map((c) => c.id)).size === 3,
  (app.upgradeChoices || []).map((c) => c.id).join(',')
);
level.chooseCard(0);
check('全部选完回到战斗', app.screen === 'game' && lp.pendingLevels === 0, app.stack.join('>'));

// 键盘与点击
lp.pendingLevels = 1;
run(1);
check('再次弹出三选一', current() === 'upgrade');
const cnt = app.upgradeChoices.length;
onKeyPress('ArrowRight');
check('方向键切换高亮', app.upgradeIdx === 1 % cnt, `idx=${app.upgradeIdx}`);
const rect = (await import('../src/ui/upgrade.js')).cardRect(0, cnt);
onCanvasClick(rect.cx, rect.cy);
check('点击卡面直接选中', current() === 'game' && lp.pendingLevels === 0);

// ── 每张卡的效果都落在明确的字段上 ──
const mp = mkPlayer('jiaran');
CARD_BY_ID.atk.apply(mp, { charKey: 'jiaran' });
check('力量：攻击 +20%', Math.abs(mp.atk - 1.2) < 1e-9, `atk=${mp.atk}`);
const fire0 = mp.fireCD;
CARD_BY_ID.rate.apply(mp, { charKey: 'jiaran' });
check('疾风：射击间隔变短', mp.fireCD < fire0, `${fire0} -> ${mp.fireCD}`);

const spd0 = mp.baseSpeed;
CARD_BY_ID.spd.apply(mp, { charKey: 'jiaran' });
check('轻身：移速提升且 speed 同步', mp.baseSpeed > spd0 && mp.speed === mp.baseSpeed);

mp.hp = 1;
const max0 = mp.maxHp;
CARD_BY_ID.hp.apply(mp, { charKey: 'jiaran' });
check('坚韧：上限 +1 并回复 1 点', mp.maxHp === max0 + 1 && mp.hp === 2, `hp=${mp.hp}/${mp.maxHp}`);

const crit0 = mp.critChance;
CARD_BY_ID.luck.apply(mp, { charKey: 'jiaran' });
check('幸运：暴击率 +8%', Math.abs(mp.critChance - crit0 - 0.08) < 1e-9);

CARD_BY_ID.pierce.apply(mp, { charKey: 'jiaran' });
CARD_BY_ID.multi.apply(mp, { charKey: 'jiaran' });
check('穿透 / 分裂各 +1', mp.pierce === 1 && mp.multishot === 1);

const cd0 = mp.critMult;
CARD_BY_ID.critdmg.apply(mp, { charKey: 'jiaran' });
check('暴击强化：倍率提升', mp.critMult > cd0, `${cd0} -> ${mp.critMult}`);

// 抽卡不会给出已满层的卡
startGame('jiaran');
const rg = app.gs;
rg.player.upgrades.pierce = CARD_BY_ID.pierce.max;
let leaked = false;
let alwaysThree = true;
for (let i = 0; i < 40; i++) {
  const roll = level.rollCards(rg, 3);
  if (roll.length !== 3) alwaysThree = false;
  if (roll.some((c) => c.id === 'pierce')) leaked = true;
  if (new Set(roll.map((c) => c.id)).size !== roll.length) alwaysThree = false;
}
check('到上限的卡不再出现', !leaked);
check('每次抽 3 张且互不重复', alwaysThree);

// ── 卡的效果要真的改变游戏行为，不只是改字段 ──
const { damageEnemy: dmgE, damagePlayer: dmgP } = await import('../src/game/combat.js');

startGame('jiaran');
const pg2 = app.gs;
pg2.player.critChance = 1; // 必定暴击，避免随机
press('ArrowRight');
run(1);
const cb = pg2.bullets[0];
check('暴击标记带到子弹上', !!cb && cb.crit === true);
check('暴击伤害翻倍', !!cb && Math.abs(cb.atk - pg2.player.atk * 2) < 1e-9, `atk=${cb && cb.atk}`);

pg2.bullets.length = 0;
pg2.player.multishot = 2;
pg2.shootCD = 0;
run(1);
check('分裂射击一次出 3 发', pg2.bullets.length === 3, `n=${pg2.bullets.length}`);
release('ArrowRight');

// 穿透卡：一发子弹穿两个
startGame('jiaran');
const tg = app.gs;
const mkTarget = (id) => ({
  id, x: tg.player.x + 15, y: tg.player.y, w: 40, h: 40,
  hp: 50, maxHp: 50, atk: 0, xp: 0, speed: 0, frozen: 0, dmgCD: 0, age: 99,
});
const t1 = mkTarget(501);
const t2 = mkTarget(502);
tg.enemies.push(t1, t2);
tg.bullets.push({
  x: tg.player.x, y: tg.player.y, dx: 1, dy: 0, speed: 0, w: 20, h: 20,
  atk: 1, life: 50, tracking: false, pierce: false, pierceLeft: 2, hitIds: new Set(),
});
run(2);
check('穿透：一发子弹打穿两个敌人', t1.hp < 50 && t2.hp < 50, `${t1.hp} / ${t2.hp}`);
check('穿透次数还有余，子弹仍在飞', tg.bullets.length === 1, `n=${tg.bullets.length}`);

// 反伤
startGame('jiaran');
const rf = app.gs;
rf.player.reflect = 3;
const near = {
  id: 601, x: rf.player.x + 10, y: rf.player.y, w: 40, h: 40,
  hp: 10, maxHp: 10, atk: 0, xp: 0, speed: 0, frozen: 0, dmgCD: 0, age: 99,
};
rf.enemies.push(near);
rf.player.invincible = 0;
rf.player.shield = 0;
rf.player.thorns = 0;
dmgP(rf, 1);
check('反伤：受伤瞬间弹给贴身敌人', near.hp === 7, `hp=${near.hp}`);

// 嗜血
startGame('jiaran');
const vg = app.gs;
vg.player.vampEvery = 2;
vg.player.hp = 1;
const mkFeed = (id) => ({
  id, x: 300, y: 300, w: 40, h: 40,
  hp: 1, maxHp: 1, atk: 0, xp: 0, speed: 0, frozen: 0, dmgCD: 0, age: 99,
});
const f1 = mkFeed(701);
const f2 = mkFeed(702);
vg.enemies.push(f1, f2);
dmgE(vg, f1, 5);
check('嗜血：没到门槛不回血', vg.player.hp === 1, `hp=${vg.player.hp}`);
dmgE(vg, f2, 5);
check('嗜血：第 2 杀回 1 点', vg.player.hp === 2, `hp=${vg.player.hp}`);

// 追击
startGame('jiaran');
const cg2 = app.gs;
cg2.player.candyChance = 1;
const prey = mkFeed(801);
cg2.enemies.push(prey);
dmgE(cg2, prey, 5);
check('追击：击杀掉出追踪糖果', cg2.specials.some((s) => s.type === 'candy'));

console.log('\n[19] 脚底锚点：碰撞盒 / 枪口 / 朝向');
{
  // p.y 是脚底，碰撞盒必须往**上**长，底边永远贴脚
  const pp = { x: 100, y: 300, w: 40, h: 44 };
  const b = playerBox(pp);
  check('碰撞盒底边贴脚底', b.y + b.h / 2 === pp.y, `bottom=${b.y + b.h / 2} y=${pp.y}`);
  // playerBox 的 y 是**中心**（overlaps 按中心算），顶沿要再减半高
  check('碰撞盒覆盖脚底往上 44px', b.y - b.h / 2 === 300 - 44, `top=${b.y - b.h / 2}`);

  const mz = muzzleOf(pp);
  check('枪口在碰撞盒之上', mz.y <= b.y, `muzzle=${mz.y} boxTop=${b.y}`);
  check('枪口不会高过头顶', mz.y >= pp.y - 132, `muzzle=${mz.y}`);

  // 贝拉技能把 h 撑到 66：盒子往上长，不能往下沉
  const big = { x: 0, y: 300, w: 60, h: 66 };
  check('体型放大后底边仍贴脚底', playerBox(big).y + 33 === 300);
  check('体型放大后枪口不变', muzzleOf(big).y === muzzleOf(pp).y);
}
startGame('jiaran');
app.gs.enemies.length = 0;
app.gs.items.length = 0;
app.gs.spawnTimer = -1e9;
press('ArrowRight');
run(2);
const firstBullet = app.gs.bullets[0];
check(
  '子弹真的从胸口出膛',
  !!firstBullet && Math.abs(firstBullet.y - (app.gs.player.y - MUZZLE_H)) < 1,
  firstBullet ? `by=${firstBullet.y} py=${app.gs.player.y}` : '没出子弹'
);
check('子弹不在脚底高度', !!firstBullet && firstBullet.y < app.gs.player.y - 40);
release('ArrowRight');
check(
  '三套素材都登记了默认朝向',
  ['jiaran', 'bella', 'eileen'].every((k) => SPRITE_SHEETS[k].facing === -1),
  ['jiaran', 'bella', 'eileen'].map((k) => `${k}:${SPRITE_SHEETS[k].facing}`).join(' ')
);

// 接触判定：敌人贴到脚边就该掉血。修复前碰撞盒卡在脚踝、视觉身体在上方，
// 敌人从下方要钻进身体 20px 才算碰到，看起来像"隔空受伤"
startGame('jiaran');
const touchP = app.gs.player;
touchP.invincible = 0;
app.gs.spawnTimer = -1e9;
app.gs.itemTimer = -1e9;
app.gs.enemies.length = 0;
const mkTouchEnemy = (dy) => ({
  id: app.gs.eid++, type: 'frog', x: touchP.x, y: touchP.y + dy,
  w: 40, h: 40, hp: 99, maxHp: 99, atk: 1, xp: 0,
  speed: 0, frozen: 0, dmgCD: 0, age: 99,
});
app.gs.enemies.push(mkTouchEnemy(90));
run(2);
check('隔着一个身位不接触', touchP.hp === touchP.maxHp, `hp=${touchP.hp}`);
app.gs.enemies.length = 0;
app.gs.enemies.push(mkTouchEnemy(10));
run(2);
check('敌人贴到脚边就受伤', touchP.hp < touchP.maxHp, `hp=${touchP.hp}`);

console.log('\n[20] 敌人分级与波次导演');

const {
  PHASES, ELITE_EVERY, phaseAt, hpScaleAt, intervalAt, pickType, tickDirector,
} = await import('../src/game/director.js');

// ── 类型表 ──
check(
  '四种敌人齐备（小兵/快怪/肉盾/精英）',
  ['frog', 'runner', 'brute', 'elite'].every((k) => ENEMY_TYPES[k]),
  Object.keys(ENEMY_TYPES).join(',')
);
check(
  '只有精英打 elite 标记',
  ENEMY_TYPES.elite.tier === 'elite' &&
    ['frog', 'runner', 'brute'].every((k) => ENEMY_TYPES[k].tier === 'normal')
);
check(
  '快怪真的更快、更脆',
  ENEMY_TYPES.runner.speedMax > ENEMY_TYPES.frog.speedMax &&
    ENEMY_TYPES.runner.hp < ENEMY_TYPES.frog.hp,
  `spd ${ENEMY_TYPES.frog.speedMax}→${ENEMY_TYPES.runner.speedMax}`
);
check(
  '肉盾真的更厚、更慢、更大',
  ENEMY_TYPES.brute.hp > ENEMY_TYPES.frog.hp * 3 &&
    ENEMY_TYPES.brute.speedMax < ENEMY_TYPES.frog.speedMin &&
    ENEMY_TYPES.brute.visual > 1,
  `hp ${ENEMY_TYPES.brute.hp} spd ${ENEMY_TYPES.brute.speedMax}`
);
check(
  '四种体型互不相同（一眼能分辨）',
  new Set(['frog', 'runner', 'brute', 'elite'].map((k) => ENEMY_TYPES[k].visual)).size === 4
);
check(
  '三种非小兵各自有独立色相',
  ['runner', 'brute', 'elite'].every((k) => ENEMY_TYPES[k].hue !== 0)
);
check('未知 type 兜底到小兵', enemyType({ type: 'nope' }) === ENEMY_TYPES.frog);
check('空对象也能兜底', enemyType({}) === ENEMY_TYPES.frog);
check(
  '体型系数真的作用到绘制高度',
  enemyDrawH({ type: 'runner' }) < enemyDrawH({ type: 'frog' }) &&
    enemyDrawH({ type: 'elite' }) > enemyDrawH({ type: 'brute' })
);

// ── 步频 ──
check('快怪换帧更密', strideFor(2.6) < strideFor(1.3), `${strideFor(1.3)} vs ${strideFor(2.6)}`);
check('stride 有下限，不会除零', strideFor(0.001) >= 5);
check(
  '敌人带 stride 时按自己的步频取帧',
  enemyFrameIdx({ age: 100, stride: 5 }) === 20 &&
    enemyFrameIdx({ age: 100, stride: 10 }) === 10 &&
    enemyFrameIdx({ age: 100 }) === 10,
  `${enemyFrameIdx({ age: 100, stride: 5 })}/${enemyFrameIdx({ age: 100, stride: 10 })}`
);

// ── 阶段推进 ──
check('0 秒在第一个阶段', phaseAt(0).tag === PHASES[0].tag);
check('300 秒进入最后一阶段', phaseAt(300).at === PHASES[PHASES.length - 1].at);
check('阶段表按时间递增', PHASES.every((p, i) => i === 0 || p.at > PHASES[i - 1].at));
check(
  '阶段推进时刷怪密度单调上升',
  PHASES.every((p, i) => i === 0 || p.interval <= PHASES[i - 1].interval)
);
check(
  '同屏上限单调上升',
  PHASES.every((p, i) => i === 0 || p.cap >= PHASES[i - 1].cap)
);

// ── 难度曲线 ──
check('血量系数随时间上升', hpScaleAt(300) > hpScaleAt(100) && hpScaleAt(100) > hpScaleAt(0));
check('刷怪间隔有下限', intervalAt(9999) >= 26);

// ── 权重刷怪 ──
check('第一阶段只刷小兵', pickType(PHASES[0], () => 0.5) === 'frog');
let seed = 12345;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const latePhase = PHASES[PHASES.length - 1];
let sawRunner = false;
let sawBrute = false;
for (let i = 0; i < 200; i++) {
  const k = pickType(latePhase, rnd);
  if (k === 'runner') sawRunner = true;
  if (k === 'brute') sawBrute = true;
}
check('后期能刷出快怪和肉盾', sawRunner && sawBrute);

// ── 导演节奏 ──
const dgs = { time: 0, spawnTimer: 0, elitesSpawned: 0, enemies: [] };
let earlyElites = 0;
for (let t = 0; t < ELITE_EVERY; t++) {
  dgs.time = t * 60;
  for (const k of tickDirector(dgs, () => 0.5)) if (k === 'elite') earlyElites++;
}
check('前 75 秒不刷精英', earlyElites === 0, `earlyElites=${earlyElites}`);

dgs.time = ELITE_EVERY * 60;
let gotElite = false;
for (const k of tickDirector(dgs, () => 0.5)) if (k === 'elite') gotElite = true;
check('到点刷出一只精英', gotElite);

let dupElite = false;
for (let i = 0; i < 10; i++) {
  for (const k of tickDirector(dgs, () => 0.5)) if (k === 'elite') dupElite = true;
}
check('同一时间点只刷一次精英', !dupElite);

// 调试时把 time 直接跳到 300 秒会差出 4 个节点，不能一帧蹦四只。
// bossesSpawned 拉满是为了把 Boss 排除在外（300 秒同时也是 Boss 节点，
// 会顺带触发精英让位），这一项只验"精英不会一帧蹦四只"
const jumpGs = { time: 300 * 60, spawnTimer: 0, elitesSpawned: 0, bossesSpawned: 99, enemies: [] };
const jumpElites = [];
for (let i = 0; i < 5; i++) {
  for (const k of tickDirector(jumpGs, () => 0.5)) if (k === 'elite') jumpElites.push(k);
}
check('时间跳跃只补一只精英', jumpElites.length === 1, jumpElites.join(','));

const capGs = {
  time: 0,
  spawnTimer: 0,
  elitesSpawned: 0,
  enemies: new Array(PHASES[0].cap).fill({}),
};
const capped = [];
for (let i = 0; i < 400; i++) capped.push(...tickDirector(capGs, () => 0.5));
check(
  '同屏满员后不再刷普通怪',
  capped.filter((k) => k !== 'elite').length === 0,
  capped.join(',')
);

const gapGs = { time: 0, spawnTimer: 0, elitesSpawned: 0, enemies: [] };
let spawns = 0;
for (let i = 0; i < 600; i++) {
  for (const k of tickDirector(gapGs, () => 0.5)) if (k !== 'elite') spawns++;
}
check('10 秒内刷出 6~12 只怪', spawns >= 6 && spawns <= 12, `spawns=${spawns}`);

console.log('\n[21] Boss 与弹幕');

const { BOSS_EVERY: BOSS_GAP } = await import('../src/game/director.js');
const { BOSS_PHASES, bossPhaseIndex, bossPhase } = await import('../src/data/boss.js');

check('Boss 类型已登记', !!ENEMY_TYPES.boss && ENEMY_TYPES.boss.tier === 'boss');
check(
  'Boss 比精英更大更厚',
  ENEMY_TYPES.boss.visual > ENEMY_TYPES.elite.visual &&
    ENEMY_TYPES.boss.hp > ENEMY_TYPES.elite.hp * 3,
  `${ENEMY_TYPES.boss.hp} vs ${ENEMY_TYPES.elite.hp}`
);
check('Boss 的视觉尺寸超过玩家', enemyDrawH({ type: 'boss' }) > FRAME_DRAW_H, `${enemyDrawH({ type: 'boss' })} vs ${FRAME_DRAW_H}`);

// ── 出现时机 ──
const bgs = {
  time: BOSS_GAP * 60,
  spawnTimer: 0,
  elitesSpawned: 99,
  bossesSpawned: 0,
  enemies: [],
};
check('到点刷出 Boss', tickDirector(bgs, () => 0.5).includes('boss'));

// 场上还有 Boss 时不能再来一只，否则"不打"能把三只攒在同一屏
bgs.enemies.push({ tier: 'boss' });
bgs.time = BOSS_GAP * 2 * 60;
check('场上已有 Boss 时不刷第二只', !tickDirector(bgs, () => 0.5).includes('boss'));

bgs.enemies.length = 0;
check('清掉之后才补下一只', tickDirector(bgs, () => 0.5).includes('boss'));

// ── 弹幕 ──
startGame('jiaran');
const bs = app.gs.player;
app.gs.enemies.length = 0;
app.gs.eBullets.length = 0;
app.gs.spawnTimer = -1e9;
app.gs.itemTimer = -1e9;
bs.hp = 5;
bs.invincible = 0;
bs.shield = 0;
bs.thorns = 0;
app.gs.eBullets.push({
  x: bs.x,
  y: bs.y - 22,
  dx: 0,
  dy: 0,
  speed: 0,
  r: 7,
  dmg: 1,
  life: 10,
});
run(2);
check('弹幕命中玩家会扣血', bs.hp === 4, `hp=${bs.hp}`);
check('弹幕命中后被移除', app.gs.eBullets.length === 0);

// ── Boss 真的会开火 ──
startGame('jiaran');
const bg2 = app.gs;
bg2.enemies.length = 0;
bg2.eBullets.length = 0;
bg2.spawnTimer = -1e9;
bg2.itemTimer = -1e9;
bg2.player.hp = 99;
bg2.player.maxHp = 3;
bg2.player.invincible = 1e9;
bg2.enemies.push({
  id: bg2.eid++,
  type: 'boss',
  tier: 'boss',
  x: bg2.player.x + 300,
  y: bg2.player.y - 22,
  w: 96,
  h: 96,
  hp: 999,
  maxHp: 999,
  atk: 1,
  xp: 0,
  speed: 0.8,
  stride: 10,
  flash: 0,
  frozen: 0,
  dmgCD: 0,
  age: 99,
});
// 出场蓄力 80 帧，第 81 帧开火
run(85);
check('Boss 会周期开火', bg2.eBullets.length >= 3, `n=${bg2.eBullets.length}`);
check(
  '弹幕朝玩家方向飞',
  bg2.eBullets.every((b) => b.dx < 0),
  bg2.eBullets.map((b) => b.dx.toFixed(2)).join(',')
);

console.log('\n[21.5] Boss 三阶段');

check(
  '三个阶段齐备且发数是奇数',
  BOSS_PHASES.length === 3 && BOSS_PHASES.every((p) => p.shots >= 3 && p.shots % 2 === 1),
  BOSS_PHASES.map((p) => p.shots).join('/')
);
check(
  '越怒：弹数更多、间隔更短、弹速更快',
  BOSS_PHASES.every(
    (p, i, a) => i === 0 || (p.shots > a[i - 1].shots && p.cd < a[i - 1].cd && p.speed > a[i - 1].speed)
  )
);
check(
  '扇面收窄（发数变多时不会宽到没法躲）',
  BOSS_PHASES.every((p, i, a) => i === 0 || p.spread < a[i - 1].spread)
);
check(
  '血量决定阶段：满血/半血/残血',
  bossPhaseIndex({ hp: 220, maxHp: 220 }) === 0 &&
    bossPhaseIndex({ hp: 110, maxHp: 220 }) === 1 &&
    bossPhaseIndex({ hp: 60, maxHp: 220 }) === 2,
  [220, 110, 60].map((h) => bossPhaseIndex({ hp: h, maxHp: 220 })).join('/')
);
check('没有 maxHp 时兜底到第一阶段', bossPhaseIndex({}) === 0 && bossPhaseIndex(null) === 0);
check('bossPhase 返回的是表里那一行', bossPhase({ hp: 60, maxHp: 220 }) === BOSS_PHASES[2]);

// 跨过 66% 的那一刻必须切阶段 + 出公告 + 停火蓄力
startGame('jiaran');
const bp = app.gs.player;
bp.invincible = 1e9;
bp.pendingLevels = 0;
app.gs.spawnTimer = -1e9;
app.gs.itemTimer = -1e9;
app.gs.enemies.length = 0;
app.gs.eBullets.length = 0;
const mkBoss = (ratio, phase) => {
  const t = ENEMY_TYPES.boss;
  return {
    id: app.gs.eid++, type: 'boss', tier: 'boss',
    x: bp.x + 420, y: bp.y, w: t.w, h: t.h,
    hp: Math.round(t.hp * ratio), maxHp: t.hp, atk: t.atk, xp: t.xp,
    speed: 0.8, frozen: 0, dmgCD: 0, age: 99, fireCD: 0, phase,
  };
};
const bossA = mkBoss(0.5, 0);
app.gs.enemies.push(bossA);
run(2);
check('血量掉到 66% 以下切到二阶段', bossA.phase === 1, `phase=${bossA.phase}`);
check('变招有公告', app.gs.announceText.includes('怒'), app.gs.announceText);
check('变招先停火蓄力', bossA.fireCD > 30, `fireCD=${bossA.fireCD}`);

// 二阶段一次齐射 5 发
bossA.fireCD = 0;
app.gs.eBullets.length = 0;
run(1);
check('二阶段齐射 5 发', app.gs.eBullets.length === 5, `n=${app.gs.eBullets.length}`);

// 三阶段一次齐射 7 发，且 12 帧后补一轮
app.gs.enemies.length = 0;
app.gs.eBullets.length = 0;
const bossB = mkBoss(0.2, 1);
app.gs.enemies.push(bossB);
run(2);
check('血量掉到 33% 以下切到三阶段', bossB.phase === 2, `phase=${bossB.phase}`);
bossB.fireCD = 0;
app.gs.eBullets.length = 0;
run(1);
check('三阶段齐射 7 发', app.gs.eBullets.length === 7, `n=${app.gs.eBullets.length}`);
check('狂怒会排一轮补射', bossB.extraVolley > 0, `extra=${bossB.extraVolley}`);
run(12);
check('补射真的打出来了（7 + 7）', app.gs.eBullets.length === 14, `n=${app.gs.eBullets.length}`);

// 血条要能按阶段换色换名，且在三个状态下都不炸
let barOk = true;
let barMsg = '';
for (const ratio of [1, 0.5, 0.2]) {
  app.gs.enemies.length = 0;
  app.gs.enemies.push(mkBoss(ratio, 0));
  try {
    drawScreens();
  } catch (e) {
    barOk = false;
    barMsg = e.message;
  }
}
check('Boss 血条三阶段都能渲染', barOk, barMsg);

console.log('\n[22] 受击盒：子弹要能打到敌人的整个身体');

// 用一只基准青蛙做标尺：碰撞盒 40 高，视觉 65 高左右
const dummy = { type: 'frog', x: 400, y: 300, w: 40, h: 40 };
const frogHurt = enemyHurtBox(dummy);
const frogFeet = dummy.y + dummy.h / 2;
check('受击盒比碰撞盒高（覆盖全身）', frogHurt.h > dummy.h, `h ${frogHurt.h.toFixed(1)} vs ${dummy.h}`);
check(
  '受击盒底边贴着脚底',
  Math.abs(frogHurt.y + frogHurt.h / 2 - frogFeet) < 0.01,
  `bottom=${(frogHurt.y + frogHurt.h / 2).toFixed(2)} feet=${frogFeet}`
);
check(
  '受击盒顶边盖住头顶',
  frogHurt.y - frogHurt.h / 2 < frogFeet - enemyDrawH(dummy) * 0.75,
  `top=${(frogHurt.y - frogHurt.h / 2).toFixed(1)} 头高≈${(frogFeet - enemyDrawH(dummy) * 0.8).toFixed(1)}`
);
check(
  '受击盒不宽于视觉宽度',
  frogHurt.w > 0 && frogHurt.w < ENEMY_SHEETS.frog.frameW
);

// 直接打一枪验证：子弹停在青蛙**头顶**（碰撞盒之外、受击盒之内）时必须判定命中。
// 修复前子弹会从头顶穿过去，玩家看着明明瞄准了却打不到
startGame('jiaran');
const tallP = app.gs.player;
tallP.invincible = 1e9;
app.gs.spawnTimer = -1e9;
app.gs.itemTimer = -1e9;
app.gs.enemies.length = 0;
tallP.xp = 0;
tallP.pendingLevels = 0;
const tallFrog = {
  id: app.gs.eid++, type: 'frog', x: tallP.x + 150, y: tallP.y,
  w: 40, h: 40, hp: 99, maxHp: 99, atk: 0, xp: 0,
  speed: 0, frozen: 0, dmgCD: 0, age: 99,
};
app.gs.enemies.push(tallFrog);
app.gs.bullets.push({
  x: tallFrog.x,
  // 头顶高度：脚底往上 55。碰撞盒顶只在脚底往上 20，所以这是"打不到的上半身"
  y: tallFrog.y + tallFrog.h / 2 - 55,
  dx: 0, dy: 0, speed: 0, w: 10, h: 10, atk: 1, life: 60,
  tracking: false, pierce: false, hitIds: new Set(),
});
update();
check('子弹打敌人上半身能命中', tallFrog.hp < 99, `hp=${tallFrog.hp}`);

console.log('\n[23] 技能充能节奏');

const { KILL_CHARGE, addSkillCharge } = await import('../src/game/combat.js');

check('小兵击杀不再一次充 1/10 条', KILL_CHARGE <= 5, `KILL_CHARGE=${KILL_CHARGE}`);
const chargeGs = { player: { skillCharge: 0, skillActive: 0 } };
addSkillCharge(chargeGs, { tier: 'normal' });
const normalGain = chargeGs.player.skillCharge;
check('小兵按 KILL_CHARGE 充能', normalGain === KILL_CHARGE, `gain=${normalGain}`);
chargeGs.player.skillCharge = 0;
addSkillCharge(chargeGs, { tier: 'elite' });
check('精英给的充能明显更多', chargeGs.player.skillCharge > normalGain * 2, `gain=${chargeGs.player.skillCharge}`);
chargeGs.player.skillCharge = 0;
addSkillCharge(chargeGs, { tier: 'boss' });
check('Boss 给的充能最多', chargeGs.player.skillCharge > normalGain * 5, `gain=${chargeGs.player.skillCharge}`);
check(
  '充满需要二十多只小兵（不是一发清屏就满）',
  100 / KILL_CHARGE >= 20,
  `需要 ${Math.ceil(100 / KILL_CHARGE)} 杀`
);

console.log('\n[24] 斩杀只对小兵 / 技能弹射程');

check(
  '普通怪可被斩杀',
  canExecute({ type: 'frog', tier: 'normal' }) &&
    canExecute({ type: 'runner', tier: 'normal' }) &&
    canExecute({ type: 'brute', tier: 'normal' })
);
check(
  '精英和 Boss 免疫斩杀',
  !canExecute({ type: 'elite', tier: 'elite' }) && !canExecute({ type: 'boss', tier: 'boss' })
);
check('没写 tier 的老数据按小兵处理', canExecute({ type: 'frog' }) && canExecute({}));
check('null 敌人不会崩', canExecute(null) === false);

// 嘉然技能：追踪弹打精英不秒杀，但按暴击结算、不掉糖果
startGame('jiaran');
const sp1 = app.gs.player;
sp1.invincible = 1e9;
sp1.pendingLevels = 0;
app.gs.spawnTimer = -1e9;
app.gs.itemTimer = -1e9;
app.gs.enemies.length = 0;
app.gs.bullets.length = 0;
app.gs.specials.length = 0;
const eliteE = {
  id: app.gs.eid++, type: 'elite', tier: 'elite', x: sp1.x + 150, y: sp1.y,
  w: 72, h: 72, hp: 52, maxHp: 52, atk: 0, xp: 8,
  speed: 0, frozen: 0, dmgCD: 0, age: 99,
};
app.gs.enemies.push(eliteE);
app.gs.bullets.push({
  x: eliteE.x, y: eliteE.y + eliteE.h / 2 - 40, dx: 1, dy: 0, speed: 0, w: 10, h: 10,
  atk: 2, life: 80, tracking: true, pierce: false, hitIds: new Set(),
  range: 420, traveled: 0, exeCrit: true,
});
run(2);
check(
  '精英免疫追踪弹斩杀，但吃暴击伤害',
  eliteE.hp === 52 - 2 * sp1.critMult,
  `hp=${eliteE.hp} 期望=${52 - 2 * sp1.critMult}`
);
check('打精英不掉糖果', !app.gs.specials.some((s) => s.type === 'candy'));

// 同一条判定下，小兵仍然是秒杀 + 掉糖果（技能爽点保留）
app.gs.enemies.length = 0;
app.gs.specials.length = 0;
const normalE = {
  id: app.gs.eid++, type: 'frog', tier: 'normal', x: sp1.x + 150, y: sp1.y,
  w: 40, h: 40, hp: 3, maxHp: 3, atk: 0, xp: 1,
  speed: 0, frozen: 0, dmgCD: 0, age: 99,
};
app.gs.enemies.push(normalE);
app.gs.bullets.push({
  x: normalE.x, y: normalE.y, dx: 1, dy: 0, speed: 0, w: 10, h: 10,
  atk: 2, life: 80, tracking: true, pierce: false, hitIds: new Set(),
  range: 420, traveled: 0, exeCrit: true,
});
run(2);
check('小兵仍被追踪弹秒杀', !app.gs.enemies.includes(normalE));
check('小兵掉了糖果', app.gs.specials.some((s) => s.type === 'candy'));

// 贝拉撞击：精英不掉血到死，而是一记重击 + 冷却
startGame('bella');
const sp2 = app.gs.player;
sp2.invincible = 1e9;
sp2.skillActive = 600;
sp2.pendingLevels = 0;
app.gs.spawnTimer = -1e9;
app.gs.itemTimer = -1e9;
app.gs.enemies.length = 0;
app.gs.specials.length = 0;
const ramE = {
  id: app.gs.eid++, type: 'elite', tier: 'elite', x: sp2.x + 8, y: playerBox(sp2).y,
  w: 72, h: 72, hp: 52, maxHp: 52, atk: 0, xp: 8,
  speed: 0, frozen: 0, dmgCD: 0, age: 99,
};
app.gs.enemies.push(ramE);
run(3);
check('精英不会被撞击秒杀', app.gs.enemies.includes(ramE) && ramE.hp < 52, `hp=${ramE.hp}`);
check('撞击精英有伤害（不是免疫到零）', ramE.hp <= 52 - sp2.atk * 3, `hp=${ramE.hp} atk=${sp2.atk}`);

// 贝拉技能弹：走真实生成路径，必须带暴击标记，打精英不秒杀但吃暴击
startGame('bella');
const sp4 = app.gs.player;
sp4.invincible = 1e9;
sp4.skillActive = 600;
sp4.critChance = 0; // 关掉随机暴击，断言才稳定
sp4.pendingLevels = 0;
app.gs.spawnTimer = -1e9;
app.gs.itemTimer = -1e9;
app.gs.enemies.length = 0;
app.gs.bullets.length = 0;
press('ArrowRight');
run(1);
const skillShot = app.gs.bullets[0];
release('ArrowRight');
check('贝拉技能弹带暴击标记', !!skillShot && skillShot.exeCrit === true);

app.gs.bullets.length = 0;
const bellaElite = {
  id: app.gs.eid++, type: 'elite', tier: 'elite', x: sp4.x + 150, y: sp4.y,
  w: 72, h: 72, hp: 52, maxHp: 52, atk: 0, xp: 8,
  speed: 0, frozen: 0, dmgCD: 0, age: 99,
};
app.gs.enemies.push(bellaElite);
app.gs.bullets.push({
  ...skillShot, x: bellaElite.x, y: bellaElite.y, speed: 0, hitIds: new Set(), traveled: 0,
});
run(2);
check(
  '贝拉技能弹打精英按暴击结算',
  bellaElite.hp === 52 - sp4.atk * sp4.critMult,
  `hp=${bellaElite.hp} 期望=${52 - sp4.atk * sp4.critMult}`
);

// 技能结束后同样的子弹不该再暴击：暴击是"技能期间"的特权
app.gs.enemies.length = 0;
app.gs.bullets.length = 0;
const plainElite = {
  id: app.gs.eid++, type: 'elite', tier: 'elite', x: sp4.x + 150, y: sp4.y,
  w: 72, h: 72, hp: 52, maxHp: 52, atk: 0, xp: 8,
  speed: 0, frozen: 0, dmgCD: 0, age: 99,
};
app.gs.enemies.push(plainElite);
app.gs.bullets.push({
  ...skillShot, x: plainElite.x, y: plainElite.y, speed: 0, hitIds: new Set(),
  traveled: 0, exeCrit: false,
});
run(2);
check(
  '非技能弹打精英只有普通伤害',
  plainElite.hp === 52 - sp4.atk,
  `hp=${plainElite.hp} 期望=${52 - sp4.atk}`
);

// 乃琳的技能弹不参与这条规则：她的技能是"四向穿透"，本来就没有斩杀设定
startGame('eileen');
const sp5 = app.gs.player;
sp5.invincible = 1e9;
sp5.skillActive = 600;
sp5.pendingLevels = 0;
app.gs.spawnTimer = -1e9;
app.gs.itemTimer = -1e9;
app.gs.enemies.length = 0;
app.gs.bullets.length = 0;
press('ArrowRight');
run(1);
release('ArrowRight');
check(
  '乃琳技能弹不带暴击标记',
  app.gs.bullets.length > 0 && app.gs.bullets.every((b) => !b.exeCrit),
  `n=${app.gs.bullets.length}`
);

// 技能弹射程：走完就消失，不会满场飞
startGame('jiaran');
const sp3 = app.gs.player;
sp3.invincible = 1e9;
app.gs.spawnTimer = -1e9;
app.gs.itemTimer = -1e9;
app.gs.enemies.length = 0;
app.gs.bullets.length = 0;
app.gs.bullets.push({
  x: sp3.x, y: sp3.y, dx: 1, dy: 0, speed: 7, w: 10, h: 10,
  atk: 1, life: 999, tracking: false, pierce: false, hitIds: new Set(),
  range: 21, traveled: 0,
});
run(4);
check('追踪弹走完射程就消失', app.gs.bullets.length === 0, `left=${app.gs.bullets.length}`);

app.gs.bullets.push({
  x: sp3.x, y: sp3.y, dx: 1, dy: 0, speed: 7, w: 10, h: 10,
  atk: 1, life: 999, tracking: false, pierce: false, hitIds: new Set(),
  range: 0, traveled: 0,
});
run(4);
check('普通弹不受射程字段影响', app.gs.bullets.length === 1);

console.log('\n[25] 入口模块可完整加载');
let mainOk = true;
try {
  await import('../src/main.js');
} catch (e) {
  mainOk = false;
  console.log('      ' + e.message);
}
check('main.js 依赖图完整', mainOk);

console.log('\n[26] 版本号三处一致');
// 版本号曾经分裂成"项目版本 0.7.0"和"需求编号 0.16.0"两个数字，
// 而 ?v= 是击穿缓存的唯一手段，写错就等于改了代码用户还是跑旧的。
// 唯一真值在 src/data/version.js，HTML 里两处必须跟着它走 —— 这里替人盯住。
const { VERSION } = await import('../src/data/version.js');
const htmlSrc = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
check('version.js 导出的是 1.1', VERSION === '1.1', `VERSION=${VERSION}`);
check(
  '<title> 里的版本号与 version.js 一致',
  htmlSrc.includes(`一个魂的试炼 ${VERSION}`)
);
check(
  'main.js 的 ?v= 与 version.js 一致',
  htmlSrc.includes(`src/main.js?v=${VERSION}`),
  '标题改了但查询串忘了改，线上会继续吃旧缓存'
);
check('index.html 里没有残留的旧版本号', !/0\.16\.0|试炼 0\.7\.0/.test(htmlSrc));

console.log('\n[27] 加载闸门：图片没就位就不撤加载层');
const { preloadImages } = await import('../src/gfx/preload.js');
const { IMGS } = await import('../src/gfx/assets.js');

// 成功路径：桩里的 Image 一创建就是 complete + naturalWidth>0
const progress = [];
const preOk = await preloadImages((p) => progress.push(p.done));
check('全部成功时 ok 为真且没有失败项', preOk.ok && preOk.failed.length === 0, `failed=${preOk.failed.join(',')}`);
check('进度回调次数等于图片数', progress.length === preOk.total, `${progress.length}/${preOk.total}`);
check(
  '进度单调递增并停在 total',
  progress[progress.length - 1] === preOk.total && progress.every((v, i) => i === 0 || v >= progress[i - 1]),
  progress.join(',')
);

// 失败路径：complete 为真但 naturalWidth 是 0 —— 这就是"图 404 了"在浏览器里的样子。
// 只看 complete 会把它当好图放过去，等人发现时缺的是角色立绘
IMGS.__broken = { complete: true, naturalWidth: 0, naturalHeight: 0 };
const preBad = await preloadImages();
delete IMGS.__broken;
check('坏图记为失败而不是放行', preBad.failed.includes('__broken') && !preBad.ok, `failed=${preBad.failed.join(',')}`);

console.log('\n[28] Boss 与精英不同帧登场');
const { ELITE_HOLD_AFTER_BOSS: HOLD } = await import('../src/game/director.js');

// 150 秒整：精英节点和 Boss 节点落在同一帧（75 与 150 是整数倍关系）
const clashGs = {
  time: BOSS_GAP * 60, spawnTimer: 0, elitesSpawned: 1, bossesSpawned: 0,
  enemies: [], eliteHold: 0,
};
const clash = tickDirector(clashGs, () => 0.5);
check('撞车帧只出 Boss、不出精英', clash.includes('boss') && !clash.includes('elite'), clash.join(','));
check('撞车后精英进入让位期', clashGs.eliteHold === HOLD, `hold=${clashGs.eliteHold}`);

let earlyElite = 0;
for (let i = 0; i < HOLD - 1; i++) if (tickDirector(clashGs, () => 0.5).includes('elite')) earlyElite++;
check('让位期内不刷精英', earlyElite === 0, `n=${earlyElite}`);

let lateElite = false;
for (let i = 0; i < 4; i++) if (tickDirector(clashGs, () => 0.5).includes('elite')) lateElite = true;
check('让位期结束后补上被推迟的精英', lateElite);
check('欠的节点没丢：elitesSpawned 追到 2', clashGs.elitesSpawned === 2, `spawned=${clashGs.elitesSpawned}`);

// 反过来：Boss 因为场上已有一只而没刷出来时，不该连累精英一起停手
const busyGs = {
  time: BOSS_GAP * 60, spawnTimer: 0, elitesSpawned: 1, bossesSpawned: 0,
  enemies: [{ tier: 'boss' }], eliteHold: 0,
};
const busy = tickDirector(busyGs, () => 0.5);
check('Boss 在场导致本轮不刷 Boss 时，精英照常登场', busy.includes('elite') && !busy.includes('boss'), busy.join(','));
check('没刷 Boss 就不该产生让位期', !busyGs.eliteHold, `hold=${busyGs.eliteHold}`);

// 长跑：让位只是推迟，不能让节点消失，也不能再撞车
const longGs = {
  time: 0, spawnTimer: 0, elitesSpawned: 0, bossesSpawned: 0,
  enemies: [], eliteHold: 0,
};
let longElites = 0;
let longBosses = 0;
let sameFrame = 0;
for (let t = 0; t < 320 * 60; t++) {
  longGs.time = t;
  const out = tickDirector(longGs, () => 0.5);
  if (out.includes('elite')) longElites++;
  if (out.includes('boss')) longBosses++;
  if (out.includes('elite') && out.includes('boss')) sameFrame++;
}
check('320 秒内 4 个精英节点一个不丢', longElites === 4, `elites=${longElites}`);
check('320 秒内 2 个 Boss 节点一个不丢', longBosses === 2, `bosses=${longBosses}`);
check('全程没有一帧同时刷精英和 Boss', sameFrame === 0, `sameFrame=${sameFrame}`);

console.log('\n[29] 护体规则：同一时刻只有一个');
const G = await import('../src/game/guard.js');

/** 造一个"裸装"玩家，只带 guard.js 关心的字段 */
function barePlayer() {
  return { invincible: 0, skillGuard: 0, shield: 0, thorns: 0, thornCharges: 0, god: 0 };
}

const gp1 = barePlayer();
check('裸装没有任何护体', G.guardKind(gp1) === null);
G.grantGuard(gp1, 'shield');
check('护盾 10 秒生效', G.guardKind(gp1) === 'shield' && gp1.shield === G.SHIELD_FRAMES);
G.grantGuard(gp1, 'thorns');
check(
  '捡到荆棘顶掉护盾（互斥，不是叠加）',
  gp1.shield === 0 && gp1.thornCharges === G.THORN_CHARGES && G.guardKind(gp1) === 'thorns'
);
G.grantGuard(gp1, 'shield');
check('捡到护盾顶掉荆棘（含耐久清零）', gp1.thorns === 0 && gp1.thornCharges === 0);

const gp2 = barePlayer();
G.grantGuard(gp2, 'skill');
check('技能护体 13 秒', gp2.skillGuard === G.SKILL_GUARD_FRAMES);
check(
  '技能护体期间护盾吃不下（道具应留在地上）',
  G.grantGuard(gp2, 'shield') === false && gp2.shield === 0
);
check('技能护体期间荆棘同样吃不下', G.grantGuard(gp2, 'thorns') === false && gp2.thorns === 0);

const gp3 = barePlayer();
G.grantGuard(gp3, 'shield');
G.grantGuard(gp3, 'skill');
check('开技能会清掉身上的护盾', gp3.shield === 0 && G.guardKind(gp3) === 'skill');

const gp4 = barePlayer();
G.grantGuard(gp4, 'thorns');
check('荆棘初始 4 层耐久', gp4.thornCharges === G.THORN_CHARGES);
G.consumeThorn(gp4);
G.consumeThorn(gp4);
G.consumeThorn(gp4);
check('挡 3 次还剩 1 层、三角还在', gp4.thornCharges === 1 && gp4.thorns > 0);
G.consumeThorn(gp4);
check('耐久打光时三角一起消失', gp4.thornCharges === 0 && gp4.thorns === 0 && G.guardKind(gp4) === null);

// HUD 用 lastingGuard：荆棘格挡后的 20 帧无敌不该让图标闪掉
const gp5 = barePlayer();
G.grantGuard(gp5, 'thorns');
gp5.invincible = G.THORN_IFRAMES;
check('格挡无敌帧内 guardKind 是无敌帧', G.guardKind(gp5) === 'iframe');
check('但 HUD 看到的仍是荆棘（不会闪）', G.lastingGuard(gp5) === 'thorns');
check('hasGuard 能回答"有没有护体"', G.hasGuard(gp5) === true && G.hasGuard(barePlayer()) === false);

// ── 接到真实流程里验一遍 ──
startGame('jiaran');
const rp = app.gs.player;
rp.hp = 3;
rp.shield = G.SHIELD_FRAMES;
damagePlayer(app.gs, 1);
check('护盾期间挨打不掉血', rp.hp === 3 && rp.shield > 0);

startGame('jiaran');
const tp = app.gs.player;
tp.hp = 3;
G.grantGuard(tp, 'thorns');
damagePlayer(app.gs, 1);
check('荆棘挡下第一下：不掉血', tp.hp === 3);
check('挡完少一层', tp.thornCharges === 3, `charges=${tp.thornCharges}`);
check('格挡后 1 秒无敌（挡一次真的换到脱身机会）', tp.invincible === G.THORN_IFRAMES && G.THORN_IFRAMES === 60);
damagePlayer(app.gs, 1);
check('间隔内再挨打不扣耐久', tp.thornCharges === 3);

tp.invincible = 0; damagePlayer(app.gs, 1);
tp.invincible = 0; damagePlayer(app.gs, 1);
tp.invincible = 0; damagePlayer(app.gs, 1);
check('第 4 次挡完荆棘消失', tp.thornCharges === 0 && tp.thorns === 0);
tp.invincible = 0;
const tpHp = tp.hp;
damagePlayer(app.gs, 1);
check('荆棘打光后开始掉血', tp.hp === tpHp - 1, `hp=${tp.hp}`);

// 技能护体不再借 invincible：否则整段技能都在放受击姿势、还一直闪
startGame('jiaran');
const skillP = app.gs.player;
skillP.skillCharge = 100;
activateSkill();
check(
  '技能护体走独立字段，不再污染 invincible',
  skillP.skillGuard === 780 && skillP.invincible === 0
);

// 拾取：技能护体期间护盾道具必须留在地上（applyItem 返回 false 就不 splice）
startGame('jiaran');
const pickP = app.gs.player;
pickP.skillGuard = 780;
app.gs.items.length = 0;
const box = playerBox(pickP);
app.gs.items.push({ x: box.x, y: box.y, w: 30, h: 30, type: 'shield' });
app.gs.player.pendingLevels = 0;
update();
check(
  '技能护体期间护盾道具不会被吃掉',
  app.gs.items.length === 1 && pickP.shield === 0,
  `items=${app.gs.items.length} shield=${pickP.shield}`
);

startGame('jiaran');
const pickQ = app.gs.player;
app.gs.items.length = 0;
const boxQ = playerBox(pickQ);
app.gs.items.push({ x: boxQ.x, y: boxQ.y, w: 30, h: 30, type: 'thorns' });
app.gs.player.pendingLevels = 0;
update();
check(
  '平时捡荆棘：道具被吃掉且带 4 层耐久',
  app.gs.items.length === 0 && pickQ.thornCharges === G.THORN_CHARGES,
  `items=${app.gs.items.length} charges=${pickQ.thornCharges}`
);

// ── 荆棘的攻击：范围比原来大、伤害翻倍（2026-10-26 用户要求）──
const { playerCenterY: centerY } = await import('../src/data/appearance.js');
check(
  '三角环半径与命中半径都放大了（范围增大）',
  G.THORN_RING >= 1.4 && G.THORN_REACH > 0.4 && G.THORN_SIZE >= 0.6,
  `ring=${G.THORN_RING} reach=${G.THORN_REACH} size=${G.THORN_SIZE}`
);
check('荆棘伤害从 2 提到 4', G.THORN_DMG === 4, `dmg=${G.THORN_DMG}`);

startGame('jiaran');
const thGs = app.gs;
const thP = thGs.player;
thP.god = 1; // 只测荆棘，别让接触伤害干扰
thP.hp = thP.maxHp;
thGs.spawnTimer = 1e9; // 逼出真实的一只怪（字段齐全，免得手搓对象缺 stride/age）
thGs.itemTimer = -1e9;
run(2);
thGs.enemies.length = Math.min(thGs.enemies.length, 1);
const foe = thGs.enemies[0];
foe.hp = foe.maxHp = 100;
foe.dmgCD = 0;
G.grantGuard(thP, 'thorns');
// 三角按 gs.frame*0.04 转，而 update 会先把 frame +1，所以按下一帧的角度摆位
const ring = thP.w * G.THORN_RING;
const putOnTriangle = () => {
  const ang = (thGs.frame + 1) * 0.04;
  foe.x = thP.x + Math.cos(ang) * ring;
  foe.y = centerY(thP) + Math.sin(ang) * ring;
};
putOnTriangle();
update();
check(
  '站在三角上会被荆棘打伤，伤害等于 THORN_DMG',
  foe.hp === 100 - G.THORN_DMG,
  `hp=${foe.hp}`
);

// 再远一格就不该命中：说明"范围"是有边界的，不是全屏
foe.hp = 100;
foe.dmgCD = 0;
foe.x = thP.x + ring * 2.4;
foe.y = centerY(thP);
update();
check('离得远就不吃荆棘伤害', foe.hp === 100, `hp=${foe.hp}`);

console.log('\n[30] 调试面板');
const D = await import('../src/ui/debug.js');
check('默认关闭，不影响正式玩法', D.DEBUG.on === false);
check('关闭时热键不响应', D.handleDebugKey('F3') === false);

D.DEBUG.on = true;
startGame('jiaran');
const dbgGs = app.gs;
dbgGs.time = 0;
check('F1 把时间拨到下一个阶段起点', D.handleDebugKey('F1') === true && dbgGs.time === 50 * 60, `time=${dbgGs.time}`);

dbgGs.player.pendingLevels = 0;
dbgGs.player.xp = 0;
D.handleDebugKey('F2');
check('F2 加满经验并产生待选卡', dbgGs.player.pendingLevels >= 1, `pending=${dbgGs.player.pendingLevels}`);

D.handleDebugKey('F3');
const godOn = dbgGs.player.god;
D.handleDebugKey('F3');
check(
  'F3 是开关（开→关）',
  godOn === 1 && dbgGs.player.god === 0
);
dbgGs.player.god = 1;
check('god 模式下不掉血', damagePlayer(dbgGs, 99) === false && dbgGs.player.hp === dbgGs.player.maxHp);
dbgGs.player.god = 0;

dbgGs.enemies.length = 0;
const { ENEMY_TYPES: ET2 } = await import('../src/data/enemies.js');
dbgGs.enemies.push({ ...ET2.frog, x: 100, y: 100, hp: 3, maxHp: 3, w: 30, h: 30, type: 'frog' });
dbgGs.eBullets.push({ x: 0, y: 0, dx: 1, dy: 0, speed: 1, r: 7, life: 60, dmg: 1 });
D.handleDebugKey('F4');
check('F4 清屏：敌人和敌弹都清空', dbgGs.enemies.length === 0 && dbgGs.eBullets.length === 0);

let drawOk = true;
try {
  D.drawDebug();
  const keep = app.gs;
  app.gs = null;
  D.drawDebug(); // 标题页也要能画，不能因为没对局就崩
  app.gs = keep;
} catch (e) {
  drawOk = false;
  console.log('      ' + e.message);
}
check('drawDebug 在有对局 / 无对局两种情况下都不炸', drawOk);

console.log('\n[31] 种子复现与 URL 参数');
const R = await import('../src/core/rng.js');
R.rng.seed(4242);
const seqA = [R.rng.next(), R.rng.next(), R.rng.next()];
R.rng.seed(4242);
const seqB = [R.rng.next(), R.rng.next(), R.rng.next()];
check('同一个 seed 出同一串随机数', seqA.join(',') === seqB.join(','));
check('rng.value 记住当前种子', R.rng.value === 4242);
R.rng.seed(4243);
check('换一个 seed 就换一串', R.rng.next() !== seqA[0]);

// 导演层复现：同 seed 两次跑同一段时间，刷怪类型序列必须一模一样。
// 从 100 秒起跑——前 50 秒的权重表里只有青蛙，不管什么种子都是同一个序列，
// 拿那一段测"种子有没有生效"会得到假阳性
function spawnSeq(seed) {
  R.rng.seed(seed);
  const g = { time: 0, spawnTimer: 0, elitesSpawned: 0, bossesSpawned: 0, enemies: [], eliteHold: 0 };
  const out = [];
  for (let t = 100 * 60; t < 140 * 60; t++) {
    g.time = t;
    out.push(...tickDirector(g, () => R.rng.next()));
  }
  return out.join(',');
}
const runA = spawnSeq(777);
const runB = spawnSeq(777);
const runC = spawnSeq(778);
check('同 seed 两次开局刷怪序列一致', runA === runB);
check('不同 seed 序列不同', runA !== runC, '种子没起作用，等于没法复现');

// ?seed= / ?debug= 解析：换一个模块实例（带查询串）绕开缓存，喂一个假 location
globalThis.location = { search: '?debug=1&seed=777' };
const probeOn = (await import('../src/core/params.js?probe=1')).PARAMS;
check('?debug=1 被识别', probeOn.debug === true);
check('?seed=777 被识别', probeOn.seed === 777);
globalThis.location = { search: '?seed=-5' };
const probeBad = (await import('../src/core/params.js?probe=2')).PARAMS;
check('非法 seed 当没有（负数不能悄悄生效）', probeBad.seed === null);
delete globalThis.location;
const probeNone = (await import('../src/core/params.js?probe=3')).PARAMS;
check('没有查询串时安全降级', probeNone.debug === false && probeNone.seed === null);

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
