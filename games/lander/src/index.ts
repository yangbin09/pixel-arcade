import {
  P,
  clamp,
  defineGame,
  drawPixelText,
  measurePixelText,
  mulberry32,
  rect,
  type GameContext,
  type GameInstance,
} from "@arcade/core";

import { drawArrow, drawLander, drawPadMarker, drawStars, drawTerrain } from "./art";
import { meta } from "./meta";
import {
  FUEL_MAX,
  GROUND_Y,
  PERFECT_VY,
  ROUGH_ANGLE,
  ROUGH_VY,
  SHIP_MARGIN,
  START_Y,
  TOUCH_LAYOUT,
  altitudeMeters,
  burnFuel,
  createShip,
  isOnPad,
  landingResult,
  landingScore,
  nearestPad,
  padCenter,
  stepShip,
  terrainFor,
  touchActionAt,
  wrapAngle,
  type ShipState,
  type Terrain,
  type TouchAction,
  type Verdict,
} from "./logic";

const W = meta.size.w;
const H = meta.size.h;

/** 着陆后画面停住的时长（毫秒），给玩家看清评价并记住这次的落点。 */
const SETTLE_MS = 900;
/** 速度表量程：达到 ROUGH_VY 就是满格（满格即坠毁线）。 */
const GAUGE_W = 30;
/** 倾斜表量程：达到 ROUGH_ANGLE 就是满偏。 */
const TILT_SPAN = 13;

type Mode = "ready" | "playing" | "over";

const VERDICT_LABEL: Record<Verdict, string> = {
  perfect: "PERFECT",
  good: "GOOD",
  rough: "ROUGH",
  crash: "CRASH",
};

const VERDICT_COLOR: Record<Verdict, string> = {
  perfect: P.gold,
  good: P.mint,
  rough: P.orange,
  crash: P.red,
};

