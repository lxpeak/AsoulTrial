/** 32 位种子随机，保证同一 seed 的刷怪/掉落序列可复现。 */
export function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rng = {
  next: Math.random,
  /** 当前种子；`null` 表示用的是 Math.random，这局没法复现 */
  value: null,
  seed(s) {
    this.value = s >>> 0;
    this.next = mulberry32(this.value);
    return this;
  },
  reset() {
    this.value = null;
    this.next = Math.random;
  },
};

export function rand(a, b) {
  return a + rng.next() * (b - a);
}

export function randInt(a, b) {
  return Math.floor(rand(a, b + 1));
}

export function pick(arr) {
  return arr[Math.floor(rng.next() * arr.length)];
}
