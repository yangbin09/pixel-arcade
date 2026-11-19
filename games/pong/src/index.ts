import {
  P,
  clamp,
  defineGame,
  rect,
  type GameContext,
  type GameInstance,
} from "@arcade/core";

import {
  AI_TONE,
  PLAYER_TONE,
  drawBall,
  drawCourt,
  drawGoalFlash,
  drawHint,
  drawPaddle,
  drawPaddleSpark,
  drawScoreBoard,
  drawTrail,
} from "./art";
import { meta } from "./meta";
import {
  AI_DEFAULT_LEVEL,
  BALL_MAX_X,
  BALL_MIN_X,
  BALL_R,
  BASE_SPEED,
  BOTTOM_PLANE,
  FIELD,
  PADDLE_HALF,
  PADDLE_SPEED,
  RALLY_POINT,
  TOP_LINE,
  TOP_PLANE,
  WIN_BONUS,
  WIN_POINTS,
  aiReaction,
  aiSpeed,
  aiStep,
  aiTarget,
  ballBox,
  bounceVelocity,
  clampPaddle,
  dragAnchor,
  dragTarget,
  goalScored,
  hitOffset,
  overlap,
  paddleRect,
  serveAngle,
  speedUp,
  substepsFor,
  type Ball,
  type DragAnchor,
} from "./logic";

/** 逻辑画布就是球场，168×168 正方形。 */
const W = FIELD;
const H = FIELD;

/** 发球前的等待：开局久一点留出看清提示的时间，得分后短一点。 */
const SERVE_START_MS = 1500;
const SERVE_AFTER_POINT_MS = 1000;
/** AI 等级固定，保证难度公平。 */
const AI_LEVEL = AI_DEFAULT_LEVEL;

/** 球拖影的采样间隔与长度。 */
const TRAIL_GAP = 34;
const TRAIL_MAX = 7;

type Phase = "ready" | "serve" | "play" | "over";

interface TrailPoint {
  x: number;
  y: number;
}

interface Spark {
  x: number;
  plane: number;
  life: number;
  top: boolean;
}

interface GoalFlash {
  side: "top" | "bottom";
  life: number;
}

/** HUD 数值只能吃像素字库，且夹到 2 位数位宽度。 */
const hudNumber = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(clamp(value, 0, 99));
};

