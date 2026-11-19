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

import { drawAsteroid, drawBullet, drawShip, drawSpark, drawStar, type AsteroidKind } from "./art";
import { meta } from "./meta";
import {
  ASTEROID_RADIUS,
  BULLET_MS,
  FIRE_COOLDOWN_MS,
  H,
  INVULN_MS,
  SHIP_R,
  START_LIVES,
  W,
  WAVE_GAP_MS,
  asteroidSpeed,
  bulletVelocity,
  circleHit,
  makeAsteroid,
  normalizeAngle,
  scoreForSize,
  shipVelocity,
  spawnCount,
  splitAsteroid,
  turnAngle,
  wrapDelta,
  wrapX,
  wrapY,
} from "./logic";

/** 子弹对象池：冷却 180ms、存活 700ms，8 发足够覆盖。 */
const BULLET_POOL = 12;
/** 粒子池上限。 */
const MAX_PARTICLES = 140;
/** 子弹每一步最多推进的距离：高速时子步进，避免穿过小陨石。 */
const BULLET_STEP = 4;
/** 星空层数：亮星 1/4，慢速远景。 */
const STAR_COUNT = 58;

type Mode = "ready" | "playing" | "over";

interface Bullet {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 剩余存活毫秒。 */
  life: number;
}

interface Asteroid {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: AsteroidKind;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
}

interface Star {
  x: number;
  y: number;
  bright: boolean;
}

