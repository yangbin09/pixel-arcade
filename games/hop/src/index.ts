import {
  P,
  clamp,
  defineGame,
  drawPixelText,
  measurePixelText,
  mulberry32,
  rect,
  sparkle,
  strokeRect,
  type GameContext,
  type GameInstance,
} from "@arcade/core";

import { drawBankFlag, drawCar, drawFrog, drawLog, drawSplash, paintBoard } from "./art";
import { meta } from "./meta";
import {
  BOARD_H,
  CELL,
  COLS,
  HOME_ROW,
  LOG_GRACE,
  MAX_LIVES,
  ROWS,
  START_COL,
  START_ROW,
  carHitsPlayer,
  clampX,
  createLane,
  isWaterRow,
  laneSpeed,
  levelFor,
  logUnder,
  playerXForCol,
  rideDelta,
  rowKind,
  rowProgress,
  scoreForRow,
  stepObjects,
  stepOnWater,
  type LaneKind,
  type TrafficObject,
} from "./logic";

const W = meta.size.w;
const H = meta.size.h;

/** 起跳动画时长（毫秒）；期间不接受新输入，避免一帧连跳。 */
const HOP_MS = 120;
/** 死亡后的短暂停顿，用来放落水 / 撞击反馈。 */
const RESPAWN_MS = 460;
/** 落水涟漪的存活时间。 */
const SPLASH_MS = 420;
const MAX_POPUPS = 4;
const POPUP_MS = 720;
const MAX_SPLASHES = 4;
/** 分数 / 生命 / 最远行的 HUD 数字上限，对应 pad 宽度。 */
const MAX_SCORE = 99999;
const MAX_TWO_DIGIT = 99;

type Mode = "ready" | "playing" | "over";
type Dir = "up" | "down" | "left" | "right";

interface Hop {
  /** 起跳前的位置与落点，渲染时用来插值。 */
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** 0 → 1 的进度。 */
  t: number;
  /** 是否朝左（渲染时翻转青蛙）。 */
  flip: boolean;
  /** 起跳瞬间脚下踩着的木头（空中继续跟着它漂）；不在水上则为 null。 */
  ridingLog: TrafficObject | null;
}

interface Popup {
  alive: boolean;
  x: number;
  y: number;
  born: number;
  text: string;
  color: string;
}

interface Splash {
  alive: boolean;
  x: number;
  y: number;
  born: number;
  color: string;
}

const laneCenterY = (row: number): number => row * CELL + CELL / 2;

