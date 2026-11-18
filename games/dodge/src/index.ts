import {
  P,
  clamp,
  defineGame,
  drawPixelText,
  measurePixelText,
  rand,
  randInt,
  rect,
  sparkle,
  type GameContext,
  type GameInstance,
} from "@arcade/core";

import { drawMeteor, drawShieldPickup, drawShieldRing, drawShip, drawShipGhost, paintBackdrop } from "./art";
import {
  GRAZE_POINTS,
  H,
  MAX_SHIELDS,
  ROUND_MS,
  SHIELD_INTERVAL_MS,
  SHIP_SPEED,
  SURVIVAL_POINTS,
  W,
  circleRectOverlap,
  clampShipX,
  clampShipY,
  createMeteorPool,
  createParticlePool,
  createShieldPool,
  hitsShip,
  isGraze,
  meteorRadius,
  meteorSpeedAt,
  scoreFor,
  spawnIntervalAt,
  speedStageFor,
  stepParticles,
  survivalTicksFor,
  touchDragAnchor,
  touchDragTarget,
  type Meteor,
  type ShieldDrop,
  type TouchDragAnchor,
} from "./logic";
import { meta } from "./meta";

const STAR_COUNT = 44;
const MAX_POPUPS = 8;
const POPUP_LIFE = 640;
const FIRST_SPAWN_MS = 420;
/** 护盾挡下之后短暂无敌，避免同一瞬间连掉两个护盾。 */
const HIT_INVULN_MS = 520;
const SHIELD_DROP_SPEED = 58;
const SHIELD_DROP_RADIUS = 6;
const TRAIL_ALPHA = 0.24;

type Mode = "ready" | "playing" | "over";
type BurstKind = "graze" | "hit" | "shield" | "rock";

interface Star {
  x: number;
  y: number;
  speed: number;
  phase: number;
  /** 0 白 / 1 奶白 / 2 淡紫。 */
  kind: number;
}

interface Popup {
  alive: boolean;
  x: number;
  y: number;
  born: number;
  life: number;
  text: string;
  color: string;
}

