import {
  P,
  clamp,
  defineGame,
  rect,
  type GameContext,
  type GameInstance,
} from "@arcade/core";

import { CELL, PAD, drawApple, drawSnakeHead, drawSnakeSegment, paintBoard } from "./art";
import { meta } from "./meta";

const GRID = 16;
const W = meta.size.w;
const START_TICK = 150;
const MIN_TICK = 70;
const TICK_STEP = 8;
const FRUIT_SCORE = 10;
const QUEUE_MAX = 2;
const START_LENGTH = 3;

export type Dir = "up" | "down" | "left" | "right";

export interface Cell {
  x: number;
  y: number;
}

export const DELTA: Record<Dir, Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export const OPPOSITE: Record<Dir, Dir> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

export function sameCell(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y;
}

export function nextHead(head: Cell, dir: Dir): Cell {
  const delta = DELTA[dir];
  return { x: head.x + delta.x, y: head.y + delta.y };
}

/** 初始蛇：3 节，头在棋盘中心，向右出发。 */
export function createSnake(): Cell[] {
  const x = GRID >> 1;
  const y = GRID >> 1;
  const cells: Cell[] = [];
  for (let i = 0; i < START_LENGTH; i += 1) cells.push({ x: x - i, y });
  return cells;
}

export interface StepResult {
  snake: Cell[];
  ate: boolean;
  dead: boolean;
  cause: "wall" | "self" | null;
}

/**
 * 走一步（纯函数，判定按格点）：
 * - 撞墙 / 咬到自己 → dead
 * - 吃到果实 → 不弹尾，长度 +1
 * - 普通移动 → 弹尾（所以走进当前尾格是合法的）
 */
export function stepSnake(
  snake: readonly Cell[],
  dir: Dir,
  fruit: Cell,
  grid = GRID,
): StepResult {
  const head = snake[0];
  if (!head) return { snake: [], ate: false, dead: true, cause: "wall" };

  const next = nextHead(head, dir);
  if (next.x < 0 || next.y < 0 || next.x >= grid || next.y >= grid) {
    return { snake: snake.slice(), ate: false, dead: true, cause: "wall" };
  }

  const ate = sameCell(next, fruit);
  const bodyEnd = ate ? snake.length : snake.length - 1;
  for (let i = 0; i < bodyEnd; i += 1) {
    if (sameCell(snake[i]!, next)) {
      return { snake: snake.slice(), ate, dead: true, cause: "self" };
    }
  }

  const moved = ate ? [next, ...snake] : [next, ...snake.slice(0, -1)];
  return { snake: moved, ate, dead: false, cause: null };
}

/** 方向队列：最多 2 个，禁止 180° 掉头；与队尾相同的方向不占位。 */
export function queueDirection(
  queue: readonly Dir[],
  current: Dir,
  next: Dir,
  max = QUEUE_MAX,
): Dir[] {
  if (queue.length >= max) return queue.slice();
  const last = queue.length ? queue[queue.length - 1]! : current;
  if (next === last || next === OPPOSITE[last]) return queue.slice();
  return [...queue, next];
}

/** 每吃 5 颗减 8ms，最低 70ms。 */
export function tickMsFor(eaten: number): number {
  const steps = Math.floor(Math.max(0, eaten) / 5);
  return Math.max(MIN_TICK, START_TICK - steps * TICK_STEP);
}

/** 从空格里随机取一格；棋盘满了返回 null。 */
export function findFreeCell(
  snake: readonly Cell[],
  rng: () => number = Math.random,
  grid = GRID,
): Cell | null {
  const occupied = new Set<number>();
  for (const cell of snake) occupied.add(cell.y * grid + cell.x);

  const free: number[] = [];
  for (let i = 0; i < grid * grid; i += 1) {
    if (!occupied.has(i)) free.push(i);
  }
  if (!free.length) return null;

  const roll = Math.floor(clamp(rng(), 0, 0.999999) * free.length);
  const index = free[roll]!;
  return { x: index % grid, y: Math.floor(index / grid) };
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
}