const game = defineGame({
  meta,
  create(ctx: GameContext): GameInstance {
    let mode: Mode = "ready";
    let clock = 0;
    let score = 0;
    let fuel = FUEL_MAX;
    let descent = 1;
    let okCount = 0;
    let landings = 0;
    let bestVerdict: Verdict = "crash";

    let terrain: Terrain = { pads: [], rocks: [] };
    let ship: ShipState = { x: W / 2, y: START_Y, vx: 0, vy: 0, angle: 0 };

    /** 每局的随机源：由真实随机播一次种，再交给 mulberry32 保证可复现。 */
    let rng: () => number = mulberry32(20261119);

    /** 着陆后的停顿计时；> 0 表示正处在「这一下」的慢镜头里。 */
    let settleMs = 0;
    let runOver = false;
    let lastVerdict: Verdict | null = null;
    let lastGain = 0;
    let shake = 0;

    /** 画布内触屏按钮当前按住的键。 */
    let touchAction: TouchAction | null = null;
    let thrustingNow = false;
    let thrustSfxOn = false;
    let lastFuelShown = -1;
    let lastAltShown = -1;

    /* ---------------- HUD ---------------- */

    const syncScore = (bump: boolean): void => {
      ctx.hud.set("score", clamp(Math.round(score), 0, 99999));
      if (bump) ctx.hud.flash("score", "is-bump");
    };

    const syncFuel = (force = false): void => {
      const shown = clamp(Math.round(fuel), 0, FUEL_MAX);
      if (!force && shown === lastFuelShown) return;
      lastFuelShown = shown;
      ctx.hud.set("fuel", shown);
      ctx.hud.setColor("fuel", shown <= 20 ? P.red : shown <= 45 ? P.orange : P.gold);
    };

    const syncAlt = (force = false): void => {
      const shown = clamp(altitudeMeters(ship.y), 0, 999);
      if (!force && shown === lastAltShown) return;
      lastAltShown = shown;
      ctx.hud.set("alt", shown);
    };

    /* ---------------- 流程 ---------------- */

    /**
     * 开一段新的下降：新地形、满油、飞船从某条着陆带正上方出发。
     *
     * 燃料**每段重置**：`landingScore` 里的燃料加成衡量的是「这 160px
     * 下降用了多少油」，同一局里多段落地的效率因此可以横向比较。
     */
    const beginDescent = (): void => {
      terrain = terrainFor(rng, W);
      fuel = FUEL_MAX;

      // 起飞点在某一带着陆带正上方；初速的随机横向分量负责制造第一段漂移。
      const pads = terrain.pads;
      const index = pads.length > 0 ? Math.min(pads.length - 1, Math.floor(rng() * pads.length)) : 0;
      const pad = pads[index];
      const startX = pad ? padCenter(pad) : W / 2;

      ship = createShip(clamp(startX, SHIP_MARGIN, W - SHIP_MARGIN), rng);
      ship.y = START_Y;

      settleMs = 0;
      runOver = false;
      lastVerdict = null;
      lastGain = 0;
      touchAction = null;
      thrustingNow = false;
      thrustSfxOn = false;
      lastFuelShown = -1;
      lastAltShown = -1;

      syncFuel(true);
      syncAlt(true);
    };

    /** 结算只走这里一次；最高分由壳层按 high 模式写入。 */
    const finish = (): void => {
      if (mode === "over") return;
      mode = "over";
      touchAction = null;
      thrustingNow = false;
      thrustSfxOn = false;
      shake = 0;
      ctx.hud.urgent(false);
      ctx.timer.hide();

      if (okCount > 0) ctx.audio.end();
      else ctx.audio.lose();

      ctx.end({
        score: Math.round(score),
        title: lastVerdict === "crash" ? "坠毁了" : "船体受损",
        kicker: `LANDED ${landings}`,
        stats: [
          { label: "成功着陆", value: `${okCount} 次` },
          { label: "最高评价", value: VERDICT_LABEL[bestVerdict] },
        ],
      });
    };

    const resetRun = (seed: number): void => {
      rng = mulberry32(seed);
      mode = "ready";
      clock = 0;
      score = 0;
      fuel = FUEL_MAX;
      descent = 1;
      okCount = 0;
      landings = 0;
      bestVerdict = "crash";
      settleMs = 0;
      shake = 0;
      runOver = false;
      lastVerdict = null;
      lastGain = 0;
      touchAction = null;
      thrustingNow = false;
      thrustSfxOn = false;
      lastFuelShown = -1;
      lastAltShown = -1;

      // 准备画面也要有地形和飞船：静态定格在第一条着陆带上方。
      terrain = terrainFor(rng, W);
      const pad = terrain.pads[0];
      ship = { x: pad ? padCenter(pad) : W / 2, y: START_Y, vx: 0, vy: 0, angle: 0 };

      ctx.hud.set("score", 0);
      syncFuel(true);
      syncAlt(true);
      ctx.hud.urgent(false);
      ctx.timer.hide();
    };

    /** 真正坐地：判定 → 计分 → 决定继续下一段还是收工。 */
    const resolveLanding = (): void => {
      ship.y = GROUND_Y;
      const onPad = isOnPad(ship.x, terrain.pads);
      const verdict = landingResult(ship.vy, ship.angle, !onPad);
      const pad = nearestPad(ship.x, terrain.pads);
      const drift = pad ? Math.abs(ship.x - padCenter(pad)) : W;
      const gained = landingScore(verdict, fuel, drift);

      const success = verdict === "perfect" || verdict === "good";

      lastVerdict = verdict;
      lastGain = gained;
      landings += 1;
      score += gained;
      syncScore(gained > 0);

      if (verdict === "perfect") bestVerdict = "perfect";
      else if (verdict === "good" && bestVerdict !== "perfect") bestVerdict = "good";
      else if (verdict === "rough" && bestVerdict === "crash") bestVerdict = "rough";
      if (success) okCount += 1;

      ship.vy = 0;
      ship.vx = 0;
      ship.angle = 0;
      thrustingNow = false;
      thrustSfxOn = false;
      touchAction = null;
      settleMs = SETTLE_MS;
      runOver = !success;

      if (verdict === "perfect") {
        ctx.audio.gold(landings);
        ctx.toast.show(`完美着陆 +${gained}`, { duration: 900 });
      } else if (verdict === "good") {
        ctx.audio.coin();
        ctx.toast.show(`软着陆 +${gained}`, { duration: 900 });
      } else if (verdict === "rough") {
        ctx.audio.miss();
        shake = 3;
        ctx.toast.show("硬着陆，船体受损", { warn: true, duration: 1100 });
      } else {
        ctx.audio.lose();
        shake = 5;
        ctx.toast.show(onPad ? "着陆速度过大" : "撞上岩石了", { warn: true, duration: 1100 });
      }
    };

    /* ---------------- 输入 ---------------- */

    const turnInput = (): number => {
      let turn = 0;
      if (ctx.input.keys.isDown("left")) turn -= 1;
      if (ctx.input.keys.isDown("right")) turn += 1;
      if (touchAction === "left") turn -= 1;
      if (touchAction === "right") turn += 1;
      return clamp(turn, -1, 1);
    };

    const thrustInput = (): boolean =>
      ctx.input.keys.isDown("action") || ctx.input.keys.isDown("primary") || touchAction === "thrust";

    ctx.input.pointer.on("down", (info) => {
      ctx.audio.unlock();
      if (mode !== "playing" || ctx.isPaused() || settleMs > 0) return;
      // 虚拟手柄在场时用手柄，画面内的触屏按钮不参与判定，避免双重输入。
      if (ctx.padVisible()) return;
      touchAction = touchActionAt(info.x, info.y);
    });

    ctx.input.pointer.on("move", (info) => {
      if (mode !== "playing" || ctx.isPaused() || settleMs > 0) return;
      if (!info.down || ctx.padVisible()) return;
      // 手指在按钮之间滑过去也能换键，不必抬起再按。
      touchAction = touchActionAt(info.x, info.y);
    });

    const clearTouch = (): void => {
      touchAction = null;
    };
    ctx.input.pointer.on("up", clearTouch);
    ctx.input.pointer.on("cancel", clearTouch);
    ctx.input.pointer.on("leave", clearTouch);

    /* ---------------- 更新 ---------------- */

    const step = (dt: number): void => {
      if (settleMs > 0) {
        settleMs = Math.max(0, settleMs - dt);
        if (settleMs > 0) return;
        if (runOver) {
          finish();
          return;
        }
        descent += 1;
        beginDescent();
        return;
      }

      const thrusting = thrustInput() && fuel > 0;
      if (thrusting) {
        const before = fuel;
        fuel = burnFuel(fuel, true, dt);
        if (before > 0 && fuel <= 0) {
          ctx.toast.show("燃料耗尽", { warn: true, duration: 900 });
          ctx.audio.error();
        }
      }
      thrustingNow = thrusting;

      if (thrusting && !thrustSfxOn) {
        thrustSfxOn = true;
        ctx.audio.tone(150, 0.07, "sawtooth", 0.022, 240);
      } else if (!thrusting) {
        thrustSfxOn = false;
      }

      stepShip(ship, dt, thrusting, turnInput());

      if (ship.y >= GROUND_Y) {
        resolveLanding();
        return;
      }

      syncFuel();
      syncAlt();
    };

    /* ---------------- 绘制 ---------------- */

    const drawSpeedGauge = (c: CanvasRenderingContext2D): void => {
      const speed = Math.min(1, Math.abs(ship.vy) / ROUGH_VY);
      const fill = Math.round(speed * GAUGE_W);
      const color = speed >= 1 ? P.red : speed > 0.63 ? P.orange : speed > 0.35 ? P.gold : P.mint;
      rect(c, 6, 6, GAUGE_W + 2, 7, P.void);
      rect(c, 7, 8, GAUGE_W, 3, P.panel);
      if (fill > 0) rect(c, 7, 8, fill, 3, color);
      // 刻度画在 PERFECT_VY 的位置：指针没越过它才可能拿到 best 评价。
      rect(c, 7 + Math.round((PERFECT_VY / ROUGH_VY) * GAUGE_W), 7, 1, 5, P.lineHi);
      drawPixelText(c, "V", GAUGE_W + 12, 5, 1, P.lineHi);
    };

    const drawTiltGauge = (c: CanvasRenderingContext2D): void => {
      const cx = W - 24;
      const cy = 10;
      rect(c, cx - TILT_SPAN, cy, TILT_SPAN * 2 + 1, 1, P.line);
      rect(c, cx - TILT_SPAN, cy - 2, 1, 5, P.lineHi);
      rect(c, cx + TILT_SPAN, cy - 2, 1, 5, P.lineHi);
      rect(c, cx, cy - 1, 1, 3, P.line);

      const ratio = wrapAngle(ship.angle) / ROUGH_ANGLE;
      const offset = clamp(Math.round(ratio * TILT_SPAN), -TILT_SPAN, TILT_SPAN);
      const out = Math.abs(ratio) > 1;
      rect(c, cx + offset - 1, cy - 1, 3, 3, out ? P.red : P.cream);
    };

    const drawTouchButtons = (c: CanvasRenderingContext2D): void => {
      const keyboardThrust = ctx.input.keys.isDown("action") || ctx.input.keys.isDown("primary");
      for (const button of TOUCH_LAYOUT) {
        const active =
          (button.action === "left" && (touchAction === "left" || ctx.input.keys.isDown("left"))) ||
          (button.action === "right" && (touchAction === "right" || ctx.input.keys.isDown("right"))) ||
          (button.action === "thrust" && (touchAction === "thrust" || keyboardThrust));

        rect(c, button.x, button.y, button.w, button.h, active ? P.gold : P.panel2);
        if (active) {
          rect(c, button.x, button.y, button.w, 1, P.white);
          rect(c, button.x, button.y + button.h - 1, button.w, 1, P.amber);
        } else {
          rect(c, button.x, button.y, button.w, 1, P.lineHi);
        }

        const ink = active ? P.void : P.cream;
        const cx = button.x + Math.floor(button.w / 2);
        const iy = button.y + Math.floor((button.h - 5) / 2);
        if (button.action === "thrust") drawArrow(c, cx - 2, iy, "up", ink);
        else if (button.action === "left") drawArrow(c, cx - 2, iy, "left", ink);
        else drawArrow(c, cx - 2, iy, "right", ink);
      }
    };

    const drawWreck = (c: CanvasRenderingContext2D): void => {
      const x = Math.round(ship.x);
      rect(c, x - 5, GROUND_Y - 2, 11, 2, P.redDeep);
      rect(c, x - 2, GROUND_Y - 4, 2, 2, P.orange);
      rect(c, x + 3, GROUND_Y - 4, 2, 1, P.amber);
      for (let i = 0; i < 6; i += 1) {
        const t = ((clock / 90 + i * 1.7) % 4) * 1.2;
        const px = x + Math.round(Math.sin(i * 2.1) * (3 + t * 3));
        rect(c, px, GROUND_Y - 6 - t * 2, 1, 1, i % 2 === 0 ? P.amber : P.orange);
      }
    };

    const render = (): void => {
      const c = ctx.ctx;

      let sx = 0;
      let sy = 0;
      if (shake > 0.2 && !ctx.reducedMotion) {
        sx = Math.round(Math.sin(clock * 0.13) * shake);
        sy = Math.round(Math.cos(clock * 0.17) * shake * 0.5);
      }

      rect(c, 0, 0, W, H, P.void);
      rect(c, 0, 0, W, GROUND_Y, P.night);
      drawStars(c, W, GROUND_Y - 14, clock / 1000, 46);

      c.save();
      c.translate(sx, sy);

      drawTerrain(c, terrain, GROUND_Y, W, H);
      for (const pad of terrain.pads) drawPadMarker(c, pad, GROUND_Y, clock / 1000);

      if (lastVerdict === null) {
        drawLander(c, ship.x, ship.y, ship.angle, thrustingNow, Math.floor(clock / 60));
      } else if (lastVerdict === "crash") {
        drawWreck(c);
      } else {
        drawLander(c, ship.x, ship.y, 0, false, 0);
      }

      c.restore();

      drawSpeedGauge(c);
      drawTiltGauge(c);
      if (mode === "playing" && settleMs === 0 && !ctx.padVisible()) drawTouchButtons(c);

      // 评价横幅：着陆后的慢镜头里显示，收工时也保留在结算层背后。
      if (lastVerdict !== null && (settleMs > 0 || mode === "over")) {
        const label = `${VERDICT_LABEL[lastVerdict]} +${lastGain}`;
        const width = measurePixelText(label, 2);
        const boxW = width + 12;
        const boxX = Math.round((W - boxW) / 2);
        const y = 72;
        rect(c, boxX, y - 5, boxW, 22, P.void);
        rect(c, boxX, y - 5, boxW, 1, VERDICT_COLOR[lastVerdict]);
        rect(c, boxX, y + 16, boxW, 1, VERDICT_COLOR[lastVerdict]);
        drawPixelText(c, label, boxX + 6, y, 2, VERDICT_COLOR[lastVerdict], P.panel);
      }

      // 第一段下降的起飞提示（准备画面与开局头两秒都显示）。
      if (mode === "ready" || (mode === "playing" && descent === 1 && clock < 2200)) {
        const label = ctx.padVisible() ? "A = THRUST" : "HOLD TO THRUST";
        const width = measurePixelText(label, 1);
        drawPixelText(c, label, Math.round((W - width) / 2), START_Y + 22, 1, P.lineHi);
      }
    };

    /* ---------------- 生命周期 ---------------- */

    resetRun(20261119);

    return {
      start(): void {
        ctx.audio.unlock();
        // 每局换种子；terrainFor 是纯函数，同种子必然同地形。
        resetRun((Date.now() ^ Math.floor(Math.random() * 0xffff)) >>> 0);
        beginDescent();
        mode = "playing";
      },

      update(dt: number): void {
        if (mode !== "playing") return;
        clock += dt;
        if (shake > 0) shake = Math.max(0, shake - dt * 0.012);
        step(dt);
      },

      render,

      pause(): void {
        touchAction = null;
        thrustingNow = false;
        thrustSfxOn = false;
      },

      resume(): void {
        thrustSfxOn = false;
      },

      destroy(): void {
        touchAction = null;
        thrustingNow = false;
      },
    };
  },
});

export default game;
