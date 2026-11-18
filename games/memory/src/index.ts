import {
  P,
  clamp,
  defineGame,
  drawPixelText,
  measurePixelText,
  rect,
  strokeRect,
  type GameContext,
  type GameInstance,
} from "@arcade/core";

import { CARD_SIZE, ICON_IDS, drawCardBack, drawCardFace } from "./art";
import { meta } from "./meta";

/**
 * 记忆翻牌：4×4 共 16 张牌、8 对图案。
 * 逻辑尺寸 168×168 = 4 张 36px 牌 + 3 个 4px 间隙 + 两侧 6px 边距。
 */
const W = 168;
const H = 168;
const COLS = 4;
const ROWS = 4;
const PAIRS = 8;
const MARGIN = 6;
const GAP = 4;
const STEP = CARD_SIZE + GAP;
/** 翻牌动画：宽度 1 → 0 → 1，中点换面。 */
const FLIP_MS = 160;
/** 翻错后正面停留时间（中点换面之后开始计时）。 */
const MISMATCH_PAUSE_MS = 550;
/** 最后一对配对后，先展示一下再结算。 */
const FINISH_HOLD_MS = 480;
/** 配对成功的金色描边时长。 */
const MATCH_GLOW_MS = 320;

type Phase = "ready" | "playing" | "over";

interface Card {
  icon: number;
  faceUp: boolean;
  matched: boolean;
  /** 本次翻动开始前显示的是哪一面。 */
  fromFace: boolean;
  /** 翻动开始时刻；-1 表示静止。 */
  flipAt: number;
  /** 配对成功的高亮起点；-1 表示没有。 */
  glowAt: number;
}

interface Visual {
  left: number;
  top: number;
  width: number;
  faceUp: boolean;
  matched: boolean;
}

/**
 * 8 对图案洗成 16 张。random 可注入，单测里配合 mulberry32 复现。
 */
export function buildDeck(random: () => number = Math.random): number[] {
  const deck: number[] = [];
  for (let i = 0; i < ICON_IDS.length; i += 1) deck.push(i, i);
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    const swap = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = swap;
  }
  return deck;
}

/** 正确率：配对成功次数 / 翻牌尝试次数，钳在 0–100。 */
export function accuracyPercent(matchedPairs: number, attempts: number): number {
  if (attempts <= 0) return 0;
  return clamp(Math.round((matchedPairs / attempts) * 100), 0, 100);
}

/** 用时（毫秒）→ 低分模式的整数秒；最少 1 秒、最多 999 秒，避免溢出。 */
export function timeScore(elapsedMs: number): number {
  return clamp(Math.ceil(Math.max(0, elapsedMs) / 1000), 1, 999);
}

const cardX = (index: number): number => MARGIN + (index % COLS) * STEP;
const cardY = (index: number): number => MARGIN + Math.floor(index / COLS) * STEP;

