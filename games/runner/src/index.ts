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
  drawCoin,
  drawDust,
  drawGroundDashes,
  drawImpact,
  drawObstacle,
  drawRunner,
  drawScenery,
  drawShards,
  drawSpeedLines,
  paintBackdrop,
  paintHillStrip,
} from "./art";
import { meta } from "./meta";
import {
  GROUND_Y,
  H,
  OBSTACLE_SIZE,
  PLAYER_X,
  SLIDE_MS,
  W,
  addScore,
  clampHud,
  coinArc,
  coinPicked,
  collisionAt,
  createPlayer,
  makeObstacle,
  metersOf,
  obstacleBox,
  pickObstacleKind,
  safeCoins,
  speedAt,
  speedLevel,
  spawnGapPx,
  stepPlayer,
  takeOff,
  type Coin,
  type Obstacle,
  type ObstacleKind,
  type PlayerState,
} from "./logic";

/** HUD 固定位数上限：超出就夹住，像素字不会撑破栏位。 */
const SCORE_MAX = 99999;
const DIST_MAX = 9999;
const SPEED_HUD_MAX = 99;

/** 障碍 / 金币滚出这个 x 就回收。 */
const CULL_X = -40;
/** 新障碍从画面右侧外多远处进入。 */
const SPAWN_X = W + 12;
/** 画布底部这块区域是「滑」的手势区，其余地方点一下就是跳。 */
const SLIDE_ZONE_Y = 146;
/**
 * 金币串相对上一只障碍右沿的提前量。
 *
 * 取值不能太小：金币贴着障碍摆的话，跨过障碍的那一跳会占用起跳时机，
 * 落地时金币已经飞到身后，等于永远吃不到。90px 保证「跳过障碍 → 落地
 * → 再跳一次正好穿过金币」这条节奏成立（120px/s 时约 0.75 秒）。
 */
const COIN_LEAD = 90;
/** 满速之后才画速度线。 */
const SPEED_LINE_FROM = 240;

type Mode = "ready" | "playing" | "over";

interface Layer {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
}