const game = defineGame({
  meta,
  create(ctx: GameContext): GameInstance {
    let mode: Mode = "ready";
    let clock = 0;
    let elapsed = 0;
    let score = 0;
    let ticks = 0;
    let grazes = 0;
    let shields = 0;
    let stage = 0;

    let nextSpawn = FIRST_SPAWN_MS;
    let nextShieldAt = SHIELD_INTERVAL_MS;

    let shipX = W / 2;
    let shipY = H - 30;
    let trailX1 = shipX;
    let trailY1 = shipY;
    let trailX2 = shipX;
    let trailY2 = shipY;

    let shake = 0;
    let flash = 0;
    let invulnUntil = 0;
    let lastSecond = -1;

    let particleCursor = 0;
    let popupCursor = 0;

    /** 触摸 / 笔的拖动锚点；鼠标不走相对拖动，保持绝对跟随。 */
    let drag: TouchDragAnchor | null = null;

    const meteors = createMeteorPool();
    const particles = createParticlePool();
    const drops = createShieldPool();

    const popups: Popup[] = [];
    for (let i = 0; i < MAX_POPUPS; i += 1) {
      popups.push({ alive: false, x: 0, y: 0, born: 0, life: 0, text: "", color: P.cream });
    }

    const stars: Star[] = [];
    for (let i = 0; i < STAR_COUNT; i += 1) {
      stars.push({
        x: rand(1, W - 2),
        y: rand(0, H - 14),
        speed: rand(4, 16),
        phase: rand(0, Math.PI * 2),
        kind: randInt(0, 2),
      });
    }

    /* ---------------- 静态背景 ---------------- */

    let backdrop: HTMLCanvasElement | null = null;

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

    const setScore = (bump: boolean): void => {
      ctx.hud.set("score", score);
      if (bump) ctx.hud.flash("score", "is-bump");
    };

    const setShields = (value: number, bump: boolean): void => {
      shields = value;
      ctx.hud.set("shield", value);
      ctx.hud.setColor("shield", value > 0 ? P.mint : P.red);
      if (bump) ctx.hud.flash("shield", "is-bump");
    };

    const syncTime = (remaining: number, force = false): void => {
      const seconds = Math.max(0, Math.ceil(remaining / 1000));
      if (force || seconds !== lastSecond) {
        lastSecond = seconds;
        ctx.hud.set("time", remaining);
        const critical = seconds <= 5;
        ctx.hud.setColor("time", critical ? P.red : P.cream);
        ctx.hud.urgent(critical);
      }
      ctx.timer.set(remaining, ROUND_MS, { low: 10 / 45, critical: 5 / 45 });
    };

    /* ---------------- 粒子 / 飘字 ---------------- */

    const burstColor = (kind: BurstKind, index: number): string => {
      switch (kind) {
        case "graze":
          return index % 4 === 0 ? P.white : index % 3 === 0 ? P.mint : P.gold;
        case "hit":
          return index % 4 === 0 ? P.cream : index % 3 === 0 ? P.orange : P.red;
        case "shield":
          return index % 4 === 0 ? P.white : index % 3 === 0 ? P.cream : P.mint;
        default:
          return index % 3 === 0 ? P.dirtHi : index % 3 === 1 ? P.dirt : P.purple;
      }
    };

    const addParticle = (
      x: number,
      y: number,
      vx: number,
      vy: number,
      life: number,
      size: number,
      star: boolean,
      color: string,
    ): void => {
      const p = particles[particleCursor]!;
      particleCursor = (particleCursor + 1) % particles.length;
      p.alive = true;
      p.x = x;
      p.y = y;
      p.vx = vx;
      p.vy = vy;
      p.life = life;
      p.max = life;
      p.size = size;
      p.star = star;
      p.color = color;
    };

    const burst = (x: number, y: number, count: number, kind: BurstKind, speed: number): void => {
      const total = ctx.reducedMotion ? Math.max(2, Math.round(count / 3)) : count;
      for (let i = 0; i < total; i += 1) {
        const angle = rand(0, Math.PI * 2);
        const velocity = rand(speed * 0.25, speed);
        const life = rand(260, 540);
        addParticle(
          x + rand(-2, 2),
          y + rand(-2, 2),
          Math.cos(angle) * velocity,
          Math.sin(angle) * velocity,
          life,
          randInt(1, 2),
          Math.random() < 0.25,
          burstColor(kind, i),
        );
      }
    };

    const addPopup = (text: string, x: number, y: number, color: string): void => {
      const p = popups[popupCursor]!;
      popupCursor = (popupCursor + 1) % popups.length;
      p.alive = true;
      p.text = text;
      p.x = x;
      p.y = y;
      p.born = clock;
      p.life = POPUP_LIFE;
      p.color = color;
    };

    /* ---------------- 生成 ---------------- */

    const spawnMeteor = (atMs: number): void => {
      let target: Meteor | null = null;
      for (let i = 0; i < meteors.length; i += 1) {
        const m = meteors[i]!;
        if (!m.alive) {
          target = m;
          break;
        }
      }
      if (!target) return;

      const radius = meteorRadius();
      target.alive = true;
      target.x = rand(radius + 3, W - radius - 3);
      target.y = -radius - 2;
      target.r = radius;
      target.vy = meteorSpeedAt(atMs);
      target.spin = rand(0, Math.PI * 2);
      target.spinSpeed = rand(-2.8, 2.8);
      target.kind = randInt(0, 3);
      target.grazed = false;
    };

    const spawnDrop = (): void => {
      for (let i = 0; i < drops.length; i += 1) {
        const d = drops[i]!;
        if (d.alive) continue;
        d.alive = true;
        d.x = rand(14, W - 14);
        d.y = -8;
        d.vy = SHIELD_DROP_SPEED;
        d.phase = rand(0, Math.PI * 2);
        return;
      }
    };

    /* ---------------- 结算 ---------------- */

    const finish = (cause: "hit" | "survived"): void => {
      if (mode === "over") return;
      mode = "over";

      // 结算分统一按「生存跳 + 擦身 + 未用护盾」重算，避免逐帧累加漂移。
      score = scoreFor(ticks, grazes, shields);
      setScore(false);
      ctx.hud.set("time", 0);
      ctx.hud.urgent(false);
      ctx.timer.set(0, ROUND_MS);

      if (cause === "survived") ctx.audio.win();
      else ctx.audio.lose();

      const lived = cause === "survived" ? ROUND_MS : Math.min(elapsed, ROUND_MS);
      ctx.end({
        score,
        title: cause === "survived" ? "活下来了" : "被砸中了",
        kicker: cause === "survived" ? "SURVIVED" : "GAME OVER",
        stats: [
          { label: "存活时间", value: `${(lived / 1000).toFixed(1)} 秒` },
          { label: "擦身次数", value: grazes },
        ],
      });
    };

    /* ---------------- 命中 / 擦身 / 道具 ---------------- */

    /** 返回 true 表示这一击直接结束了本局。 */
    const handleHit = (m: Meteor): boolean => {
      m.alive = false;
      burst(m.x, m.y, 16, "rock", 130);
      burst(m.x, m.y, 10, "hit", 90);
      shake = Math.max(shake, ctx.reducedMotion ? 0 : 4.5);
      flash = Math.max(flash, 0.75);

      if (shields > 0) {
        setShields(shields - 1, false);
        ctx.hud.flash("shield", "is-broken");
        invulnUntil = clock + HIT_INVULN_MS;
        ctx.audio.hit(1);
        ctx.toast.show("护盾挡住了一次", { warn: true, duration: 900 });
        ctx.announce(`护盾挡住了陨石，还剩 ${shields} 个。`);
        return false;
      }
      finish("hit");
      return true;
    };

    const handleGraze = (m: Meteor): void => {
      m.grazed = true;
      grazes += 1;
      score += GRAZE_POINTS;
      setScore(true);
      ctx.audio.coin();
      burst(m.x, m.y, 6, "graze", 80);
      addPopup("+15", m.x, Math.max(14, m.y - 3), P.gold);
      shake = Math.max(shake, ctx.reducedMotion ? 0 : 1.4);
    };

    const collectDrop = (d: ShieldDrop): void => {
      d.alive = false;
      burst(d.x, d.y, 10, "shield", 80);
      if (shields >= MAX_SHIELDS) {
        ctx.audio.blip();
        addPopup("MAX", d.x, d.y - 3, P.mint);
        return;
      }
      setShields(shields + 1, true);
      ctx.audio.gold();
      addPopup("+1", d.x, d.y - 3, P.mint);
      ctx.toast.show("护盾 +1", { duration: 800 });
      ctx.announce(`拿到护盾，现在有 ${shields} 个。`);
    };

    /* ---------------- 复位 ---------------- */

    const resetRun = (): void => {
      clock = 0;
      elapsed = 0;
      score = 0;
      ticks = 0;
      grazes = 0;
      stage = 0;
      nextSpawn = FIRST_SPAWN_MS;
      nextShieldAt = SHIELD_INTERVAL_MS;

      shipX = W / 2;
      shipY = H - 30;
      trailX1 = shipX;
      trailY1 = shipY;
      trailX2 = shipX;
      trailY2 = shipY;

      shake = 0;
      flash = 0;
      invulnUntil = 0;
      lastSecond = -1;
      particleCursor = 0;
      popupCursor = 0;
      drag = null;

      for (let i = 0; i < meteors.length; i += 1) meteors[i]!.alive = false;
      for (let i = 0; i < particles.length; i += 1) particles[i]!.alive = false;
      for (let i = 0; i < drops.length; i += 1) drops[i]!.alive = false;
      for (let i = 0; i < popups.length; i += 1) popups[i]!.alive = false;

      ctx.hud.set("time", ROUND_MS);
      ctx.hud.set("score", 0);
      setShields(0, false);
      ctx.hud.setColor("shield", P.mint);
      ctx.hud.urgent(false);
    };

    /* ---------------- 绘制 ---------------- */

    const drawStars = (): void => {
      const c = ctx.ctx;
      for (let i = 0; i < stars.length; i += 1) {
        const s = stars[i]!;
        const pulse = (Math.sin(clock * 0.0022 + s.phase) + 1) / 2;
        c.globalAlpha = 0.35 + pulse * 0.65;
        const color = s.kind === 0 ? P.white : s.kind === 1 ? P.cream : P.lav;
        if (s.kind === 0 && pulse > 0.72) sparkle(c, s.x, s.y, 1, color, P.white);
        else rect(c, s.x, s.y, 1, 1, color);
      }
      c.globalAlpha = 1;
    };

    const drawParticles = (): void => {
      const c = ctx.ctx;
      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i]!;
        if (!p.alive) continue;
        c.globalAlpha = Math.min(1, p.life / 180);
        if (p.star) sparkle(c, p.x, p.y, p.size + 1, p.color, P.white);
        else rect(c, p.x, p.y, p.size, p.size, p.color);
      }
      c.globalAlpha = 1;
    };

    const drawPopups = (): void => {
      const c = ctx.ctx;
      for (let i = 0; i < popups.length; i += 1) {
        const p = popups[i]!;
        if (!p.alive) continue;
        const age = clock - p.born;
        if (age < 0 || age >= p.life) continue;
        const k = age / p.life;
        const width = measurePixelText(p.text, 2);
        const x = clamp(p.x - width / 2, 3, W - width - 3);
        const y = p.y - Math.round(k * 12);
        c.globalAlpha = 1 - k * k;
        drawPixelText(c, p.text, x, y, 2, p.color, P.void);
      }
      c.globalAlpha = 1;
    };

    const render = (): void => {
      const c = ctx.ctx;

      let sx = 0;
      let sy = 0;
      if (!ctx.reducedMotion && shake > 0.25) {
        sx = Math.round(Math.sin(clock * 0.08) * shake);
        sy = Math.round(Math.cos(clock * 0.11) * shake * 0.6);
      }

      c.save();
      c.translate(sx, sy);

      if (backdrop) c.drawImage(backdrop, 0, 0);
      else rect(c, 0, 0, W, H, P.night);

      drawStars();

      for (let i = 0; i < drops.length; i += 1) {
        const d = drops[i]!;
        if (d.alive) drawShieldPickup(c, d.x, d.y, d.phase + clock * 0.006);
      }

      for (let i = 0; i < meteors.length; i += 1) {
        const m = meteors[i]!;
        if (m.alive) drawMeteor(c, m.x, m.y, m.r, m.spin, m.kind);
      }

      if (mode !== "over") {
        drawShipGhost(c, trailX2, trailY2, TRAIL_ALPHA * 0.42);
        drawShipGhost(c, trailX1, trailY1, TRAIL_ALPHA);
        if (shields > 0) drawShieldRing(c, shipX, shipY, 8, clock * 0.006);

        const blinking = clock < invulnUntil && Math.floor(clock / 70) % 2 === 0;
        if (!blinking) drawShip(c, shipX, shipY, Math.floor(clock / 90) % 2 === 0);
      }

      drawParticles();
      drawPopups();

      c.restore();

      if (flash > 0.01) {
        c.globalAlpha = Math.min(0.3, flash * 0.3);
        c.fillStyle = P.red;
        c.fillRect(0, 0, W, H);
        c.globalAlpha = 1;
      }
    };

    /* ---------------- 输入 ---------------- */

    const moveShipTo = (x: number, y: number): void => {
      shipX = clampShipX(x);
      shipY = clampShipY(y);
    };

    ctx.input.pointer.on("down", (info) => {
      ctx.audio.unlock();
      if (mode !== "playing" || ctx.isPaused()) return;
      if (info.source.pointerType === "mouse") {
        if (info.source.button !== 0) return;
        drag = null;
        moveShipTo(info.x, info.y);
        return;
      }
      // 触摸 / 笔：只记锚点，不从手指位置开始，避免手指盖住飞船。
      drag = touchDragAnchor(info.x, info.y, shipX, shipY);
    });

    ctx.input.pointer.on("move", (info) => {
      if (mode !== "playing" || ctx.isPaused()) return;
      if (info.source.pointerType === "mouse") {
        drag = null;
        moveShipTo(info.x, info.y);
        return;
      }
      if (!drag || !info.down) return;
      const next = touchDragTarget(drag, info.x, info.y);
      shipX = next.x;
      shipY = next.y;
    });

    const endDrag = (): void => {
      drag = null;
    };
    ctx.input.pointer.on("up", endDrag);
    ctx.input.pointer.on("cancel", endDrag);
    ctx.input.pointer.on("leave", endDrag);

    buildBackdrop();
    resetRun();

    return {
      start(): void {
        resetRun();
        mode = "playing";
        ctx.audio.unlock();
        ctx.audio.ui();
        syncTime(ROUND_MS, true);
        ctx.announce("撑过 45 秒，躲开陨石。");
      },

      update(dt: number): void {
        if (mode !== "playing") return;

        clock += dt;
        elapsed += dt;

        // 生存分：每 100ms 一跳，最后正好 450 跳 = 900 分
        const nextTicks = survivalTicksFor(elapsed);
        if (nextTicks > ticks) {
          score += (nextTicks - ticks) * SURVIVAL_POINTS;
          ticks = nextTicks;
          setScore(false);
        }

        if (elapsed >= ROUND_MS) {
          finish("survived");
          return;
        }

        const nextStage = speedStageFor(elapsed);
        if (nextStage > stage) {
          stage = nextStage;
          ctx.toast.show(nextStage === 2 ? "陨石更密了" : "陨石加速", { duration: 900 });
          ctx.audio.tier();
        }

        // 键盘移动与指针跟随互不干扰：只有按住方向键时才改坐标
        let kx = 0;
        let ky = 0;
        if (ctx.input.keys.isDown("left")) kx -= 1;
        if (ctx.input.keys.isDown("right")) kx += 1;
        if (ctx.input.keys.isDown("up")) ky -= 1;
        if (ctx.input.keys.isDown("down")) ky += 1;
        if (kx !== 0 || ky !== 0) {
          const length = Math.sqrt(kx * kx + ky * ky);
          shipX = clampShipX(shipX + (kx / length) * SHIP_SPEED * (dt / 1000));
          shipY = clampShipY(shipY + (ky / length) * SHIP_SPEED * (dt / 1000));
        }

        // 拖影：只保留最近两帧
        trailX2 = trailX1;
        trailY2 = trailY1;
        trailX1 = shipX;
        trailY1 = shipY;

        if (elapsed >= nextSpawn) {
          spawnMeteor(elapsed);
          nextSpawn = elapsed + spawnIntervalAt(elapsed) * rand(0.85, 1.15);
        }

        while (elapsed >= nextShieldAt) {
          nextShieldAt += SHIELD_INTERVAL_MS;
          if (shields < MAX_SHIELDS) spawnDrop();
        }

        // 陨石：按位移拆子步，避免高速时一帧穿过飞船
        for (let i = 0; i < meteors.length; i += 1) {
          const m = meteors[i]!;
          if (!m.alive) continue;

          const travel = (Math.abs(m.vy) * dt) / 1000;
          const steps = Math.min(4, Math.max(1, Math.ceil(travel / 3)));
          const stepSeconds = dt / steps / 1000;

          for (let s = 0; s < steps; s += 1) {
            m.y += m.vy * stepSeconds;
            m.spin += m.spinSpeed * stepSeconds;

            if (clock >= invulnUntil && hitsShip(m.x, m.y, m.r, shipX, shipY)) {
              if (handleHit(m)) return;
              break;
            }
            if (!m.grazed && m.y > 0 && isGraze(m.x, m.y, m.r, shipX, shipY)) handleGraze(m);
          }

          if (m.alive && m.y - m.r > H + 4) m.alive = false;
        }

        // 护盾掉落：下落 + 拾取
        for (let i = 0; i < drops.length; i += 1) {
          const d = drops[i]!;
          if (!d.alive) continue;
          d.y += d.vy * (dt / 1000);
          d.phase += dt * 0.006;
          if (d.y > H + 10) {
            d.alive = false;
            continue;
          }
          if (
            circleRectOverlap(
              d.x,
              d.y,
              SHIELD_DROP_RADIUS,
              shipX - 4.5,
              shipY - 4.5,
              9,
              9,
            )
          ) {
            collectDrop(d);
          }
        }

        stepParticles(particles, dt);

        for (let i = 0; i < popups.length; i += 1) {
          const p = popups[i]!;
          if (p.alive && clock - p.born >= p.life) p.alive = false;
        }

        // 星空缓慢下移
        for (let i = 0; i < stars.length; i += 1) {
          const s = stars[i]!;
          s.y += s.speed * (dt / 1000);
          if (s.y > H - 12) {
            s.y = -1;
            s.x = rand(1, W - 2);
          }
        }

        shake = Math.max(0, shake - dt * 0.012);
        flash = Math.max(0, flash - dt * 0.004);
        syncTime(Math.max(0, ROUND_MS - elapsed));
      },

      render,

      pause(): void {
        // 壳层停掉 update，位置与计时自然冻结，无需额外处理。
      },
    };
  },
});

export default game;
