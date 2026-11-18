import {
  P,
  clamp,
  defineGame,
  drawPixelText,
  measurePixelText,
  mulberry32,
  pick,
  rand,
  randInt,
  rect,
  type GameContext,
  type GameInstance,
} from "@arcade/core";

import { drawEnemy, drawShip, type EnemyKind } from "./art";
import { meta } from "./meta";
import {
  ENEMY_BULLET_H,
  ENEMY_BULLET_SPEED,
  ENEMY_COLS,
  ENEMY_DROP,
  ENEMY_H,
  ENEMY_ROWS,
  ENEMY_START_Y,
  ENEMY_STEP_Y,
  ENEMY_W,
  FIELD_H,
  FIELD_W,
  INVULN_MS,
  PLAYER_BULLET_H,
  PLAYER_BULLET_SPEED,
  PLAYER_FIRE_MS,
  SHIP_H,
  SHIP_SPEED,
  SHIP_W,
  SHIP_Y,
  START_LIVES,
  WAVE_BONUS,
  WAVE_COUNT,
  accuracy,
  clampShipX,
  enemyScore,
  enemyX,
  enemyY,
  marchStep,
  sweptHit,
  waveFireInterval,
  waveSpeed,
  type MarchState,
} from "./logic";

const MAX_PARTICLES = 120;
const PLAYER_BULLET_POOL = 8;
const ENEMY_BULLET_POOL = 24;
const STAR_COUNT = 80;
/** 两波之间的喘息时间。 */
const WAVE_GAP_MS = 950;
/** 敌机压到飞船头顶就算防线失守。 */
const DEFENSE_LINE = SHIP_Y;

const ENEMY_KINDS: readonly EnemyKind[] = [0, 1, 2];

type Mode = "ready" | "playing" | "over";
type FinishReason = "lives" | "breach" | "clear";

interface Enemy {
  alive: boolean;
  row: number;
  col: number;
  kind: EnemyKind;
}

interface Bullet {
  alive: boolean;
  x: number;
  y: number;
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
}

interface Star {
  x: number;
  y: number;
  speed: number;
  size: number;
  color: string;
}

