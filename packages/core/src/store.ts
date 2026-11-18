/**
 * 存档：沿用旧前缀 pixelArcade.，老玩家的最高分不会丢。
 * - 高分榜（high）：越大越好
 * - 低分榜（low） ：越少越好（步数、用时）
 */

export type ScoreMode = "high" | "low";

const PREFIX = "pixelArcade.";
const SCHEMA = 2;

const safe = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(PREFIX + key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): boolean {
    try {
      window.localStorage.setItem(PREFIX + key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(PREFIX + key);
    } catch {
      /* 无痕模式忽略 */
    }
  },
};

function migrate(): void {
  const version = Number(safe.get("schema") ?? 0);
  if (version >= SCHEMA) return;
  // v1 只有 <game>.best，语义正好是 high，无需搬运，只打版本号
  safe.set("schema", String(SCHEMA));
}

migrate();

export const Store = {
  get(key: string, fallback = ""): string {
    const value = safe.get(key);
    return value === null ? fallback : value;
  },

  set(key: string, value: string | number | boolean): boolean {
    return safe.set(key, String(value));
  },

  remove(key: string): void {
    safe.remove(key);
  },

  number(key: string, fallback = 0): number {
    const n = Number.parseInt(Store.get(key, String(fallback)), 10);
    return Number.isFinite(n) ? n : fallback;
  },

  bool(key: string, fallback = false): boolean {
    const value = Store.get(key, fallback ? "1" : "0");
    return value === "1" || value === "true";
  },

  /** 读取最佳成绩；低分模式没有记录时返回 null。 */
  best(game: string, mode: ScoreMode = "high"): number | null {
    const key = mode === "low" ? `${game}.best.low` : `${game}.best`;
    const raw = safe.get(key);
    if (raw === null) return mode === "low" ? null : 0;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return mode === "low" ? null : 0;
    return Math.max(0, n);
  },

  setBest(game: string, value: number, mode: ScoreMode = "high"): void {
    const key = mode === "low" ? `${game}.best.low` : `${game}.best`;
    safe.set(key, String(Math.max(0, Math.floor(value))));
  },

  /** 是否刷新了纪录（低分模式要严格更小）。 */
  isRecord(game: string, value: number, mode: ScoreMode = "high"): boolean {
    const prev = Store.best(game, mode);
    if (mode === "low") return prev === null ? value > 0 : value < prev;
    return value > (prev ?? 0);
  },

  muted(): boolean {
    return Store.bool("muted", false);
  },

  setMuted(muted: boolean): void {
    Store.set("muted", muted ? "1" : "0");
  },

  /** 通用开关：音效、减少动效、震动。 */
  flag(key: string, fallback: boolean): boolean {
    return Store.bool(`setting.${key}`, fallback);
  },

  setFlag(key: string, value: boolean): void {
    Store.set(`setting.${key}`, value ? "1" : "0");
  },
};