const game = defineGame({
  meta,
  create(ctx: GameContext): GameInstance {
    let phase: Phase = "ready";
    let clock = 0;

    /* ---------------- 比赛状态 ---------------- */

    /** 玩家 / AI 的比分（七分制，0..7）。 */
    let points = 0;
    let aiPoints = 0;
    /** 街机分数：每拍 +1，赢下一分 +50，由壳层写入历史最高。 */
    let score = 0;
    /** 当前这一分里的回合拍数。 */
    let rally = 0;
    let longestRally = 0;

    let playerX = W / 2;
    let aiX = W / 2;

    let ball: Ball = { x: W / 2, y: H / 2, vx: 0, vy: 0, speed: BASE_SPEED };
    let serving = true;
    let serveLeft = 0;

    let trail: TrailPoint[] = [];
    let trailClock = 0;
    let sparks: Spark[] = [];
    let goalFlash: GoalFlash | null = null;
    let shake = 0;

    /** 触摸拖动锚点；鼠标保持绝对跟随。 */
    let drag: DragAnchor | null = null;
    let usingKeys = false;

    /** AI 看到的是「反应延迟之前」的球，所以不会瞬移。 */
    let history: { t: number; ball: Ball }[] = [];
    let historyClock = 0;

    /* ---------------- HUD ---------------- */

    const syncHud = (): void => {
      ctx.hud.set("score", hudNumber(points));
      ctx.hud.set("ai", hudNumber(aiPoints));
      ctx.hud.set("rally", hudNumber(rally));
    };

    /* ---------------- 流程 ---------------- */

    const clearTransient = (): void => {
      trail = [];
      trailClock = 0;
      sparks = [];
      goalFlash = null;
      shake = 0;
      drag = null;
    };

    const attachServe = (): void => {
      serving = true;
      ball = {
        x: playerX,
        y: BOTTOM_PLANE - BALL_R,
        vx: 0,
        vy: 0,
        speed: BASE_SPEED,
      };
      history = [];
      historyClock = 0;
    };

    const launchServe = (): void => {
      if (phase !== "serve") return;
      const angle = serveAngle(Math.random);
      const speed = BASE_SPEED;
      ball.vx = Math.sin(angle) * speed;
      ball.vy = -Math.cos(angle) * speed;
      ball.speed = speed;
      ball.y = BOTTOM_PLANE - BALL_R;
      serving = false;
      phase = "play";
      history = [];
      historyClock = 0;
      ctx.audio.pop();
    };

    const resetRun = (): void => {
      phase = "ready";
      clock = 0;
      points = 0;
      aiPoints = 0;
      score = 0;
      rally = 0;
      longestRally = 0;
      playerX = W / 2;
      aiX = W / 2;
      serving = true;
      serveLeft = 0;
      usingKeys = false;
      clearTransient();
      attachServe();
      syncHud();
      ctx.hud.urgent(false);
      ctx.timer.hide();
    };

    /** 结算只走这里一次；最高分由壳层按 high 模式写入。 */
    const finish = (playerWon: boolean): void => {
      if (phase === "over") return;
      phase = "over";
      serving = false;
      clearTransient();
      syncHud();

      if (playerWon) {
        ctx.audio.win();
        ctx.announce("先到七分，赢下这一局");
      } else {
        ctx.audio.lose();
        ctx.announce("对手先到七分，本局结束");
      }

      render();

      ctx.end({
        score,
        title: playerWon ? "拿下这一局" : "对手先到七分",
        kicker: playerWon ? "WIN" : "GAME OVER",
        stats: [
          { label: "最长回合", value: longestRally },
          { label: "AI 得分", value: aiPoints },
        ],
      });
    };

    /** 一分结束：记分、结算街机分、回到发球。 */
    const endPoint = (to: "player" | "ai"): void => {
      const playerWon = to === "player";

      if (playerWon) points += 1;
      else aiPoints += 1;

      // 每拍到球 +1 已在 bounceOffPaddle 里实时入账，这里只补赢下这一分的 +50。
      if (playerWon) score += WIN_BONUS;
      longestRally = Math.max(longestRally, rally);

      goalFlash = { side: playerWon ? "top" : "bottom", life: 1 };
      if (!ctx.reducedMotion) shake = playerWon ? 2 : 3;

      if (playerWon) {
        ctx.audio.coin();
        ctx.hud.flash("score", "is-bump");
      } else {
        ctx.audio.miss();
        ctx.hud.flash("ai", "is-broken");
      }

      serving = true;
      rally = 0;
      syncHud();

      if (points >= WIN_POINTS) {
        finish(true);
        return;
      }
      if (aiPoints >= WIN_POINTS) {
        finish(false);
        return;
      }

      // 一分结束后短暂停顿再发球，让记分和闪光看得清。
      phase = "serve";
      attachServe();
      serveLeft = SERVE_AFTER_POINT_MS;
    };

    /* ---------------- 球 ---------------- */

    const addSpark = (x: number, plane: number, top: boolean): void => {
      sparks.push({ x, plane, life: 1, top });
      if (sparks.length > 12) sparks.shift();
    };

    const addTrail = (dt: number): void => {
      trailClock += dt;
      if (trailClock < TRAIL_GAP) return;
      trailClock = 0;
      trail.push({ x: ball.x, y: ball.y });
      if (trail.length > TRAIL_MAX) trail.shift();
    };

    const bounceOffPaddle = (top: boolean): void => {
      const center = top ? aiX : playerX;
      const offset = hitOffset(ball.x, center);
      const dir: 1 | -1 = top ? 1 : -1;
      const speed = speedUp(ball.speed, 1);
      const velocity = bounceVelocity(offset, speed, dir);

      ball.speed = speed;
      ball.vx = velocity.vx;
      ball.vy = velocity.vy;
      ball.y = top ? TOP_PLANE + BALL_R : BOTTOM_PLANE - BALL_R;

      rally += 1;
      longestRally = Math.max(longestRally, rally);
      // 每拍到球 +1 分，实时累加，结算时再加赢分奖励。
      score += RALLY_POINT;
      syncHud();
      ctx.hud.flash("rally", "is-bump");
      ctx.audio.hit(Math.min(rally, 12));

      addSpark(ball.x, top ? TOP_PLANE : BOTTOM_PLANE, top);
    };

    const stepBall = (dt: number): void => {
      const distance = (ball.speed * dt) / 1000;
      const steps = substepsFor(distance);
      const subSeconds = dt / 1000 / steps;

      for (let i = 0; i < steps; i += 1) {
        ball.x += ball.vx * subSeconds;
        ball.y += ball.vy * subSeconds;

        // 侧墙竖直反弹。
        if (ball.x < BALL_MIN_X) {
          ball.x = BALL_MIN_X;
          ball.vx = Math.abs(ball.vx);
          ctx.audio.blip();
        } else if (ball.x > BALL_MAX_X) {
          ball.x = BALL_MAX_X;
          ball.vx = -Math.abs(ball.vx);
          ctx.audio.blip();
        }

        // 顶挡板（AI）：只有球心横坐标落在挡板接球范围才弹回去。
        if (ball.vy < 0 && ball.y - BALL_R <= TOP_PLANE) {
          const paddle = paddleRect(aiX, TOP_LINE);
          const touched = overlap(ballBox(ball.x, ball.y), paddle);
          if (touched || Math.abs(ball.x - aiX) <= PADDLE_HALF + BALL_R) {
            bounceOffPaddle(true);
          }
        }

        // 底挡板（玩家）。
        if (ball.vy > 0 && ball.y + BALL_R >= BOTTOM_PLANE) {
          const paddle = paddleRect(playerX, BOTTOM_PLANE);
          const touched = overlap(ballBox(ball.x, ball.y), paddle);
          if (touched || Math.abs(ball.x - playerX) <= PADDLE_HALF + BALL_R) {
            bounceOffPaddle(false);
          }
        }

        const goal = goalScored(ball);
        if (goal) {
          endPoint(goal);
          return;
        }
      }
    };

    /* ---------------- AI ---------------- */

    const recordHistory = (dt: number): void => {
      historyClock += dt;
      if (historyClock < 16) return;
      historyClock = 0;
      history.push({ t: clock, ball: { ...ball } });
      if (history.length > 40) history.shift();
    };

    /**
     * AI 眼里「反应延迟之前」的那一帧球。
     * 找不到更早的样本就退回最早的一条，再兜底用当前球。
     */
    const seenBall = (): Ball => {
      const cutoff = clock - aiReaction(AI_LEVEL);
      let pick: Ball | null = null;
      for (const sample of history) {
        if (sample.t > cutoff) break;
        pick = sample.ball;
      }
      if (!pick) pick = history[0]?.ball ?? ball;
      return { ...pick };
    };

    const updateAi = (dt: number): void => {
      if (serving) {
        // 发球前慢慢回中线，像在等球。
        aiX = aiStep(aiX, W / 2, dt, aiSpeed(AI_LEVEL) * 0.6);
        return;
      }
      const target = aiTarget(seenBall(), AI_LEVEL);
      aiX = aiStep(aiX, target, dt, aiSpeed(AI_LEVEL));
    };

    /* ---------------- 玩家 ---------------- */

    const updatePlayer = (dt: number): void => {
      let dir = 0;
      if (ctx.input.keys.isDown("left")) dir -= 1;
      if (ctx.input.keys.isDown("right")) dir += 1;
      if (dir === 0) return;

      usingKeys = true;
      drag = null;
      playerX = clampPaddle(playerX + (dir * PADDLE_SPEED * dt) / 1000);
    };

    const movePlayerTo = (x: number): void => {
      playerX = clampPaddle(x);
      if (serving && phase !== "over") {
        ball.x = playerX;
        ball.y = BOTTOM_PLANE - BALL_R;
      }
    };

    /* ---------------- 绘制 ---------------- */

    const render = (): void => {
      const c = ctx.ctx;
      drawCourt(c);

      let sx = 0;
      let sy = 0;
      if (shake > 0.2 && !ctx.reducedMotion) {
        sx = Math.round(Math.sin(clock * 0.12) * shake);
        sy = Math.round(Math.cos(clock * 0.17) * shake * 0.5);
      }

      c.save();
      c.translate(sx, sy);

      // AI 挡板在上，玩家挡板在下。
      drawPaddle(c, aiX, TOP_LINE, AI_TONE);
      drawPaddle(c, playerX, BOTTOM_PLANE, PLAYER_TONE);

      if (goalFlash && goalFlash.life > 0) {
        drawGoalFlash(c, goalFlash.side, goalFlash.life, goalFlash.side === "top" ? P.mint : P.red);
      }

      if (!serving && phase === "play") {
        drawTrail(c, trail, P.lav);
        drawBall(c, ball.x, ball.y, rally >= 6);
      } else if (serving && phase !== "over") {
        // 待发：球停在玩家挡板上，上方一颗跳动的小箭头。
        drawBall(c, ball.x, ball.y, false);
        const hop = Math.round((Math.sin(clock * 0.008) + 1) * 2);
        const ax = Math.round(ball.x);
        const ay = Math.round(ball.y) - 8 - hop;
        rect(c, ax, ay, 1, 3, P.lav);
        rect(c, ax - 1, ay + 1, 3, 1, P.lav);
        rect(c, ax - 2, ay + 2, 5, 1, P.lav);
      }

      for (const spark of sparks) {
        drawPaddleSpark(
          c,
          spark.x,
          spark.plane,
          spark.life,
          spark.top ? AI_TONE : PLAYER_TONE,
        );
      }

      c.restore();

      // 比分牌：发球等待时淡出显示，得分后短暂停留。
      if (phase === "serve") {
        const fade = clamp(serveLeft / 500, 0, 1);
        drawScoreBoard(c, points, aiPoints, 0.35 + 0.65 * fade);

        const label = points >= WIN_POINTS - 1 || aiPoints >= WIN_POINTS - 1 ? "MATCH POINT" : "FIRST TO 7";
        drawHint(c, label, H / 2 + 22, 1, P.lav, 0.5 + 0.5 * fade);

        const hint = usingKeys ? "PRESS ACTION TO SERVE" : "TAP OR PRESS ACTION";
        drawHint(c, hint, H - 26, 1, P.cream, 0.6 + 0.4 * fade);
      }

      if (phase === "over") {
        drawScoreBoard(c, points, aiPoints, 1);
      }
    };

    /* ---------------- 输入 ---------------- */

    ctx.input.pointer.on("down", (info) => {
      ctx.audio.unlock();
      if (phase === "over" || ctx.isPaused()) return;

      const type = info.source.pointerType || "mouse";
      if (type === "mouse" && info.source.button !== 0) return;

      if (type === "mouse") {
        // 鼠标：绝对跟随，点哪走哪。
        drag = null;
        movePlayerTo(info.x);
      } else {
        // 触摸 / 笔：相对拖动，手指不遮住挡板。
        drag = dragAnchor(info.x, playerX);
      }

      if (phase === "serve") launchServe();
    });

    ctx.input.pointer.on("move", (info) => {
      if (phase === "over" || ctx.isPaused()) return;

      const type = info.source.pointerType || "mouse";
      if (type === "mouse" && !info.down) {
        // 悬停也跟随，端着鼠标就能打。
        drag = null;
        movePlayerTo(info.x);
        return;
      }
      if (!drag || !info.down) return;
      movePlayerTo(dragTarget(drag, info.x));
    });

    const endDrag = (): void => {
      drag = null;
    };
    ctx.input.pointer.on("up", endDrag);
    ctx.input.pointer.on("cancel", endDrag);
    ctx.input.pointer.on("leave", endDrag);

    ctx.input.keys.onPress((action) => {
      if (phase === "over" || ctx.isPaused()) return;
      if (action !== "action" && action !== "primary") return;
      usingKeys = true;
      if (phase === "serve") launchServe();
    });

    resetRun();

    return {
      start(): void {
        ctx.audio.unlock();
        ctx.audio.ui();
        resetRun();
        phase = "serve";
        serving = true;
        serveLeft = SERVE_START_MS;
        syncHud();
        ctx.announce("像素乒乓，七分制，先到七分获胜。");
      },

      update(dt: number): void {
        if (phase === "over") return;
        clock += dt;

        // 特效衰减与球速无关，发球阶段也要走。
        for (let i = sparks.length - 1; i >= 0; i -= 1) {
          const spark = sparks[i];
          if (!spark) continue;
          spark.life -= dt / 420;
          if (spark.life <= 0) sparks.splice(i, 1);
        }
        if (goalFlash) {
          goalFlash.life -= dt / 620;
          if (goalFlash.life <= 0) goalFlash = null;
        }
        if (shake > 0) shake = Math.max(0, shake - dt * 0.012);

        updatePlayer(dt);
        updateAi(dt);

        if (phase === "serve") {
          serveLeft -= dt;
          if (serving) {
            ball.x = playerX;
            ball.y = BOTTOM_PLANE - BALL_R;
          }
          if (serveLeft <= 0 && serving) launchServe();
          return;
        }

        if (phase !== "play") return;

        addTrail(dt);
        recordHistory(dt);
        stepBall(dt);
      },

      render,

      pause(): void {
        drag = null;
      },

      resume(): void {
        drag = null;
      },

      destroy(): void {
        drag = null;
        history = [];
        trail = [];
      },
    };
  },
});

export default game;