const game = defineGame({
  meta,
  create(ctx: GameContext): GameInstance {
    /* ---------------- 状态 ---------------- */

    let mode: Mode = "ready";
    let clock = 0;
    /** 世界已经滚过的距离（逻辑像素）。 */
    let scroll = 0;
    let score = 0;
    let coinsTaken = 0;
    let bestLevel = 1;

    let player: PlayerState = createPlayer();
    let slideMs = 0;
    let obstacles: Obstacle[] = [];
    let coins: Coin[] = [];
    let nextId = 1;
    let lastKind: ObstacleKind | undefined;

    /** 指针按住画布 / 键盘按住 A 都算「按住跳」。 */
    let pointerHeld = false;
    let shake = 0;
    let flash = 0;
    let dustLife = 0;
    let dustX = PLAYER_X;
    let crashKind: ObstacleKind = "box";

    /* ---------------- 静态图层（create 时各建一次，绝不在帧里建 canvas） ---------------- */

    const makeLayer = (
      w: number,
      h: number,
      paint: (c: CanvasRenderingContext2D) => void,
    ): Layer | null => {
      if (typeof document === "undefined") return null;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w));
      canvas.height = Math.max(1, Math.round(h));
      const c = canvas.getContext("2d");
      if (!c) return null;
      c.imageSmoothingEnabled = false;
      paint(c);
      return { canvas, w: canvas.width, h: canvas.height };
    };

    const backdrop = makeLayer(W, H, (c) => paintBackdrop(c, W, H));

    /** 远山：周期 42，条宽 84，视差最慢。 */
    const FAR_PERIOD = 42;
    const farHills = makeLayer(FAR_PERIOD * 2, 20, (c) =>
      paintHillStrip(c, FAR_PERIOD * 2, 18, 15, P.panel, P.line, FAR_PERIOD),
    );

    /** 近山：周期 26，条宽 52，比远山快一倍。 */
    const NEAR_PERIOD = 26;
    const nearHills = makeLayer(NEAR_PERIOD * 2, 14, (c) =>
      paintHillStrip(c, NEAR_PERIOD * 2, 12, 10, P.purple, P.lav, NEAR_PERIOD),
    );

    /** 把静态条平铺到底边 baseY 处，offset 越大越向左滚。 */
    const blitLayer = (layer: Layer | null, baseY: number, offset: number): void => {
      if (!layer) return;
      const c = ctx.ctx;
      const wrapped = ((offset % layer.w) + layer.w) % layer.w;
      const top = Math.round(baseY - layer.h);
      for (let x = -wrapped; x < W; x += layer.w) {
        c.drawImage(layer.canvas, Math.round(x), top);
      }
    };

    /* ---------------- HUD ---------------- */

    const syncHud = (bumpScore = false): void => {
      const meters = Math.floor(metersOf(scroll));
      ctx.hud.set("score", clampHud(score, SCORE_MAX));
      ctx.hud.set("dist", clampHud(meters, DIST_MAX));
      ctx.hud.set("speed", clampHud(speedLevel(meters), SPEED_HUD_MAX));
      if (bumpScore) ctx.hud.flash("score", "is-bump");
    };

    /* ---------------- 生成 ---------------- */

    /**
     * 在刚生成的那只障碍右侧、画面外撒一串跳跃弧线上的金币。
     *
     * 关键点：起点一定在 SPAWN_X 右边，所以金币和障碍一起从右沿滚进来，
     * 不会中途凭空出现在画面中间；再经 safeCoins 去掉压在障碍上的。
     */
    const sprinkleCoins = (obstacle: Obstacle): void => {
      if (Math.random() > 0.62) return;

      const spots = coinArc(speedAt(metersOf(scroll)));
      if (spots.length === 0) return;

      const startX = obstacle.x + OBSTACLE_SIZE[obstacle.kind].w + COIN_LEAD;
      const group: Coin[] = spots.map((spot) => ({
        x: startX + spot.dx,
        y: spot.y,
        taken: false,
      }));

      coins = coins.concat(safeCoins(group, obstacles));
    };

    const spawnObstacle = (): void => {
      const kind = pickObstacleKind(Math.random, lastKind);
      const obstacle = makeObstacle(kind, SPAWN_X, nextId, Math.random);
      nextId += 1;
      lastKind = kind;
      obstacles.push(obstacle);
      sprinkleCoins(obstacle);
    };

    /** 场上没有障碍且已经跑过开局空跑道，或最后一只有了间距，就补一只。 */
    const maybeSpawn = (): void => {
      const gap = spawnGapPx(speedAt(metersOf(scroll)));
      const last = obstacles[obstacles.length - 1];
      if (!last) {
        // 开局留一小段空跑道（约 0.8 秒）再放第一只
        if (scroll > 90) spawnObstacle();
        return;
      }
      if (last.x <= W - gap) spawnObstacle();
    };

    /* ---------------- 复位 / 结算 ---------------- */

    const reset = (): void => {
      clock = 0;
      scroll = 0;
      score = 0;
      coinsTaken = 0;
      bestLevel = 1;
      player = createPlayer();
      slideMs = 0;
      obstacles = [];
      coins = [];
      nextId = 1;
      lastKind = undefined;
      pointerHeld = false;
      shake = 0;
      flash = 0;
      dustLife = 0;
      dustX = PLAYER_X;
      crashKind = "box";

      ctx.hud.set("score", 0);
      ctx.hud.set("dist", 0);
      ctx.hud.set("speed", 1);
      ctx.hud.urgent(false);
    };

    /** 结算只走这里一次；最高分由壳层按 high 模式写入。 */
    const finish = (hit: Obstacle): void => {
      if (mode === "over") return;
      mode = "over";
      crashKind = hit.kind;
      pointerHeld = false;
      slideMs = 0;
      shake = ctx.reducedMotion ? 0 : 4;
      flash = 1;

      ctx.hud.set("score", clampHud(score, SCORE_MAX));
      ctx.audio.hit(0);
      ctx.audio.end();

      // 让结算面板背后的画面停在撞击那一帧
      render();

      ctx.end({
        score: clampHud(score, SCORE_MAX),
        title: "撞到障碍了",
        kicker: "GAME OVER",
        stats: [
          { label: "距离", value: `${Math.floor(metersOf(scroll))} 米` },
          { label: "金币", value: coinsTaken },
        ],
      });
    };

    /* ---------------- 动作 ---------------- */

    const canAct = (): boolean => mode === "playing" && !ctx.isPaused();

    const doJump = (): void => {
      if (!canAct() || player.airborne) return;
      takeOff(player);
      slideMs = 0;
      dustLife = 1;
      dustX = PLAYER_X;
      ctx.audio.pop();
    };

    const doSlide = (): void => {
      if (!canAct()) return;
      if (slideMs <= 0) ctx.audio.slide();
      slideMs = SLIDE_MS;
      if (!player.airborne) {
        dustLife = 1;
        dustX = PLAYER_X;
      }
    };

    /* ---------------- 绘制 ---------------- */

    const drawCoins = (): void => {
      const c = ctx.ctx;
      const spin = Math.floor(clock * 0.008);
      for (let i = 0; i < coins.length; i += 1) {
        const coin = coins[i]!;
        if (coin.taken) continue;
        drawCoin(c, coin.x, coin.y, spin + i);
      }
    };

    const drawObstacles = (): void => {
      const c = ctx.ctx;
      const tick = Math.floor(clock * 0.012);
      for (let i = 0; i < obstacles.length; i += 1) {
        const obstacle = obstacles[i]!;
        const box = obstacleBox(obstacle);
        drawObstacle(c, obstacle.kind, Math.round(box.x), Math.round(box.y), box.w, box.h, tick);
      }
    };

    const drawRunnerNow = (): void => {
      const c = ctx.ctx;
      if (mode === "over") {
        const cx = PLAYER_X;
        const cy = player.feetY - 15;
        drawShards(c, cx, cy, 1);
        drawImpact(c, cx, cy, 1);
        return;
      }
      const sliding = slideMs > 0 && !player.airborne;
      const pose = sliding ? "slide" : player.airborne ? "jump" : "run";
      drawRunner(c, PLAYER_X, player.feetY, pose, Math.floor(clock * 0.012));
    };

    /**
     * 虚拟手柄收起时，在画布上标出两个触屏手势区。
     * 只画很淡的小字，不画分隔线，免得横线穿过跑者。
     */
    const drawTouchHints = (): void => {
      if (ctx.padVisible()) return;
      const c = ctx.ctx;
      const sliding = slideMs > 0;

      c.globalAlpha = 0.45;
      const jumpLabel = "TAP JUMP";
      const jumpWidth = measurePixelText(jumpLabel, 1);
      drawPixelText(c, jumpLabel, Math.round(W / 2 - jumpWidth / 2), H - 30, 1, P.lineHi);

      // 滑行区：底部一条虚线 + 标签，按下时整条变金色
      const dashColor = sliding ? P.gold : P.line;
      for (let x = 0; x < W; x += 12) rect(c, x, H - 21, 6, 1, dashColor);

      const slideLabel = "SLIDE";
      const slideWidth = measurePixelText(slideLabel, 1);
      drawPixelText(
        c,
        slideLabel,
        Math.round(W / 2 - slideWidth / 2),
        H - 14,
        1,
        sliding ? P.gold : P.lineHi,
      );
      c.globalAlpha = 1;
    };

    const drawSceneryRow = (): void => {
      const c = ctx.ctx;
      const slot = 240;
      const base = Math.floor(scroll / slot);
      for (let i = 0; i < 6; i += 1) {
        const index = base + i;
        const x = Math.round(index * slot - scroll + 40);
        if (x < -28 || x > W + 12) continue;
        drawScenery(c, x, GROUND_Y, ((index % 3) + 3) % 3);
      }
    };

    const render = (): void => {
      const c = ctx.ctx;

      let sx = 0;
      let sy = 0;
      if (!ctx.reducedMotion && shake > 0.25) {
        sx = Math.round(Math.sin(clock * 0.09) * shake);
        sy = Math.round(Math.cos(clock * 0.13) * shake * 0.5);
      }

      c.save();
      c.translate(sx, sy);

      if (backdrop) c.drawImage(backdrop.canvas, 0, 0);
      else rect(c, 0, 0, W, H, P.night);

      // 两层视差山脊
      blitLayer(farHills, GROUND_Y - 8, scroll * 0.16);
      blitLayer(nearHills, GROUND_Y, scroll * 0.36);

      drawSceneryRow();
      drawGroundDashes(c, W, GROUND_Y, scroll, 9);

      drawCoins();
      drawObstacles();

      if (dustLife > 0) drawDust(c, dustX, GROUND_Y, dustLife);

      const speed = speedAt(metersOf(scroll));
      if (!ctx.reducedMotion && speed >= SPEED_LINE_FROM) {
        drawSpeedLines(c, PLAYER_X, player.feetY - 14, 3, clock * 0.05);
      }

      drawRunnerNow();

      if (mode === "over" && flash > 0.02) {
        c.globalAlpha = Math.min(0.34, flash * 0.34);
        c.fillStyle = P.red;
        c.fillRect(0, 0, W, H);
        c.globalAlpha = 1;
      }

      c.restore();

      if (mode === "playing") drawTouchHints();

      if (mode === "over") {
        const label =
          crashKind === "box" ? "HIT BOX" : crashKind === "beam" ? "HIT BEAM" : "HIT BIRD";
        const width = measurePixelText(label, 1);
        ctx.ctx.globalAlpha = 0.85;
        drawPixelText(ctx.ctx, label, Math.round(W / 2 - width / 2), H - 10, 1, P.red, P.void);
        ctx.ctx.globalAlpha = 1;
      }
    };

    /* ---------------- 输入 ---------------- */

    ctx.input.pointer.on("down", (info) => {
      ctx.audio.unlock();
      if (!canAct()) return;
      if (info.source.pointerType === "mouse" && info.source.button !== 0) return;

      pointerHeld = false;
      if (info.y >= SLIDE_ZONE_Y) {
        doSlide();
        return;
      }
      // 上方大半屏：点一下跳，按住继续加高
      pointerHeld = true;
      doJump();
    });

    ctx.input.pointer.on("up", () => {
      pointerHeld = false;
    });
    ctx.input.pointer.on("cancel", () => {
      pointerHeld = false;
    });
    ctx.input.pointer.on("leave", () => {
      pointerHeld = false;
    });

    const isJumpAction = (action: string): boolean =>
      action === "action" || action === "primary" || action === "up";

    ctx.input.keys.onPress((action) => {
      if (!canAct()) return;
      if (isJumpAction(action)) doJump();
      else if (action === "secondary" || action === "down") doSlide();
    });

    /* ---------------- 生命周期 ---------------- */

    reset();

    return {
      start(): void {
        reset();
        mode = "playing";
        ctx.audio.unlock();
        ctx.audio.ui();
        ctx.timer.hide();
        ctx.announce("开始跑步。点击或按空格跳跃，按住能跳更高；按 X 滑行。");
      },

      update(dt: number): void {
        if (mode !== "playing") {
          dustLife = Math.max(0, dustLife - dt * 0.004);
          flash = Math.max(0, flash - dt * 0.003);
          shake = Math.max(0, shake - dt * 0.012);
          return;
        }

        clock += dt;
        const seconds = dt / 1000;
        const speed = speedAt(metersOf(scroll));
        const travel = speed * seconds;

        // 世界向左滚动
        scroll += travel;
        for (let i = 0; i < obstacles.length; i += 1) obstacles[i]!.x -= travel;
        for (let i = 0; i < coins.length; i += 1) coins[i]!.x -= travel;

        // 滑行计时：按住 B 会一直续上
        if (slideMs > 0) {
          slideMs = Math.max(0, slideMs - dt);
          if (ctx.input.keys.isDown("secondary") && slideMs < 80) slideMs = 80;
        }

        // 竖直物理：按住 A / 按住画布都能加高
        const holdJump =
          pointerHeld ||
          ctx.input.keys.isDown("action") ||
          ctx.input.keys.isDown("primary") ||
          ctx.input.keys.isDown("up");
        const wasAirborne = player.airborne;
        stepPlayer(player, dt, holdJump);
        if (wasAirborne && !player.airborne) {
          dustLife = 1;
          dustX = PLAYER_X;
          ctx.audio.blip();
        }

        const sliding = slideMs > 0 && !player.airborne;

        // 水平位移拆子步，满速时也不会一帧穿过薄障碍
        const steps = Math.min(4, Math.max(1, Math.ceil(travel / 8)));
        for (let s = 0; s < steps; s += 1) {
          const hit = collisionAt(player.feetY, sliding, obstacles);
          if (hit) {
            finish(hit);
            return;
          }
        }

        // 金币拾取
        for (let i = 0; i < coins.length; i += 1) {
          const coin = coins[i]!;
          if (!coinPicked(player.feetY, sliding, coin)) continue;
          coin.taken = true;
          coinsTaken += 1;
          score = addScore(true, score);
          syncHud(true);
          ctx.audio.coin();
        }

        // 回收 + 补充生成
        obstacles = obstacles.filter(
          (obstacle) => obstacle.x + OBSTACLE_SIZE[obstacle.kind].w > CULL_X,
        );
        coins = coins.filter((coin) => !coin.taken && coin.x > CULL_X);
        maybeSpawn();

        // 提速提示
        const level = speedLevel(metersOf(scroll));
        if (level > bestLevel) {
          bestLevel = level;
          ctx.toast.show("速度提升", { duration: 900 });
          ctx.audio.tier();
        }

        syncHud(false);

        dustLife = Math.max(0, dustLife - dt * 0.004);
        shake = Math.max(0, shake - dt * 0.012);
        flash = Math.max(0, flash - dt * 0.003);
      },

      render,

      pause(): void {
        pointerHeld = false;
      },

      resume(): void {
        pointerHeld = false;
      },

      destroy(): void {
        pointerHeld = false;
        obstacles = [];
        coins = [];
      },
    };
  },
});

export default game;
