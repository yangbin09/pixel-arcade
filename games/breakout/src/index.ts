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

import { drawBall, drawBrick, drawPaddle, drawPowerUp } from "./art";
import { meta } from "./meta";
import {
  BALL_R,
  FIELD_H,
  FIELD_W,
  LIVES,
  MAX_STEP,
  PADDLE_H,
  PADDLE_SPEED,
  PADDLE_W,
  PADDLE_WIDE,
  PADDLE_Y,
  POWERUP_CHANCE,
  POWERUP_EVERY,
  POWERUP_FALL,
  POWERUP_KINDS,
  POWERUP_SIZE,
  TOTAL_LEVELS,
  WIDE_MS,
  ballBox,
  bounceFromPaddle,
  brickPoints,
  brickRect,
  clampPaddleX,
  countAlive,
  createBricks,
  overlap,
  paddleRect,
  speedForLevel,
  substepsFor,
  type Ball,
  type Brick,
  type PowerUp,
  type PowerUpKind,
  type Rect,
} from "./logic";

const W = FIELD_W;
const H = FIELD_H;

/** 清关横幅停留时间，随后进入下一关。 */
const CLEAR_MS = 950;
const SERVE_HINT = "TAP OR SPACE";

type Phase = "serve" | "play" | "clear" | "over";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
}