const DIR_ACTIONS: Record<string, Dir | undefined> = {
  left: "left",
  right: "right",
  up: "up",
  down: "down",
  slot1: "left",
  slot2: "up",
  slot3: "right",
  slot4: "down",
};

const game = defineGame({
  meta,
  create(ctx: GameContext): GameInstance {
    let snake: Cell[] = createSnake();
    let dir: Dir = "right";
    let queue: Dir[] = [];
    let fruit: Cell = { x: 0, y: 0 };
    let acc = 0;
    let tickMs = START_TICK;
    let score = 0;
    let eaten = 0;
    let maxLength = START_LENGTH;
    let best = 0;
    let playing = false;
    let ended = false;
    let clock = 0;
    let flash = 0;
    let particles: Particle[] = [];
    let board: HTMLCanvasElement | null = null;

    /* ---------------- 静态层 ---------------- */

    const buildBoard = (): void => {
      const layer = document.createElement("canvas");
      layer.width = W;
      layer.height = W;
      const paint = layer.getContext("2d");
      if (!paint) return;
      paint.imageSmoothingEnabled = false;
      paintBoard(paint, W);
      board = layer;
    };

    /* ---------------- 状态 ---------------- */

    const reset = (): void => {
      snake = createSnake();
      dir = "right";
      queue = [];
      fruit = findFreeCell(snake) ?? { x: 0, y: 0 };
      acc = 0;
      tickMs = START_TICK;
      score = 0;
      eaten = 0;
      maxLength = snake.length;
      best = ctx.store.best(meta.id, "high") ?? 0;
      playing = false;
      ended = false;
      clock = 0;
      flash = 0;
      particles = [];

      ctx.hud.set("score", 0);
      ctx.hud.set("length", snake.length);
      ctx.hud.set("best", best);
      ctx.hud.urgent(false);
      ctx.timer.hide();
    };

    const enqueue = (next: Dir): void => {
      if (!playing || ctx.isPaused()) return;
      queue = queueDirection(queue, dir, next);
    };

    const refreshHud = (): void => {
      ctx.hud.set("score", score);
      ctx.hud.set("length", snake.length);
      if (score > best) ctx.hud.set("best", score);
      ctx.hud.flash("score", "is-bump");
    };

    /* ---------------- 粒子 ---------------- */

    const addBurst = (cell: Cell): void => {
      if (ctx.reducedMotion) return;
      const cx = PAD + cell.x * CELL + CELL / 2;
      const cy = PAD + cell.y * CELL + CELL / 2;
      const colors = [P.red, P.gold, P.cream, P.amber];
      for (let i = 0; i < 8; i += 1) {
        const angle = (Math.PI * 2 * i) / 8 + Math.random() * 0.4;
        const speed = 16 + Math.random() * 20;
        const life = 240 + Math.random() * 160;
        particles.push({
          x: cx,
          y: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 8,
          life,
          max: life,
          color: colors[i % colors.length]!,
        });
      }
      if (particles.length > 48) particles.splice(0, particles.length - 48);
    };

    const updateParticles = (dt: number): void => {
      const seconds = dt / 1000;
      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const p = particles[i]!;
        p.life -= dt;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        p.x += p.vx * seconds;
        p.y += p.vy * seconds;
        p.vy += 120 * seconds;
      }
    };

    /* ---------------- 流程 ---------------- */

    const spawnFruit = (): boolean => {
      const next = findFreeCell(snake);
      if (!next) return false;
      fruit = next;
      return true;
    };

    const finish = (cause: "wall" | "self" | "full"): void => {
      if (ended) return;
      ended = true;
      playing = false;
      queue = [];
      ctx.audio.end();
      ctx.hud.set("length", snake.length);
      ctx.end({
        score,
        title: cause === "full" ? "满屏了" : "撞到了",
        kicker: cause === "full" ? "CLEAR" : "GAME OVER",
        stats: [
          { label: "最长长度", value: maxLength },
          { label: "吃到果实", value: eaten },
        ],
      });
    };

    const advance = (): void => {
      const turn = queue.shift();
      if (turn) dir = turn;

      const result = stepSnake(snake, dir, fruit);
      if (result.dead) {
        finish(result.cause === "self" ? "self" : "wall");
        return;
      }

      snake = result.snake;
      if (!result.ate) return;

      score += FRUIT_SCORE;
      eaten += 1;
      if (snake.length > maxLength) maxLength = snake.length;

      const nextTick = tickMsFor(eaten);
      const faster = nextTick < tickMs;
      tickMs = nextTick;

      addBurst(fruit);
      refreshHud();
      flash = 0.7;

      if (faster) {
        ctx.toast.show("速度提升");
        ctx.audio.tier();
      } else {
        ctx.audio.coin();
      }

      if (!spawnFruit()) finish("full");
    };

    /* ---------------- 绘制 ---------------- */

    const render = (): void => {
      const c = ctx.ctx;
      if (board) {
        c.drawImage(board, 0, 0);
      } else {
        rect(c, 0, 0, W, W, P.night);
      }

      const head = snake[0];
      if (!head) return;

      // 果实：判定在格点上，画面只做 1px 浮动
      drawApple(c, PAD + fruit.x * CELL, PAD + fruit.y * CELL, clock / 1000);

      for (const p of particles) {
        c.globalAlpha = clamp(p.life / p.max, 0, 1);
        rect(c, p.x, p.y, 1, 1, p.color);
      }
      c.globalAlpha = 1;

      // 插值：t 是「走向下一格」的进度，判定仍按格点
      const t = playing ? clamp(acc / tickMs, 0, 1) : 0;
      const pending = queue[0] ?? dir;
      const ahead = nextHead(head, pending);
      const growing = playing && sameCell(ahead, fruit);

      for (let i = snake.length - 1; i >= 1; i -= 1) {
        const from = snake[i]!;
        const to = snake[i - 1]!;
        // 下一格就吃到果实时，身体先不收缩：蛇从头部“长”出去
        const follow = growing ? 0 : t;
        const x = PAD + (from.x + (to.x - from.x) * follow) * CELL;
        const y = PAD + (from.y + (to.y - from.y) * follow) * CELL;
        drawSnakeSegment(c, x, y, i === snake.length - 1 ? "tail" : "body", i);
      }

      const hx = PAD + (head.x + (ahead.x - head.x) * t) * CELL;
      const hy = PAD + (head.y + (ahead.y - head.y) * t) * CELL;
      const tongue = playing && Math.floor(clock / 240) % 3 === 0;
      drawSnakeHead(c, hx, hy, pending, tongue);

      if (flash > 0) {
        c.globalAlpha = Math.min(0.12, flash * 0.16);
        rect(c, 0, 0, W, W, P.cream);
        c.globalAlpha = 1;
      }
    };

    /* ---------------- 输入 ---------------- */

    ctx.input.keys.onPress((action) => {
      const next = DIR_ACTIONS[action];
      if (next) enqueue(next);
    });

    ctx.input.swipe.onSwipe((info) => {
      enqueue(info.direction);
    });

    buildBoard();
    reset();

    return {
      start(): void {
        ctx.audio.unlock();
        reset();
        playing = true;
        ctx.audio.ui();
      },

      update(dt: number): void {
        clock += dt;
        updateParticles(dt);
        if (flash > 0) flash = Math.max(0, flash - dt / 260);

        if (!playing) return;

        acc += dt;
        let steps = 0;
        while (playing && acc >= tickMs && steps < 4) {
          acc -= tickMs;
          steps += 1;
          advance();
        }
        if (!playing) acc = 0;
      },

      render,

      pause(): void {
        queue = [];
      },
    };
  },
});

export default game;
