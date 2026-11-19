import {
  P,
  clamp,
  defineGame,
  drawPixelText,
  line,
  measurePixelText,
  rect,
  type GameContext,
  type GameInstance,
} from "@arcade/core";

import {
  drawBall,
  drawBumper,
  drawFlipper,
  drawServeMark,
  drawTable,
  drawTarget,
} from "./art";
import { meta } from "./meta";
import {
  BUMPERS,
  COMBO_WINDOW_MS,
  FIELD_H,
  FIELD_W,
  FLIP_FROM,
  FLIP_TO,
  GUIDE_THICK,
  GUIDES,
  START_BALLS,
  SUB_STEP_MS,
  TARGETS,
  TARGET_POINTS,
  allTargetsLit,
  flipperSegment,
  multiplierFor,
  scoreForBumper,
  serveBall,
  stepBall,
  stepFlipper,
  targetRect,
  type Ball,
  type BallEvent,
  type FlipperSide,
  type FlipperState,
} from "./logic";

const W = FIELD_W;
const H = FIELD_H;

/** 掉球后重新投入的停顿（毫秒）。 */
const SERVE_DELAY_MS = 620;
/** 顶部得分飘字停留时间。 */
const POPUP_MS = 620;
/** 缓冲器命中后的高亮衰减速度（每毫秒）。 */
const HOT_DECAY = 1 / 320;
/** 分数上限，防止 HUD 数字撑破 5 位布局。 */
const SCORE_MAX = 99999;
/**
 * 轻点 / 单击至少要按住这么久（毫秒）。
 * 触屏上一次点按可能整个发生在两帧之间，只靠轮询 isDown 会漏掉，
 * 所以按下时先锁存一小段时间，保证挡板一定走完一次行程。
 */
const TAP_LATCH_MS = 130;

type Mode = "ready" | "serve" | "playing" | "over";

interface Popup {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
}

