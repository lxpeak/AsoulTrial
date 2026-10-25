/**
 * 存档骨架（localStorage）。
 *
 * 只存"跨局需要保留"的东西：设置、最佳记录、局外解锁、一次性标记。
 * 局内进度（血量、敌人、子弹）一概不存 —— 肉鸽游戏中途退出就重开，
 * 存了反而要处理"读档时敌人位置在世界外"这类麻烦。
 *
 * 三条硬约束：
 *  1. 任何读写都必须 try/catch。无痕模式 / 禁用 Cookie / 存储写满时
 *     `localStorage.setItem` 会直接抛异常，不接就会白屏。
 *  2. JSON 解析失败（用户改过、别的版本写过）一律当"没有存档"，不崩。
 *  3. 版本号写在文件里，将来结构变了在 loadSave 里做迁移，不要静默丢档。
 */
import { SETTINGS } from './settings.js';

const KEY = 'asoul-trial.save';
const VERSION = 1;

function defaults() {
  return {
    version: VERSION,
    settings: { volume: 0.7, sfx: true },
    best: { kills: 0, time: 0 }, // time 单位：秒
    unlocks: [], // 局外解锁 id 列表（角色 / 道具 / 图鉴），P4 用
    flags: {}, // 一次性标记（是否看过提示、彩蛋是否触发过）
  };
}

export const SAVE = defaults();

/** localStorage 是否真的可用（无痕模式下为 false，此时只在内存里跑） */
export let persistent = false;
let storage = null;

function pickStorage() {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    const probe = `${KEY}.probe`;
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null; // 无痕 / 禁用存储 / 配额异常
  }
}

/**
 * 惰性获取存储：正常流程由 loadSave() 在启动时初始化，但如果有人（测试、
 * 未来的模块）在 loadSave 之前就写档，这里兜住，不要静默丢数据。
 */
function ensureStorage() {
  if (!storage) {
    storage = pickStorage();
    persistent = !!storage;
  }
  return storage;
}

function num(v, fallback, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function mergeSettings(src) {
  if (!src || typeof src !== 'object') return;
  SAVE.settings.volume = num(src.volume, SAVE.settings.volume, 0, 1);
  if (typeof src.sfx === 'boolean') SAVE.settings.sfx = src.sfx;
}

function mergeBest(src) {
  if (!src || typeof src !== 'object') return;
  SAVE.best.kills = Math.floor(num(src.kills, 0, 0, 1e9));
  SAVE.best.time = Math.floor(num(src.time, 0, 0, 1e9));
}

/** 把存档里的设置灌进运行时 SETTINGS */
function applySettings() {
  SETTINGS.volume = SAVE.settings.volume;
  SETTINGS.sfx = SAVE.settings.sfx;
}

/**
 * 启动时调用一次。返回是否读到了有效存档。
 */
export function loadSave() {
  storage = pickStorage();
  persistent = !!storage;

  if (!storage) {
    applySettings();
    return false;
  }

  let raw = null;
  try {
    raw = storage.getItem(KEY);
  } catch {
    raw = null;
  }
  if (!raw) {
    applySettings();
    return false;
  }

  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null; // 坏档：当作没有，下次写入会覆盖掉
  }
  if (!data || typeof data !== 'object') {
    applySettings();
    return false;
  }

  // 版本迁移入口：v1 是首版，比它新的存档只读已知字段，不覆盖
  mergeSettings(data.settings);
  mergeBest(data.best);
  if (Array.isArray(data.unlocks)) {
    SAVE.unlocks = data.unlocks.filter((x) => typeof x === 'string').slice(0, 200);
  }
  if (data.flags && typeof data.flags === 'object') {
    SAVE.flags = { ...data.flags };
  }
  applySettings();
  return true;
}

/** 立即落盘。返回是否写入成功（失败不抛，调用方可以忽略返回值） */
export function saveNow() {
  const s = ensureStorage();
  if (!s) {
    persistent = false;
    return false;
  }
  try {
    s.setItem(KEY, JSON.stringify(SAVE));
    persistent = true;
    return true;
  } catch {
    persistent = false;
    return false;
  }
}

/** 设置被改动后调用：把 SETTINGS 同步进 SAVE 并落盘 */
export function persistSettings() {
  SAVE.settings.volume = num(SETTINGS.volume, 0.7, 0, 1);
  SAVE.settings.sfx = !!SETTINGS.sfx;
  return saveNow();
}

/**
 * 记一局的结果：只有更好才覆盖最佳记录。返回是否刷新了纪录。
 * @param {number} kills 击杀数
 * @param {number} timeSec 存活秒数
 */
export function recordRun(kills, timeSec) {
  const k = Math.floor(num(kills, 0, 0, 1e9));
  const t = Math.floor(num(timeSec, 0, 0, 1e9));
  const better = k > SAVE.best.kills || (k === SAVE.best.kills && t > SAVE.best.time);
  if (better) {
    SAVE.best.kills = k;
    SAVE.best.time = t;
  }
  saveNow();
  return better;
}

export function isUnlocked(id) {
  return SAVE.unlocks.includes(id);
}

/** 解锁一个 id，返回是否是新解锁（用于弹提示） */
export function unlock(id) {
  if (typeof id !== 'string' || SAVE.unlocks.includes(id)) return false;
  SAVE.unlocks.push(id);
  saveNow();
  return true;
}

export function getFlag(name) {
  return !!SAVE.flags[name];
}

export function setFlag(name, value = true) {
  SAVE.flags[name] = !!value;
  saveNow();
}

/** 清空存档（设置面板的"重置"、或用户手动排障用） */
export function resetSave() {
  const d = defaults();
  SAVE.version = d.version;
  SAVE.settings = d.settings;
  SAVE.best = d.best;
  SAVE.unlocks = d.unlocks;
  SAVE.flags = d.flags;
  applySettings();
  const s = ensureStorage();
  if (s) {
    try {
      s.removeItem(KEY);
    } catch {
      /* 存储不可用就算了，内存已经是默认值 */
    }
  }
  return true;
}
