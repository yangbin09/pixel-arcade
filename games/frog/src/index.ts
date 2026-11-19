import {
  P,
  defineGame,
  drawPixelText,
  measurePixelText,
  rect,
  type GameContext,
  type GameInstance,
} from "@arcade/core";

import {
  drawCar,
  drawFrog,
  drawHitBurst,
  drawLog,
  drawSplash,
  paintBackdrop,
} from "./art";
import { meta } from "./meta";
import {
  CAR_H,
  GOAL_BONUS,
  GOAL_ROW,
  LIVES,
  LOG_H,
  RIVER_FROM,
  ROUND_MS,
  SCORE_PER_ROW,
  START_COL,
  START_ROW,
  advanceScore,
  carHitsPlayer,
  carLane,
  cellCenter,
  colForX,
  dirFromTap,
  hopPosition,
  isOutOfCanvas,
  laneObjects,
  laneTravel,
  logLane,
  logUnder,
  movePlayer,
  nextBestRow,
  rowKind,
  xForCol,
  type Dir,
} from "./logic";

const W = meta.size.w;
const H = meta.size.h;

/** 一次跳跃的动画时长（毫秒）；期间不接受新输入，避免一帧连跳两格。 */
const HOP_MS = 110;
/** 掉命后的短暂停顿，用来放落水 / 撞击反馈。 */
const RESPAWN_MS = 540;
/** 受伤闪烁时长。 */
const HURT_MS = 700;
const SPLASH_MS = 420;
const HIT_MS = 320;
const POPUP_MS = 720;
const MAX_EFFECTS = 5;
const MAX_POPUPS = 3;
const MAX_SCORE = 99_999;
/** 剩余时间低于该值时 HUD 进入警戒态。 */
const URGENT_MS = 10_000;

type Mode = "ready" | "playing" | "over";
type EffectKind = "splash" | "hit" | "goal";

interface Hop {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** 0 → 1 的进度。 */
  t: number;
  flip: boolean;
}

interface Effect {
  alive: boolean;
  kind: EffectKind;
  x: number;
  y: number;
  born: number;
  life: number;
  color: string;
}

interface Popup {
  alive: boolean;
  x: number;
  y: number;
  born: number;
  text: string;
  color: string;
}

/** 某行的格心 y（每帧都要用，抽成小函数）。 */
const rowY = (row: number): number => cellCenter(0, row).y;