const game = defineGame({
  meta,
  create(ctx: GameContext): GameInstance {
    /* ---------------- 状态 ---------------- */

    let mode: Mode = "ready";
    let clock = 0;
    let score = 0;
    let lives = MAX_LIVES;
    let crossings = 0;
    let level = 1;
    /** 本局到过的最上面一行；HUD 的「最远行」由它换算。 */
    let bestRow = START_ROW;

    /** 青蛙逻辑位置：中心点像素 + 所在行。 */
    let playerX = playerXForCol(START_COL);
    let playerRow = START_ROW;
    let facingLeft = false;
    let hop: Hop | null = null;
    /** 死亡停顿计时，> 0 时冻结车道与主角。 */
    let freeze = 0;
    let shake = 0;
    /** 受伤 / 过河时的闪屏强度（0 表示不闪）。 */
    let flash = 0;
    /** 闪屏颜色：受伤偏红，过河偏金。 */
    let flashColor = P.red;

    /** 已经拿过「首次到达」分数的行；起点行开局就算来过。 */
    const visited: boolean[] = new Array<boolean>(ROWS).fill(false);
    visited[START_ROW] = true;

    let logs: TrafficObject[] = [];
    let cars: TrafficObject[] = [];

    const popups: Popup[] = [];
    for (let i = 0; i < MAX_POPUPS; i += 1) {
      popups.push({ alive: false, x: 0, y: 0, born: 0, text: "", color: P.gold });
    }
    let popupCursor = 0;

    const splashes: Splash[] = [];
    for (let i = 0; i < MAX_SPLASHES; i += 1) {
      splashes.push({ alive: false, x: 0, y: 0, born: 0, color: P.lav });
    }
    let splashCursor = 0;

    /** 静态背景层，只在 create 时画一次（单帧内不建 canvas）。 */
    let backdrop: HTMLCanvasElement | null = null;

    /* ---------------- HUD ---------------- */

    /** 分数 5 位、生命 / 最远行 2 位：都按显示宽度夹住，避免溢出。 */
    const setScore = (bump = false): void => {
      ctx.hud.set("score", clamp(Math.round(score), 0, MAX_SCORE));
      if (bump) ctx.hud.flash("score", "is-bump");
    };

    const setLives = (bump = false): void => {
      ctx.hud.set("lives", clamp(lives, 0, MAX_TWO_DIGIT));
      ctx.hud.setColor("lives", lives <= 1 ? P.orange : P.red);
      if (bump) ctx.hud.flash("lives", "is-broken");
    };

    const setRowHud = (): void => {
      ctx.hud.set("row", clamp(rowProgress(bestRow), 0, MAX_TWO_DIGIT));
    };

    /* ---------------- 车道 ---------------- */

    const seedFor = (): number => 0x5f3a91 ^ (level * 7919) ^ (crossings * 104729);

    /** 逐行铺满木头 / 汽车：水面两行、车路两行，其余行留空。 */
    const rebuildLanes = (): void => {
      const rng = mulberry32(seedFor());
      const nextLogs: TrafficObject[] = [];
      const nextCars: TrafficObject[] = [];

      for (let row = 0; row < ROWS; row += 1) {
        const water = isWaterRow(row);
        if (!water && rowKind(row) !== "road") continue;
        const kind: LaneKind = water ? "water" : "road";
        const lane = createLane(row, level, kind, rng);
        if (water) nextLogs.push(...lane);
        else nextCars.push(...lane);
      }

      logs = nextLogs;
      cars = nextCars;
    };

    /** 升级时只改已有对象的速度，保持铺法不变。 */
    const applyLevel = (nextLevel: number): void => {
      if (nextLevel === level) return;
      level = nextLevel;
      for (const item of logs) item.speed = laneSpeed(item.row, level);
      for (const item of cars) item.speed = laneSpeed(item.row, level);
    };

    /* ---------------- 反馈 ---------------- */

    const addPopup = (text: string, x: number, y: number, color: string): void => {
      const p = popups[popupCursor] as Popup;
      popupCursor = (popupCursor + 1) % popups.length;
      p.alive = true;
      p.text = text;
      p.x = clamp(x, 12, W - 12);
      p.y = clamp(y, 8, BOARD_H - 4);
      p.born = clock;
      p.color = color;
    };

    const addSplash = (x: number, y: number, color: string): void => {
      const s = splashes[splashCursor] as Splash;
      splashCursor = (splashCursor + 1) % splashes.length;
      s.alive = true;
      s.x = clampX(x);
      s.y = y;
      s.born = clock;
      s.color = color;
    };

    /* ---------------- 流程 ---------------- */

    const respawn = (): void => {
      playerX = playerXForCol(START_COL);
      playerRow = START_ROW;
      facingLeft = false;
      hop = null;
    };

    /** 结算只走这里一次；最高分由壳层按 high 模式写入。 */
    const finish = (): void => {
      if (mode === "over") return;
      mode = "over";
      hop = null;
      freeze = 0;
      setScore(false);
      setLives(false);
      setRowHud();
      ctx.audio.lose();
      ctx.announce("生命用完，本局结束。");
      render();
      ctx.end({
        score: Math.round(score),
        title: "被车流拦住了",
        kicker: "GAME OVER",
        stats: [
          { label: "最远行数", value: rowProgress(bestRow) },
          { label: "过河次数", value: crossings },
        ],
      });
    };

    const loseLife = (cause: "water" | "road"): void => {
      if (mode !== "playing") return;

      lives = Math.max(0, lives - 1);
      setLives(true);
      flash = Math.max(flash, 0.7);
      flashColor = P.red;
      shake = Math.max(shake, ctx.reducedMotion ? 0 : 3.5);

      if (cause === "water") {
        addSplash(playerX, laneCenterY(playerRow), P.lav);
        addPopup("SPLASH", playerX, laneCenterY(playerRow) - 10, P.lav);
        ctx.audio.miss();
        ctx.announce("落水了。");
      } else {
        addSplash(playerX, laneCenterY(playerRow), P.orange);
        addPopup("HIT", playerX, laneCenterY(playerRow) - 10, P.orange);
        ctx.audio.hit(1);
        ctx.announce("被车撞到了。");
      }

      if (lives <= 0) {
        finish();
        return;
      }

      freeze = RESPAWN_MS;
      respawn();
      ctx.toast.show(cause === "water" ? "落水了，回到起点" : "被车撞了，回到起点", {
        warn: true,
        duration: 900,
      });
    };

    /** 到达对岸：+100 分、可能升级、回到起点。 */
    const reachHome = (): void => {
      crossings += 1;
      score += scoreForRow(HOME_ROW);
      setScore(true);
      bestRow = HOME_ROW;
      setRowHud();
      applyLevel(levelFor(crossings));
      addPopup("+100", playerX, laneCenterY(HOME_ROW) + 6, P.gold);
      flash = Math.max(flash, 0.55);
      flashColor = P.gold;
      ctx.audio.win();
      ctx.toast.show(`过河 +100（第 ${crossings} 次）`, { duration: 1000 });
      ctx.announce(`过河成功，第 ${crossings} 次。`);
      respawn();
    };

    /** 落点结算：先判死亡，再判「首次到达某行」的分数。 */
    const settleLanding = (): void => {
      if (playerRow === HOME_ROW) {
        reachHome();
        return;
      }

      if (isWaterRow(playerRow)) {
        if (logUnder(playerX, playerRow, logs, LOG_GRACE) === null) {
          loseLife("water");
          return;
        }
      } else if (rowKind(playerRow) === "road") {
        if (carHitsPlayer(playerX, playerRow, cars)) {
          loseLife("road");
          return;
        }
      }

      if (playerRow < bestRow) {
        bestRow = playerRow;
        setRowHud();
      }

      // 首次到达某行才计分，重复访问不再给分。
      if (playerRow !== START_ROW && !visited[playerRow]) {
        visited[playerRow] = true;
        score += scoreForRow(playerRow);
        setScore(true);
        addPopup("+10", playerX, laneCenterY(playerRow) - 10, P.mint);
        ctx.audio.blip();
      }
    };

    const tryJump = (dir: Dir): void => {
      if (mode !== "playing" || ctx.isPaused()) return;
      if (freeze > 0 || hop) return;

      const fromX = playerX;
      const fromRow = playerRow;
      const fromY = laneCenterY(fromRow);
      let nextRow = playerRow;
      let nextX = playerX;
      let flip = facingLeft;

      if (dir === "up") nextRow = playerRow - 1;
      else if (dir === "down") nextRow = playerRow + 1;
      else if (dir === "left") {
        nextX = clampX(playerX - CELL);
        flip = true;
      } else {
        nextX = clampX(playerX + CELL);
        flip = false;
      }

      if (nextRow < HOME_ROW) nextRow = HOME_ROW;
      if (nextRow > START_ROW) nextRow = START_ROW;

      const rowChanged = nextRow !== playerRow;
      const moved = rowChanged || Math.abs(nextX - playerX) > 0.01;
      if (!moved) return;

      playerRow = nextRow;
      playerX = nextX;
      facingLeft = flip;
      // 起跳时如果正站在木头上，空中继续搭这趟「顺风车」。
      const ridingLog = isWaterRow(fromRow) ? logUnder(fromX, fromRow, logs, LOG_GRACE) : null;
      hop = {
        fromX,
        fromY,
        toX: playerX,
        toY: laneCenterY(playerRow),
        t: 0,
        flip,
        ridingLog,
      };

      ctx.audio.slide();
    };

    /* ---------------- 复位 ---------------- */

    const resetRun = (): void => {
      clock = 0;
      score = 0;
      lives = MAX_LIVES;
      crossings = 0;
      level = 1;
      bestRow = START_ROW;
      freeze = 0;
      shake = 0;
      flash = 0;
      hop = null;
      facingLeft = false;
      playerX = playerXForCol(START_COL);
      playerRow = START_ROW;

      visited.fill(false);
      visited[START_ROW] = true;

      for (const p of popups) p.alive = false;
      for (const s of splashes) s.alive = false;
      popupCursor = 0;
      splashCursor = 0;

      rebuildLanes();

      setScore(false);
      setLives(false);
      setRowHud();
      ctx.hud.urgent(false);
      ctx.timer.hide();
    };

    /* ---------------- 静态背景 ---------------- */

    const buildBackdrop = (): void => {
      const layer = document.createElement("canvas");
      layer.width = W;
      layer.height = H;
      const c = layer.getContext("2d");
      if (!c) return;
      c.imageSmoothingEnabled = false;

      paintBoard(c, ROWS);

      // 8 行只占 192px，画布还有 18px：补一条更深的水岸，避免底部留白。
      rect(c, 0, BOARD_H, W, H - BOARD_H, P.hole);
      rect(c, 0, BOARD_H, W, 1, P.grassDeep);
      for (let x = 0; x < W; x += 4) {
        rect(c, x, BOARD_H + 3, 2, 1, P.grassDeep);
        rect(c, x + 1, BOARD_H + 8, 1, 1, P.grass);
      }
      rect(c, 0, H - 2, W, 2, P.void);

      backdrop = layer;
    };

    /* ---------------- 绘制 ---------------- */

    const drawObjects = (c: CanvasRenderingContext2D): void => {
      const seconds = clock / 1000;
      for (const log of logs) drawLog(c, log.x, log.row * CELL, log.w, log.kind, seconds);
      for (const car of cars) drawCar(c, car.x, car.row * CELL, car.w, car.kind, seconds);
    };

    const drawPlayer = (c: CanvasRenderingContext2D): void => {
      if (mode === "over") return;
      // 死亡停顿期间不画青蛙：落水 / 被撞的反馈靠涟漪表达。
      if (freeze > 0) return;

      let cx = playerX;
      let cy = laneCenterY(playerRow);
      let hopping = false;

      if (hop) {
        const t = clamp(hop.t, 0, 1);
        cx = hop.fromX + (hop.toX - hop.fromX) * t;
        cy = hop.fromY + (hop.toY - hop.fromY) * t - Math.sin(t * Math.PI) * 9;
        hopping = t > 0.08 && t < 0.92;
      }

      // 站在木头上时抬高 1px，看起来像踩在木头表面。
      if (!hop && isWaterRow(playerRow) && logUnder(playerX, playerRow, logs, LOG_GRACE)) {
        cy -= 1;
      }

      drawFrog(c, cx, cy, hopping, facingLeft, clock / 1000);
    };

    const drawEffects = (c: CanvasRenderingContext2D): void => {
      for (const s of splashes) {
        if (!s.alive) continue;
        const age = clock - s.born;
        if (age < 0 || age >= SPLASH_MS) continue;
        const k = age / SPLASH_MS;
        c.globalAlpha = 1 - k;
        drawSplash(c, Math.round(s.x), Math.round(s.y + k * 5), 3 + Math.round(k * 11), s.color);
        c.globalAlpha = 1;
      }

      for (const p of popups) {
        if (!p.alive) continue;
        const age = clock - p.born;
        if (age < 0 || age >= POPUP_MS) continue;
        const k = age / POPUP_MS;
        const width = measurePixelText(p.text, 2);
        const x = clamp(p.x - width / 2, 2, W - width - 2);
        const y = p.y - Math.round(k * 14);
        c.globalAlpha = 1 - k * k;
        drawPixelText(c, p.text, x, y, 2, p.color, P.void);
      }
      c.globalAlpha = 1;
    };

    /** 对岸的停靠位提示：7 个位置都可以上岸。 */
    const drawHomeSlots = (c: CanvasRenderingContext2D): void => {
      const active = mode === "playing" && playerRow === HOME_ROW;
      for (let col = 0; col < COLS; col += 1) {
        strokeRect(c, col * CELL + 5, 3, CELL - 10, CELL - 8, active ? P.gold : P.grassHi);
      }
    };

    const render = (): void => {
      const c = ctx.ctx;

      let sx = 0;
      let sy = 0;
      if (!ctx.reducedMotion && shake > 0.2) {
        sx = Math.round(Math.sin(clock * 0.09) * shake);
        sy = Math.round(Math.cos(clock * 0.13) * shake * 0.5);
      }

      c.save();
      c.translate(sx, sy);

      if (backdrop) c.drawImage(backdrop, 0, 0);
      else rect(c, 0, 0, W, H, P.night);

      // 水面 / 车道上的动态目标
      drawHomeSlots(c);
      drawObjects(c);
      drawPlayer(c);
      drawEffects(c);

      // 只剩一条命时压一圈暗红，提示危险。
      if (mode === "playing" && lives <= 1 && !ctx.reducedMotion) {
        c.globalAlpha = 0.16 + Math.sin(clock * 0.006) * 0.06;
        rect(c, 0, 0, W, 2, P.red);
        rect(c, 0, H - 2, W, 2, P.red);
        rect(c, 0, 0, 2, H, P.red);
        rect(c, W - 2, 0, 2, H, P.red);
        c.globalAlpha = 1;
      }

      // 受伤 / 过河的整屏闪光
      if (flash > 0.01) {
        c.globalAlpha = Math.min(0.26, flash * 0.26);
        rect(c, 0, 0, W, H, flashColor);
        c.globalAlpha = 1;
      }

      c.restore();

      // 准备画面：在画布中央给一句目标提示（中文只进 label，这里用像素字英文）。
      if (mode === "ready") {
        const text = "REACH THE TOP";
        const tw = measurePixelText(text, 1);
        rect(c, (W - tw) / 2 - 4, 96, tw + 8, 11, P.void);
        strokeRect(c, (W - tw) / 2 - 5, 95, tw + 10, 13, P.lineHi);
        drawPixelText(c, text, (W - tw) / 2, 98, 1, P.cream, null);
        sparkle(c, 12, 101, 1, P.gold, P.white);
      }

      // 对岸小旗：标出「最大目标」在哪。
      drawBankFlag(c, W - 14, 20, clock / 1000);
    };

    /* ---------------- 输入 ---------------- */

    let tapStart: { x: number; y: number; dragged: boolean } | null = null;

    const jumpToward = (dx: number, dy: number): void => {
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      if (Math.abs(dx) > Math.abs(dy)) tryJump(dx > 0 ? "right" : "left");
      else tryJump(dy > 0 ? "down" : "up");
    };

    ctx.input.pointer.on("down", (info) => {
      ctx.audio.unlock();
      if (mode !== "playing" || ctx.isPaused()) return;
      if (info.source.pointerType === "mouse" && info.source.button !== 0) return;
      tapStart = { x: info.x, y: info.y, dragged: false };
    });

    ctx.input.pointer.on("move", (info) => {
      if (!tapStart || !info.down) return;
      if (Math.abs(info.x - tapStart.x) > 6 || Math.abs(info.y - tapStart.y) > 6) {
        tapStart.dragged = true;
      }
    });

    ctx.input.pointer.on("up", (info) => {
      const start = tapStart;
      tapStart = null;
      if (!start || mode !== "playing" || ctx.isPaused()) return;
      if (info.source.pointerType === "mouse" && info.source.button !== 0) return;
      if (start.dragged) return;

      // 轻点：朝点击位置的方向跳一格；点在青蛙身上就往前跳。
      const dx = info.x - playerX;
      const dy = info.y - laneCenterY(playerRow);
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
        tryJump("up");
        return;
      }
      jumpToward(dx, dy);
    });

    const clearTap = (): void => {
      tapStart = null;
    };
    ctx.input.pointer.on("cancel", clearTap);
    ctx.input.pointer.on("leave", clearTap);

    // 滑动手势：和虚拟手柄的 D-pad 走同一套语义动作。
    ctx.input.swipe.onSwipe(({ direction }) => {
      tryJump(direction);
    });

    ctx.input.keys.onPress((action) => {
      if (mode !== "playing" || ctx.isPaused()) return;
      if (action === "left" || action === "right" || action === "up" || action === "down") {
        tryJump(action);
        return;
      }
      // A 键 / 回车：向前（向上）跳一格。
      if (action === "primary" || action === "action") tryJump("up");
    });

    buildBackdrop();
    resetRun();

    /* ---------------- 主循环 ---------------- */

    const tickHop = (dt: number): void => {
      if (!hop) return;
      hop.t += dt / HOP_MS;
      if (hop.t < 1) return;
      hop = null;
      // 落地瞬间才结算：视觉上青蛙刚踩到格子，判定同步发生。
      settleLanding();
    };

    /** 水面：踩到木头就跟着漂，踩空立即扣命。空中（起跳中）跟随起跳那根木头。 */
    const rideWater = (dt: number): void => {
      if (!isWaterRow(playerRow)) return;

      if (hop) {
        // 空中继续跟着起跳时脚下的木头漂：位移同时作用在起点、落点和当前位置，
        // 落地时青蛙和木头才不会错位。
        const carried = hop.ridingLog;
        if (!carried) return;
        const delta = rideDelta(carried, dt);
        hop.fromX += delta;
        hop.toX += delta;
        playerX = clampX(playerX + delta);
        return;
      }

      const step = stepOnWater(playerX, playerRow, logs, dt, LOG_GRACE);
      if (!step.onLog) {
        loseLife("water");
        return;
      }
      playerX = step.x;
    };

    /** 车路：车压到青蛙就扣命（每帧判定，不只在落地那一下）。 */
    const checkRoad = (): void => {
      if (rowKind(playerRow) !== "road") return;
      if (carHitsPlayer(playerX, playerRow, cars)) loseLife("road");
    };

    return {
      start(): void {
        ctx.audio.unlock();
        resetRun();
        mode = "playing";
        ctx.audio.go();
        ctx.announce("青蛙过河开始，三条命，躲开车，踩着木头过河。");
      },

      update(dt: number): void {
        if (mode !== "playing") return;
        clock += dt;

        // 死亡停顿：车道与主角一起冻结，给玩家反应时间。
        if (freeze > 0) {
          freeze = Math.max(0, freeze - dt);
          shake = Math.max(0, shake - dt * 0.012);
          flash = Math.max(0, flash - dt * 0.004);
          return;
        }

        stepObjects(logs, dt);
        stepObjects(cars, dt);
        tickHop(dt);

        if (isWaterRow(playerRow)) {
          rideWater(dt);
          if (mode !== "playing") return;
        } else {
          checkRoad();
          if (mode !== "playing") return;
        }

        // 木头可能把青蛙带到画面边缘：夹住，不允许身体留在画外。
        playerX = clampX(playerX);

        for (const p of popups) {
          if (p.alive && clock - p.born >= POPUP_MS) p.alive = false;
        }
        for (const s of splashes) {
          if (s.alive && clock - s.born >= SPLASH_MS) s.alive = false;
        }

        shake = Math.max(0, shake - dt * 0.012);
        flash = Math.max(0, flash - dt * 0.004);
      },

      render,

      pause(): void {
        clearTap();
      },

      resume(): void {
        clearTap();
      },

      destroy(): void {
        clearTap();
      },
    };
  },
});

export default game;
