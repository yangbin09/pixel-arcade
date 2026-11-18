/**
 * 调色板：唯一颜色来源是 CSS 变量，保证 Canvas 与 DOM 永远同一套色。
 * 24 色复古调色板（值与 packages/styles/src/tokens.css 完全一致）。
 */

export const PALETTE_KEYS = [
  "void",
  "night",
  "panel",
  "panel2",
  "line",
  "lineHi",
  "purple",
  "lav",
  "cream",
  "white",
  "amber",
  "gold",
  "orange",
  "red",
  "redDeep",
  "grass",
  "grassHi",
  "grassDeep",
  "dirt",
  "dirtHi",
  "dirtDeep",
  "hole",
  "pink",
  "mint",
] as const;

export type PaletteKey = (typeof PALETTE_KEYS)[number];
export type Palette = Record<PaletteKey, string>;

const CSS_VARS: Record<PaletteKey, string> = {
  void: "--c-void",
  night: "--c-night",
  panel: "--c-panel",
  panel2: "--c-panel-2",
  line: "--c-line",
  lineHi: "--c-line-hi",
  purple: "--c-purple",
  lav: "--c-lav",
  cream: "--c-cream",
  white: "--c-white",
  amber: "--c-amber",
  gold: "--c-gold",
  orange: "--c-orange",
  red: "--c-red",
  redDeep: "--c-red-deep",
  grass: "--c-grass",
  grassHi: "--c-grass-hi",
  grassDeep: "--c-grass-deep",
  dirt: "--c-dirt",
  dirtHi: "--c-dirt-hi",
  dirtDeep: "--c-dirt-deep",
  hole: "--c-hole",
  pink: "--c-pink",
  mint: "--c-mint",
};

export const FALLBACK_PALETTE: Palette = {
  void: "#07060c",
  night: "#0d0b16",
  panel: "#151125",
  panel2: "#1d1830",
  line: "#2c2443",
  lineHi: "#4a3c68",
  purple: "#6b5b8c",
  lav: "#a291c4",
  cream: "#f0e5ca",
  white: "#fff8e8",
  amber: "#f3a841",
  gold: "#ffd35f",
  orange: "#e17236",
  red: "#d9523f",
  redDeep: "#782a28",
  grass: "#3c6338",
  grassHi: "#5c8947",
  grassDeep: "#24402b",
  dirt: "#8a5a37",
  dirtHi: "#b37e4d",
  dirtDeep: "#4b2f1c",
  hole: "#1b1009",
  pink: "#e39b87",
  mint: "#a6d96b",
};

/** 从 :root 读取 CSS 变量；读不到就用内置值。 */
export function readPalette(): Palette {
  const out: Palette = { ...FALLBACK_PALETTE };
  let style: CSSStyleDeclaration | null = null;
  try {
    style = window.getComputedStyle(document.documentElement);
  } catch {
    style = null;
  }
  if (!style) return out;
  for (const key of PALETTE_KEYS) {
    const value = style.getPropertyValue(CSS_VARS[key]).trim();
    if (value) out[key] = value;
  }
  return out;
}

/** 全局共享调色板；样式加载完成后会刷新一次，和旧 core.js 行为一致。 */
export const P: Palette = readPalette();

if (typeof document !== "undefined") {
  const refresh = () => Object.assign(P, readPalette());
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refresh, { once: true });
  } else {
    // 样式可能还没算好，下一帧再读一次
    requestAnimationFrame(refresh);
  }
}