const game = defineGame({
  meta,
  create(ctx: GameContext): GameInstance {
    /* ---------------- 状态 ---------------- */

    let mode: Mode = "ready";
    /** 车道时钟（毫秒）：车与浮木的位置完全由它推导，暂停时不走。 */
    let clock = 0;
    /** 本局计时（毫秒），到 ROUND_MS 结束。 */
    let elapsed = 0;
    let score = 0;
    let lives = LIVES;
    /** 到过的最远行，只升不降；HUD 的「最远行」和加分都靠它。 */
    let bestRow = START_ROW;

    let playerRow = START_ROW;
    /** 青蛙中心 x：在河里是连续值（被浮木带着走）。 */
    let playerX = xForCol(START_COL);
    /** 站上浮木那一刻，青蛙 x 与「整条河带净位移」的差；之后一直加它。 */
    let rideBase = 0;
    let facingLeft = false;
    let hop: Hop | null = null;
    /** 掉命后的输入冻结（毫秒）。 */
    let freeze = 0;
    /** 受伤闪烁倒计时（毫秒）。 */
    let hurt = 0;
    let flash = 0;
    let shake = 0;
    let urgent = false;
    let popupCursor = 0;
    let effectCursor = 0;

    const effects: Effect[] = [];
    for (let i = 0; i < MAX_EFFECTS; i += 1) {
      effects.push({ alive: false, kind: "splash", x: 0, y: 0, born: 0, life: 0, color: P.lav });
    }
    const popups: Popup[] = [];
    for (let i = 0; i < MAX_POPUPS; i += 1) {
      popups.push({ alive: false, x: 0, y: 0, born: 0, text: "", color: P.gold });
    }

    /* ---------------- 静态背景 ---------------- */

    let backdrop: HTMLCanvasElement | null = null;

    /** 只在 create 时画一次（单帧内不创建 canvas）。 */
    const buildBackdrop = (): void => {
      const layer = document.createElement("canvas");
      layer.width = W;
      layer.height = H;
      const c = layer.getContext("2d");
      if (!c) return;
      c.imageSmoothingEnabled = false;
      paintBackdrop(c, W, H);
      backdrop = layer;
    };

    /* ---------------- HUD ---------------- */

    const syncScore = (bump = false): void => {
      ctx.hud.set("score", Math.min(MAX_SCORE, Math.max(0, score)));
      if (bump) ctx.hud.flash("score", "is-bump");
    };

    const syncRow = (): void => {
      ctx.hud.set("row", Math.min(99, Math.max(0, bestRow)));
    };

    const syncLives = (bump = false): void => {
      const shown = Math.max(0, Math.min(9, lives));
      ctx.hud.set("lives", shown);
      ctx.hud.setColor("lives", shown <= 1 ? P.orange : P.red);
      if (bump) ctx.hud.flash("lives", "is-broken");
    };

    const syncTimer = (remaining: number): void => {
      ctx.timer.set(remaining, ROUND_MS, { low: 0.34, critical: 0.15 });
      const wantUrgent = remaining <= URGENT_MS;
      if (wantUrgent !== urgent) {
        urgent = wantUrgent;
        ctx.hud.urgent(wantUrgent);
      }
    };

    /* ---------------- 特效 / 飘字 ---------------- */

    const addEffect = (kind: EffectKind, x: number, y: number, color: string): void => {
      const slot = effects[effectCursor]!;
      effectCursor = (effectCursor + 1) % effects.length;
      slot.alive = true;
      slot.kind = kind;
      slot.x = x;
      slot.y = y;
      slot.born = clock;
      slot.life = kind === "hit" ? HIT_MS : SPLASH_MS;
      slot.color = color;
    };

    const addPopup = (text: string, x: number, y: number, color: string): void => {
      const slot = popups[popupCursor]!;
      popupCursor = (popupCursor + 1) % popups.length;
      slot.alive = true;
      slot.text = text;
      slot.x = x;
      slot.y = y;
      slot.born = clock;
      slot.color = color;
    };

    const stepEffects = (): void => {
      for (let i = 0; i < effects.length; i += 1) {
        const fx = effects[i]!;
        if (fx.alive && clock - fx.born >= fx.life) fx.alive = false;
      }
      for (let i = 0; i < popups.length; i += 1) {
        const p = popups[i]!;
        if (p.alive && clock - p.born >= POPUP_MS) p.alive = false;
      }
    };

    /* ---------------- 流程 ---------------- */

    const reset = (): void => {
      mode = "ready";
      clock = 0;
      elapsed = 0;
      score = 0;
      lives = LIVES;
      bestRow = START_ROW;
      playerRow = START_ROW;
      playerX = xForCol(START_COL);
      rideBase = 0;
      facingLeft = false;
      hop = null;
      freeze = 0;
      hurt = 0;
      flash = 0;
      shake = 0;
      urgent = false;
      popupCursor = 0;
      effectCursor = 0;
      for (let i = 0; i < effects.length; i += 1) effects[i]!.alive = false;
      for (let i = 0; i < popups.length; i += 1) popups[i]!.alive = false;

      syncScore();
      syncRow();
      syncLives();
      ctx.hud.urgent(false);
      ctx.timer.hide();
    };

    /** 结算只走这里一次；最高分由壳层按 high 模式写入。 */
    const finish = (cause: "clear" | "out" | "time"): void => {
      if (mode === "over") return;
      mode = "over";
      hop = null;
      freeze = 0;

      if (cause === "clear") score = Math.min(MAX_SCORE, score + GOAL_BONUS);

      ctx.timer.hide();
      ctx.hud.urgent(false);
      syncScore();
      syncRow();
      syncLives();

      if (cause === "clear") ctx.audio.win();
      else ctx.audio.lose();

      // 让结算层背后停在最后一帧：青蛙和车流都保持原位。
      render();

      ctx.end({
        score,
        title: cause === "clear" ? "跳过河了" : cause === "time" ? "时间到" : "三条命用完了",
        kicker: cause === "clear" ? "CLEAR" : "GAME OVER",
        stats: [
          { label: "最远行", value: `${bestRow - START_ROW}/${GOAL_ROW - START_ROW}` },
          { label: "剩余命", value: Math.max(0, lives) },
        ],
      });
    };

    /** 掉一条命：回起点岸，不是直接结束（三条命用完才结束）。 */
    const loseLife = (cause: "car" | "water"): void => {
      if (mode !== "playing") return;

      const x = hop ? hop.toX : playerX;
      const y = rowY(playerRow);
      lives -= 1;
      syncLives(true);
      flash = 1;
      shake = ctx.reducedMotion ? 0 : 3.5;
      addEffect(cause === "car" ? "hit" : "splash", x, y, cause === "car" ? P.orange : P.lav);
      ctx.audio.miss();
      ctx.toast.show(cause === "car" ? "被车撞到了" : "落水了", { warn: true, duration: 800 });
      ctx.announce(
        cause === "car" ? "被车撞到，扣一条命，回到起点岸。" : "落水，扣一条命，回到起点岸。",
      );

      playerRow = START_ROW;
      playerX = xForCol(START_COL);
      rideBase = 0;
      hop = null;
      hurt = HURT_MS;
      freeze = RESPAWN_MS;

      if (lives <= 0) {
        lives = 0;
        syncLives();
        finish("out");
      }
    };

    /** 前进到新的最远行才加分，同行反复走不重复给分。 */
    const awardRow = (): void => {
      if (playerRow <= bestRow) return;
      score = Math.min(MAX_SCORE, score + advanceScore(bestRow, playerRow));
      bestRow = nextBestRow(bestRow, playerRow);
      syncScore(true);
      syncRow();
      addPopup(`+${SCORE_PER_ROW}`, playerX, rowY(playerRow) - 9, P.gold);
      ctx.audio.coin();
    };

    /** 落地（或静止）时检查脚下的这一行：河面找浮木，车道看车。 */
    const settle = (): void => {
      if (mode !== "playing") return;
      const kind = rowKind(playerRow);

      if (kind === "river") {
        const logs = laneObjects("log", playerRow, clock);
        const log = logUnder(playerX, logs);
        if (!log) {
          loseLife("water");
          return;
        }
        // 记下「青蛙相对整条河带的偏移」：laneTravel 单调不回绕，之后每帧
        // playerX = laneTravel + rideBase 都能精确落在同一根木头上，不会漂移。
        rideBase = playerX - laneTravel("log", playerRow, clock);
        if (isOutOfCanvas(playerX)) loseLife("water");
        return;
      }

      if (kind === "road") {
        const cars = laneObjects("car", playerRow, clock);
        if (carHitsPlayer(playerX, cars)) loseLife("car");
      }
    };

    /** 跳跃落地：更新 x、结算分数，再检查这一行。 */
    const land = (): void => {
      const current = hop;
      hop = null;
      if (!current) return;
      playerX = current.toX;

      if (playerRow >= GOAL_ROW) {
        awardRow();
        addEffect("goal", playerX, rowY(playerRow), P.gold);
        ctx.audio.gold();
        finish("clear");
        return;
      }

      awardRow();
      settle();
    };

    /**
     * 一次跳跃一格。上下跳保持当前 x（经典青蛙手感，落到哪根木头由
     * 落地瞬间决定）；左右跳按当前所在列移动一格，落在格心上。
     */
    const jump = (dir: Dir): void => {
      if (mode !== "playing" || ctx.isPaused()) return;
      if (freeze > 0 || hop) return;

      const col = colForX(playerX);
      const next = movePlayer({ col, row: playerRow }, dir);
      if (next.row === playerRow && next.col === col) return;

      let toX = playerX;
      if (dir === "left" || dir === "right") toX = xForCol(next.col);
      if (dir === "left") facingLeft = true;
      else if (dir === "right") facingLeft = false;

      hop = {
        fromX: playerX,
        fromY: rowY(playerRow),
        toX,
        toY: rowY(next.row),
        t: 0,
        flip: facingLeft,
      };
      playerRow = next.row;
      ctx.audio.blip();
    };

    /* ---------------- 绘制 ---------------- */

    const frogPoint = (): { x: number; y: number } => {
      if (!hop) return { x: playerX, y: rowY(playerRow) };
      const p = hopPosition(hop.fromX, hop.fromY, hop.toX, hop.toY, hop.t);
      return { x: p.x, y: p.y };
    };

    const renderEffects = (c: CanvasRenderingContext2D): void => {
      for (let i = 0; i < effects.length; i += 1) {
        const fx = effects[i]!;
        if (!fx.alive) continue;
        const k = Math.min(1, (clock - fx.born) / fx.life);
        if (fx.kind === "splash") drawSplash(c, fx.x, fx.y, k);
        else drawHitBurst(c, fx.x, fx.y, k, fx.color);
      }
    };

    const renderPopups = (c: CanvasRenderingContext2D): void => {
      for (let i = 0; i < popups.length; i += 1) {
        const p = popups[i]!;
        if (!p.alive) continue;
        const k = Math.min(1, (clock - p.born) / POPUP_MS);
        const width = measurePixelText(p.text, 2);
        const x = Math.max(3, Math.min(W - width - 3, Math.round(p.x - width / 2)));
        c.globalAlpha = 1 - k * k;
        drawPixelText(c, p.text, x, Math.round(p.y - k * 10), 2, p.color, P.void);
      }
      c.globalAlpha = 1;
    };

    const render = (): void => {
      const c = ctx.ctx;

      let sx = 0;
      let sy = 0;
      if (!ctx.reducedMotion && shake > 0.3) {
        sx = Math.round(Math.sin(clock * 0.09) * shake);
        sy = Math.round(Math.cos(clock * 0.13) * shake * 0.6);
      }

      c.save();
      c.translate(sx, sy);

      if (backdrop) c.drawImage(backdrop, 0, 0);
      else rect(c, 0, 0, W, H, P.night);

      // 车道（行 1–5）
      for (let row = 1; row <= 5; row += 1) {
        const lane = carLane(row);
        if (!lane) continue;
        const cars = laneObjects("car", row, clock);
        const y = rowY(row) - CAR_H / 2;
        for (let i = 0; i < cars.length; i += 1) {
          const car = cars[i]!;
          drawCar(c, car.x, y, car.w, CAR_H, row + i, lane.dir);
        }
      }

      // 河面浮木（行 6–9）：正踩着的那根加高光
      const onRiver = rowKind(playerRow) === "river" && !hop;
      const ridingRow = onRiver ? playerRow : -1;
      const ridingLogs = ridingRow >= 0 ? laneObjects("log", ridingRow, clock) : [];
      const riddenLog = ridingRow >= 0 ? logUnder(playerX, ridingLogs) : null;

      for (let row = RIVER_FROM; row < GOAL_ROW; row += 1) {
        const lane = logLane(row);
        if (!lane) continue;
        const logs = row === ridingRow ? ridingLogs : laneObjects("log", row, clock);
        const y = rowY(row) - LOG_H / 2;
        for (let i = 0; i < logs.length; i += 1) {
          const log = logs[i]!;
          drawLog(c, log.x, y, log.w, LOG_H, row === ridingRow && log === riddenLog);
        }
      }

      renderEffects(c);

      // 青蛙：受伤时按 90ms 闪烁
      const p = frogPoint();
      const blinking = hurt > 0 && Math.floor(hurt / 90) % 2 === 0;
      if (!blinking) {
        drawFrog(c, Math.round(p.x), Math.round(p.y), {
          flip: hop ? hop.flip : facingLeft,
          airborne: hop !== null,
          time: clock / 1000,
        });
      }

      c.restore();

      if (flash > 0.02) {
        c.globalAlpha = Math.min(0.32, flash * 0.32);
        c.fillStyle = P.red;
        c.fillRect(0, 0, W, H);
        c.globalAlpha = 1;
      }

      renderPopups(c);
    };

    /* ---------------- 输入：触屏 + 键盘 ---------------- */

    // 触屏：轻点画面，朝点击相对青蛙的方向跳一格（点在自己身上 = 向前跳）。
    ctx.input.pointer.on("down", (info) => {
      ctx.audio.unlock();
      if (mode !== "playing" || ctx.isPaused()) return;
      if (info.source.pointerType === "mouse" && info.source.button !== 0) return;
      const frog = frogPoint();
      jump(dirFromTap(info.x, info.y, frog.x, frog.y));
    });

    // 键盘 / 虚拟手柄：按下瞬间跳一格（不是持续移动）。
    ctx.input.keys.onPress((action) => {
      if (mode !== "playing" || ctx.isPaused()) return;
      if (action === "left" || action === "right" || action === "up" || action === "down") {
        jump(action);
        return;
      }
      if (action === "action" || action === "primary") jump("up");
    });

    buildBackdrop();
    reset();

    return {
      start(): void {
        reset();
        mode = "playing";
        ctx.audio.unlock();
        ctx.audio.ui();
        syncTimer(ROUND_MS);
        ctx.announce("跳过车道，踩准浮木，冲到对岸。三条命。");
      },

      update(dt: number): void {
        if (mode !== "playing") return;

        clock += dt;
        elapsed += dt;
        if (hurt > 0) hurt = Math.max(0, hurt - dt);
        if (flash > 0) flash = Math.max(0, flash - dt / 220);
        if (shake > 0) shake = Math.max(0, shake - dt * 0.012);
        stepEffects();

        const remaining = Math.max(0, ROUND_MS - elapsed);
        syncTimer(remaining);
        if (remaining <= 0) {
          finish("time");
          return;
        }

        if (freeze > 0) {
          freeze -= dt;
          return;
        }

        if (hop) {
          hop.t += dt / HOP_MS;
          if (hop.t >= 1) {
            hop.t = 1;
            land();
          }
          return;
        }

        const kind = rowKind(playerRow);

        // 河面：跟着脚下的浮木漂；漂出画布或踩空都算落水
        if (kind === "river") {
          playerX = laneTravel("log", playerRow, clock) + rideBase;

          // 踩空：当前 x 落到了两根木头之间的缝隙里
          const logs = laneObjects("log", playerRow, clock);
          if (!logUnder(playerX, logs)) {
            loseLife("water");
            return;
          }
          if (isOutOfCanvas(playerX)) loseLife("water");
          return;
        }

        // 车道：站着不动也会被撞
        if (kind === "road") {
          const cars = laneObjects("car", playerRow, clock);
          if (carHitsPlayer(playerX, cars)) loseLife("car");
        }
      },

      render,

      pause(): void {
        // 壳层会停掉 update：车道时钟、腾空动画、掉命冻结都会自然停在原地，
        // 恢复后从同一进度继续，所以这里不需要改动任何状态。
      },

      resume(): void {
        // 恢复后从当前格重新开始，不需要额外补帧。
      },

      destroy(): void {
        backdrop = null;
      },
    };
  },
});

export default game;
