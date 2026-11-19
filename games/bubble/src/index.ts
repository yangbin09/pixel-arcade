import {
  P,
  defineGame,
  rect,
  strokeRect,
  type GameContext,
  type GameInstance,
} from "@arcade/core";

import {
  BUBBLE_COLORS,
  drawAimGuide,
  drawBubble,
  drawCannon,
  drawCeiling,
  drawDangerLine,
  drawFlyingBubble,
} from "./art";
import { meta } from "./meta";
import {
  CANNON_SPEED,
  CANNON_Y,
  CLEAR_BONUS,
  DANGER_ROW,
  DIAMETER,
  FIELD_H,
  FIELD_W,
  ORIGIN_Y,
  RADIUS,
  ROW_H,
  SHOTS,
  SPEED,
  cellColor,
  clampCannon,
  countBubbles,
  createGrid,
  detachedFromCeiling,
  hexCenter,
  insertBubble,
  isCleared,
  landingCell,
  lowestOccupiedRow,
  randomColor,
  removeCells,
  sameColorCluster,
  scoreForClear,
  scoreForDrop,
  snapToGrid,
  substepsFor,
  swapColors,
  type Cell,
  type Grid,
} from "./logic";

const W = FIELD_W;
const H = FIELD_H;

/** 触摸按下后位移小于这个距离，松手时算「轻点发弹」。 */
const TAP_SLOP = 10;

/** 消除 / 掉落特效的存活时长（毫秒）。 */
const BURST_MS = 260;

type Mode = "ready" | "playing" | "over";

/** 正在飞的泡泡。 */
interface Shot {
  x: number;
  y: number;
  vy: number;
  color: number;
}

/** 掉落中的泡泡（纯视觉，不参与碰撞）。 */
interface Falling {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: number;
}

/** 消除炸开的像素碎屑。 */
interface Burst {
  x: number;
  y: number;
  color: number;
  life: number;
}

