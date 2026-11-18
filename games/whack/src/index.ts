import {
  P,
  clamp,
  defineGame,
  easeInQuad,
  easeOutBack,
  measurePixelText,
  drawPixelText,
  pick,
  prefersReducedMotion,
  rand,
  randInt,
  rect,
  type GameContext,
  type GameInstance,
} from "@arcade/core";

import { drawHammer, drawHoleBack, drawHoleFront, drawMole, drawSparkle, paintGrass } from "./art";
import { CURSOR_COLS, CURSOR_HOME, CURSOR_ROWS, moveCursor } from "./logic";
import { meta } from "./meta";

const W = 168;
const CELL = 48;
const GAP = 4;
const GRID = CELL + GAP;
const MARGIN = 8;
const ROUND_MS = 30000;
const CD_MS = 3000;

interface Level {
  spawn: number;
  up: number;
  goldUp: number;
  cap: number;
  goldChance: number;
}

const LEVELS: Level[] = [
  { spawn: 500, up: 1050, goldUp: 520, cap: 2, goldChance: 0.07 },
  { spawn: 420, up: 920, goldUp: 480, cap: 3, goldChance: 0.09 },
  { spawn: 340, up: 780, goldUp: 430, cap: 3, goldChance: 0.11 },
];

const TIER_COLORS = [P.cream, P.gold, P.orange, P.mint];

type Mode = "ready" | "countdown" | "playing" | "over";

interface Mole {
  kind: "brown" | "gold";
  born: number;
  hideAt: number;
  hitAt: number;
  seed: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  star: boolean;
}

interface Popup {
  text: string;
  x: number;
  y: number;
  color: string;
  born: number;
  life: number;
}

