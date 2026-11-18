/** 通用小工具：数学、随机、缓动、格式化。无 DOM 依赖（prefersReducedMotion 除外）。 */

export const clamp = (n: number, min: number, max: number): number =>
  n < min ? min : n > max ? max : n;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** 朝目标逼近，最多走 step（用于速度、淡出，不依赖帧率）。 */
export function approach(value: number, target: number, step: number): number {
  if (value < target) return Math.min(value + step, target);
  if (value > target) return Math.max(value - step, target);
  return target;
}

export const rand = (min: number, max: number): number => min + Math.random() * (max - min);

export const randInt = (min: number, max: number): number =>
  Math.floor(min + Math.random() * (max - min + 1));

export function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)] as T;
}

export function shuffle<T>(list: readonly T[]): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = out[i] as T;
    out[i] = out[j] as T;
    out[j] = t;
  }
  return out;
}

/** 可复现随机数（同一个种子出同一串）。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const easeOutCubic = (t: number): number => {
  const x = 1 - t;
  return 1 - x * x * x;
};

export const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = t - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
};

export const easeInQuad = (t: number): number => t * t;

export const easeOutQuad = (t: number): number => t * (2 - t);

/** 锯齿/呼吸波，t 为秒。 */
export const wave = (t: number, speed = 1, from = 0, to = 1): number => {
  const x = (Math.sin(t * speed * Math.PI * 2) + 1) / 2;
  return from + (to - from) * x;
};

export function padNumber(value: number, length = 5): string {
  const n = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  return String(n).padStart(length, "0");
}

/** 毫秒 → 秒，向上取整，用于倒计时显示。 */
export const ceilSeconds = (ms: number): number => Math.max(0, Math.ceil(ms / 1000));

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** 触屏优先（用于隐藏键盘提示等）。 */
export function isCoarsePointer(): boolean {
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

/** 把 [0,1] 之外的输入夹住，组合动画常用。 */
export const clamp01 = (n: number): number => clamp(n, 0, 1);
