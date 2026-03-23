'use strict';
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

// ==================== IMAGES ====================
const IMGS = {};
[['jiaran',   'assets/character/diana-1.jpg'],
 ['bella',    'assets/character/bella-1.jpg'],
 ['eileen',   'assets/character/eileen-1.jpg'],
 ['enemy',    'assets/character/enemy-1.jpg'],
 ['b_jiaran', 'assets/THEWORLD/jiaran-1.jpg'],
 ['b_bella',  'assets/THEWORLD/beila-1.jpg'],
 ['b_eileen', 'assets/THEWORLD/nailin-1.jpg'],
].forEach(([k, src]) => { IMGS[k] = new Image(); IMGS[k].src = src; });

// ==================== CHARACTERS ====================
const CHARS = {
  jiaran: { name: '嘉然', imgKey: 'jiaran', bannerKey: 'b_jiaran',
            desc: '追踪子弹·糖果连爆', atk: 1, speed: 3, hp: 3 },
  bella:  { name: '贝拉', imgKey: 'bella',  bannerKey: 'b_bella',
            desc: '体型速度UP·星星引力', atk: 1, speed: 3, hp: 3 },
  eileen: { name: '乃琳', imgKey: 'eileen', bannerKey: 'b_eileen',
            desc: '激光穿透·冰淇淋冻结', atk: 1, speed: 3, hp: 3 },
};
const CHAR_KEYS = ['jiaran', 'bella', 'eileen'];

// ==================== AUDIO ====================
let audioCtx = null;
function getAC() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function playTone({ type='square', freq=440, freqEnd=null, dur=0.1, vol=0.3, atk=0.005 }={}) {
  try {
    const ac = getAC();
    const osc = ac.createOscillator(), g = ac.createGain();
    osc.connect(g); g.connect(ac.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ac.currentTime);
    if (freqEnd !== null) osc.frequency.linearRampToValueAtTime(freqEnd, ac.currentTime + dur);
    g.gain.setValueAtTime(0, ac.currentTime);
    g.gain.linearRampToValueAtTime(vol, ac.currentTime + atk);
    g.gain.setValueAtTime(vol, ac.currentTime + dur - 0.01);
    g.gain.linearRampToValueAtTime(0, ac.currentTime + dur + 0.02);
    osc.start(ac.currentTime); osc.stop(ac.currentTime + dur + 0.05);
  } catch(e) {}
}
function playNoise({ dur=0.15, vol=0.25 }={}) {
  try {
    const ac = getAC();
    const buf = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource(), g = ac.createGain();
    g.gain.setValueAtTime(vol, ac.currentTime);
    g.gain.linearRampToValueAtTime(0, ac.currentTime + dur);
    src.buffer = buf; src.connect(g); g.connect(ac.destination); src.start();
  } catch(e) {}
}
const SFX = {
  shoot:      () => playTone({ type:'square', freq:880, freqEnd:440, dur:0.07, vol:0.18 }),
  hit:        () => playTone({ type:'sawtooth', freq:220, freqEnd:80, dur:0.12, vol:0.22 }),
  enemyDie:   () => { playNoise({ dur:0.18, vol:0.28 }); playTone({ type:'sine', freq:300, freqEnd:80, dur:0.2, vol:0.12 }); },
  playerHit:  () => { playNoise({ dur:0.12, vol:0.4 }); playTone({ type:'sawtooth', freq:150, freqEnd:60, dur:0.25, vol:0.32 }); },
  heal:       () => [523,659,784].forEach((f,i) => setTimeout(() => playTone({ type:'sine', freq:f, dur:0.1, vol:0.2 }), i*100)),
  bomb:       () => { playNoise({ dur:0.45, vol:0.5 }); playTone({ type:'sawtooth', freq:100, freqEnd:30, dur:0.45, vol:0.38 }); },
  shield:     () => [784,880,1047].forEach((f,i) => setTimeout(() => playTone({ type:'sine', freq:f, dur:0.12, vol:0.2 }), i*70)),
  thorns:     () => [330,392,330].forEach((f,i) => setTimeout(() => playTone({ type:'square', freq:f, dur:0.1, vol:0.18 }), i*70)),
  skillReady: () => playTone({ type:'sine', freq:1047, freqEnd:1568, dur:0.35, vol:0.3 }),
  skillUse:   () => [1047,1319,1568,2093].forEach((f,i) => setTimeout(() => playTone({ type:'sine', freq:f, dur:0.15, vol:0.28 }), i*55)),
  candy:      () => playTone({ type:'sine', freq:1200, freqEnd:600, dur:0.15, vol:0.22 }),
  star:       () => [1568,1319,1047].forEach((f,i) => setTimeout(() => playTone({ type:'sine', freq:f, dur:0.1, vol:0.18 }), i*65)),
  icecream:   () => playTone({ type:'sine', freq:440, freqEnd:220, dur:0.3, vol:0.2 }),
  gameOver:   () => [440,330,220,110].forEach((f,i) => setTimeout(() => playTone({ type:'sawtooth', freq:f, dur:0.3, vol:0.28 }), i*140)),
  select:     () => playTone({ type:'sine', freq:660, dur:0.07, vol:0.15 }),
  confirm:    () => [523,659].forEach((f,i) => setTimeout(() => playTone({ type:'sine', freq:f, dur:0.1, vol:0.2 }), i*80)),
};