const game = defineGame({
  meta,
  create(ctx: GameContext): GameInstance {
    const canvas = ctx.surface.canvas;
    let mode: Mode = "ready";
    let clock = 0;
    let playStart = 0;
    let nextSpawn = 0;
    let lastCd = 4;
    let lastSec = -1;
    let level = -1;
    let lastTier = 1;
    let holes: (Mole | null)[] = new Array(9).fill(null);
    /** 键盘 / 虚拟手柄光标：0–8，默认中间格。 */
    let cursor = CURSOR_HOME;
    let hover = { x: 0, y: 0, inside: false };
    let strike: { x: number; y: number; until: number } | null = null;
    let markCell = -1;
    let markUntil = 0;
    let hammerVisible = false;
    let particles: Particle[] = [];
    let popups: Popup[] = [];
    let shake = 0;
    let flash = 0;
    let score = 0;
    let combo = 0;
    let maxCombo = 0;
    let hits = 0;
    let taps = 0;
    let golds = 0;
    let lastSpawn = -1;

    /* ---------------- 几何 ---------------- */

    const cellRect = (index: number): { x: number; y: number; cx: number; cy: number } => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      const x = MARGIN + col * GRID;
      const y = MARGIN + row * GRID;
      return { x, y, cx: x + CELL / 2, cy: y + 30 };
    };

    const cellAt = (x: number, y: number): number => {
      if (x < MARGIN || y < MARGIN || x >= W - MARGIN || y >= W - MARGIN) return -1;
      const rx = x - MARGIN;
      const ry = y - MARGIN;
      const col = Math.floor(rx / GRID);
      const row = Math.floor(ry / GRID);
      if (col < 0 || col > 2 || row < 0 || row > 2) return -1;
      if (rx - col * GRID >= CELL) return -1;
      if (ry - row * GRID >= CELL) return -1;
      return row * 3 + col;
    };

    const multFor = (value: number): number => (value >= 20 ? 4 : value >= 10 ? 3 : value >= 5 ? 2 : 1);
    const levelFor = (elapsed: number): number => (elapsed >= 20000 ? 2 : elapsed >= 10000 ? 1 : 0);

    /* ---------------- 静态层 ---------------- */

    let bgLayer: HTMLCanvasElement | null = null;
    let frontLayer: HTMLCanvasElement | null = null;

    const buildStaticLayers = (): void => {
      bgLayer = document.createElement("canvas");
      bgLayer.width = W;
      bgLayer.height = W;
      const bg = bgLayer.getContext("2d");
      if (bg) {
        bg.imageSmoothingEnabled = false;
        paintGrass(bg, W, W, 4242);
      }

      frontLayer = document.createElement("canvas");
      frontLayer.width = W;
      frontLayer.height = W;
      const front = frontLayer.getContext("2d");
      if (front) front.imageSmoothingEnabled = false;

      for (let i = 0; i < 9; i += 1) {
        const cell = cellRect(i);
        if (bg) drawHoleBack(bg, cell.cx, cell.cy);
        if (front) drawHoleFront(front, cell.cx, cell.cy);
      }
    };

    /* ---------------- HUD ---------------- */

    const flashStat = (key: string, cls: "is-bump" | "is-broken"): void => {
      ctx.hud.flash(key, cls);
    };

    const setScore = (value: number, bump: boolean): void => {
      score = value;
      ctx.hud.set("score", value);
      if (bump) flashStat("score", "is-bump");
    };

    const setCombo = (value: number, bump: boolean): void => {
      combo = value;
      const tier = multFor(value);
      ctx.hud.setColor("combo", TIER_COLORS[tier - 1]!);
      ctx.hud.set("combo", value);
      ctx.hud.setSuffix("combo", `×${tier}`, tier >= 4 ? "is-max" : tier >= 2 ? "is-hot" : "");
      if (bump) flashStat("combo", "is-bump");
    };

    const syncTime = (remaining: number, force = false): void => {
      const seconds = Math.max(0, Math.ceil(remaining / 1000));
      if (force || seconds !== lastSec) {
        lastSec = seconds;
        ctx.hud.set("time", remaining);
        const critical = seconds <= 5 && seconds > 0;
        ctx.hud.setColor("time", critical ? P.red : P.cream);
        ctx.hud.urgent(critical);
      }
      ctx.timer.set(remaining, ROUND_MS, { low: 10 / 30, critical: 5 / 30 });
    };

    /* ---------------- 粒子 / 飘字 ---------------- */

    const addParticles = (items: Particle[]): void => {
      for (const item of items) {
        particles.push(item);
        if (particles.length > 90) particles.shift();
      }
    };

    const addHitBurst = (index: number, gold: boolean): void => {
      const cell = cellRect(index);
      const colors = gold ? [P.gold, P.cream, P.white, P.amber] : [P.cream, P.amber, P.white, P.grassHi];
      const count = gold ? 16 : 10;
      const items: Particle[] = [];
      for (let i = 0; i < count; i += 1) {
        const life = rand(330, 540);
        items.push({
          x: cell.cx + rand(-8, 8),
          y: cell.y + 20 + rand(-6, 6),
          vx: rand(-95, 95),
          vy: rand(-185, -45),
          life,
          max: life,
          color: pick(colors),
          size: randInt(1, 2),
          star: Math.random() < (gold ? 0.32 : 0.16),
        });
      }
      addParticles(items);
    };

    const addDust = (x: number, y: number, count: number, gold: boolean): void => {
      const items: Particle[] = [];
      for (let i = 0; i < count; i += 1) {
        const life = rand(280, 520);
        items.push({
          x: x + rand(-8, 8),
          y: y + rand(-2, 4),
          vx: rand(-35, 35),
          vy: rand(-72, -16),
          life,
          max: life,
          color: gold ? pick([P.gold, P.amber, P.cream]) : pick([P.dirtHi, P.dirt, P.grassHi]),
          size: 1,
          star: gold && Math.random() < 0.35,
        });
      }
      addParticles(items);
    };

    const addPopup = (text: string, x: number, y: number, color: string): void => {
      popups.push({ text, x, y, color, born: clock, life: 720 });
      if (popups.length > 12) popups.shift();
    };

    const updateParticles = (dt: number): void => {
      const seconds = dt / 1000;
      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const p = particles[i]!;
        p.life -= dt;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        p.x += p.vx * seconds;
        p.y += p.vy * seconds;
        p.vy += 520 * seconds;
      }
    };

    const updatePopups = (): void => {
      for (let i = popups.length - 1; i >= 0; i -= 1) {
        if (clock - popups[i]!.born > popups[i]!.life) popups.splice(i, 1);
      }
    };

    /* ---------------- 流程 ---------------- */

    const resetRun = (): void => {
      clock = 0;
      playStart = 0;
      nextSpawn = 0;
      lastCd = 4;
      level = -1;
      lastTier = 1;
      holes = new Array(9).fill(null);
      cursor = CURSOR_HOME;
      particles = [];
      popups = [];
      shake = 0;
      flash = 0;
      maxCombo = 0;
      hits = 0;
      taps = 0;
      golds = 0;
      lastSpawn = -1;
      hover.inside = false;
      strike = null;
      markCell = -1;
      markUntil = 0;
      hammerVisible = false;
      canvas.classList.remove("has-hammer");

      score = 0;
      combo = 0;
      lastSec = -1;
      ctx.hud.set("score", 0);
      ctx.hud.setColor("combo", P.cream);
      ctx.hud.set("combo", 0);
      ctx.hud.setSuffix("combo", "×1");
      ctx.hud.urgent(false);
      syncTime(ROUND_MS, true);
    };

    const beginPlaying = (): void => {
      playStart = clock;
      nextSpawn = clock + 430;
      level = -1;
      lastCd = 0;
      mode = "playing";
      ctx.audio.go();
      syncTime(ROUND_MS, true);
      ctx.announce("开始，30 秒。");
    };

    const finishRound = (): void => {
      mode = "over";
      ctx.audio.end();
      holes = new Array(9).fill(null);
      particles = [];
      popups = [];
      strike = null;
      hover.inside = false;
      shake = 0;
      flash = 0;
      ctx.hud.set("time", 0);
      ctx.timer.hide();
      ctx.hud.urgent(false);

      const accuracy = taps ? Math.round((hits / taps) * 100) : 0;
      ctx.end({
        score,
        title: "时间到",
        kicker: "TIME UP",
        stats: [
          { label: "最高连击", value: maxCombo },
          { label: "命中率", value: `${accuracy}%` },
        ],
      });
    };

    /* ---------------- 生成 / 敲击 ---------------- */

    const updateSpawning = (): void => {
      if (clock < nextSpawn) return;
      const cfg = LEVELS[level] ?? LEVELS[0]!;

      let active = 0;
      for (let i = 0; i < 9; i += 1) if (holes[i]) active += 1;
      if (active >= cfg.cap) {
        nextSpawn = clock + 150;
        return;
      }

      let free: number[] = [];
      for (let i = 0; i < 9; i += 1) if (!holes[i]) free.push(i);
      if (!free.length) {
        nextSpawn = clock + 120;
        return;
      }

      if (free.length > 1 && lastSpawn >= 0) {
        const filtered = free.filter((n) => n !== lastSpawn);
        if (filtered.length) free = filtered;
      }

      const index = free[Math.floor(Math.random() * free.length)]!;
      const gold = golds < 3 && Math.random() < cfg.goldChance;
      const up = gold ? cfg.goldUp : cfg.up;
      const cell = cellRect(index);

      holes[index] = {
        kind: gold ? "gold" : "brown",
        born: clock,
        hideAt: clock + up,
        hitAt: 0,
        seed: Math.random() * 6.28,
      };
      if (gold) golds += 1;
      lastSpawn = index;
      nextSpawn = clock + cfg.spawn * rand(0.85, 1.15);

      addDust(cell.cx, cell.cy + 1, gold ? 6 : 3, gold);
      ctx.audio.spawn(gold);
    };

    const hitMole = (index: number, mole: Mole): void => {
      const cell = cellRect(index);
      hits += 1;
      combo += 1;
      if (combo > maxCombo) maxCombo = combo;

      const tier = multFor(combo);
      const base = mole.kind === "gold" ? 30 : 10;
      const points = base * tier;

      mole.hitAt = clock;
      mole.hideAt = Math.min(mole.hideAt, clock + 185);

      setScore(score + points, true);
      setCombo(combo, true);

      if (tier > lastTier) {
        lastTier = tier;
        ctx.toast.show(`倍率 ×${tier}`);
        ctx.audio.tier();
      }

      if (mole.kind === "gold") ctx.audio.gold(combo);
      else ctx.audio.hit(combo);

      addHitBurst(index, mole.kind === "gold");
      addPopup(`+${points}`, cell.cx, Math.max(20, cell.y + 9), mole.kind === "gold" ? P.gold : P.cream);

      if (!prefersReducedMotion()) {
        shake = Math.max(shake, 2.5);
        flash = 1;
      } else {
        flash = 0.55;
      }
    };

    const missAt = (x: number, y: number, index: number): void => {
      const previousCombo = combo;
      if (index >= 0) {
        const cell = cellRect(index);
        x = cell.cx;
        y = cell.cy + 4;
      }

      setCombo(0, false);
      lastTier = 1;
      flashStat("combo", "is-broken");
      ctx.audio.miss();

      addPopup("MISS", x, Math.max(20, y - 2), P.red);
      addDust(x, y, 5, false);

      if (previousCombo >= 3) ctx.toast.show("连击中断", { warn: true });
    };

    const tapAt = (x: number, y: number, forcedIndex?: number): void => {
      if (mode !== "playing") return;
      taps += 1;

      const index = typeof forcedIndex === "number" ? forcedIndex : cellAt(x, y);

      if (index >= 0) {
        markCell = index;
        markUntil = clock + 180;
      }

      if (index < 0) {
        missAt(x, y, -1);
        return;
      }

      const mole = holes[index];
      if (!mole) {
        missAt(x, y, index);
        return;
      }

      if (mole.hitAt || clock >= mole.hideAt) {
        // 已经敲中、正在缩回去的地鼠不再罚连击
        return;
      }

      hitMole(index, mole);
    };

    const keyStrike = (index: number): void => {
      if (mode !== "playing") return;
      const cell = cellRect(index);
      hover.inside = false;
      markCell = index;
      markUntil = clock + 200;
      strike = { x: cell.cx, y: cell.cy, until: clock + 165 };
      ctx.audio.unlock();
      tapAt(cell.cx, cell.cy, index);
    };

    /* ---------------- 绘制 ---------------- */

    const drawHover = (): void => {
      let index = -1;
      if (hover.inside) index = cellAt(hover.x, hover.y);
      if (index < 0 && markCell >= 0 && clock < markUntil) index = markCell;
      if (index < 0) return;

      const c = cellRect(index);
      const arm = 7;
      const pad = 2;
      const x = c.x + pad;
      const y = c.y + pad;
      const right = c.x + CELL - pad;
      const bottom = c.y + CELL - pad;

      ctx.ctx.save();
      ctx.ctx.globalAlpha = 0.82;
      ctx.ctx.fillStyle = P.amber;
      ctx.ctx.fillRect(x, y, arm, 1);
      ctx.ctx.fillRect(x, y, 1, arm);
      ctx.ctx.fillRect(right - arm, y, arm, 1);
      ctx.ctx.fillRect(right, y, 1, arm);
      ctx.ctx.fillRect(x, bottom - 1, arm, 1);
      ctx.ctx.fillRect(x, bottom - arm, 1, arm);
      ctx.ctx.fillRect(right - arm, bottom - 1, arm, 1);
      ctx.ctx.fillRect(right, bottom - arm, 1, arm);
      ctx.ctx.restore();
    };

    /**
     * 虚拟手柄光标：只画土坑四角的 2px 短角标，贴在外圈泥环上，
     * 地鼠本体（半宽最大 14px）和耳朵都在角标内侧，不会被遮住。
     */
    const drawPadCursor = (): void => {
      if (mode !== "playing" || !ctx.padVisible()) return;

      const cell = cellRect(cursor);
      const left = cell.cx - 24;
      const right = cell.cx + 24;
      const top = cell.cy - 8;
      const bottom = cell.cy + 12;
      const arm = 6;
      const c = ctx.ctx;

      c.save();
      c.fillStyle = P.gold;
      c.fillRect(left, top, arm, 2);
      c.fillRect(left, top, 2, arm);
      c.fillRect(right - arm + 1, top, arm, 2);
      c.fillRect(right - 1, top, 2, arm);
      c.fillRect(left, bottom - 1, arm, 2);
      c.fillRect(left, bottom - arm + 1, 2, arm);
      c.fillRect(right - arm + 1, bottom - 1, arm, 2);
      c.fillRect(right - 1, bottom - arm + 1, 2, arm);

      // 角尖点一颗奶油色像素，金色在草地上更跳。
      c.fillStyle = P.cream;
      c.fillRect(left, top, 2, 2);
      c.fillRect(right - 1, top, 2, 2);
      c.fillRect(left, bottom - 1, 2, 2);
      c.fillRect(right - 1, bottom - 1, 2, 2);
      c.restore();
    };

    const drawMoleAt = (index: number, mole: Mole): void => {
      const c = cellRect(index);
      let offset = 0;

      if (mole.hitAt) {
        const hitT = clamp((clock - mole.hitAt) / 180, 0, 1);
        offset = Math.round(34 * easeInQuad(hitT));
      } else {
        const riseT = clamp((clock - mole.born) / 125, 0, 1);
        offset = Math.round(34 * (1 - easeOutBack(riseT)));
        const retractStart = mole.hideAt - 130;
        if (clock > retractStart) {
          const rT = clamp((clock - retractStart) / 130, 0, 1);
          offset = Math.max(offset, Math.round(34 * easeInQuad(rT)));
        }
      }

      const isFlash = !!mole.hitAt && clock - mole.hitAt < 60;

      ctx.ctx.save();
      ctx.ctx.beginPath();
      ctx.ctx.rect(c.x, c.y, CELL, 38);
      ctx.ctx.clip();
      drawMole(ctx.ctx, c.cx, c.cy - 24 + offset, mole.kind, { hit: !!mole.hitAt, flash: isFlash });
      ctx.ctx.restore();

      if (mole.kind === "gold" && !mole.hitAt && clock - mole.born > 80) {
        const t = (clock - mole.born) / 260 + mole.seed;
        drawSparkle(
          ctx.ctx,
          c.cx - 18 + Math.round(Math.sin(t) * 2),
          c.cy - 26,
          Math.sin(t * 1.7) > 0.2 ? 2 : 1,
          P.gold,
        );
        drawSparkle(
          ctx.ctx,
          c.cx + 18,
          c.cy - 9 + Math.round(Math.cos(t * 1.3) * 2),
          1,
          P.amber,
        );
      }
    };

    const drawParticles = (): void => {
      const c = ctx.ctx;
      for (const p of particles) {
        if (p.life <= 0) continue;
        c.globalAlpha = Math.min(1, p.life / 160);
        if (p.star) drawSparkle(c, p.x, p.y, p.size + 1, p.color);
        else rect(c, p.x, p.y, p.size, p.size, p.color);
      }
      c.globalAlpha = 1;
    };

    const drawHammerLocal = (): void => {
      hammerVisible = false;
      if (mode !== "playing") return;
      const isStrike = !!(strike && clock < strike.until);
      let point: { x: number; y: number } | null = null;
      if (hover.inside) point = hover;
      else if (isStrike && strike) point = strike;
      if (!point) return;
      drawHammer(ctx.ctx, point.x, point.y, isStrike);
      hammerVisible = true;
    };

    const drawPopups = (): void => {
      const c = ctx.ctx;
      for (const p of popups) {
        const age = clock - p.born;
        if (age < 0 || age > p.life) continue;
        const k = age / p.life;
        const alpha = 1 - k * k;
        const width = measurePixelText(p.text, 2);
        const x = clamp(p.x, width / 2 + 3, W - width / 2 - 3);
        const y = p.y - Math.round(k * 13);
        c.globalAlpha = Math.max(0, alpha);
        drawPixelText(c, p.text, x - width / 2, y, 2, p.color, P.void);
        c.globalAlpha = 1;
      }
    };

    const drawCountdown = (): void => {
      const c = ctx.ctx;
      const remaining = Math.max(0, CD_MS - clock);
      const n = clamp(Math.ceil(remaining / 1000), 1, 3);
      const color = n === 1 ? P.red : n === 2 ? P.gold : P.amber;

      c.save();
      c.globalAlpha = 0.6;
      c.fillStyle = P.void;
      c.fillRect(0, 0, W, W);
      c.globalAlpha = 1;

      rect(c, 24, 28, 128, 122, P.void);
      rect(c, 20, 24, 128, 122, P.night);
      rect(c, 20, 24, 128, 2, P.lineHi);
      rect(c, 20, 144, 128, 2, P.lineHi);
      rect(c, 20, 24, 2, 122, P.lineHi);
      rect(c, 146, 24, 2, 122, P.lineHi);
      rect(c, 22, 26, 124, 2, P.amber);

      rect(c, 24, 30, 2, 2, P.cream);
      rect(c, 142, 30, 2, 2, P.cream);
      rect(c, 24, 138, 2, 2, P.cream);
      rect(c, 142, 138, 2, 2, P.cream);

      const label = "GET READY";
      const labelW = measurePixelText(label, 2);
      drawPixelText(c, label, (W - labelW) / 2, 39, 2, P.lav, P.void);

      const text = String(n);
      const textW = measurePixelText(text, 10);
      drawPixelText(c, text, (W - textW) / 2, 60, 10, color, P.orange);

      for (let i = 0; i < 3; i += 1) {
        rect(c, 71 + i * 10, 135, 6, 4, i < n ? color : P.line);
      }

      c.restore();
    };

    const drawGo = (): void => {
      const t = clock - playStart;
      if (t < 0 || t > 430) return;
      const k = clamp(t / 430, 0, 1);
      const c = ctx.ctx;
      c.save();
      c.globalAlpha = 0.26 * (1 - k * 0.5);
      c.fillStyle = P.void;
      c.fillRect(0, 0, W, W);
      c.globalAlpha = 1;
      const size = 8;
      const width = measurePixelText("GO!", size);
      drawPixelText(c, "GO!", (W - width) / 2, 52, size, P.mint, P.dirtDeep);
      c.restore();
    };

    const render = (): void => {
      const c = ctx.ctx;
      c.fillStyle = P.grassDeep;
      c.fillRect(0, 0, W, W);

      let sx = 0;
      let sy = 0;
      if (shake > 0.2) {
        sx = Math.round(Math.sin(clock * 0.09) * shake);
        sy = Math.round(Math.cos(clock * 0.115) * shake * 0.7);
      }

      c.save();
      c.translate(sx, sy);

      if (bgLayer) c.drawImage(bgLayer, 0, 0);

      if (mode === "playing") drawHover();

      for (let i = 0; i < 9; i += 1) {
        const mole = holes[i];
        if (mole) drawMoleAt(i, mole);
      }

      if (frontLayer) c.drawImage(frontLayer, 0, 0);

      drawPadCursor();

      drawParticles();

      if (flash > 0) {
        c.globalAlpha = Math.min(0.18, flash * 0.18);
        c.fillStyle = P.white;
        c.fillRect(0, 0, W, W);
        c.globalAlpha = 1;
      }

      drawHammerLocal();
      drawPopups();

      c.restore();

      canvas.classList.toggle("has-hammer", hammerVisible);

      if (mode === "countdown") drawCountdown();
      else if (mode === "playing" && clock - playStart < 430) drawGo();
    };

    /* ---------------- 输入绑定 ---------------- */

    ctx.input.pointer.on("down", (info) => {
      ctx.audio.unlock();
      if (mode !== "playing") return;
      if (info.source.pointerType === "mouse" && info.source.button !== 0) return;

      if (info.source.pointerType === "mouse" || info.source.pointerType === "pen") {
        hover = { x: info.x, y: info.y, inside: true };
      } else {
        hover.inside = false;
      }
      const index = cellAt(info.x, info.y);
      // 点过哪一格，手柄光标就停在哪一格，下一次 A 键不会敲偏。
      if (index >= 0) cursor = index;
      strike = { x: info.x, y: info.y, until: clock + 155 };
      tapAt(info.x, info.y, index >= 0 ? index : undefined);
    });

    ctx.input.pointer.on("move", (info) => {
      if (mode !== "playing") return;
      if (info.source.pointerType === "touch") return;
      hover = { x: info.x, y: info.y, inside: true };
    });

    ctx.input.pointer.on("leave", (info) => {
      if (info.source.pointerType === "touch") return;
      hover.inside = false;
      hammerVisible = false;
      canvas.classList.remove("has-hammer");
    });

    ctx.input.pointer.on("cancel", () => {
      hover.inside = false;
      hammerVisible = false;
      canvas.classList.remove("has-hammer");
    });

    ctx.input.keys.onPress((action) => {
      if (action.startsWith("slot")) {
        const index = Number(action.slice(4)) - 1;
        if (index >= 0 && index < 9) keyStrike(index);
        return;
      }

      if (action === "left" || action === "right" || action === "up" || action === "down") {
        hover.inside = false;
        cursor = moveCursor(cursor, action, CURSOR_COLS, CURSOR_ROWS);
        return;
      }

      if (action === "action") {
        hover.inside = false;
        keyStrike(cursor);
      }
    });

    buildStaticLayers();
    resetRun();

    return {
      start(): void {
        ctx.audio.unlock();
        ctx.audio.ui();
        resetRun();
        mode = "countdown";
        clock = 0;
        ctx.announce("倒计时三秒。");
      },

      update(dt: number): void {
        clock += dt;

        if (mode === "countdown") {
          const remaining = Math.max(0, CD_MS - clock);
          const n = Math.max(1, Math.ceil(remaining / 1000));
          if (n !== lastCd) {
            lastCd = n;
            ctx.audio.tick(n);
          }
          if (clock >= CD_MS) beginPlaying();
          return;
        }

        if (mode !== "playing") return;

        for (let i = 0; i < 9; i += 1) {
          const mole = holes[i];
          if (mole && clock >= mole.hideAt) holes[i] = null;
        }

        const elapsed = clock - playStart;
        if (elapsed >= ROUND_MS) {
          finishRound();
          return;
        }

        const nextLevel = levelFor(elapsed);
        if (nextLevel !== level) {
          if (level >= 0 && nextLevel > level) {
            ctx.toast.show("速度提升");
            ctx.audio.tier();
          }
          level = nextLevel;
        }

        updateSpawning();
        syncTime(ROUND_MS - elapsed);
        updateParticles(dt);
        updatePopups();

        shake = Math.max(0, shake - dt * 0.024);
        flash = Math.max(0, flash - dt * 0.02);
      },

      render,

      pause(): void {
        hover.inside = false;
        strike = null;
        hammerVisible = false;
        canvas.classList.remove("has-hammer");
      },
    };
  },
});

export default game;