const game = defineGame({
  meta,
  create(ctx: GameContext): GameInstance {
    let mode: Mode = "ready";
    let clock = 0;

    let score = 0;
    let ballsLeft = START_BALLS;

    /** 连击：命中次数与距上次命中的毫秒数。 */
    let comboHits = 0;
    let comboElapsed = COMBO_WINDOW_MS;
    let shownMult = 1;
    let bestMult = 1;

    let ball: Ball = serveBall(0);
    let ballActive = false;
    let serveLeft = 0;
    let serveSeed = 0;

    let leftAngle = FLIP_FROM;
    let rightAngle = FLIP_FROM;
    let leftHeld = false;
    let rightHeld = false;
    /** 手指 / 鼠标按在画布哪一侧；按下即锁存，避免快速点按被帧率漏掉。 */
    let pointerSide: FlipperSide | null = null;
    /** 点按锁存剩余时间（毫秒），期间强制按住对应挡板。 */
    let leftLatch = 0;
    let rightLatch = 0;

    let lit: boolean[] = [];
    let cleared = 0;

    let hot: number[] = [];
    let flipperHot: Record<FlipperSide, number> = { left: 0, right: 0 };
    let popups: Popup[] = [];
    const trail: { x: number; y: number }[] = [];

    /* ---------------- HUD ---------------- */

    const syncHud = (): void => {
      ctx.hud.set("score", score);
      ctx.hud.set("balls", Math.max(0, ballsLeft));
      ctx.hud.set("mult", `x${shownMult}`);
    };

    /* ---------------- 流程 ---------------- */

    const reset = (): void => {
      mode = "ready";
      clock = 0;
      score = 0;
      ballsLeft = START_BALLS;
      comboHits = 0;
      comboElapsed = COMBO_WINDOW_MS;
      shownMult = 1;
      bestMult = 1;
      ballActive = false;
      serveLeft = 0;
      serveSeed = 0;
      ball = serveBall(serveSeed);
      leftAngle = FLIP_FROM;
      rightAngle = FLIP_FROM;
      leftHeld = false;
      rightHeld = false;
      pointerSide = null;
      leftLatch = 0;
      rightLatch = 0;
      lit = TARGETS.map(() => false);
      cleared = 0;
      hot = BUMPERS.map(() => 0);
      flipperHot = { left: 0, right: 0 };
      popups = [];
      trail.length = 0;
      syncHud();
      ctx.hud.urgent(false);
      ctx.timer.hide();
    };

    const addPopup = (x: number, y: number, text: string, color: string): void => {
      popups.push({ x, y, text, color, life: POPUP_MS });
      if (popups.length > 12) popups.splice(0, popups.length - 12);
    };

    const addScore = (points: number): void => {
      score = Math.min(SCORE_MAX, score + points);
      ctx.hud.set("score", score);
      ctx.hud.flash("score", "is-bump");
    };

    /** 结算只走这里一次；最高分由壳层按 high 模式写入。 */
    const finish = (): void => {
      if (mode === "over") return;
      mode = "over";
      ballActive = false;
      pointerSide = null;
      leftHeld = false;
      rightHeld = false;
      ctx.timer.hide();
      ctx.hud.urgent(false);

      ctx.audio.lose();
      if (score > 0) ctx.audio.end();
      render();

      ctx.end({
        score,
        title: "球全部掉完",
        kicker: "GAME OVER",
        stats: [
          { label: "最高倍率", value: `x${bestMult}` },
          { label: "打亮靶标", value: `${cleared} 轮` },
        ],
      });
    };

    const serve = (): void => {
      ball = serveBall(serveSeed);
      trail.length = 0;
      ballActive = true;
      mode = "playing";
      ctx.audio.blip();
    };

    const loseBall = (): void => {
      ballsLeft -= 1;
      ballActive = false;
      trail.length = 0;
      comboHits = 0;
      comboElapsed = COMBO_WINDOW_MS;
      shownMult = 1;
      ctx.hud.set("balls", Math.max(0, ballsLeft));
      ctx.hud.set("mult", "x1");
      ctx.hud.flash("balls", "is-broken");
      ctx.audio.miss();

      if (ballsLeft <= 0) {
        finish();
        return;
      }

      mode = "serve";
      serveLeft = SERVE_DELAY_MS;
      serveSeed += 1;
      ctx.toast.show(`还剩 ${ballsLeft} 颗球`, { warn: true, duration: 900 });
    };

    /* ---------------- 计分 ---------------- */

    const hitBumper = (index: number): void => {
      comboHits = comboElapsed < COMBO_WINDOW_MS ? comboHits + 1 : 1;
      comboElapsed = 0;

      const mult = multiplierFor(comboHits, 0);
      shownMult = mult;
      if (mult > bestMult) bestMult = mult;

      const points = scoreForBumper(mult);
      addScore(points);

      const bumper = BUMPERS[index] ?? BUMPERS[0];
      if (bumper) {
        hot[index] = 1;
        addPopup(bumper.x, bumper.y - bumper.r - 8, `+${points}`, mult > 1 ? P.gold : P.cream);
      }

      ctx.hud.set("mult", `x${mult}`);
      if (mult > 1) {
        ctx.hud.flash("mult", "is-bump");
        ctx.audio.hit(mult);
      } else {
        ctx.audio.pop();
      }
    };

    const hitTarget = (index: number): void => {
      if (lit[index]) return;
      lit[index] = true;
      ctx.audio.blip();

      if (!allTargetsLit(lit)) return;

      lit = TARGETS.map(() => false);
      addScore(TARGET_POINTS);
      cleared += 1;
      ctx.audio.gold();
      addPopup(W / 2, 150, `+${TARGET_POINTS}`, P.gold);
      ctx.toast.show(`靶标全亮 +${TARGET_POINTS}`, { duration: 900 });
    };

    const handleEvents = (events: readonly BallEvent[]): void => {
      for (const event of events) {
        if (mode !== "playing") return;
        if (event.kind === "bumper") {
          hitBumper(event.index);
        } else if (event.kind === "target") {
          hitTarget(event.index);
        } else if (event.kind === "flipper") {
          flipperHot[event.side] = 1;
          ctx.audio.tick(1);
        } else if (event.kind === "drain") {
          loseBall();
          return;
        }
      }
    };

    /* ---------------- 碰撞 / 物理 ---------------- */

    /** 本切片的挡板状态；omega 用真实角度差算，碰撞才能拿到正确的切向速度。 */
    let leftState: FlipperState = { side: "left", angle: FLIP_FROM, omega: 0 };
    let rightState: FlipperState = { side: "right", angle: FLIP_FROM, omega: 0 };

    const tickFlippers = (ms: number): void => {
      leftState = stepFlipper("left", leftAngle, leftHeld, ms);
      rightState = stepFlipper("right", rightAngle, rightHeld, ms);
      leftAngle = leftState.angle;
      rightAngle = rightState.angle;
    };

    const stepPhysics = (ms: number): void => {
      const events: BallEvent[] = [];
      ball = stepBall(ball, ms, [leftState, rightState], events);
      handleEvents(events);
    };

    /* ---------------- 绘制 ---------------- */

    const drawGuides = (c: CanvasRenderingContext2D): void => {
      for (const guide of GUIDES) {
        line(c, guide.x0, guide.y0, guide.x1, guide.y1, P.void, GUIDE_THICK + 1);
        line(c, guide.x0, guide.y0, guide.x1, guide.y1, P.lineHi, GUIDE_THICK);
        line(c, guide.x0, guide.y0, guide.x1, guide.y1, P.panel2, 1);
      }
    };

    const drawPlayfield = (c: CanvasRenderingContext2D): void => {
      drawTable(c, W, H);

      // 靶标
      for (let i = 0; i < TARGETS.length; i += 1) {
        const target = TARGETS[i];
        if (!target) continue;
        const box = targetRect(target);
        drawTarget(c, box.x, box.y, box.w, box.h, lit[i] === true);
      }

      drawGuides(c);

      // 缓冲器
      for (let i = 0; i < BUMPERS.length; i += 1) {
        const bumper = BUMPERS[i];
        if (!bumper) continue;
        drawBumper(c, bumper.x, bumper.y, bumper.r, hot[i] ?? 0);
      }

      // 挡板
      const leftSeg = flipperSegment("left", leftAngle);
      const rightSeg = flipperSegment("right", rightAngle);
      drawFlipper(c, leftSeg, leftAngle < (FLIP_FROM + FLIP_TO) / 2, flipperHot.left > 0.35);
      drawFlipper(c, rightSeg, rightAngle < (FLIP_FROM + FLIP_TO) / 2, flipperHot.right > 0.35);

      // 球的拖影
      for (let i = 0; i < trail.length; i += 1) {
        const point = trail[i];
        if (!point) continue;
        const alpha = ((i + 1) / (trail.length + 1)) * 0.5;
        c.globalAlpha = alpha;
        rect(c, point.x - 1, point.y - 1, 2, 2, P.amber);
        c.globalAlpha = 1;
      }

      if (ballActive || mode === "serve" || mode === "ready") drawBall(c, ball.x, ball.y, 3);

      // 发球提示
      if (mode === "serve") {
        const pulse = 0.35 + 0.4 * ((Math.sin(clock * 0.008) + 1) / 2);
        drawServeMark(c, Math.round(ball.x), Math.round(ball.y) + 7, pulse);
      }
    };

    const drawHints = (c: CanvasRenderingContext2D): void => {
      if (ctx.padVisible()) return;
      if (mode !== "serve" && mode !== "ready") return;

      const pulse = 0.4 + 0.35 * ((Math.sin(clock * 0.006) + 1) / 2);
      c.globalAlpha = pulse;
      drawPixelText(c, "L", 9, H - 24, 1, P.lav);
      drawPixelText(c, "R", W - 14, H - 24, 1, P.lav);
      c.globalAlpha = 1;
    };

    const drawPopups = (c: CanvasRenderingContext2D): void => {
      for (const popup of popups) {
        const alpha = clamp(popup.life / POPUP_MS, 0, 1);
        const width = measurePixelText(popup.text, 1);
        c.globalAlpha = alpha;
        drawPixelText(c, popup.text, popup.x - width / 2, popup.y, 1, popup.color);
        c.globalAlpha = 1;
      }
    };

    const render = (): void => {
      const c = ctx.ctx;
      rect(c, 0, 0, W, H, P.night);
      drawPlayfield(c);
      drawPopups(c);
      drawHints(c);
    };

    /* ---------------- 输入 ---------------- */

    const pressSide = (side: FlipperSide): void => {
      pointerSide = side;
      // 锁存一小段时间：快速点按也能让挡板完整抬一次，
      // 否则触屏点按可能整段落在两帧之间，轮询永远读不到。
      if (side === "left") leftLatch = TAP_LATCH_MS;
      else rightLatch = TAP_LATCH_MS;
      if (side === "left") leftHeld = true;
      else rightHeld = true;
    };

    const releasePointer = (): void => {
      pointerSide = null;
    };

    ctx.input.pointer.on("down", (info) => {
      ctx.audio.unlock();
      if (mode !== "playing" && mode !== "serve") return;
      if (info.source.pointerType === "mouse" && info.source.button !== 0) return;
      pressSide(info.x < W / 2 ? "left" : "right");
    });

    ctx.input.pointer.on("move", (info) => {
      if (!info.down) return;
      if (mode !== "playing" && mode !== "serve") return;
      // 手指在左右半区之间滑动时切换挡板。
      pressSide(info.x < W / 2 ? "left" : "right");
    });

    ctx.input.pointer.on("up", releasePointer);
    ctx.input.pointer.on("cancel", releasePointer);
    ctx.input.pointer.on("leave", releasePointer);

    /* ---------------- 循环 ---------------- */

    /** 键盘（含虚拟手柄）两个独立通路：左板 = 左方向 / A，右板 = 右方向 / B。 */
    const readInput = (): void => {
      const leftKey = ctx.input.keys.isDown("left") || ctx.input.keys.isDown("primary");
      const rightKey = ctx.input.keys.isDown("right") || ctx.input.keys.isDown("secondary");
      leftHeld = leftKey || pointerSide === "left" || leftLatch > 0;
      rightHeld = rightKey || pointerSide === "right" || rightLatch > 0;
    };

    /** 点按锁存随帧时间衰减。 */
    const decayLatch = (ms: number): void => {
      leftLatch = Math.max(0, leftLatch - ms);
      rightLatch = Math.max(0, rightLatch - ms);
    };

    reset();

    return {
      start(): void {
        ctx.audio.unlock();
        reset();
        mode = "serve";
        serveLeft = SERVE_DELAY_MS;
        ctx.timer.hide();
        ctx.audio.ui();
        ctx.announce("弹珠台开始，三颗球，守住底门。");
      },

      update(dt: number): void {
        if (mode === "over") return;
        clock += dt;

        readInput();
        decayLatch(dt);

        // 高亮 / 飘字 / 连击计时都用整帧时间推进。
        for (let i = 0; i < hot.length; i += 1) {
          hot[i] = Math.max(0, (hot[i] ?? 0) - dt * HOT_DECAY);
        }
        flipperHot.left = Math.max(0, flipperHot.left - dt * HOT_DECAY);
        flipperHot.right = Math.max(0, flipperHot.right - dt * HOT_DECAY);

        for (let i = popups.length - 1; i >= 0; i -= 1) {
          const popup = popups[i];
          if (!popup) continue;
          popup.life -= dt;
          popup.y -= (dt / 1000) * 14;
          if (popup.life <= 0) popups.splice(i, 1);
        }

        if (comboElapsed < COMBO_WINDOW_MS) {
          comboElapsed += dt;
          if (comboElapsed >= COMBO_WINDOW_MS) {
            comboHits = 0;
            shownMult = 1;
            ctx.hud.set("mult", "x1");
          }
        }

        if (mode === "serve") {
          serveLeft -= dt;
          tickFlippers(dt);
          if (serveLeft <= 0) serve();
          return;
        }

        if (mode !== "playing") {
          tickFlippers(dt);
          return;
        }

        // 按 4ms 切片推进：挡板角度和球的积分都保持同样的时间粒度，
        // 避免整帧 50ms 位移 13px 穿过 5px 厚的挡板。
        let remaining = dt;
        while (remaining > 0 && mode === "playing") {
          const slice = Math.min(SUB_STEP_MS, remaining);
          remaining -= slice;

          tickFlippers(slice);

          if (ballActive) {
            trail.push({ x: ball.x, y: ball.y });
            if (trail.length > 5) trail.shift();
            stepPhysics(slice);
          }
        }
      },

      render,

      pause(): void {
        leftHeld = false;
        rightHeld = false;
        pointerSide = null;
        leftLatch = 0;
        rightLatch = 0;
      },

      resume(): void {
        leftHeld = false;
        rightHeld = false;
        pointerSide = null;
        leftLatch = 0;
        rightLatch = 0;
      },

      destroy(): void {
        popups = [];
        trail.length = 0;
      },
    };
  },
});

export default game;
