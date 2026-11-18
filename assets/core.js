/* ============================================================
   像素街机 · 共享核心 core.js
   - 调色板（从 CSS 变量读取，保持一套颜色）
   - 像素字库 + 小画布数字
   - 像素绘制工具 / 地鼠 / 土坑 / 锤子 / 图标
   - 存档、随机、音效（全部 WebAudio 合成）
   这是一个普通脚本（非 ES Module）：这样在 file:// 下双击
   index.html 也能直接运行，不需要本地服务器。
   ============================================================ */
(function (window, document) {
  "use strict";

  /* ---------------- 调色板 ---------------- */

  const FALLBACK = {
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

  const CSS_KEYS = {
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

  function readPalette() {
    const out = {};
    let style = null;
    try {
      style = window.getComputedStyle(document.documentElement);
    } catch (err) {
      /* 极端情况下退回内置色值 */
    }
    Object.keys(CSS_KEYS).forEach(function (key) {
      let value = "";
      if (style) {
        value = style.getPropertyValue(CSS_KEYS[key]).trim();
      }
      out[key] = value || FALLBACK[key];
    });
    return out;
  }

  const P = readPalette();
  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      function () {
        Object.assign(P, readPalette());
      },
      { once: true }
    );
  }

  /* ---------------- 小工具 ---------------- */

  function clamp(n, min, max) {
    return n < min ? min : n > max ? max : n;
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function randInt(min, max) {
    return Math.floor(min + Math.random() * (max - min + 1));
  }

  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function shuffle(list) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = out[i];
      out[i] = out[j];
      out[j] = t;
    }
    return out;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function easeOutCubic(t) {
    const x = 1 - t;
    return 1 - x * x * x;
  }

  function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const x = t - 1;
    return 1 + c3 * x * x * x + c1 * x * x;
  }

  function easeInQuad(t) {
    return t * t;
  }

  function prefersReducedMotion() {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (err) {
      return false;
    }
  }

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  /* ---------------- 存档 ---------------- */

  const PREFIX = "pixelArcade.";

  const Store = {
    get: function (key, fallback) {
      try {
        const value = window.localStorage.getItem(PREFIX + key);
        return value === null ? fallback : value;
      } catch (err) {
        return fallback;
      }
    },
    set: function (key, value) {
      try {
        window.localStorage.setItem(PREFIX + key, String(value));
        return true;
      } catch (err) {
        return false;
      }
    },
    number: function (key, fallback) {
      const n = parseInt(Store.get(key, String(fallback)), 10);
      return isFinite(n) ? n : fallback;
    },
    bool: function (key, fallback) {
      const value = Store.get(key, fallback ? "1" : "0");
      return value === "1" || value === "true";
    },
    best: function (game) {
      return Math.max(0, Store.number(game + ".best", 0));
    },
    setBest: function (game, value) {
      return Store.set(game + ".best", Math.max(0, Math.floor(value)));
    },
    muted: function () {
      return Store.bool("muted", false);
    },
    setMuted: function (muted) {
      return Store.set("muted", muted ? "1" : "0");
    },
  };

  /* ---------------- 像素字库 5x7 ---------------- */

  const GLYPH_SRC = {
    "0": "01110/10001/10011/10101/11001/10001/01110",
    "1": "00100/01100/00100/00100/00100/00100/01110",
    "2": "01110/10001/00001/00010/00100/01000/11111",
    "3": "11110/00001/00001/01110/00001/00001/11110",
    "4": "00010/00110/01010/10010/11111/00010/00010",
    "5": "11111/10000/11110/00001/00001/10001/01110",
    "6": "00110/01000/10000/11110/10001/10001/01110",
    "7": "11111/00001/00010/00100/01000/01000/01000",
    "8": "01110/10001/10001/01110/10001/10001/01110",
    "9": "01110/10001/10001/01111/00001/00010/01100",
    A: "01110/10001/10001/11111/10001/10001/10001",
    B: "11110/10001/10001/11110/10001/10001/11110",
    C: "01110/10001/10000/10000/10000/10001/01110",
    D: "11110/10001/10001/10001/10001/10001/11110",
    E: "11111/10000/10000/11110/10000/10000/11111",
    F: "11111/10000/10000/11110/10000/10000/10000",
    G: "01110/10001/10000/10111/10001/10001/01110",
    H: "10001/10001/10001/11111/10001/10001/10001",
    I: "01110/00100/00100/00100/00100/00100/01110",
    J: "00111/00010/00010/00010/00010/10010/01100",
    K: "10001/10010/10100/11000/10100/10010/10001",
    L: "10000/10000/10000/10000/10000/10000/11111",
    M: "10001/11011/10101/10101/10001/10001/10001",
    N: "10001/11001/10101/10011/10001/10001/10001",
    O: "01110/10001/10001/10001/10001/10001/01110",
    P: "11110/10001/10001/11110/10000/10000/10000",
    Q: "01110/10001/10001/10001/10101/10010/01101",
    R: "11110/10001/10001/11110/10100/10010/10001",
    S: "01111/10000/10000/01110/00001/00001/11110",
    T: "11111/00100/00100/00100/00100/00100/00100",
    U: "10001/10001/10001/10001/10001/10001/01110",
    V: "10001/10001/10001/10001/10001/01010/00100",
    W: "10001/10001/10001/10101/10101/10101/01010",
    X: "10001/10001/01010/00100/01010/10001/10001",
    Y: "10001/10001/10001/01010/00100/00100/00100",
    Z: "11111/00001/00010/00100/01000/10000/11111",
    "+": "00000/00100/00100/11111/00100/00100/00000",
    "-": "00000/00000/00000/11111/00000/00000/00000",
    "!": "00100/00100/00100/00100/00100/00000/00100",
    "?": "01110/10001/00001/00010/00100/00000/00100",
    "%": "11001/11010/00010/00100/01000/01011/10011",
    ":": "00000/00100/00000/00000/00100/00000/00000",
    ".": "00000/00000/00000/00000/00000/00100/00100",
    "/": "00001/00010/00010/00100/01000/01000/10000",
    "*": "00000/10101/01110/11111/01110/10101/00000",
    " ": "00000/00000/00000/00000/00000/00000/00000",
  };

  const GLYPHS = {};
  Object.keys(GLYPH_SRC).forEach(function (key) {
    GLYPHS[key] = GLYPH_SRC[key].split("/");
  });

  function normalizeText(text) {
    return String(text)
      .toUpperCase()
      .replace(/×/g, "X")
      .replace(/−/g, "-");
  }

  function measurePixelText(text, size) {
    const value = normalizeText(text);
    if (!value.length) return 0;
    return (value.length * 6 - 1) * size;
  }

  function drawPixelText(ctx, text, x, y, size, color, shadowColor) {
    const value = normalizeText(text);
    const s = Math.max(1, Math.round(size));
    const px = Math.round(x);
    const py = Math.round(y);

    function paint(offsetX, offsetY, ink) {
      ctx.fillStyle = ink;
      let cursor = px + offsetX;
      for (let i = 0; i < value.length; i++) {
        const glyph = GLYPHS[value[i]] || GLYPHS["?"];
        for (let row = 0; row < 7; row++) {
          const line = glyph[row];
          for (let col = 0; col < 5; col++) {
            if (line[col] === "1") {
              ctx.fillRect(cursor + col * s, py + offsetY + row * s, s, s);
            }
          }
        }
        cursor += 6 * s;
      }
    }

    if (shadowColor) {
      paint(s, s, shadowColor);
    }
    paint(0, 0, color);
    return measurePixelText(value, s);
  }

  /* 小画布数字：用于 HUD / 结算 */
  function PixelText(canvas, options) {
    this.el = canvas;
    this.ctx = canvas.getContext("2d");
    this.size = options && options.size ? options.size : 3;
    this.color = (options && options.color) || P.cream;
    this.shadow = options && options.shadow ? options.shadow : null;
    this.pad = options && options.pad ? options.pad : 0;
    this.minChars = options && options.minChars ? options.minChars : 0;
    this.value = "";
    this._draw("");
  }

  PixelText.prototype._draw = function (text) {
    const dpr = Math.min(window.devicePixelRatio || 1, 4);
    const unit = Math.max(1, Math.round(this.size * dpr));
    const chars = Math.max(1, text.length, this.minChars);
    const extra = this.shadow ? 1 : 0;
    const w = (Math.max(1, chars * 6 - 1) + extra) * unit;
    const h = (7 + extra) * unit;
    const canvas = this.el;

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;

    function paint(ink, ox, oy) {
      ctx.fillStyle = ink;
      let cursor = ox;
      for (let i = 0; i < text.length; i++) {
        const glyph = GLYPHS[text[i]] || GLYPHS["?"];
        for (let row = 0; row < 7; row++) {
          const line = glyph[row];
          for (let col = 0; col < 5; col++) {
            if (line[col] === "1") {
              ctx.fillRect(cursor + col * unit, oy + row * unit, unit, unit);
            }
          }
        }
        cursor += 6 * unit;
      }
    }

    if (this.shadow) paint(this.shadow, unit, unit);
    paint(this.color, 0, 0);

    canvas.style.width = w / dpr + "px";
    canvas.style.height = h / dpr + "px";
  };

  PixelText.prototype.set = function (value) {
    let text = normalizeText(value);
    if (this.pad) {
      text = text.padStart(this.pad, "0");
    }
    if (text === this.value) return;
    this.value = text;
    this._draw(text);
  };

  PixelText.prototype.setColor = function (color) {
    if (!color || color === this.color) return;
    this.color = color;
    this._draw(this.value);
  };

  PixelText.prototype.refresh = function () {
    this._draw(this.value);
  };

  /* ---------------- 像素图形工具 ---------------- */

  function rect(ctx, x, y, w, h, color) {
    w = Math.round(w);
    h = Math.round(h);
    if (w <= 0 || h <= 0) return;
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  }

  function ellipseHalf(rx, ry, dy) {
    const t = 1 - (dy * dy) / (ry * ry);
    if (t <= 0) return 0;
    return Math.round(rx * Math.sqrt(t));
  }

  function fillEllipse(ctx, cx, cy, rx, ry, color) {
    for (let dy = -ry; dy <= ry; dy++) {
      const half = ellipseHalf(rx, ry, dy);
      if (half > 0) rect(ctx, cx - half, cy + dy, half * 2, 1, color);
    }
  }

  const Art = {};

  Art.rect = rect;
  Art.fillEllipse = fillEllipse;

  Art.paintGrass = function (ctx, w, h, seed) {
    rect(ctx, 0, 0, w, h, P.grassDeep);
    const rng = mulberry32(seed || 7);

    for (let y = 2; y < h; y += 4) {
      const offset = y % 8 === 2 ? 1 : 3;
      for (let x = offset; x < w; x += 6) {
        if (rng() < 0.52) rect(ctx, x, y, 1, 1, P.grass);
      }
    }

    const count = Math.round((w * h) / 190);
    for (let i = 0; i < count; i++) {
      const x = 2 + Math.floor(rng() * (w - 4));
      const y = 2 + Math.floor(rng() * (h - 4));
      const color = rng() < 0.24 ? P.grassHi : P.grass;
      rect(ctx, x, y, 1, 2, color);
      rect(ctx, x - 1, y + 1, 1, 1, color);
      rect(ctx, x + 1, y + 2, 1, 1, color);
    }

    // 屏幕四角的像素铆钉
    rect(ctx, 2, 2, 2, 2, P.lineHi);
    rect(ctx, w - 4, 2, 2, 2, P.lineHi);
    rect(ctx, 2, h - 4, 2, 2, P.lineHi);
    rect(ctx, w - 4, h - 4, 2, 2, P.lineHi);
  };

  Art.drawHoleBack = function (ctx, cx, cy) {
    cx = Math.round(cx);
    cy = Math.round(cy);

    fillEllipse(ctx, cx, cy + 3, 24, 10, P.dirtDeep);
    fillEllipse(ctx, cx, cy + 1, 22, 9, P.dirt);

    for (let dy = -9; dy <= -6; dy++) {
      const half = ellipseHalf(22, 9, dy);
      if (half > 2) {
        rect(ctx, cx - half + 2, cy + 1 + dy, half * 2 - 4, 1, P.dirtHi);
      }
    }

    fillEllipse(ctx, cx, cy + 4, 18, 8, P.dirtDeep);
    fillEllipse(ctx, cx, cy + 4, 16, 6, P.hole);

    for (let dy = -6; dy <= -4; dy++) {
      const half = ellipseHalf(16, 6, dy);
      if (half > 1) {
        rect(ctx, cx - half + 1, cy + 4 + dy, half * 2 - 2, 1, P.dirtHi);
      }
    }

    // 土壤细节
    rect(ctx, cx - 19, cy + 4, 2, 1, P.dirt);
    rect(ctx, cx + 16, cy + 7, 3, 1, P.dirtHi);
    rect(ctx, cx - 15, cy - 3, 2, 1, P.dirtHi);

    // 土坑边的草
    const variant = ((cx * 13 + cy * 7) >> 2) % 3;
    if (variant !== 1) {
      rect(ctx, cx - 23, cy + 5, 1, 3, P.grassHi);
      rect(ctx, cx - 22, cy + 6, 1, 1, P.grass);
    }
    if (variant !== 2) {
      rect(ctx, cx + 22, cy + 5, 1, 3, P.grassHi);
      rect(ctx, cx + 21, cy + 7, 1, 1, P.grass);
    }
  };

  Art.drawHoleFront = function (ctx, cx, cy) {
    cx = Math.round(cx);
    cy = Math.round(cy);

    for (let dy = 4; dy <= 7; dy++) {
      const half = ellipseHalf(18, 8, dy);
      if (half <= 0) continue;
      rect(ctx, cx - half, cy + 4 + dy, half * 2, 1, P.dirt);
      if (dy === 4) {
        rect(ctx, cx - half + 2, cy + 4 + dy, Math.max(0, half * 2 - 4), 1, P.dirtHi);
      }
    }

    rect(ctx, cx - 14, cy + 10, 3, 1, P.dirtDeep);
    rect(ctx, cx + 11, cy + 9, 2, 1, P.dirtDeep);
  };

  /* ---------------- 地鼠 ---------------- */

  const MOLE_PROFILE = [
    4, 7, 9, 11, 12, 13, 14, 14, 14, 14, 14, 14, 13, 13, 13, 12,
    12, 11, 11, 10, 10, 9, 9, 8, 8, 7, 6, 5, 4, 3,
  ];

  function drawMoleEar(ctx, x, y, outline, inner, light) {
    rect(ctx, x, y, 6, 6, outline);
    rect(ctx, x + 1, y + 1, 4, 4, inner);
    rect(ctx, x + 1, y + 1, 2, 1, light);
  }

  Art.drawMole = function (ctx, cx, top, kind, options) {
    cx = Math.round(cx);
    top = Math.round(top);
    const opts = options || {};
    const flash = !!opts.flash;
    const gold = kind === "gold";

    let outline;
    let body;
    let light;
    let belly;
    let nose;
    let earInner;

    if (flash) {
      outline = P.amber;
      body = P.white;
      light = P.white;
      belly = P.white;
      nose = P.orange;
      earInner = P.cream;
    } else if (gold) {
      outline = P.dirtDeep;
      body = P.gold;
      light = P.white;
      belly = P.cream;
      nose = P.orange;
      earInner = P.amber;
    } else {
      outline = P.dirtDeep;
      body = P.dirt;
      light = P.dirtHi;
      belly = P.cream;
      nose = P.pink;
      earInner = P.dirtHi;
    }

    // 耳朵
    drawMoleEar(ctx, cx - 18, top + 5, outline, earInner, light);
    drawMoleEar(ctx, cx + 12, top + 5, outline, earInner, light);

    // 身体 / 头
    for (let row = 0; row < MOLE_PROFILE.length; row++) {
      const half = MOLE_PROFILE[row];
      rect(ctx, cx - half - 1, top + row, half * 2 + 2, 1, outline);
      rect(ctx, cx - half, top + row, half * 2, 1, body);
    }

    // 顶部与左侧高光
    rect(ctx, cx - 3, top + 1, 4, 1, light);
    rect(ctx, cx - 2, top + 2, 2, 1, light);
    for (let row = 5; row <= 11; row += 2) {
      const half = MOLE_PROFILE[row];
      rect(ctx, cx - half + 2, top + row, 2, 1, light);
    }

    // 头顶小毛
    if (!gold) {
      rect(ctx, cx - 1, top - 1, 3, 1, outline);
      rect(ctx, cx, top - 2, 1, 1, body);
    }

    // 口鼻奶油色区域
    const muzzle = [2, 4, 5, 6, 6, 5];
    for (let i = 0; i < muzzle.length; i++) {
      const half = muzzle[i];
      rect(ctx, cx - half, top + 16 + i, half * 2, 1, belly);
    }
    rect(ctx, cx - 5, top + 22, 10, 1, P.dirtHi);

    // 眼睛
    if (opts.hit) {
      const ink = flash ? P.orange : P.void;
      rect(ctx, cx - 8, top + 9, 1, 1, ink);
      rect(ctx, cx - 6, top + 10, 3, 1, ink);
      rect(ctx, cx - 5, top + 11, 1, 1, ink);
      rect(ctx, cx + 3, top + 9, 1, 1, ink);
      rect(ctx, cx + 5, top + 10, 3, 1, ink);
      rect(ctx, cx + 8, top + 11, 1, 1, ink);
    } else {
      rect(ctx, cx - 7, top + 9, 3, 3, P.void);
      rect(ctx, cx - 6, top + 9, 1, 1, P.white);
      rect(ctx, cx + 4, top + 9, 3, 3, P.void);
      rect(ctx, cx + 5, top + 9, 1, 1, P.white);
    }

    // 鼻子
    rect(ctx, cx - 3, top + 16, 6, 1, outline);
    rect(ctx, cx - 2, top + 17, 4, 2, nose);
    rect(ctx, cx - 2, top + 17, 1, 1, P.white);

    // 嘴与胡须
    rect(ctx, cx - 3, top + 21, 2, 1, outline);
    rect(ctx, cx + 2, top + 21, 2, 1, outline);
    rect(ctx, cx - 1, top + 22, 2, 1, outline);
    rect(ctx, cx - 10, top + 18, 2, 1, outline);
    rect(ctx, cx + 9, top + 18, 2, 1, outline);

    // 两只前爪
    rect(ctx, cx - 15, top + 21, 7, 7, outline);
    rect(ctx, cx - 14, top + 22, 5, 5, light);
    rect(ctx, cx - 13, top + 24, 1, 2, outline);

    rect(ctx, cx + 8, top + 21, 7, 7, outline);
    rect(ctx, cx + 9, top + 22, 5, 5, light);
    rect(ctx, cx + 12, top + 24, 1, 2, outline);

    // 金地鼠的小皇冠
    if (gold) {
      const crownY = top - 4;
      rect(ctx, cx - 6, crownY + 3, 13, 2, outline);
      for (let i = 0; i < 3; i++) {
        const x = cx - 6 + i * 5;
        rect(ctx, x, crownY, 2, 4, outline);
        rect(ctx, x, crownY + 1, 2, 2, P.gold);
      }
      rect(ctx, cx - 5, crownY + 2, 11, 2, P.gold);
      rect(ctx, cx - 5, crownY + 2, 3, 1, P.white);
      rect(ctx, cx + 3, crownY + 2, 2, 1, P.amber);
      rect(ctx, cx - 1, crownY + 3, 2, 1, P.pink);
    }
  };

  /* ---------------- 锤子 ---------------- */

  Art.drawHammer = function (ctx, x, y, strike) {
    x = Math.round(x);
    y = Math.round(y);

    const hx = strike ? x - 8 : x + 4;
    const hy = strike ? y - 17 : y - 29;

    // 木柄：从锤头下方斜向玩家的手
    const handle = strike
      ? [
          [x + 2, y - 10],
          [x + 5, y - 7],
          [x + 8, y - 4],
          [x + 11, y - 1],
        ]
      : [
          [x + 12, y - 21],
          [x + 9, y - 17],
          [x + 6, y - 13],
          [x + 3, y - 9],
          [x, y - 5],
        ];

    for (let i = 0; i < handle.length; i++) {
      const p = handle[i];
      rect(ctx, p[0] - 1, p[1] - 1, 5, 5, P.dirtDeep);
      rect(ctx, p[0], p[1], 3, 3, P.dirt);
      rect(ctx, p[0], p[1], 1, 2, P.dirtHi);
    }

    // 锤头
    rect(ctx, hx - 1, hy - 1, 18, 12, P.dirtDeep);
    rect(ctx, hx, hy, 16, 10, P.cream);
    rect(ctx, hx + 1, hy + 1, 14, 2, P.white);
    rect(ctx, hx, hy + 7, 16, 2, P.amber);
    rect(ctx, hx + 1, hy + 7, 3, 2, P.orange);
    rect(ctx, hx - 1, hy + 2, 2, 5, P.orange);
    rect(ctx, hx + 15, hy + 2, 2, 5, P.orange);
    rect(ctx, hx + 3, hy + 4, 2, 1, P.dirtDeep);
    rect(ctx, hx + 11, hy + 4, 2, 1, P.dirtDeep);

    // 挥击速度线
    if (strike) {
      rect(ctx, x - 16, y - 14, 5, 1, P.cream);
      rect(ctx, x - 19, y - 9, 8, 1, P.amber);
      rect(ctx, x - 14, y - 4, 3, 1, P.cream);
    }
  };

  Art.drawSparkle = function (ctx, x, y, size, color) {
    x = Math.round(x);
    y = Math.round(y);
    rect(ctx, x - size, y, size * 2 + 1, 1, color);
    rect(ctx, x, y - size, 1, size * 2 + 1, color);
    rect(ctx, x, y, 1, 1, P.white);
  };

  /* ---------------- 像素图标 ---------------- */

  const ICONS = {
    joystick: [
      "...........",
      "....ooo....",
      "...o+++o...",
      "...o+++o...",
      "....ooo....",
      ".....#.....",
      ".....#.....",
      "..#######..",
      ".o#*###*#o.",
      ".o#######o.",
      "..ooooooo..",
    ],
    sound: [
      "...........",
      "....#......",
      "...##..#...",
      "..###.#.#..",
      "#####.#..#.",
      "#####.#..#.",
      "#####.#..#.",
      "..###.#.#..",
      "...##..#...",
      "....#......",
      "...........",
    ],
    muted: [
      "...........",
      "....#......",
      "...##.x...x",
      "..###.x.x..",
      "#####..x...",
      "#####.x.x..",
      "#####.x...x",
      "..###......",
      "...##......",
      "....#......",
      "...........",
    ],
    pause: [
      "...........",
      "..##...##..",
      "..##...##..",
      "..##...##..",
      "..##...##..",
      "..##...##..",
      "..##...##..",
      "..##...##..",
      "..##...##..",
      "...........",
      "...........",
    ],
    play: [
      "...........",
      "..#........",
      "..##.......",
      "..###......",
      "..####.....",
      "..#####....",
      "..####.....",
      "..###......",
      "..##.......",
      "..#........",
      "...........",
    ],
    back: [
      "...........",
      "...#.......",
      "..##.......",
      ".###.......",
      "###########",
      "###########",
      ".###.......",
      "..##.......",
      "...#.......",
      "...........",
      "...........",
    ],
  };

  function paintIcon(canvas, name, targetCss, colors) {
    const bitmap = ICONS[name];
    if (!bitmap || !canvas) return;
    const cssSize = targetCss || 22;
    const dpr = Math.min(window.devicePixelRatio || 1, 4);
    const cols = bitmap[0].length;
    const rows = bitmap.length;
    const unit = Math.max(1, Math.round((cssSize / cols) * dpr));
    const w = cols * unit;
    const h = rows * unit;

    canvas.width = w;
    canvas.height = h;
    canvas.style.width = w / dpr + "px";
    canvas.style.height = h / dpr + "px";

    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;

    const ink = Object.assign(
      {
        "#": P.cream,
        "+": P.amber,
        "*": P.mint,
        x: P.red,
        o: P.dirtDeep,
      },
      colors || {}
    );

    for (let row = 0; row < rows; row++) {
      const line = bitmap[row];
      for (let col = 0; col < cols; col++) {
        const ch = line[col];
        if (!ch || ch === ".") continue;
        const color = ink[ch];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(col * unit, row * unit, unit, unit);
      }
    }

    canvas.dataset.icon = name;
    canvas.dataset.iconSize = String(cssSize);
  }

  function paintAllIcons(root) {
    const scope = root || document;
    const list = scope.querySelectorAll
      ? scope.querySelectorAll("canvas[data-icon]")
      : [];
    for (let i = 0; i < list.length; i++) {
      const canvas = list[i];
      const name = canvas.dataset.icon;
      if (!ICONS[name]) continue;
      paintIcon(canvas, name, Number(canvas.dataset.iconSize) || 22);
    }
  }

  /* ---------------- WebAudio 合成音效 ---------------- */

  const Sound = {
    ctx: null,
    master: null,
    muted: Store.muted(),
    noiseBuffer: null,

    unlock: function () {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!this.ctx) {
        try {
          const ac = new AC();
          const master = ac.createGain();
          master.gain.value = this.muted ? 0 : 0.62;
          master.connect(ac.destination);
          this.ctx = ac;
          this.master = master;

          const length = Math.floor(ac.sampleRate * 0.4);
          const buffer = ac.createBuffer(1, length, ac.sampleRate);
          const data = buffer.getChannelData(0);
          for (let i = 0; i < length; i++) {
            data[i] = Math.random() * 2 - 1;
          }
          this.noiseBuffer = buffer;
        } catch (err) {
          return null;
        }
      }
      if (this.ctx.state === "suspended") {
        this.ctx.resume().catch(function () {});
      }
      return this.ctx;
    },

    setMuted: function (muted) {
      this.muted = !!muted;
      Store.setMuted(this.muted);
      if (this.ctx && this.master) {
        const now = this.ctx.currentTime;
        const gain = this.master.gain;
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(Math.max(0.0001, gain.value), now);
        gain.linearRampToValueAtTime(this.muted ? 0 : 0.62, now + 0.03);
      }
      return this.muted;
    },

    toggleMuted: function () {
      const next = !this.muted;
      this.setMuted(next);
      if (!next) {
        this.unlock();
        this.tone(520, 0.04, "square", 0.06);
      }
      return next;
    },

    _active: function () {
      return !this.muted && this.ctx && this.ctx.state === "running";
    },

    tone: function (freq, duration, type, volume, slideTo, delay) {
      if (!this._active()) return;
      const ac = this.ctx;
      const start = ac.currentTime + (delay || 0);
      const dur = Math.max(0.02, duration || 0.08);
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type || "square";
      osc.frequency.setValueAtTime(freq, start);
      if (slideTo) {
        osc.frequency.exponentialRampToValueAtTime(
          Math.max(20, slideTo),
          start + dur
        );
      }
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(
        Math.max(0.0002, volume || 0.08),
        start + 0.008
      );
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(start);
      osc.stop(start + dur + 0.03);
    },

    noise: function (duration, volume, filterType, frequency, delay) {
      if (!this._active() || !this.noiseBuffer) return;
      const ac = this.ctx;
      const start = ac.currentTime + (delay || 0);
      const dur = Math.max(0.02, duration || 0.05);
      const source = ac.createBufferSource();
      source.buffer = this.noiseBuffer;
      const filter = ac.createBiquadFilter();
      filter.type = filterType || "bandpass";
      filter.frequency.value = frequency || 1200;
      filter.Q.value = 0.7;
      const gain = ac.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(
        Math.max(0.0002, volume || 0.12),
        start + 0.008
      );
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      source.start(start);
      source.stop(start + dur + 0.02);
    },

    hit: function (combo) {
      if (!this._active()) return;
      const scale = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24, 27, 29, 31, 34];
      const step = scale[Math.min(combo, scale.length - 1)];
      const freq = 330 * Math.pow(2, step / 12);
      this.noise(0.045, 0.16, "bandpass", 1450);
      this.tone(freq, 0.075, "triangle", 0.15, freq * 1.35);
      this.tone(freq * 2, 0.04, "square", 0.045);
      this.tone(110, 0.06, "sine", 0.1);
    },

    gold: function (combo) {
      this.hit(combo);
      if (!this._active()) return;
      this.tone(1568, 0.07, "sine", 0.08, null, 0.03);
      this.tone(2093, 0.09, "sine", 0.06, null, 0.09);
      this.tone(2637, 0.08, "sine", 0.035, null, 0.15);
    },

    miss: function () {
      if (!this._active()) return;
      this.tone(120, 0.13, "sine", 0.2, 58);
      this.tone(80, 0.09, "triangle", 0.12, 52);
      this.noise(0.06, 0.12, "lowpass", 420);
    },

    spawn: function (gold) {
      if (!this._active()) return;
      this.tone(gold ? 720 : 230, 0.06, "triangle", gold ? 0.05 : 0.035, gold ? 1080 : 300);
      if (gold) {
        this.tone(1440, 0.06, "sine", 0.04, null, 0.045);
      }
    },

    tick: function (step) {
      if (!this._active()) return;
      const freq = step === 1 ? 960 : step === 2 ? 780 : 620;
      this.tone(freq, 0.055, "square", 0.075);
    },

    go: function () {
      if (!this._active()) return;
      this.tone(880, 0.09, "square", 0.09);
      this.tone(1320, 0.13, "triangle", 0.08, null, 0.07);
    },

    end: function () {
      if (!this._active()) return;
      this.tone(660, 0.12, "triangle", 0.12);
      this.tone(494, 0.12, "triangle", 0.11, null, 0.13);
      this.tone(330, 0.25, "triangle", 0.12, 294, 0.27);
    },

    tier: function () {
      if (!this._active()) return;
      this.tone(784, 0.06, "square", 0.07);
      this.tone(988, 0.06, "square", 0.065, null, 0.065);
      this.tone(1319, 0.1, "square", 0.06, null, 0.13);
    },

    ui: function () {
      if (!this._active()) return;
      this.tone(480, 0.035, "square", 0.045);
    },
  };

  /* ---------------- 导出 ---------------- */

  window.Arcade = {
    P: P,
    Store: Store,
    Sound: Sound,
    Font: {
      glyphs: GLYPHS,
      measure: measurePixelText,
      draw: drawPixelText,
      normalize: normalizeText,
    },
    PixelText: PixelText,
    Art: Art,
    Icons: {
      paint: paintIcon,
      paintAll: paintAllIcons,
      bitmaps: ICONS,
    },
    color: readPalette,
    util: {
      clamp: clamp,
      rand: rand,
      randInt: randInt,
      pick: pick,
      shuffle: shuffle,
      mulberry32: mulberry32,
      easeOutCubic: easeOutCubic,
      easeOutBack: easeOutBack,
      easeInQuad: easeInQuad,
      prefersReducedMotion: prefersReducedMotion,
    },
    ready: ready,
  };
})(window, document);
