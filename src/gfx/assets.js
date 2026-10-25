import { SETTINGS } from '../data/settings.js';
import { SPRITE_SHEETS } from '../data/sprites.js';
import { ENEMY_SHEETS } from '../data/enemies.js';

// ==================== 图片 ====================
export const IMGS = {};
const IMG_LIST = [
  ['jiaran', 'assets/character/diana-1.jpg'],
  ['bella', 'assets/character/bella-1.jpg'],
  ['eileen', 'assets/character/eileen-1.jpg'],
  ['enemy', 'assets/character/enemy-1.jpg'],
  ['b_jiaran', 'assets/THEWORLD/jiaran-1.jpg'],
  ['b_bella', 'assets/THEWORLD/beila-1.jpg'],
  ['b_eileen', 'assets/THEWORLD/nailin-1.jpg'],
  ['background', 'assets/background/background-1.png'],
];
// 序列帧表按登记表自动挂上，加角色/敌人只改各自的 data 表一处
for (const s of Object.values(SPRITE_SHEETS)) IMG_LIST.push([s.key, s.src]);
for (const s of Object.values(ENEMY_SHEETS)) IMG_LIST.push([s.key, s.src]);

IMG_LIST.forEach(([key, src]) => {
  const img = new Image();
  img.src = src;
  IMGS[key] = img;
});

// ==================== 技能语音 ====================
export const SKILL_AUDIO = {
  jiaran: 'assets/audio/diana-skill-1.mp3',
  bella: 'assets/audio/bella-skill-1.mp3',
  eileen: 'assets/audio/eileen-skill-1.mp3',
};

const AUDIOS = {};
Object.entries(SKILL_AUDIO).forEach(([key, src]) => {
  const audio = new Audio(src);
  audio.preload = 'auto';
  AUDIOS[key] = audio;
});

// ==================== 音效合成 ====================
let audioCtx = null;

/**
 * 射击音效的上次播放时刻（performance.now，毫秒）。
 *
 * 为什么要限流：射速卡叠满后能到 15 发/秒，同一个 70ms 短音连播 15 次
 * 在听觉上不是"连射"，而是一堵噪音墙——而且完全盖住了命中音、技能音。
 * 用一个最小间隔兜住："听起来还在连射，但不再是机关枪"。
 */
let lastShootAt = -1e9;
const SHOOT_MIN_GAP = 100;

function getAC() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
  }
  return audioCtx;
}

function playTone({ type = 'square', freq = 440, freqEnd = null, dur = 0.1, vol = 0.3, atk = 0.005 } = {}) {
  if (!SETTINGS.sfx) return;
  const v = vol * SETTINGS.volume;
  try {
    const ac = getAC();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ac.currentTime);
    if (freqEnd !== null) osc.frequency.linearRampToValueAtTime(freqEnd, ac.currentTime + dur);
    gain.gain.setValueAtTime(0, ac.currentTime);
    gain.gain.linearRampToValueAtTime(v, ac.currentTime + atk);
    gain.gain.setValueAtTime(v, ac.currentTime + dur - 0.01);
    gain.gain.linearRampToValueAtTime(0, ac.currentTime + dur + 0.02);
    osc.start(ac.currentTime);
    osc.stop(ac.currentTime + dur + 0.05);
  } catch (e) {
    /* 音频未解锁时静默 */
  }
}

function playNoise({ dur = 0.15, vol = 0.25 } = {}) {
  if (!SETTINGS.sfx) return;
  const v = vol * SETTINGS.volume;
  try {
    const ac = getAC();
    const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    const gain = ac.createGain();
    gain.gain.setValueAtTime(v, ac.currentTime);
    gain.gain.linearRampToValueAtTime(0, ac.currentTime + dur);
    src.buffer = buf;
    src.connect(gain);
    gain.connect(ac.destination);
    src.start();
  } catch (e) {
    /* 同上 */
  }
}

function arp(freqs, opts, gap) {
  freqs.forEach((f, i) => setTimeout(() => playTone({ ...opts, freq: f }), i * gap));
}