const game = defineGame({
  meta,
  create(ctx: GameContext): GameInstance {
    let phase: Phase = "ready";
    let clock = 0;
    let cards: Card[] = [];
    /** 当前翻开、尚未判定的牌（最多两张）。 */
    let open: number[] = [];
    let mismatch: [number, number] | null = null;
    /** 翻错停顿结束时刻，期间不接受新点击。 */
    let lockUntil = 0;
    /** 第一次翻牌的时刻；-1 表示计时还没开始。 */
    let runStart = -1;
    let moves = 0;
    let pairs = 0;
    let lastSec = -1;
    let cursor = 0;
    let keyboardActive = false;
    let hoverIndex = -1;
    /** 最后一对配对后的结算时刻；-1 表示还没通关。 */
    let finishAt = -1;
    let finalScore = 0;
    let ended = false;

    /* ---------------- 状态 ---------------- */

    const reset = (): void => {
      cards = buildDeck().map((icon) => ({
        icon,
        faceUp: false,
        matched: false,
        fromFace: false,
        flipAt: -1,
        glowAt: -1,
      }));
      open = [];
      mismatch = null;
      lockUntil = 0;
      runStart = -1;
      moves = 0;
      pairs = 0;
      lastSec = -1;
      cursor = 0;
      keyboardActive = false;
      hoverIndex = -1;
      finishAt = -1;
      finalScore = 0;
      ended = false;
      clock = 0;

      ctx.hud.set("time", 0);
      ctx.hud.set("moves", 0);
      ctx.hud.set("pairs", 0);
      ctx.hud.urgent(false);
    };

    const cardAt = (x: number, y: number): number => {
      if (x < MARGIN || y < MARGIN) return -1;
      const col = Math.floor((x - MARGIN) / STEP);
      const row = Math.floor((y - MARGIN) / STEP);
      if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return -1;
      if (x - MARGIN - col * STEP >= CARD_SIZE) return -1;
      if (y - MARGIN - row * STEP >= CARD_SIZE) return -1;
      return row * COLS + col;
    };

    const isFlipping = (card: Card): boolean =>
      card.flipAt >= 0 && clock - card.flipAt < FLIP_MS;

    const flipCard = (card: Card, faceUp: boolean): void => {
      card.fromFace = card.faceUp;
      card.faceUp = faceUp;
      card.flipAt = ctx.reducedMotion ? -1 : clock;
    };

    /* ---------------- 流程 ---------------- */

    const scheduleFinish = (): void => {
      const elapsed = runStart >= 0 ? clock - runStart : 0;
      finalScore = timeScore(elapsed);
      finishAt = clock + FINISH_HOLD_MS;
      lastSec = Math.ceil(elapsed / 1000);
      ctx.hud.set("time", Math.min(elapsed, 999000));
      ctx.audio.win();
      ctx.announce(`全部配对，用时 ${finalScore} 秒。`);
    };

    const attemptFlip = (index: number): void => {
      if (phase !== "playing" || finishAt >= 0 || mismatch || clock < lockUntil) return;
      const card = cards[index];
      if (!card || card.matched || card.faceUp || isFlipping(card)) return;

      if (runStart < 0) {
        runStart = clock;
        ctx.announce("开始计时。");
      }

      flipCard(card, true);
      ctx.audio.blip();
      open.push(index);
      if (open.length < 2) return;

      const first = cards[open[0]!]!;
      moves += 1;
      ctx.hud.set("moves", moves);
      ctx.hud.flash("moves", "is-bump");

      if (first.icon === card.icon) {
        first.matched = true;
        card.matched = true;
        pairs += 1;
        first.glowAt = clock;
        card.glowAt = clock;
        open = [];
        ctx.hud.set("pairs", pairs);
        ctx.hud.flash("pairs", "is-bump");
        ctx.audio.coin();
        if (pairs >= PAIRS) scheduleFinish();
        return;
      }

      mismatch = [open[0]!, open[1]!];
      lockUntil = clock + FLIP_MS / 2 + MISMATCH_PAUSE_MS;
      ctx.audio.miss();
    };

    const moveCursor = (dx: number, dy: number): void => {
      const col = cursor % COLS;
      const row = Math.floor(cursor / COLS);
      cursor = ((row + dy + ROWS) % ROWS) * COLS + ((col + dx + COLS) % COLS);
      keyboardActive = true;
      hoverIndex = -1;
    };

    /* ---------------- 绘制 ---------------- */

    const paintTable = (): void => {
      const c = ctx.ctx;
      rect(c, 0, 0, W, H, P.night);
      for (let y = 8; y < H; y += 8) {
        for (let x = 8; x < W; x += 8) rect(c, x, y, 1, 1, P.panel);
      }
      rect(c, 0, 0, W, 1, P.line);
      rect(c, 0, H - 1, W, 1, P.line);
      rect(c, 0, 0, 1, H, P.line);
      rect(c, W - 1, 0, 1, H, P.line);
    };

    const visualOf = (index: number): Visual => {
      const card = cards[index]!;
      const x = cardX(index);
      const y = cardY(index);
      if (card.flipAt < 0) {
        return { left: x, top: y, width: CARD_SIZE, faceUp: card.faceUp, matched: card.matched };
      }
      const progress = clamp((clock - card.flipAt) / FLIP_MS, 0, 1);
      const scale = Math.max(0.04, Math.abs(1 - progress * 2));
      const width = Math.max(1, Math.round(CARD_SIZE * scale));
      return {
        left: x + Math.round((CARD_SIZE - width) / 2),
        top: y,
        width,
        faceUp: progress >= 0.5 ? card.faceUp : card.fromFace,
        matched: card.matched,
      };
    };

    const drawShadows = (): void => {
      const c = ctx.ctx;
      for (let i = 0; i < cards.length; i += 1) {
        const visual = visualOf(i);
        rect(c, visual.left + 2, visual.top + 2, visual.width, CARD_SIZE, P.void);
      }
    };

    const drawCardAt = (index: number): void => {
      const c = ctx.ctx;
      const card = cards[index]!;
      const visual = visualOf(index);

      c.save();
      c.beginPath();
      c.rect(visual.left, visual.top, visual.width, CARD_SIZE);
      c.clip();
      if (visual.faceUp) {
        drawCardFace(c, ICON_IDS[card.icon]!, cardX(index), cardY(index), visual.matched);
      } else {
        drawCardBack(c, cardX(index), cardY(index));
      }
      c.restore();

      const x = cardX(index);
      const y = cardY(index);

      // 翻错：红色描边提示，等两张牌都翻完再画
      if (mismatch && card.flipAt < 0 && (index === mismatch[0] || index === mismatch[1])) {
        strokeRect(c, x - 1, y - 1, CARD_SIZE + 2, CARD_SIZE + 2, P.red, 1);
      }

      // 配对成功：金色描边淡出
      if (card.glowAt >= 0) {
        const age = clock - card.glowAt;
        if (age >= 0 && age < MATCH_GLOW_MS) {
          c.globalAlpha = 1 - age / MATCH_GLOW_MS;
          strokeRect(c, x - 2, y - 2, CARD_SIZE + 4, CARD_SIZE + 4, P.gold, 1);
          c.globalAlpha = 1;
        }
      }
    };

    const drawBrackets = (index: number, color: string, alpha: number): void => {
      const c = ctx.ctx;
      const left = cardX(index) - 3;
      const top = cardY(index) - 3;
      const right = left + CARD_SIZE + 6;
      const bottom = top + CARD_SIZE + 6;
      const arm = 7;

      c.globalAlpha = alpha;
      c.fillStyle = color;
      c.fillRect(left, top, arm, 1);
      c.fillRect(left, top, 1, arm);
      c.fillRect(right - arm, top, arm, 1);
      c.fillRect(right, top, 1, arm);
      c.fillRect(left, bottom - 1, arm, 1);
      c.fillRect(left, bottom - arm, 1, arm);
      c.fillRect(right - arm, bottom - 1, arm, 1);
      c.fillRect(right, bottom - arm, 1, arm);
      c.globalAlpha = 1;
    };

    const drawFinishBanner = (): void => {
      if (finishAt < 0) return;
      const c = ctx.ctx;
      const accuracy = accuracyPercent(pairs, moves);
      const label = accuracy >= 100 ? "PERFECT" : "CLEAR";
      const width = measurePixelText(label, 3);
      const age = clock - (finishAt - FINISH_HOLD_MS);
      const k = ctx.reducedMotion ? 1 : clamp(age / 160, 0, 1);

      c.save();
      c.globalAlpha = 0.66 * k;
      c.fillStyle = P.void;
      c.fillRect(0, 64, W, 40);
      c.globalAlpha = k;
      drawPixelText(c, label, Math.round((W - width) / 2), 73, 3, P.gold, P.orange);
      c.restore();
    };

    const render = (): void => {
      paintTable();
      drawShadows();
      for (let i = 0; i < cards.length; i += 1) drawCardAt(i);

      if (phase === "playing" && finishAt < 0) {
        const target = hoverIndex >= 0 ? hoverIndex : keyboardActive ? cursor : -1;
        if (target >= 0) {
          drawBrackets(target, hoverIndex >= 0 ? P.amber : P.gold, hoverIndex >= 0 ? 0.75 : 0.95);
        }
      }

      drawFinishBanner();
    };

    /* ---------------- 输入 ---------------- */

    ctx.input.pointer.on("down", (info) => {
      ctx.audio.unlock();
      if (info.source.pointerType === "mouse" && info.source.button !== 0) return;
      if (phase !== "playing" || finishAt >= 0) return;

      const index = cardAt(info.x, info.y);
      hoverIndex = info.source.pointerType === "touch" ? -1 : index;
      keyboardActive = false;
      if (index < 0) return;

      cursor = index;
      attemptFlip(index);
    });

    ctx.input.pointer.on("move", (info) => {
      if (info.source.pointerType === "touch") return;
      hoverIndex = phase === "playing" ? cardAt(info.x, info.y) : -1;
    });

    ctx.input.pointer.on("leave", () => {
      hoverIndex = -1;
    });

    ctx.input.pointer.on("cancel", () => {
      hoverIndex = -1;
    });

    ctx.input.keys.onPress((action) => {
      if (phase !== "playing" || finishAt >= 0) return;
      if (action === "left") moveCursor(-1, 0);
      else if (action === "right") moveCursor(1, 0);
      else if (action === "up") moveCursor(0, -1);
      else if (action === "down") moveCursor(0, 1);
      else if (action === "action") {
        keyboardActive = true;
        hoverIndex = -1;
        ctx.audio.unlock();
        attemptFlip(cursor);
      }
    });

    reset();

    return {
      start(): void {
        reset();
        phase = "playing";
        ctx.audio.unlock();
        ctx.announce("翻开两张牌，配出八对图案。");
      },

      update(dt: number): void {
        if (phase === "over") return;
        clock += dt;

        // 收尾翻牌动画
        for (const card of cards) {
          if (card.flipAt >= 0 && clock - card.flipAt >= FLIP_MS) card.flipAt = -1;
        }

        // 翻错停顿结束，盖回两张牌；盖回动画结束前也不接受新点击
        if (mismatch && clock >= lockUntil) {
          for (const index of open) {
            const card = cards[index]!;
            if (!card.matched) flipCard(card, false);
          }
          open = [];
          mismatch = null;
          lockUntil = clock + FLIP_MS;
        }

        // 第一次翻牌后才开始计时
        if (runStart >= 0 && finishAt < 0) {
          const elapsed = clock - runStart;
          const seconds = Math.max(0, Math.ceil(elapsed / 1000));
          if (seconds !== lastSec) {
            lastSec = seconds;
            ctx.hud.set("time", Math.min(elapsed, 999000));
          }
        }

        // 通关：展示完最后一对，交给壳层结算
        if (finishAt >= 0 && clock >= finishAt && !ended) {
          ended = true;
          phase = "over";
          const accuracy = accuracyPercent(pairs, moves);
          ctx.end({
            score: finalScore,
            title: "全部配对",
            kicker: accuracy >= 100 ? "PERFECT" : "CLEAR",
            stats: [
              { label: "步数", value: moves },
              { label: "正确率", value: `${accuracy}%` },
            ],
          });
        }
      },

      render,

      pause(): void {
        hoverIndex = -1;
      },
    };
  },
});

export default game;
