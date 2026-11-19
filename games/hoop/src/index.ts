import {
  P,
  clamp,
  defineGame,
  drawPixelText,
  measurePixelText,
  rect,
  type GameContext,
  type GameInstance,
} from "@arcade/core";

import {
  FLOOR_LINE,
  drawArcPreview,
  drawBall,
  drawBallTrail,
  drawPopup,
  drawPowerMeter,
  drawRack,
  drawRimFlash,
  paintCourt,
} from "./art";
import { meta } from "./meta";
import {
  ANGLE_DEG,
  BALLS_PER_ROUND,
  BALL_R,
  COMBO_HOT,
  ORIGIN,
  POWER_PERIOD_MS,
  RIM,
  ROUND_MS,
  comboAfter,
  makeKind,
  makePowerWindow,
  powerFromHold,
  rimCrossX,
  scoreFor,
  shoot,
  stepBall,
  swishPowerWindow,
  type Ball,
  type MakeKind,
  type PowerWindow,
} from "./logic";

const W = meta.size.w;
const H = meta.size.h;

/** 出手后到落定之间的最长飞行时间：超过就按不进处理，避免卡住。 */
const MAX_FLIGHT_MS = 2600;
/** 进球 / 不进后的短暂停顿。 */
const MAKE_HOLD_MS = 420;
const MISS_HOLD_MS = 320;

/** 拖影采样间隔与长度。 */
const TRAIL_GAP = 36;
const TRAIL_MAX = 8;

/** 飘字存活时长与粒子寿命。 */
const POPUP_MS = 780;
const SPARK_MS = 620;

type Phase = "ready" | "charging" | "flying" | "settle" | "over";