export const SFX = {
  /**
   * 射击。三层改动，专治"听多了枯燥"：
   *
   *   1. **换波形**：square（方波）的奇次谐波很硬，单发清脆、连射刺耳；
   *      换成 triangle，攻击性立刻降一半。
   *   2. **降音量**：0.18 → 0.09。射击是最高频的声音，它不需要"抓耳"，
   *      只需要告诉玩家"子弹出去了"。把响度预算留给命中、击杀、技能。
   *   3. **音高抖动**：每发 ±7% 随机。人对**完全相同**的重复音特别敏感
   *      （听觉适应），微小的音高差会让连射听起来像"一串"而不是"同一个音在敲"。
   *
   * 外加 100ms 最小间隔，射速堆到 15 发/秒时最多听到 10 次。
   */
  shoot: () => {
    const now = performance.now();
    if (now - lastShootAt < SHOOT_MIN_GAP) return;
    lastShootAt = now;
    const j = 0.93 + Math.random() * 0.14;
    playTone({ type: 'triangle', freq: 700 * j, freqEnd: 300 * j, dur: 0.055, vol: 0.09 });
  },
  hit: () => playTone({ type: 'sawtooth', freq: 220, freqEnd: 80, dur: 0.12, vol: 0.22 }),
  enemyDie: () => {
    playNoise({ dur: 0.18, vol: 0.28 });
    playTone({ type: 'sine', freq: 300, freqEnd: 80, dur: 0.2, vol: 0.12 });
  },
  playerHit: () => {
    playNoise({ dur: 0.12, vol: 0.4 });
    playTone({ type: 'sawtooth', freq: 150, freqEnd: 60, dur: 0.25, vol: 0.32 });
  },
  heal: () => arp([523, 659, 784], { type: 'sine', dur: 0.1, vol: 0.2 }, 100),
  bomb: () => {
    playNoise({ dur: 0.45, vol: 0.5 });
    playTone({ type: 'sawtooth', freq: 100, freqEnd: 30, dur: 0.45, vol: 0.38 });
  },
  shield: () => arp([784, 880, 1047], { type: 'sine', dur: 0.12, vol: 0.2 }, 70),
  thorns: () => arp([330, 392, 330], { type: 'square', dur: 0.1, vol: 0.18 }, 70),
  skillReady: () => playTone({ type: 'sine', freq: 1047, freqEnd: 1568, dur: 0.35, vol: 0.3 }),
  skillUse: () => arp([1047, 1319, 1568, 2093], { type: 'sine', dur: 0.15, vol: 0.28 }, 55),
  candy: () => playTone({ type: 'sine', freq: 1200, freqEnd: 600, dur: 0.15, vol: 0.22 }),
  star: () => arp([1568, 1319, 1047], { type: 'sine', dur: 0.1, vol: 0.18 }, 65),
  icecream: () => playTone({ type: 'sine', freq: 440, freqEnd: 220, dur: 0.3, vol: 0.2 }),
  gameOver: () => arp([440, 330, 220, 110], { type: 'sawtooth', dur: 0.3, vol: 0.28 }, 140),
  /**
   * 精英出场：低频 + 一个上扬的短句。
   * 混战里玩家的视觉全被弹幕占满，靠"听觉换挡"才注意得到"大怪来了"。
   */
  eliteAppear: () => {
    playTone({ type: 'sawtooth', freq: 110, freqEnd: 70, dur: 0.4, vol: 0.3 });
    arp([330, 494], { type: 'triangle', dur: 0.16, vol: 0.24 }, 110);
  },
  /** 精英倒下：比普通击杀更高更亮，是"这一波过去了"的奖励感 */
  eliteDown: () => {
    playNoise({ dur: 0.35, vol: 0.35 });
    arp([784, 988, 1319], { type: 'triangle', dur: 0.16, vol: 0.26 }, 70);
  },
  /** Boss 开火：低频"咚"+ 上滑，和玩家自己射击的清脆声完全分开 */
  bossShot: () => {
    playTone({ type: 'sawtooth', freq: 160, freqEnd: 90, dur: 0.18, vol: 0.22 });
  },
  /** Boss 出场：比精英更重、更长，玩家不看屏幕也知道"大的来了" */
  bossAppear: () => {
    playTone({ type: 'sawtooth', freq: 80, freqEnd: 50, dur: 0.7, vol: 0.34 });
    arp([262, 196], { type: 'triangle', dur: 0.24, vol: 0.26 }, 180);
  },
  /**
   * Boss 换阶段：**上滑**的低吼 + 一层噪声。
   * 出场音是下滑（"压下来"），换阶段是上滑（"又爬起来一截"），
   * 两者方向相反，玩家不用看血条也能分辨"新来了一个"还是"同一个变强了"
   */
  bossRage: () => {
    playNoise({ dur: 0.4, vol: 0.3 });
    playTone({ type: 'sawtooth', freq: 110, freqEnd: 240, dur: 0.45, vol: 0.3 });
    arp([392, 523], { type: 'triangle', dur: 0.14, vol: 0.22 }, 110);
  },
  /** Boss 倒下：长音 + 尾音上扬，是"这一关过去了" */
  bossDown: () => {
    playNoise({ dur: 0.6, vol: 0.4 });
    arp([523, 659, 784, 1047, 1319], { type: 'triangle', dur: 0.2, vol: 0.28 }, 90);
  },
  levelUp: () => arp([659, 784, 988, 1319], { type: 'triangle', dur: 0.14, vol: 0.24 }, 60),
  cardPick: () => arp([880, 1175], { type: 'triangle', dur: 0.1, vol: 0.22 }, 70),
  select: () => playTone({ type: 'sine', freq: 660, dur: 0.07, vol: 0.15 }),
  confirm: () => arp([523, 659], { type: 'sine', dur: 0.1, vol: 0.2 }, 80),
  skillAudio: (charKey) => {
    const audio = AUDIOS[charKey];
    if (!audio) return;
    audio.volume = Math.max(0, Math.min(1, SETTINGS.volume));
    audio.currentTime = 0;
    const p = audio.play();
    if (p && p.catch) p.catch(() => {});
  },
};