const game = defineGame({
  meta,
  create(ctx: GameContext): GameInstance {
    /* ---------------- 状态 ---------------- */

    let mode: Mode = "ready";
    /** 本局累计毫秒（帧间隔恒为正，用于冷却 / 闪烁）。 */
    let clock = 0;
    let score = 0;
    let lives = START_LIVES;
    let wave = 1;
    let destroyed = 0;

    let shipX = W / 2;
    let shipY = H / 2;
    let shipVx = 0;
    let shipVy = 0;
    let angle = -Math.PI / 2;

    let invulnUntil = 0;
    let nextFireAt = 0;
    let wavePending = false;
    let waveWaitAt = 0;
    let bannerUntil = 0;

    const bullets: Bullet[] = Array.from({ length: BULLET_POOL }, () => ({
      alive: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
    }));

    let asteroids: Asteroid[] = [];
    let particles: Particle[] = [];

    const stars: Star[] = [];
    const starRng = mulberry32(20261119);
    for (let i = 0; i < STAR_COUNT; i += 1) {
      stars.push({
        x: Math.floor(starRng() * W),
        y: Math.floor(starRng() * H),
        bright: i % 4 === 0,
      });
    }

    /** 本局的随机源：逻辑层只接收函数，不自己取随机。 */
    let rng = mulberry32(Math.floor(Math.random() * 0x7fffffff));

    /* ---------------- 小工具 ---------------- */

    const setScore = (value: number): void => {
      // HUD 的 score 栏是 pad 5，超过 5 位会撑破布局，这里直接夹住。
      score = clamp(Math.round(Number.isFinite(value) ? value : 0), 0, 99_999);
      ctx.hud.set("score", score);
    };

    const syncLives = (bump: boolean): void => {
      ctx.hud.set("lives", clamp(lives, 0, 9));
      ctx.hud.setColor("lives", lives <= 1 ? P.red : P.cream);
      if (bump) ctx.hud.flash("lives", "is-broken");
    };

    const syncWave = (): void => {
      ctx.hud.set("wave", clamp(wave, 0, 99));
    };

    const burst = (x: number, y: number, colors: readonly string[], count: number): void => {
      for (let i = 0; i < count; i += 1) {
        if (particles.length >= MAX_PARTICLES) particles.shift();
        const life = 220 + rng() * 260;
        particles.push({
          x,
          y,
          vx: (rng() - 0.5) * 130,
          vy: (rng() - 0.5) * 130,
          life,
          max: life,
          size: rng() > 0.65 ? 2 : 1,
          color: colors[Math.floor(rng() * colors.length)] ?? P.cream,
        });
      }
    };

    /* ---------------- 陨石 ---------------- */

    const makeRock = (size: AsteroidKind): Asteroid => {
      const speed = asteroidSpeed(wave);
      const spot = makeAsteroid(size, rng, speed, shipX, shipY);
      return { x: spot.x, y: spot.y, vx: spot.vx, vy: spot.vy, size };
    };

    /** 打碎后的两颗碎片：从母体位置出发，朝两个相反的方向散开。 */
    const splitInto = (parent: Asteroid, child: AsteroidKind): void => {
      const base = rng() * Math.PI * 2;
      const speed = asteroidSpeed(wave);
      for (let i = 0; i < 2; i += 1) {
        const heading = base + i * Math.PI;
        asteroids.push({
          x: parent.x,
          y: parent.y,
          vx: Math.cos(heading) * speed * 1.15,
          vy: Math.sin(heading) * speed * 1.15,
          size: child,
        });
      }
    };

    const startWave = (index: number): void => {
      wave = clamp(Math.floor(index), 1, 99);
      asteroids = [];
      const total = spawnCount(wave);
      for (let i = 0; i < total; i += 1) asteroids.push(makeRock("large"));
      wavePending = false;
      waveWaitAt = 0;
      bannerUntil = clock + 950;
      syncWave();
    };

    /* ---------------- 流程 ---------------- */

    /** 结算只走这里一次；mode === "over" 守卫保证 ctx.end() 只调一次。 */
    const finish = (): void => {
      if (mode === "over") return;
      mode = "over";
      for (const bullet of bullets) bullet.alive = false;
      particles = [];
      ctx.hud.urgent(false);
      ctx.timer.hide();
      ctx.audio.lose();
      ctx.end({
        score,
        title: "飞船解体",
        kicker: "GAME OVER",
        stats: [
          { label: "波次", value: wave },
          { label: "击碎", value: destroyed },
        ],
      });
    };

    const resetShip = (): void => {
      shipX = W / 2;
      shipY = H / 2;
      shipVx = 0;
      shipVy = 0;
      angle = -Math.PI / 2;
      invulnUntil = clock + INVULN_MS;
    };

    const reset = (): void => {
      mode = "ready";
      clock = 0;
      score = 0;
      lives = START_LIVES;
      wave = 1;
      destroyed = 0;
      invulnUntil = 0;
      nextFireAt = 0;
      wavePending = false;
      waveWaitAt = 0;
      bannerUntil = 0;
      rng = mulberry32((Math.floor(Math.random() * 0x7fffffff) ^ Date.now()) >>> 0);

      for (const bullet of bullets) bullet.alive = false;
      particles = [];

      resetShip();
      invulnUntil = 0;

      // create 阶段的静止画面：一波陨石 + 居中的飞船。
      asteroids = [];
      const total = spawnCount(1);
      for (let i = 0; i < total; i += 1) asteroids.push(makeRock("large"));

      setScore(0);
      syncLives(false);
      syncWave();
      ctx.hud.urgent(false);
      ctx.timer.hide();
    };

    const hitShip = (): void => {
      if (clock < invulnUntil) return;
      lives -= 1;
      syncLives(true);
      burst(shipX, shipY, [P.cream, P.amber, P.red, P.white], 16);
      ctx.audio.miss();
      if (lives <= 0) {
        finish();
        return;
      }
      ctx.toast.show(`还剩 ${lives} 条命`, { warn: true, duration: 800 });
      resetShip();
    };

    /* ---------------- 开火 ---------------- */

    const takeBullet = (): Bullet | null => {
      for (const bullet of bullets) if (!bullet.alive) return bullet;
      return null;
    };

    const fire = (): void => {
      if (mode !== "playing" || ctx.isPaused()) return;
      if (clock < nextFireAt) return;
      const bullet = takeBullet();
      if (!bullet) return;

      const velocity = bulletVelocity(angle, shipVx, shipVy);
      bullet.alive = true;
      bullet.x = wrapX(shipX + Math.cos(angle) * 7);
      bullet.y = wrapY(shipY + Math.sin(angle) * 7);
      bullet.vx = velocity.vx;
      bullet.vy = velocity.vy;
      bullet.life = BULLET_MS;
      nextFireAt = clock + FIRE_COOLDOWN_MS;
      ctx.audio.blip();
    };

    /* ---------------- 更新 ---------------- */

    const updateShip = (dt: number): void => {
      const keys = ctx.input.keys;
      const dir = (keys.isDown("left") ? -1 : 0) + (keys.isDown("right") ? 1 : 0);
      if (dir !== 0) angle = turnAngle(angle, dir, dt);

      const thrusting = keys.isDown("secondary") || keys.isDown("up");
      const velocity = shipVelocity(angle, thrusting, dt, { vx: shipVx, vy: shipVy });
      shipVx = velocity.vx;
      shipVy = velocity.vy;

      const seconds = dt / 1000;
      shipX = wrapX(shipX + shipVx * seconds);
      shipY = wrapY(shipY + shipVy * seconds);
    };

    const updateBullets = (dt: number): void => {
      for (const bullet of bullets) {
        if (!bullet.alive) continue;
        bullet.life -= dt;
        if (bullet.life <= 0) {
          bullet.alive = false;
          continue;
        }

        // 子步进：单步最多 BULLET_STEP 像素，避免高速穿过小陨石。
        const seconds = dt / 1000;
        const travel = Math.hypot(bullet.vx, bullet.vy) * seconds;
        const steps = Math.max(1, Math.ceil(travel / BULLET_STEP));
        const stepX = (bullet.vx * seconds) / steps;
        const stepY = (bullet.vy * seconds) / steps;

        for (let i = 0; i < steps && bullet.alive; i += 1) {
          bullet.x = wrapX(bullet.x + stepX);
          bullet.y = wrapY(bullet.y + stepY);

          for (let index = asteroids.length - 1; index >= 0; index -= 1) {
            const rock = asteroids[index]!;
            const radius = ASTEROID_RADIUS[rock.size] ?? 6;
            if (!circleHit(bullet.x, bullet.y, 1, rock.x, rock.y, radius)) continue;

            bullet.alive = false;
            asteroids.splice(index, 1);
            destroyed += 1;
            setScore(score + scoreForSize(rock.size));
            ctx.hud.flash("score", "is-bump");
            burst(rock.x, rock.y, [P.lav, P.purple, P.cream, P.white], 8);
            ctx.audio.pop();

            const child = splitAsteroid(rock.size);
            if (child) splitInto(rock, child);
            break;
          }
        }
      }
    };

    const updateAsteroids = (dt: number): void => {
      const seconds = dt / 1000;
      for (const rock of asteroids) {
        rock.x = wrapX(rock.x + rock.vx * seconds);
        rock.y = wrapY(rock.y + rock.vy * seconds);

        if (clock < invulnUntil) continue;
        const radius = ASTEROID_RADIUS[rock.size] ?? 6;
        if (circleHit(rock.x, rock.y, radius, shipX, shipY, SHIP_R)) {
          hitShip();
          if (mode !== "playing") return;
        }
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
        particle.vx *= 0.96;
        particle.vy *= 0.96;
        if (write !== read) particles[write] = particle;
        write += 1;
      }
      particles.length = write;
    };

    /* ---------------- 绘制 ---------------- */

    /**
     * 环绕绘制：物体靠近接缝时，在对面再画一份，
     * 这样「从一边出去、从另一边回来」在视觉上是连续的而不是突然弹出。
     * 只对半径 > 2 的东西调用（1px 星点不需要）。
     */
    const drawWrapped = (
      x: number,
      y: number,
      radius: number,
      paint: (cx: number, cy: number) => void,
    ): void => {
      paint(x, y);
      const wrapLeft = x < radius;
      const wrapRight = x > W - radius;
      const wrapTop = y < radius;
      const wrapBottom = y > H - radius;
      if (wrapLeft) paint(x + W, y);
      if (wrapRight) paint(x - W, y);
      if (wrapTop) paint(x, y + H);
      if (wrapBottom) paint(x, y - H);
      if (wrapLeft && wrapTop) paint(x + W, y + H);
      if (wrapLeft && wrapBottom) paint(x + W, y - H);
      if (wrapRight && wrapTop) paint(x - W, y + H);
      if (wrapRight && wrapBottom) paint(x - W, y - H);
    };

    const render = (): void => {
      const c = ctx.ctx;

      rect(c, 0, 0, W, H, P.void);

      for (const star of stars) drawStar(c, star.x, star.y, star.bright);

      for (const rock of asteroids) {
        const radius = ASTEROID_RADIUS[rock.size] ?? 6;
        drawWrapped(rock.x, rock.y, radius + 1, (cx, cy) =>
          drawAsteroid(c, cx, cy, radius, rock.size, 0),
        );
      }

      for (const bullet of bullets) {
        if (!bullet.alive) continue;
        drawWrapped(bullet.x, bullet.y, 3, (cx, cy) => drawBullet(c, cx, cy, bullet.vx, bullet.vy));
      }

      const blinking = clock < invulnUntil && Math.floor(clock / 90) % 2 === 1;
      if (!blinking) {
        const thrusting =
          mode === "playing" && (ctx.input.keys.isDown("secondary") || ctx.input.keys.isDown("up"));
        drawWrapped(shipX, shipY, 9, (cx, cy) => drawShip(c, cx, cy, angle, thrusting, clock));
      }

      for (const particle of particles) {
        c.globalAlpha = clamp(particle.life / 220, 0, 1);
        drawSpark(c, particle.x, particle.y, particle.size, particle.color);
      }
      c.globalAlpha = 1;

      // 环绕边界：四边各一条暗线，暗示「从对面回来」。
      rect(c, 0, 0, W, 1, P.line);
      rect(c, 0, H - 1, W, 1, P.line);
      rect(c, 0, 0, 1, H, P.line);
      rect(c, W - 1, 0, 1, H, P.line);

      // 波次横幅：只在开局 / 换波后短暂出现。
      if (mode === "playing" && !wavePending && clock < bannerUntil) {
        const label = `WAVE ${wave}`;
        const width = measurePixelText(label, 2);
        c.globalAlpha = clamp((bannerUntil - clock) / 300, 0, 1);
        drawPixelText(c, label, Math.round((W - width) / 2), 96, 2, P.mint, P.void);
        c.globalAlpha = 1;
      }
    };

    /* ---------------- 输入 ---------------- */

    /**
     * 触屏 / 鼠标直控：点画面任意位置，飞船立刻转向那个方向。
     *
     * 这是除虚拟手柄之外的第二条触屏通路 —— 手柄收起时仍然能转向，
     * 开火和推进仍然由 A / B（键盘 Enter/Z 与 X/↑）负责。
     */
    ctx.input.pointer.on("down", (info) => {
      ctx.audio.unlock();
      if (mode !== "playing" || ctx.isPaused()) return;
      const dx = wrapDelta(info.x, shipX, W);
      const dy = wrapDelta(info.y, shipY, H);
      if (Math.hypot(dx, dy) < 3) return;
      angle = normalizeAngle(Math.atan2(dy, dx));
    });

    ctx.input.pointer.on("move", (info) => {
      if (mode !== "playing" || ctx.isPaused() || !info.down) return;
      // 拖动时持续转向（鼠标按住拖动 / 手指拖拽）。
      const dx = wrapDelta(info.x, shipX, W);
      const dy = wrapDelta(info.y, shipY, H);
      if (Math.hypot(dx, dy) < 3) return;
      angle = normalizeAngle(Math.atan2(dy, dx));
    });

    ctx.input.keys.onPress((action) => {
      ctx.audio.unlock();
      if (mode !== "playing" || ctx.isPaused()) return;
      if (action === "action" || action === "primary") fire();
    });

    /* ---------------- 初始化 ---------------- */

    reset();

    return {
      start(): void {
        ctx.audio.unlock();
        reset();
        mode = "playing";
        clock = 0;
        invulnUntil = clock + INVULN_MS;
        startWave(1);
        ctx.audio.ui();
        ctx.announce("环形陨石带开始。左右转向，A 键开火，B 键推进。");
      },

      update(dt: number): void {
        if (mode !== "playing") return;
        clock += dt;

        updateShip(dt);

        // 按住开火键自动连发（受 180ms 冷却限制）。
        const keys = ctx.input.keys;
        if (
          (keys.isDown("action") || keys.isDown("primary")) &&
          clock >= nextFireAt
        ) {
          fire();
        }

        updateBullets(dt);
        if (mode !== "playing") return;

        updateAsteroids(dt);
        if (mode !== "playing") return;

        updateParticles(dt);

        // 清完一波：歇 1.6 秒再放下一波。
        if (asteroids.length === 0 && !wavePending) {
          wavePending = true;
          waveWaitAt = clock + WAVE_GAP_MS;
          ctx.audio.tier();
          ctx.toast.show(`第 ${wave} 波清空`, { duration: 900 });
        }
        if (wavePending && clock >= waveWaitAt) {
          startWave(wave + 1);
          wavePending = false;
        }
      },

      render,

      pause(): void {
        // 松手式操作：暂停时不需要清输入状态，KeyMap 自己维护 held。
      },

      destroy(): void {
        particles = [];
        asteroids = [];
        for (const bullet of bullets) bullet.alive = false;
      },
    };
  },
});

export default game;