interface Popup {
  text: string;
  x: number;
  y: number;
  color: string;
  life: number;
  size: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

/** HUD 数值只吃像素字库，且夹到各自数位宽度。 */
const hudNumber = (value: number, max: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(clamp(value, 0, max));
};

const game = defineGame({
  meta,
  create(ctx: GameContext): GameInstance {
    /* ---------------- 局面状态 ---------------- */

    let phase: Phase = "ready";
    /** 本局累计的街机分；最高分由壳层写入。 */
    let score = 0;
    /** 已经用掉的球数（0..BALLS_PER_ROUND）。 */
    let used = 0;
    let combo = 0;
    let longestCombo = 0;
    let makes = 0;

    /** 本局剩余时间（毫秒）。 */
    let remaining = ROUND_MS;
    let lastSec = -1;

    /** 蓄力计时：从按下到现在按住多久。 */
    let holdMs = 0;
    let chargingKey = false;
    let chargingPointer = false;

    let ball: Ball | null = null;
    let flightMs = 0;
    /** 这一球是否已经结算过（防止重复计分）。 */
    let resolved = true;

    let holdLeft = 0;
    let trail: { x: number; y: number }[] = [];
    let trailClock = 0;
    let popups: Popup[] = [];
    let sparks: Spark[] = [];
    let rimFlash = 0;
    let flashColor: string = P.gold;
    let clock = 0;
    let shake = 0;

    /** 甜区在开局算一次：常量物理不随时间变。 */
    const makeWindow: PowerWindow = makePowerWindow();
    const swishWindow: PowerWindow = swishPowerWindow();

    /* ---------------- 小工具 ---------------- */

    const addPopup = (text: string, x: number, y: number, color: string, size: number): void => {
      popups.push({ text, x, y, color, life: 1, size });
      if (popups.length > 6) popups.shift();
    };

    const addBurst = (x: number, y: number, count: number, gold: boolean): void => {
      const total = ctx.reducedMotion ? Math.max(2, Math.round(count / 3)) : count;
      for (let i = 0; i < total; i += 1) {
        const angle = (i / total) * Math.PI * 2 + Math.random() * 0.4;
        const speed = 24 + Math.random() * 58;
        sparks.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 26,
          life: 1,
          color: gold
            ? i % 3 === 0
              ? P.white
              : i % 2 === 0
                ? P.gold
                : P.amber
            : i % 2 === 0
              ? P.cream
              : P.orange,
        });
        if (sparks.length > 40) sparks.shift();
      }
    };

    /** 屏幕空间的居中像素字（提示条用）。 */
    const drawCentered = (
      c: CanvasRenderingContext2D,
      text: string,
      y: number,
      size: number,
      color: string,
      alpha: number,
    ): void => {
      const width = measurePixelText(text, size);
      c.globalAlpha = clamp(alpha, 0, 1);
      drawPixelText(c, text, Math.round((W - width) / 2), Math.round(y), size, color, P.void);
      c.globalAlpha = 1;
    };

    /* ---------------- HUD ---------------- */

    const syncHud = (bump?: "score" | "combo"): void => {
      ctx.hud.set("score", hudNumber(score, 99999));
      ctx.hud.set("shots", hudNumber(Math.max(0, BALLS_PER_ROUND - used), 99));
      ctx.hud.set("combo", hudNumber(combo, 99));

      // 连中 >= 3：combo 栏变金并带上 X N 后缀。
      const hot = combo >= COMBO_HOT;
      ctx.hud.setColor("combo", hot ? P.gold : P.mint);
      ctx.hud.setSuffix("combo", combo > 0 ? `X${Math.min(combo, 99)}` : "", hot ? "is-hot" : "");

      if (bump === "score") ctx.hud.flash("score", "is-bump");
      if (bump === "combo") ctx.hud.flash("combo", "is-bump");
    };

    const syncTime = (force = false): void => {
      const seconds = Math.max(0, Math.ceil(remaining / 1000));
      if (!force && seconds === lastSec) return;
      lastSec = seconds;
      ctx.hud.urgent(seconds <= 10 && seconds > 0);
    };

    /* ---------------- 流程 ---------------- */

    const stopCharge = (): void => {
      chargingKey = false;
      chargingPointer = false;
      holdMs = 0;
    };

    const clearTransient = (): void => {
      ball = null;
      trail = [];
      trailClock = 0;
      popups = [];
      sparks = [];
      rimFlash = 0;
      shake = 0;
      holdLeft = 0;
      flightMs = 0;
      resolved = true;
      stopCharge();
    };

    const resetRun = (): void => {
      phase = "ready";
      score = 0;
      used = 0;
      combo = 0;
      longestCombo = 0;
      makes = 0;
      remaining = ROUND_MS;
      lastSec = -1;
      clock = 0;
      clearTransient();
      syncHud();
      syncTime(true);
      ctx.hud.urgent(false);
      ctx.timer.hide();
    };

    /** 结算只走这里一次；最高分交给壳层按 high 模式写。 */
    const finish = (title: string, kicker: string): void => {
      if (phase === "over") return;
      phase = "over";
      ball = null;
      resolved = true;
      stopCharge();
      ctx.timer.hide();
      ctx.hud.urgent(false);
      syncHud();

      const attempts = used;
      const rate = attempts > 0 ? Math.round((makes / attempts) * 100) : 0;
      ctx.audio.end();

      // 让结算层背后停在干净的一帧。
      render();

      ctx.end({
        score,
        title,
        kicker,
        stats: [
          { label: "命中率", value: `${rate}%` },
          { label: "最长连中", value: longestCombo },
        ],
      });
    };

    /** 球数用完 / 时间到都从这里收尾。 */
    const checkRoundOver = (): boolean => {
      if (phase === "over") return true;
      if (remaining <= 0) {
        finish("时间到", "TIME UP");
        return true;
      }
      if (used >= BALLS_PER_ROUND) {
        finish("十球打完", "ROUND OVER");
        return true;
      }
      return false;
    };

    /* ---------------- 出手 ---------------- */

    const isCharging = (): boolean => chargingKey || chargingPointer;

    const currentPower = (): number => powerFromHold(holdMs);

    const beginHold = (fromPointer: boolean): void => {
      ctx.audio.unlock();
      if (ctx.isPaused()) return;
      // 只在 ready 受理蓄力。settle 期间球还挂在筐口做进球展示，
      // 这时开始蓄力会把展示中的球清掉；等那 300–400ms 的停顿过去也更像街机节奏。
      if (phase !== "ready") return;
      // 球用完 / 时间到就不再受理蓄力：否则第 10 球落定后的停顿里
      // 还能再按一次，多打出第 11 球。
      if (used >= BALLS_PER_ROUND || remaining <= 0) return;

      if (fromPointer) chargingPointer = true;
      else chargingKey = true;
      if (!isCharging()) return;

      phase = "charging";
      holdMs = 0;
      ball = null;
      resolved = true;
      ctx.audio.blip();
    };

    /** 松手出手：消耗一颗球，按当前力度发射。 */
    const release = (): void => {
      if (phase !== "charging") {
        stopCharge();
        return;
      }
      const power = currentPower();
      stopCharge();

      ball = shoot(ORIGIN, power);
      trail = [{ x: ball.x, y: ball.y }];
      trailClock = 0;
      flightMs = 0;
      resolved = false;
      used += 1;
      phase = "flying";

      syncHud();
      ctx.audio.spawn(power >= makeWindow.low && power <= makeWindow.high);
    };

    /* ---------------- 输入 ---------------- */

    /** 松手：只有双通道都松开才真的出手（键盘和指针互不干扰）。 */
    const endHold = (fromPointer: boolean): void => {
      if (fromPointer) chargingPointer = false;
      else chargingKey = false;
      if (phase === "charging" && !isCharging()) release();
    };

    // 指针：按住蓄力、松手出手；键盘走同一条通路。
    ctx.input.pointer.on("down", (info) => {
      const type = info.source.pointerType || "mouse";
      if (type === "mouse" && info.source.button !== 0) return;
      beginHold(true);
    });
    ctx.input.pointer.on("up", () => endHold(true));
    ctx.input.pointer.on("cancel", () => endHold(true));
    ctx.input.pointer.on("leave", () => {
      // 指针已被捕获，真正的离开只会在没有按住时发生；
      // 按住时拖出画布仍然算「还在蓄力」，松手再出手。
      if (chargingPointer && !ctx.input.pointer.down) endHold(true);
    });

    // 键盘 / 虚拟手柄：A / 空格 / Enter 都是 action。
    ctx.input.keys.onPress((action) => {
      if (action !== "action" && action !== "primary") return;
      beginHold(false);
    });
    ctx.input.keys.onRelease((action) => {
      if (action !== "action" && action !== "primary") return;
      endHold(false);
    });

    /* ---------------- 结算一球 ---------------- */

    const settleBall = (kind: MakeKind): void => {
      if (resolved) return;
      resolved = true;

      const points = scoreFor(kind);
      const wasHot = combo >= COMBO_HOT;
      score += points;
      combo = comboAfter(kind, combo);
      longestCombo = Math.max(longestCombo, combo);
      if (kind !== "miss") makes += 1;

      const cx = ball ? ball.x : RIM.x + RIM.w / 2;
      const cy = ball ? ball.y : RIM.y;

      if (kind === "swish") {
        addPopup("SWISH +15", cx, cy - 16, P.gold, 2);
        addBurst(cx, RIM.y - 2, 14, true);
        rimFlash = 1;
        flashColor = P.gold;
        ctx.audio.gold();
        if (!ctx.reducedMotion) shake = 2;
      } else if (kind === "rim") {
        addPopup("+10", cx, cy - 14, P.cream, 2);
        addBurst(cx, RIM.y - 2, 7, false);
        rimFlash = 0.8;
        flashColor = P.amber;
        ctx.audio.coin();
      } else {
        addPopup("MISS", Math.min(cx, W - 18), cy - 12, P.red, 1);
        ctx.audio.miss();
      }

      // 连中第一次跨到 3：冒火提示。
      if (!wasHot && combo >= COMBO_HOT) {
        addPopup("ON FIRE!", RIM.x - 4, RIM.y - 28, P.gold, 2);
        ctx.audio.tier();
      }

      syncHud(kind !== "miss" ? "score" : undefined);
      if (kind === "swish") ctx.hud.flash("combo", "is-bump");
      if (kind === "miss" && wasHot) ctx.hud.flash("combo", "is-broken");

      holdLeft = kind === "miss" ? MISS_HOLD_MS : MAKE_HOLD_MS;
      phase = "settle";
    };

    /* ---------------- 更新 ---------------- */

    const updateEffects = (dt: number): void => {
      for (let i = popups.length - 1; i >= 0; i -= 1) {
        const p = popups[i];
        if (!p) continue;
        p.life -= dt / POPUP_MS;
        if (p.life <= 0) popups.splice(i, 1);
      }

      const seconds = dt / 1000;
      for (let i = sparks.length - 1; i >= 0; i -= 1) {
        const s = sparks[i];
        if (!s) continue;
        s.life -= dt / SPARK_MS;
        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        s.x += s.vx * seconds;
        s.y += s.vy * seconds;
        s.vy += 210 * seconds;
      }

      if (rimFlash > 0) rimFlash = Math.max(0, rimFlash - dt / 420);
      if (shake > 0) shake = Math.max(0, shake - dt * 0.01);
    };

    const updateBall = (dt: number): void => {
      const b = ball;
      if (!b) return;

      trailClock += dt;
      if (trailClock >= TRAIL_GAP) {
        trailClock = 0;
        trail.push({ x: b.x, y: b.y });
        if (trail.length > TRAIL_MAX) trail.shift();
      }

      stepBall(b, dt);
      flightMs += dt;

      // 筐口判定看「本帧是否向下穿过筐口平面」，50ms 大步长也不会跳帧。
      const kind = makeKind(b);
      if (kind !== "miss") {
        // 停在筐口中心，视觉上像穿网而入。
        const cross = rimCrossX(b);
        b.x = Number.isNaN(cross) ? RIM.x + RIM.w / 2 : clamp(cross, RIM.x + 2, RIM.x + RIM.w - 2);
        b.y = RIM.y + 2;
        settleBall(kind);
        return;
      }

      if (b.y + BALL_R >= FLOOR_LINE || flightMs >= MAX_FLIGHT_MS) settleBall("miss");
    };

    /* ---------------- 绘制 ---------------- */

    /** 蓄力预览：用和实战同一套物理算出来的弧线。 */
    const previewPoints = (): { x: number; y: number }[] => {
      const points: { x: number; y: number }[] = [];
      const probe: Ball = { ...shoot(ORIGIN, currentPower()) };
      for (let i = 0; i < 120; i += 1) {
        stepBall(probe, 8);
        if (probe.y > FLOOR_LINE) break;
        if (probe.vy > 0 && probe.y > RIM.y) break;
        if (i % 3 === 0) points.push({ x: probe.x, y: probe.y });
      }
      return points.slice(0, 24);
    };

    const render = (): void => {
      const c = ctx.ctx;
      paintCourt(c, W, H);

      let sx = 0;
      let sy = 0;
      if (shake > 0.2 && !ctx.reducedMotion) {
        sx = Math.round(Math.sin(clock * 0.11) * shake);
        sy = Math.round(Math.cos(clock * 0.15) * shake * 0.5);
      }
      c.save();
      c.translate(sx, sy);

      drawRack(c, clock);

      const charging = phase === "charging";
      const power = charging ? currentPower() : 0;

      if (charging) {
        drawArcPreview(c, previewPoints(), power >= makeWindow.low && power <= makeWindow.high);
      }

      if (rimFlash > 0) drawRimFlash(c, rimFlash, flashColor);

      const hot = combo >= COMBO_HOT;
      if (ball) {
        drawBallTrail(c, trail, hot);
        drawBall(c, ball.x, ball.y, hot);
      }

      for (const s of sparks) {
        c.globalAlpha = clamp(s.life, 0, 1);
        const size = s.life > 0.6 ? 2 : 1;
        rect(c, Math.round(s.x), Math.round(s.y), size, size, s.color);
      }
      c.globalAlpha = 1;

      // 力度条：飞行中压暗，避免抢走球的注意力。
      const meterAlpha = phase === "flying" ? 0.4 : 1;
      c.globalAlpha = meterAlpha;
      drawPowerMeter(c, power, makeWindow, swishWindow, charging);
      c.globalAlpha = 1;

      c.restore();

      // 飘字用屏幕空间，不跟着抖动。
      for (const p of popups) drawPopup(c, p.text, p.x, p.y, p.life, p.color, p.size);

      // 开场提示：告诉玩家怎么出手。
      if (phase === "ready" && used === 0 && remaining > ROUND_MS - 5000) {
        const label = ctx.padVisible() ? "HOLD A" : "HOLD SPACE";
        drawCentered(c, label, H - 11, 1, P.lav, 0.6 + 0.4 * Math.sin(clock * 0.006));
      }
    };

    resetRun();

    return {
      start(): void {
        ctx.audio.unlock();
        ctx.audio.ui();
        resetRun();
        ctx.timer.set(ROUND_MS, ROUND_MS);
        ctx.announce(`像素投篮，十球一轮，抛射角 ${ANGLE_DEG} 度。`);
      },

      update(dt: number): void {
        if (phase === "over") return;
        clock += dt;

        remaining = Math.max(0, remaining - dt);
        syncTime();
        ctx.timer.set(remaining, ROUND_MS, { low: 0.34, critical: 0.15 });

        updateEffects(dt);

        if (phase === "charging") {
          // 蓄力途中时间到：立刻收尾，否则玩家一直按着就永远不结算。
          if (remaining <= 0) {
            stopCharge();
            checkRoundOver();
            return;
          }
          holdMs += dt;
          // powerFromHold 自己取模，这里只防止 holdMs 无限增长。
          if (holdMs > POWER_PERIOD_MS * 64) holdMs -= POWER_PERIOD_MS * 64;
          return;
        }

        if (phase === "flying") {
          updateBall(dt);
          return;
        }

        if (phase === "settle") {
          holdLeft -= dt;
          if (holdLeft <= 0) {
            ball = null;
            trail = [];
            if (checkRoundOver()) return;
            phase = "ready";
          }
          return;
        }

        // ready：时间到就收尾。
        checkRoundOver();
      },

      render,

      pause(): void {
        // 暂停时清掉蓄力状态，恢复后不会带着半格力度出手。
        stopCharge();
        if (phase === "charging") phase = "ready";
      },

      resume(): void {
        stopCharge();
        if (phase === "charging") phase = "ready";
      },

      destroy(): void {
        ball = null;
        trail = [];
        popups = [];
        sparks = [];
        stopCharge();
      },
    };
  },
});

export default game;