const game = defineGame({
  meta,
  create(ctx: GameContext): GameInstance {
    let mode: Mode = "ready";
    let grid: Grid = createGrid(() => 0);
    let score = 0;
    let shotsLeft = SHOTS;
    let cannonX = W / 2;
    let handColor = 0;
    let nextColor = 1;
    let shot: Shot | null = null;
    let falling: Falling[] = [];
    let bursts: Burst[] = [];
    let clock = 0;
    let shake = 0;
    let dragAnchor: { startX: number; cannon: number; moved: boolean } | null = null;

    /* ---------------- HUD ---------------- */

    const colorLabel = (index: number): string => {
      const labels = ["GRN", "GLD", "PNK", "LAV"];
      return labels[index] ?? "---";
    };

    const syncHud = (): void => {
      ctx.hud.set("score", score);
      ctx.hud.set("shots", Math.max(0, shotsLeft));
      ctx.hud.set("next", colorLabel(nextColor));
    };

    /* ---------------- 流程 ---------------- */

    const reset = (): void => {
      grid = createGrid(() => Math.random());
      score = 0;
      shotsLeft = SHOTS;
      cannonX = W / 2;
      handColor = randomColor(() => Math.random());
      nextColor = randomColor(() => Math.random());
      shot = null;
      falling = [];
      bursts = [];
      clock = 0;
      shake = 0;
      dragAnchor = null;
      ctx.hud.urgent(false);
      ctx.timer.hide();
      syncHud();
    };

    /** 结算只走这里一次；最高分由壳层按 high 模式写入，游戏里不碰 setBest。 */
    const finish = (won: boolean): void => {
      if (mode === "over") return;
      mode = "over";
      shot = null;
      dragAnchor = null;

      if (won) {
        ctx.audio.win();
        ctx.announce("全场清空，本局结束");
      } else {
        ctx.audio.lose();
        ctx.announce("泡泡到底线了，本局结束");
      }

      ctx.end({
        score,
        title: won ? "全场清空" : "泡泡到底了",
        kicker: won ? "CLEAR" : "GAME OVER",
        stats: [
          { label: "剩余弹数", value: Math.max(0, shotsLeft) },
          { label: "场上泡泡", value: countBubbles(grid) },
        ],
      });
    };

    /* ---------------- 特效 ---------------- */

    const addBurst = (cells: readonly Cell[]): void => {
      for (const cell of cells) {
        const center = hexCenter(cell.col, cell.row);
        const color = cellColor(grid, cell.col, cell.row);
        bursts.push({
          x: center.x,
          y: center.y,
          color: color === null ? 0 : color,
          life: BURST_MS,
        });
      }
      if (bursts.length > 60) bursts.splice(0, bursts.length - 60);
    };

    const addFalling = (cells: readonly Cell[]): void => {
      for (const cell of cells) {
        const center = hexCenter(cell.col, cell.row);
        const color = cellColor(grid, cell.col, cell.row);
        falling.push({
          x: center.x,
          y: center.y,
          vx: (Math.random() - 0.5) * 40,
          vy: 30 + Math.random() * 50,
          color: color === null ? 0 : color,
        });
      }
      if (falling.length > 80) falling.splice(0, falling.length - 80);
    };

    /* ---------------- 发弹 ---------------- */

    const launch = (): void => {
      if (mode !== "playing" || ctx.isPaused()) return;
      if (shot !== null || shotsLeft <= 0) return;

      shotsLeft -= 1;
      shot = {
        x: clampCannon(cannonX),
        y: CANNON_Y - RADIUS * 2,
        vy: -SPEED,
        color: handColor,
      };
      syncHud();
      ctx.hud.flash("shots", "is-bump");
      ctx.audio.blip();
    };

    /** B 键 / 手柄 B：手上与下一颗互换。 */
    const swapHand = (): void => {
      if (mode !== "playing" || ctx.isPaused()) return;
      if (shot !== null) return;
      [handColor, nextColor] = swapColors(handColor, nextColor);
      syncHud();
      ctx.hud.flash("next", "is-bump");
      ctx.audio.tick(2);
    };

    const loadNext = (): void => {
      handColor = nextColor;
      nextColor = randomColor(() => Math.random());
      syncHud();
    };

    /* ---------------- 落位与消除 ---------------- */

    /** 飞行中的泡泡是否已经贴上某颗已有泡泡（圆与圆相切判定）。 */
    const bubbleAt = (x: number, y: number): Cell | null => {
      for (let row = 0; row < grid.length; row += 1) {
        const line = grid[row];
        if (!line) continue;
        for (let col = 0; col < line.length; col += 1) {
          if (cellColor(grid, col, row) === null) continue;
          const center = hexCenter(col, row);
          const dx = center.x - x;
          const dy = center.y - y;
          if (dx * dx + dy * dy < DIAMETER * DIAMETER) return { col, row };
        }
      }
      return null;
    };

    /** 落位后的一整套结算：吸附 → 同色消除 → 断连掉落 → 计分 → 判负。 */
    const settle = (x: number, y: number, color: number): void => {
      const target = landingCell(grid, x, y);
      if (!target) {
        finish(false);
        return;
      }

      insertBubble(grid, target.col, target.row, color);
      ctx.audio.pop();

      const cluster = sameColorCluster(grid, target.col, target.row);
      if (cluster.length >= 3) {
        addBurst(cluster);
        removeCells(grid, cluster);
        score += scoreForClear(cluster.length);
        ctx.hud.set("score", score);
        ctx.hud.flash("score", "is-bump");
        ctx.audio.hit(cluster.length);
        if (!ctx.reducedMotion) shake = 2.4;

        // 消除之后再算断连：挂不住的一串整体掉下去。
        const loose = detachedFromCeiling(grid);
        if (loose.length > 0) {
          addFalling(loose);
          score += scoreForDrop(loose.length);
          ctx.hud.set("score", score);
          ctx.hud.flash("score", "is-bump");
          removeCells(grid, loose);
          ctx.audio.coin();
          if (loose.length >= 5) {
            ctx.toast.show(`掉落 ${loose.length} 颗`, { duration: 850 });
          }
        }
      }

      loadNext();

      if (isCleared(grid)) {
        score += CLEAR_BONUS;
        ctx.hud.set("score", score);
        finish(true);
        return;
      }

      if (lowestOccupiedRow(grid) >= DANGER_ROW) {
        finish(false);
        return;
      }

      if (shotsLeft <= 0) finish(false);
    };

    /** 飞行的泡泡：碰到已有泡泡或顶部就吸附。dt 是毫秒，按 4ms 拆子步。 */
    const stepShot = (dtMs: number): void => {
      const piece = shot;
      if (!piece) return;

      const steps = substepsFor(dtMs);
      const stepSeconds = dtMs / 1000 / steps;

      for (let i = 0; i < steps; i += 1) {
        piece.y += piece.vy * stepSeconds;

        // 顶部：球心贴到第 0 行中心线就落位。
        if (piece.y - RADIUS <= ORIGIN_Y) {
          piece.y = ORIGIN_Y;
          shot = null;
          settle(piece.x, piece.y, piece.color);
          return;
        }

        // 撞到已有泡泡：把球心推到相切位置再吸附，避免钻进邻居里。
        const hit = bubbleAt(piece.x, piece.y);
        if (hit) {
          const center = hexCenter(hit.col, hit.row);
          const dx = piece.x - center.x;
          const dy = piece.y - center.y;
          const dist = Math.hypot(dx, dy) || 1;
          piece.x = center.x + (dx / dist) * DIAMETER;
          piece.y = center.y + (dy / dist) * DIAMETER;
          shot = null;
          settle(piece.x, piece.y, piece.color);
          return;
        }

        // 左右墙：本作竖直向上发射，正常不会触发，保留以贴合规格的反弹定义。
        if (piece.x - RADIUS < 0) piece.x = RADIUS;
        else if (piece.x + RADIUS > W) piece.x = W - RADIUS;
      }
    };

    /* ---------------- 绘制 ---------------- */

    const drawBackground = (c: CanvasRenderingContext2D): void => {
      rect(c, 0, 0, W, H, P.night);
      rect(c, 0, 0, W, 1, P.line);
      rect(c, 0, 16, W, 1, P.line);
      for (let i = 0; i < 6; i += 1) rect(c, 18 + i * 26, 7, 3, 2, P.lineHi);

      rect(c, 0, 17, 1, H - 17, P.line);
      rect(c, W - 1, 17, 1, H - 17, P.line);

      rect(c, 0, H - 6, W, 1, P.line);
      rect(c, 0, H - 5, W, 5, P.void);
    };

    const drawGrid = (c: CanvasRenderingContext2D): void => {
      drawCeiling(c, ORIGIN_Y);
      for (let row = 0; row < grid.length; row += 1) {
        const line = grid[row];
        if (!line) continue;
        for (let col = 0; col < line.length; col += 1) {
          const color = cellColor(grid, col, row);
          if (color === null) continue;
          const center = hexCenter(col, row);
          drawBubble(c, center.x, center.y, RADIUS, color);
        }
      }
    };

    const drawDanger = (c: CanvasRenderingContext2D): void => {
      const y = ORIGIN_Y + DANGER_ROW * ROW_H + RADIUS;
      const low = lowestOccupiedRow(grid);
      const alert = low >= DANGER_ROW - 2;
      const color = alert ? P.red : P.redDeep;
      const phase = alert ? (clock / 40) % 4 : 0;
      drawDangerLine(c, y, color, phase);
    };

    const drawEffects = (c: CanvasRenderingContext2D): void => {
      for (const piece of falling) {
        drawBubble(c, piece.x, piece.y, RADIUS - 1, piece.color, { dim: true });
      }

      for (const burst of bursts) {
        const t = Math.max(0, Math.min(1, burst.life / BURST_MS));
        c.globalAlpha = t;
        const size = 2 + Math.round((1 - t) * 5);
        rect(c, burst.x - size / 2, burst.y - 1, size, 2, BUBBLE_COLORS[burst.color] ?? P.cream);
        rect(c, burst.x - 1, burst.y - size / 2, 2, size, P.cream);
      }
      c.globalAlpha = 1;
    };

    const render = (): void => {
      const c = ctx.ctx;
      drawBackground(c);

      let sx = 0;
      let sy = 0;
      if (shake > 0.2 && !ctx.reducedMotion) {
        sx = Math.round(Math.sin(clock * 0.09) * shake);
        sy = Math.round(Math.cos(clock * 0.13) * shake * 0.6);
      }

      c.save();
      c.translate(sx, sy);

      drawDanger(c);
      drawGrid(c);
      drawEffects(c);

      // 瞄准虚线：从炮口到落点所在格，给玩家一点「打哪儿」的参照。
      if (mode === "playing" && shot === null) {
        const targetRow = Math.min(
          DANGER_ROW,
          Math.max(0, lowestOccupiedRow(grid) + 1),
        );
        const target = snapToGrid(cannonX, ORIGIN_Y + targetRow * ROW_H);
        const center = hexCenter(target.col, target.row);
        const fromY = CANNON_Y - RADIUS * 2;
        if (center.y + RADIUS < fromY) {
          drawAimGuide(c, cannonX, fromY, center.y + RADIUS, P.lineHi);
        }
      }

      if (shot) drawFlyingBubble(c, shot.x, shot.y, shot.color);

      drawCannon(c, cannonX, handColor, shot === null);

      // 左下角「下一颗」小徽标，补足 HUD 里的文字提示。
      const badgeX = 14;
      const badgeY = H - 26;
      rect(c, badgeX - 9, badgeY - 9, 18, 16, P.void);
      strokeRect(c, badgeX - 9, badgeY - 9, 18, 16, P.line);
      drawBubble(c, badgeX, badgeY, 5, nextColor);

      c.restore();
    };

    /* ---------------- 输入：触屏 + 键盘两条通路 ---------------- */

    ctx.input.pointer.on("down", (info) => {
      ctx.audio.unlock();
      if (mode !== "playing" || ctx.isPaused()) return;

      const type = info.source.pointerType || "mouse";
      if (type === "mouse" && info.source.button !== 0) return;

      if (type === "touch" || type === "pen") {
        // 触摸：按相对拖动记锚点，先发一枪；继续拖动还能微调炮台。
        dragAnchor = { startX: info.x, cannon: cannonX, moved: false };
        launch();
        return;
      }

      dragAnchor = null;
      cannonX = clampCannon(info.x);
      launch();
    });

    ctx.input.pointer.on("move", (info) => {
      if (mode !== "playing" || ctx.isPaused()) return;

      if (dragAnchor && info.down) {
        const delta = info.x - dragAnchor.startX;
        if (Math.abs(delta) > 1) dragAnchor.moved = true;
        cannonX = clampCannon(dragAnchor.cannon + delta);
        return;
      }
      if (info.source.pointerType === "mouse" && info.down) {
        cannonX = clampCannon(info.x);
      }
    });

    const endDrag = (): void => {
      dragAnchor = null;
    };
    ctx.input.pointer.on("up", endDrag);
    ctx.input.pointer.on("cancel", endDrag);
    ctx.input.pointer.on("leave", endDrag);

    ctx.input.keys.onPress((action) => {
      if (mode !== "playing" || ctx.isPaused()) return;

      if (action === "left") {
        cannonX = clampCannon(cannonX - CANNON_SPEED * 0.08);
        return;
      }
      if (action === "right") {
        cannonX = clampCannon(cannonX + CANNON_SPEED * 0.08);
        return;
      }
      if (action === "action" || action === "primary") {
        launch();
        return;
      }
      if (action === "secondary") swapHand();
    });

    reset();

    return {
      start(): void {
        ctx.audio.unlock();
        reset();
        mode = "playing";
        ctx.audio.go();
        ctx.announce("泡泡龙开始，左右移动炮台，同色三颗消除。");
      },

      update(dt: number): void {
        if (mode !== "playing") return;
        clock += dt;

        // 按住左右键连续移动；单次点按的位移在 onPress 里做。
        let dir = 0;
        if (ctx.input.keys.isDown("left")) dir -= 1;
        if (ctx.input.keys.isDown("right")) dir += 1;
        if (dir !== 0) cannonX = clampCannon(cannonX + (dir * CANNON_SPEED * dt) / 1000);

        stepShot(dt);

        const seconds = dt / 1000;

        for (let i = falling.length - 1; i >= 0; i -= 1) {
          const piece = falling[i];
          if (!piece) continue;
          piece.vy += 420 * seconds;
          piece.x += piece.vx * seconds;
          piece.y += piece.vy * seconds;
          if (piece.y - RADIUS > H) falling.splice(i, 1);
        }

        for (let i = bursts.length - 1; i >= 0; i -= 1) {
          const burst = bursts[i];
          if (!burst) continue;
          burst.life -= dt;
          if (burst.life <= 0) bursts.splice(i, 1);
        }

        if (shake > 0) shake = Math.max(0, shake - dt * 0.012);
      },

      render,

      pause(): void {
        dragAnchor = null;
      },

      resume(): void {
        dragAnchor = null;
      },

      destroy(): void {
        dragAnchor = null;
        falling = [];
        bursts = [];
      },
    };
  },
});

export default game;