const game = defineGame({
  meta,
  create(ctx: GameContext): GameInstance {
    let mode: Mode = "ready";
    let clock = 0;
    let score = 0;
    let wave = 1;
    let lives = START_LIVES;
    let shipX = FIELD_W / 2;
    let invulnUntil = 0;
    let finished = false;

    /** 编队整体的横移状态与下压量。 */
    let formation: MarchState = { offset: 0, dir: 1 };
    let formOffsetY = 0;

    let nextPlayerShot = 0;
    let nextEnemyShot = 0;
    let wavePending = false;
    let waveWaitAt = 0;
    let bannerUntil = 0;
    let shots = 0;
    let kills = 0;

    /* ---------------- 实体池 ---------------- */

    const enemies: Enemy[] = [];
    for (let row = 0; row < ENEMY_ROWS; row += 1) {
      for (let col = 0; col < ENEMY_COLS; col += 1) {
        enemies.push({
          alive: false,
          row,
          col,
          kind: ENEMY_KINDS[row % ENEMY_KINDS.length] ?? 0,
        });
      }
    }

    const playerBullets: Bullet[] = Array.from({ length: PLAYER_BULLET_POOL }, () => ({
      alive: false,
      x: 0,
      y: 0,
    }));
    const enemyBullets: Bullet[] = Array.from({ length: ENEMY_BULLET_POOL }, () => ({
      alive: false,
      x: 0,
      y: 0,
    }));

    let particles: Particle[] = [];

    // 星空只生成一次：两层不同速度，缓慢向下滚动。
    const stars: Star[] = [];
    const starRng = mulberry32(20261118);
    for (let i = 0; i < STAR_COUNT; i += 1) {
      const near = i % 3 === 0;
      stars.push({
        x: Math.floor(starRng() * FIELD_W),
        y: Math.floor(starRng() * FIELD_H),
        speed: near ? 9 : 3.5,
        size: near && starRng() > 0.6 ? 2 : 1,
        color: near ? (starRng() > 0.5 ? P.cream : P.lav) : starRng() > 0.5 ? P.line : P.lineHi,
      });
    }

    const killColors: readonly (readonly string[])[] = [
      [P.lav, P.purple, P.cream],
      [P.mint, P.grass, P.white],
      [P.amber, P.orange, P.cream],
    ];

    /* ---------------- 小工具 ---------------- */

    const shipLeft = (): number => Math.round(shipX - SHIP_W / 2);

    const aliveCount = (): number => {
      let alive = 0;
      for (const enemy of enemies) if (enemy.alive) alive += 1;
      return alive;
    };

    const clearBullets = (pool: Bullet[]): void => {
      for (const bullet of pool) bullet.alive = false;
    };

    const takeBullet = (pool: Bullet[]): Bullet | null => {
      for (const bullet of pool) if (!bullet.alive) return bullet;
      return null;
    };

    const setScore = (value: number, bump: boolean): void => {
      score = value;
      ctx.hud.set("score", value);
      if (bump) ctx.hud.flash("score", "is-bump");
    };

    const syncLives = (bump: boolean): void => {
      ctx.hud.set("lives", lives);
      ctx.hud.setColor("lives", lives <= 1 ? P.red : P.cream);
      if (bump) ctx.hud.flash("lives", "is-broken");
    };

    const burst = (x: number, y: number, colors: readonly string[], count: number): void => {
      for (let i = 0; i < count; i += 1) {
        if (particles.length >= MAX_PARTICLES) particles.shift();
        const life = rand(200, 430);
        particles.push({
          x,
          y,
          vx: rand(-70, 70),
          vy: rand(-90, 55),
          life,
          max: life,
          color: pick(colors),
          size: randInt(1, 2),
        });
      }
    };

    /* ---------------- 更新 ---------------- */

    const updateStars = (dt: number): void => {
      const seconds = dt / 1000;
      for (const star of stars) {
        star.y += star.speed * seconds;
        if (star.y >= FIELD_H) star.y -= FIELD_H;
      }
    };

    const updateParticles = (dt: number): void => {
      if (particles.length === 0) return;
      const seconds = dt / 1000;
      let write = 0;
      for (let read = 0; read < particles.length; read += 1) {
        const particle = particles[read]!;
        particle.life -= dt;
        if (particle.life <= 0) continue;
        particle.x += particle.vx * seconds;
        particle.y += particle.vy * seconds;
        particle.vy += 150 * seconds;
        if (write !== read) particles[write] = particle;
        write += 1;
      }
      particles.length = write;
    };

    /* ---------------- 流程 ---------------- */

    const beginWave = (index: number): void => {
      wave = index;
      formation = { offset: 0, dir: 1 };
      formOffsetY = 0;
      for (const enemy of enemies) enemy.alive = true;
      nextPlayerShot = clock + 200;
      nextEnemyShot = clock + 900;
      wavePending = false;
      waveWaitAt = 0;
      bannerUntil = clock + 950;
      ctx.hud.set("wave", wave);
    };

    const finish = (reason: FinishReason): void => {
      if (finished) return;
      finished = true;
      mode = "over";
      clearBullets(playerBullets);
      clearBullets(enemyBullets);
      ctx.hud.urgent(false);
      ctx.timer.hide();

      const hitRate = accuracy(kills, shots);
      const stats = [
        { label: "波次", value: wave },
        { label: "命中率", value: `${hitRate}%` },
      ];

      if (reason === "clear") {
        ctx.audio.win();
        ctx.end({
          score,
          title: "守住了",
          kicker: "CLEAR",
          stats,
        });
        return;
      }

      ctx.audio.lose();
      ctx.end({
        score,
        title: reason === "breach" ? "防线失守" : "飞船被击落",
        kicker: "GAME OVER",
        stats,
      });
    };

    const reset = (): void => {
      clock = 0;
      mode = "ready";
      score = 0;
      wave = 1;
      lives = START_LIVES;
      shipX = FIELD_W / 2;
      invulnUntil = 0;
      finished = false;

      formation = { offset: 0, dir: 1 };
      formOffsetY = 0;
      nextPlayerShot = 0;
      nextEnemyShot = 0;
      wavePending = false;
      waveWaitAt = 0;
      bannerUntil = 0;
      shots = 0;
      kills = 0;

      particles = [];
      clearBullets(playerBullets);
      clearBullets(enemyBullets);

      // create 阶段的静止画面：满编敌阵 + 居中的飞船。
      for (const enemy of enemies) enemy.alive = true;

      ctx.hud.set("score", 0);
      ctx.hud.set("wave", 1);
      syncLives(false);
      ctx.hud.urgent(false);
      ctx.timer.hide();
    };

    const destroyEnemy = (enemy: Enemy): void => {
      enemy.alive = false;
      kills += 1;
      setScore(score + enemyScore(enemy.row), true);

      const cx = Math.round(enemyX(enemy.col, formation.offset)) + ENEMY_W / 2;
      const cy = Math.round(enemyY(enemy.row, formOffsetY)) + ENEMY_H / 2;
      burst(cx, cy, killColors[enemy.kind] ?? killColors[0]!, 7);
      ctx.audio.pop();
    };

    const hitPlayer = (): void => {
      lives -= 1;
      syncLives(true);
      invulnUntil = clock + INVULN_MS;

      burst(shipX, SHIP_Y + 3, [P.cream, P.amber, P.red, P.white], 14);
      ctx.audio.miss();

      if (lives <= 0) {
        finish("lives");
        return;
      }
      if (lives === 1) ctx.toast.show("最后一条命！", { warn: true, duration: 900 });
    };

    const firePlayerBullet = (): void => {
      const bullet = takeBullet(playerBullets);
      if (!bullet) return;
      bullet.alive = true;
      bullet.x = Math.round(shipX);
      bullet.y = SHIP_Y - PLAYER_BULLET_H - 1;
      shots += 1;
      ctx.audio.blip();
    };

    const fireEnemyBullet = (): boolean => {
      const bullet = takeBullet(enemyBullets);
      if (!bullet) return false;

      // 随机挑一列，再从该列最下面一架敌机开火。
      const start = Math.floor(Math.random() * ENEMY_COLS);
      for (let i = 0; i < ENEMY_COLS; i += 1) {
        const col = (start + i) % ENEMY_COLS;
        let shooter: Enemy | null = null;
        for (let row = ENEMY_ROWS - 1; row >= 0; row -= 1) {
          const enemy = enemies[row * ENEMY_COLS + col];
          if (enemy?.alive) {
            shooter = enemy;
            break;
          }
        }
        if (!shooter) continue;

        bullet.alive = true;
        bullet.x = Math.round(enemyX(shooter.col, formation.offset) + ENEMY_W / 2);
        bullet.y = Math.round(enemyY(shooter.row, formOffsetY) + ENEMY_H);
        ctx.audio.tone(180, 0.05, "square", 0.035, 120);
        return true;
      }

      return false;
    };

    const updatePlayerBullets = (dt: number): void => {
      const step = (PLAYER_BULLET_SPEED * dt) / 1000;
      for (const bullet of playerBullets) {
        if (!bullet.alive) continue;

        const fromY = bullet.y;
        bullet.y -= step;
        if (bullet.y + PLAYER_BULLET_H < 0) {
          bullet.alive = false;
          continue;
        }

        for (const enemy of enemies) {
          if (!enemy.alive) continue;
          const ex = Math.round(enemyX(enemy.col, formation.offset));
          const ey = Math.round(enemyY(enemy.row, formOffsetY));
          if (sweptHit(bullet.x, fromY, bullet.y, ex, ey)) {
            bullet.alive = false;
            destroyEnemy(enemy);
            break;
          }
        }
      }
    };

    const updateEnemyBullets = (dt: number): void => {
      const step = (ENEMY_BULLET_SPEED * dt) / 1000;
      const left = shipLeft();

      for (const bullet of enemyBullets) {
        if (!bullet.alive) continue;

        const fromY = bullet.y;
        bullet.y += step;
        if (bullet.y > FIELD_H) {
          bullet.alive = false;
          continue;
        }

        if (clock < invulnUntil) continue;
        if (
          sweptHit(
            bullet.x,
            fromY,
            bullet.y,
            left,
            SHIP_Y,
            SHIP_W,
            SHIP_H,
            ENEMY_BULLET_H,
          )
        ) {
          bullet.alive = false;
          hitPlayer();
          if (mode !== "playing") return;
        }
      }
    };

    /* ---------------- 绘制 ---------------- */

    const drawStarfield = (): void => {
      const c = ctx.ctx;
      for (const star of stars) rect(c, star.x, star.y, star.size, star.size, star.color);
    };

    const drawBullets = (): void => {
      const c = ctx.ctx;

      for (const bullet of playerBullets) {
        if (!bullet.alive) continue;
        rect(c, bullet.x, bullet.y, 1, PLAYER_BULLET_H, P.cream);
        rect(c, bullet.x, bullet.y, 1, 1, P.white);
      }

      for (const bullet of enemyBullets) {
        if (!bullet.alive) continue;
        rect(c, bullet.x, bullet.y, 1, ENEMY_BULLET_H, P.red);
        rect(c, bullet.x, bullet.y + ENEMY_BULLET_H - 1, 1, 1, P.orange);
      }
    };

    const drawParticles = (): void => {
      const c = ctx.ctx;
      for (const particle of particles) {
        c.globalAlpha = Math.min(1, particle.life / 160);
        rect(c, particle.x, particle.y, particle.size, particle.size, particle.color);
      }
      c.globalAlpha = 1;
    };

    const render = (): void => {
      const c = ctx.ctx;

      rect(c, 0, 0, FIELD_W, FIELD_H, P.void);
      drawStarfield();

      // 地面与防线。
      rect(c, 0, 203, FIELD_W, 1, P.line);
      rect(c, 0, 204, FIELD_W, FIELD_H - 204, P.panel);
      rect(c, 0, 204, FIELD_W, 1, P.lineHi);

      const frame = Math.floor(clock / 280) % 2;
      for (const enemy of enemies) {
        if (!enemy.alive) continue;
        drawEnemy(
          c,
          enemyX(enemy.col, formation.offset),
          enemyY(enemy.row, formOffsetY),
          enemy.kind,
          frame,
        );
      }

      drawBullets();

      const blinking = invulnUntil > clock && Math.floor(clock / 90) % 2 === 0;
      if (!blinking) drawShip(c, shipLeft(), SHIP_Y, Math.floor(clock / 70) % 2);

      drawParticles();

      if (mode === "playing" && !wavePending && clock < bannerUntil) {
        const alpha = clamp((bannerUntil - clock) / 260, 0, 1);
        const label = `WAVE ${wave}`;
        const width = measurePixelText(label, 3);
        c.globalAlpha = alpha;
        drawPixelText(c, label, (FIELD_W - width) / 2, 104, 3, P.cream, P.void);
        c.globalAlpha = 1;
      }
    };

    /* ---------------- 输入 ---------------- */

    const followPointer = (info: { x: number }): void => {
      if (mode !== "playing" || ctx.isPaused()) return;
      shipX = clampShipX(info.x);
    };

    ctx.input.pointer.on("down", (info) => {
      ctx.audio.unlock();
      followPointer(info);
    });
    // 悬停也跟随，桌面和触屏手感一致。
    ctx.input.pointer.on("move", followPointer);

    /* ---------------- 初始化 ---------------- */

    reset();

    return {
      start(): void {
        ctx.audio.unlock();
        reset();
        mode = "playing";
        beginWave(1);
      },

      update(dt: number): void {
        if (mode !== "playing") return;
        clock += dt;

        updateStars(dt);
        updateParticles(dt);

        // 键盘横向移动；触屏走 pointer move 直接跟随。
        let direction = 0;
        if (ctx.input.keys.isDown("left")) direction -= 1;
        if (ctx.input.keys.isDown("right")) direction += 1;
        if (direction !== 0) {
          shipX = clampShipX(shipX + (direction * SHIP_SPEED * dt) / 1000);
        }

        // 编队横移，碰边下压。
        if (aliveCount() > 0) {
          const dropped = marchStep(formation, (waveSpeed(wave) * dt) / 1000);
          if (dropped) formOffsetY += ENEMY_DROP;

          const lowest = ENEMY_START_Y + (ENEMY_ROWS - 1) * ENEMY_STEP_Y + formOffsetY + ENEMY_H;
          if (lowest >= DEFENSE_LINE) {
            finish("breach");
            return;
          }
        }

        // 自动射击：每 340ms 一颗，不需要玩家按键。
        if (aliveCount() > 0 && clock >= nextPlayerShot) {
          firePlayerBullet();
          nextPlayerShot = clock + PLAYER_FIRE_MS;
        }

        updatePlayerBullets(dt);
        if (mode !== "playing") return;

        // 清空一波：加分、清掉残余敌弹，稍后进入下一波。
        if (!wavePending) {
          if (aliveCount() === 0) {
            wavePending = true;
            setScore(score + WAVE_BONUS, true);
            clearBullets(enemyBullets);
            if (wave >= WAVE_COUNT) {
              finish("clear");
              return;
            }
            waveWaitAt = clock + WAVE_GAP_MS;
            ctx.toast.show(`第 ${wave} 波清空 +${WAVE_BONUS}`, { duration: 1000 });
            ctx.audio.tier();
          }
        } else if (clock >= waveWaitAt) {
          beginWave(wave + 1);
        }

        // 敌方随机投弹。
        if (aliveCount() > 0 && clock >= nextEnemyShot) {
          nextEnemyShot = clock + (fireEnemyBullet() ? waveFireInterval(wave) : 250);
        }

        updateEnemyBullets(dt);
      },

      render,
    };
  },
});

export default game;