const game = defineGame({
  meta,
  create(ctx: GameContext): GameInstance {
    let phase: Phase = "serve";
    let clock = 0;
    let score = 0;
    let lives = LIVES;
    let level = 1;

    let paddleX = Math.round((W - PADDLE_W) / 2);
    let paddleWidth = PADDLE_W;
    let wideLeft = 0;
    let serveCount = 1;

    let balls: Ball[] = [];
    let bricks: Brick[] = [];
    let bricksLeft = 0;
    let powerUps: PowerUp[] = [];
    let particles: Particle[] = [];

    /** 距上次掉落判定已经打碎多少块砖。 */
    let destroyed = 0;
    let clearLeft = 0;
    let shake = 0;

    /* ---------------- HUD ---------------- */

    const syncHud = (): void => {
      ctx.hud.set("score", score);
      ctx.hud.set("lives", Math.max(0, lives));
      ctx.hud.set("level", level);
    };

    /* ---------------- 流程 ---------------- */

    const spawnServe = (): void => {
      balls = [
        {
          x: paddleX + paddleWidth / 2,
          y: PADDLE_Y - BALL_R - 0.5,
          vx: 0,
          vy: 0,
          speed: speedForLevel(level),
          dead: false,
        },
      ];
      serveCount = 1;
      phase = "serve";
    };

    const buildLevel = (): void => {
      bricks = createBricks(level);
      bricksLeft = countAlive(bricks);
      powerUps = [];
      particles = [];
      destroyed = 0;
      paddleWidth = PADDLE_W;
      wideLeft = 0;
      paddleX = clampPaddleX(paddleX, paddleWidth);
      spawnServe();
    };

    const resetRun = (): void => {
      phase = "serve";
      clock = 0;
      score = 0;
      lives = LIVES;
      level = 1;
      paddleWidth = PADDLE_W;
      paddleX = Math.round((W - PADDLE_W) / 2);
      wideLeft = 0;
      clearLeft = 0;
      shake = 0;
      serveCount = 1;
      balls = [];
      powerUps = [];
      particles = [];
      destroyed = 0;
      buildLevel();
      syncHud();
      ctx.hud.urgent(false);
      ctx.timer.hide();
    };

    const finish = (won: boolean): void => {
      if (phase === "over") return;
      phase = "over";
      balls = [];
      powerUps = [];

      if (won) {
        ctx.audio.win();
        ctx.announce("三关全部通关");
      } else {
        ctx.audio.lose();
        ctx.announce("生命用完，本局结束");
      }

      ctx.end({
        score,
        title: won ? "通关" : "没命了",
        kicker: won ? "CLEAR" : "GAME OVER",
        stats: [
          { label: "关卡", value: level },
          { label: "剩余生命", value: Math.max(0, lives) },
        ],
      });
    };

    const beginLevelClear = (): void => {
      phase = "clear";
      clearLeft = CLEAR_MS;
      balls = [];
      powerUps = [];
      ctx.audio.tier();
      ctx.hud.flash("level", "is-bump");
    };

    const advanceLevel = (): void => {
      if (level >= TOTAL_LEVELS) {
        finish(true);
        return;
      }

      level += 1;
      buildLevel();
      syncHud();
      ctx.audio.go();
      ctx.hud.flash("level", "is-bump");
      ctx.toast.show(`第 ${level} 关`, { duration: 900 });
    };

    const loseLife = (): void => {
      lives -= 1;
      syncHud();
      ctx.hud.flash("lives", "is-broken");
      ctx.audio.miss();

      if (!ctx.reducedMotion) shake = 2.4;

      powerUps = [];
      paddleWidth = PADDLE_W;
      wideLeft = 0;
      paddleX = clampPaddleX(paddleX, paddleWidth);

      if (lives <= 0) {
        finish(false);
        return;
      }

      spawnServe();
      ctx.toast.show(`还剩 ${lives} 条命`, { warn: true, duration: 900 });
    };

    /* ---------------- 道具 / 砖块 ---------------- */

    const addBrickBurst = (r: Rect, row: number): void => {
      const points = brickPoints(row);
      const color = points === 30 ? P.pink : points === 20 ? P.amber : P.mint;

      for (let i = 0; i < 6; i += 1) {
        const life = 260 + Math.random() * 220;
        particles.push({
          x: r.x + Math.random() * r.w,
          y: r.y + Math.random() * r.h,
          vx: (Math.random() - 0.5) * 90,
          vy: -20 - Math.random() * 80,
          life,
          size: Math.random() < 0.4 ? 2 : 1,
          color: i % 3 === 0 ? P.cream : color,
        });
      }

      if (particles.length > 90) particles.splice(0, particles.length - 90);
    };

    const dropPowerUp = (r: Rect): void => {
      const kind = POWERUP_KINDS[Math.floor(Math.random() * POWERUP_KINDS.length)] ?? "wide";
      powerUps.push({
        x: r.x + (r.w - POWERUP_SIZE) / 2,
        y: r.y + (r.h - POWERUP_SIZE) / 2,
        kind,
      });
    };

    const hitBrick = (brick: Brick): void => {
      if (!brick.alive) return;

      const r = brickRect(brick.row, brick.col);
      brick.alive = false;
      bricksLeft = Math.max(0, bricksLeft - 1);
      score += brickPoints(brick.row);
      addBrickBurst(r, brick.row);
      ctx.audio.hit(0);
      ctx.hud.set("score", score);
      ctx.hud.flash("score", "is-bump");

      destroyed += 1;
      if (destroyed >= POWERUP_EVERY) {
        destroyed = 0;
        if (Math.random() < POWERUP_CHANCE) dropPowerUp(r);
      }

      if (bricksLeft <= 0) beginLevelClear();
    };

    const setPaddleWidth = (next: number): void => {
      const center = paddleX + paddleWidth / 2;
      paddleWidth = next;
      paddleX = clampPaddleX(center - paddleWidth / 2, paddleWidth);
    };

    const splitBalls = (): void => {
      const source = balls[0];
      if (!source) return;

      const base = Math.atan2(source.vy, source.vx);
      const speed = source.speed;
      balls = [-0.45, 0, 0.45].map((delta) => ({
        x: source.x,
        y: source.y,
        vx: Math.cos(base + delta) * speed,
        vy: Math.sin(base + delta) * speed,
        speed,
        dead: false,
      }));
    };

    const collectPowerUp = (kind: PowerUpKind): void => {
      if (kind === "wide") {
        wideLeft = WIDE_MS;
        setPaddleWidth(PADDLE_WIDE);
        ctx.toast.show("挡板加长", { duration: 900 });
      } else if (kind === "multi") {
        if (phase === "serve") serveCount = 3;
        else splitBalls();
        ctx.toast.show(serveCount >= 3 ? "三球待发" : "三球分裂", { duration: 900 });
      } else {
        lives = Math.min(9, lives + 1);
        syncHud();
        ctx.hud.flash("lives", "is-bump");
        ctx.toast.show("生命 +1", { duration: 900 });
      }

      ctx.audio.gold();
    };

    const updatePowerUps = (dt: number): void => {
      const seconds = dt / 1000;
      const paddle = paddleRect(paddleX, paddleWidth);

      for (let i = powerUps.length - 1; i >= 0; i -= 1) {
        const item = powerUps[i];
        if (!item) continue;

        item.y += POWERUP_FALL * seconds;

        if (item.y > H) {
          powerUps.splice(i, 1);
          continue;
        }

        const box: Rect = { x: item.x, y: item.y, w: POWERUP_SIZE, h: POWERUP_SIZE };
        if (overlap(box, paddle)) {
          powerUps.splice(i, 1);
          collectPowerUp(item.kind);
        }
      }
    };

    /* ---------------- 挡板 / 球 ---------------- */

    const launch = (): void => {
      if (phase !== "serve" || ctx.isPaused()) return;

      const center = paddleX + paddleWidth / 2;
      const y = PADDLE_Y - BALL_R - 0.5;
      const speed = speedForLevel(level);
      const base = -Math.PI / 2;
      const angles = serveCount >= 3 ? [base - 0.45, base, base + 0.45] : [base];

      balls = angles.map((angle) => ({
        x: center,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        speed,
        dead: false,
      }));
      serveCount = 1;
      phase = "play";
      ctx.audio.go();
    };

    const updatePaddle = (dt: number): void => {
      let dir = 0;
      if (ctx.input.keys.isDown("left")) dir -= 1;
      if (ctx.input.keys.isDown("right")) dir += 1;
      if (dir !== 0) {
        paddleX = clampPaddleX(paddleX + (dir * PADDLE_SPEED * dt) / 1000, paddleWidth);
      }
    };

    /** x 轴单独步进：撞墙、撞砖都只改 vx。 */
    const stepBallX = (ball: Ball, dx: number): void => {
      if (dx === 0) return;
      ball.x += dx;

      if (ball.x - BALL_R < 0) {
        ball.x = BALL_R;
        ball.vx = Math.abs(ball.vx);
      } else if (ball.x + BALL_R > W) {
        ball.x = W - BALL_R;
        ball.vx = -Math.abs(ball.vx);
      }

      const box = ballBox(ball.x, ball.y);
      for (const brick of bricks) {
        if (!brick.alive) continue;
        const r = brickRect(brick.row, brick.col);
        if (!overlap(box, r)) continue;

        if (ball.vx > 0) ball.x = r.x - BALL_R;
        else if (ball.vx < 0) ball.x = r.x + r.w + BALL_R;
        ball.vx = -ball.vx;
        hitBrick(brick);
        break;
      }
    };

    /** y 轴单独步进：撞顶、挡板、砖都只改 vy。 */
    const stepBallY = (ball: Ball, dy: number): void => {
      if (dy === 0) return;
      ball.y += dy;

      if (ball.y - BALL_R < 0) {
        ball.y = BALL_R;
        ball.vy = Math.abs(ball.vy);
      }

      if (ball.vy > 0) {
        const paddle = paddleRect(paddleX, paddleWidth);
        if (overlap(ballBox(ball.x, ball.y), paddle) && ball.y - BALL_R < PADDLE_Y + PADDLE_H) {
          const offset = clamp(
            (ball.x - (paddleX + paddleWidth / 2)) / (paddleWidth / 2),
            -1,
            1,
          );
          const velocity = bounceFromPaddle(offset, ball.speed);
          ball.vx = velocity.vx;
          ball.vy = velocity.vy;
          ball.y = PADDLE_Y - BALL_R;
          ctx.audio.blip();
        }
      }

      const box = ballBox(ball.x, ball.y);
      for (const brick of bricks) {
        if (!brick.alive) continue;
        const r = brickRect(brick.row, brick.col);
        if (!overlap(box, r)) continue;

        if (ball.vy > 0) ball.y = r.y - BALL_R;
        else if (ball.vy < 0) ball.y = r.y + r.h + BALL_R;
        ball.vy = -ball.vy;
        hitBrick(brick);
        break;
      }
    };

    const moveBall = (ball: Ball, dt: number): void => {
      const distance = (ball.speed * dt) / 1000;
      const steps = substepsFor(distance, MAX_STEP);
      const stepSeconds = dt / 1000 / steps;

      for (let i = 0; i < steps; i += 1) {
        if (ball.dead || phase !== "play") return;

        stepBallX(ball, ball.vx * stepSeconds);
        if (phase !== "play") return;

        stepBallY(ball, ball.vy * stepSeconds);

        if (ball.y - BALL_R > H) {
          ball.dead = true;
          return;
        }
      }
    };

    const updateParticles = (dt: number): void => {
      const seconds = dt / 1000;
      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const p = particles[i];
        if (!p) continue;

        p.life -= dt;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }

        p.x += p.vx * seconds;
        p.y += p.vy * seconds;
        p.vy += 260 * seconds;
      }
    };

    /* ---------------- 绘制 ---------------- */

    const drawField = (c: CanvasRenderingContext2D): void => {
      // 顶部横梁和铆钉：HUD 以下的 20px 留白
      rect(c, 0, 0, W, 1, P.line);
      rect(c, 0, 18, W, 1, P.line);
      for (let i = 0; i < 8; i += 1) rect(c, 9 + i * 21, 8, 3, 2, P.lineHi);

      // 侧墙
      rect(c, 0, 19, 1, H - 19, P.line);
      rect(c, W - 1, 19, 1, H - 19, P.line);

      // 底部漏球区
      rect(c, 0, H - 4, W, 1, P.redDeep);
      rect(c, 0, H - 3, W, 3, P.void);
    };

    const drawServeHint = (c: CanvasRenderingContext2D): void => {
      const pulse = 0.45 + 0.4 * ((Math.sin(clock * 0.006) + 1) / 2);
      const width = measurePixelText(SERVE_HINT, 1);
      const cx = Math.round(paddleX + paddleWidth / 2);

      c.globalAlpha = pulse;
      drawPixelText(c, SERVE_HINT, (W - width) / 2, 177, 1, P.lav, P.void);

      // 挡板上方的小箭头
      rect(c, cx, 186, 1, 4, P.lav);
      rect(c, cx - 1, 187, 3, 1, P.lav);
      rect(c, cx - 2, 188, 5, 1, P.lav);
      c.globalAlpha = 1;
    };

    const drawClearBanner = (c: CanvasRenderingContext2D): void => {
      const boxW = 140;
      const boxH = 38;
      const x = Math.round((W - boxW) / 2);
      const y = 88;

      rect(c, x + 2, y + 2, boxW, boxH, P.void);
      rect(c, x, y, boxW, boxH, P.panel);
      strokeRect(c, x, y, boxW, boxH, P.amber);
      rect(c, x + 2, y + 2, boxW - 4, 1, P.lineHi);

      const title = level >= TOTAL_LEVELS ? "ALL CLEAR" : "LEVEL CLEAR";
      const titleW = measurePixelText(title, 2);
      drawPixelText(c, title, (W - titleW) / 2, y + 9, 2, P.gold, P.void);

      const sub = level >= TOTAL_LEVELS ? "3 STAGES" : `NEXT ${level + 1}`;
      const subW = measurePixelText(sub, 1);
      drawPixelText(c, sub, (W - subW) / 2, y + 27, 1, P.cream, P.void);
    };

    const render = (): void => {
      const c = ctx.ctx;

      c.fillStyle = P.night;
      c.fillRect(0, 0, W, H);

      let sx = 0;
      let sy = 0;
      if (shake > 0.2 && !ctx.reducedMotion) {
        sx = Math.round(Math.sin(clock * 0.09) * shake);
        sy = Math.round(Math.cos(clock * 0.13) * shake * 0.6);
      }

      c.save();
      c.translate(sx, sy);

      drawField(c);

      for (const brick of bricks) {
        if (!brick.alive) continue;
        const r = brickRect(brick.row, brick.col);
        drawBrick(c, r.x, r.y, r.w, r.h, brick.row);
      }

      for (const item of powerUps) drawPowerUp(c, item.x, item.y, item.kind);

      drawPaddle(c, paddleX, PADDLE_Y, paddleWidth);

      for (const ball of balls) {
        if (!ball.dead) drawBall(c, ball.x, ball.y);
      }

      if (phase === "serve") drawServeHint(c);

      for (const p of particles) {
        c.globalAlpha = Math.min(1, p.life / 180);
        rect(c, p.x, p.y, p.size, p.size, p.color);
      }
      c.globalAlpha = 1;

      if (phase === "clear") drawClearBanner(c);

      c.restore();
    };

    /* ---------------- 输入 ---------------- */

    ctx.input.pointer.on("down", (info) => {
      ctx.audio.unlock();
      if (phase === "over" || ctx.isPaused()) return;
      if (info.source.pointerType === "mouse" && info.source.button !== 0) return;

      paddleX = clampPaddleX(info.x - paddleWidth / 2, paddleWidth);
      launch();
    });

    ctx.input.pointer.on("move", (info) => {
      if (phase === "over" || ctx.isPaused()) return;
      paddleX = clampPaddleX(info.x - paddleWidth / 2, paddleWidth);
    });

    ctx.input.keys.onPress((action) => {
      if (action === "action") launch();
    });

    resetRun();

    return {
      start(): void {
        ctx.audio.unlock();
        ctx.audio.ui();
        resetRun();
        ctx.announce("打砖块，三条命。");
      },

      update(dt: number): void {
        if (phase === "over") return;
        clock += dt;

        if (phase === "clear") {
          updateParticles(dt);
          if (shake > 0) shake = Math.max(0, shake - dt * 0.012);
          clearLeft -= dt;
          if (clearLeft <= 0) advanceLevel();
          return;
        }

        updatePaddle(dt);

        if (wideLeft > 0) {
          wideLeft -= dt;
          if (wideLeft <= 0) {
            wideLeft = 0;
            setPaddleWidth(PADDLE_W);
          }
        }

        updatePowerUps(dt);

        if (phase === "serve") {
          const ball = balls[0];
          if (ball) {
            ball.x = paddleX + paddleWidth / 2;
            ball.y = PADDLE_Y - BALL_R - 0.5;
          }
        } else {
          for (const ball of balls) {
            if (phase !== "play") break;
            moveBall(ball, dt);
          }

          if (phase === "play") {
            balls = balls.filter((ball) => !ball.dead);
            if (balls.length === 0) loseLife();
          }
        }

        updateParticles(dt);
        if (shake > 0) shake = Math.max(0, shake - dt * 0.012);
      },

      render,

      pause(): void {
        // 暂停时壳层停止 update；球和挡板保持原位，恢复后继续。
      },
    };
  },
});

export default game;
