import {
  P,
  clamp,
  defineGame,
  type GameContext,
  type GameInstance,
} from "@arcade/core";

import {
  cellAt,
  drawBanner,
  drawCorners,
  drawLastMove,
  drawRoundPips,
  drawStone,
  drawWinLine,
  paintBackdrop,
} from "./art";
import { meta } from "./meta";
import {
  AI,
  CELLS,
  PLAYER,
  ROUNDS,
  START_CURSOR,
  cellCenter,
  checkWin,
  cursorStep,
  emptyBoard,
  indexToCell,
  isFull,
  matchDecided,
  roundPoints,
  winningLine,
  bestMove,
} from "./logic";

type Mode = "ready" | "playing" | "over";

/** AI 思考节奏：落子后稍等一会儿再下，手感不至于像瞬间秒回。 */
const AI_DELAY_MS = 360;
/** 小局之间的定格时长：先看清这条五连，再换盘。 */
const ROUND_PAUSE_MS = 1500;

/** 小局结果：2 赢 / 1 平 / 0 输。 */
const WIN = 2;
const DRAW = 1;
const LOSE = 0;

/** HUD 数字按栏位宽度夹住，避免超位数把布局撑开。 */
const clampHud = (value: number, digits: number): number =>
  clamp(Math.round(value), 0, Math.pow(10, digits) - 1);

const outcomeLabel = (outcome: number): string =>
  outcome === WIN ? "WIN" : outcome === DRAW ? "DRAW" : "LOSE";

const outcomeColor = (outcome: number): string =>
  outcome === WIN ? P.mint : outcome === DRAW ? P.gold : P.red;

const game = defineGame({
  meta,
  create(ctx: GameContext): GameInstance {
    let board = emptyBoard();
    let mode: Mode = "ready";
    let ended = false;

    /** 第几局（1 起，最多 3 局）。 */
    let round = 1;
    /** 当前轮到谁：PLAYER 或 AI。 */
    let turn: number = PLAYER;
    /** 三局战绩。 */
    let wins = 0;
    let losses = 0;
    let draws = 0;
    /** 每局结果：-1 未下 / 0 输 / 1 平 / 2 赢。 */
    let outcomes: number[] = [-1, -1, -1];
    /** 本局刚结束的胜负（用于中场横幅）。 */
    let roundOutcome = -1;
    /** 本局落子历史（下标顺序），悔棋用。 */
    let history: number[] = [];
    /** 整场总落子数，结算统计用。 */
    let totalMoves = 0;

    let cursor = START_CURSOR;
    let usingKeys = false;
    let hoverIndex = -1;
    let lastMove = -1;
    /** 获胜的那条五连，用于在中场定格时描线。 */
    let winLine: number[] = [];

    /** AI 思考剩余时间；> 0 时玩家的输入被锁住。 */
    let aiTimer = 0;
    /** 小局间隙的定格时间；> 0 时输入全部锁住。 */
    let roundTimer = 0;
    /** 秒表，只用于呼吸动画。 */
    let clock = 0;
    /** AI 的随机源种子：每局重开换一个，`logic.ts` 自己不碰 Math.random。 */
    let aiSeed = 0x9e3779b9;

    /** 可复现随机源（LCG）：给 `bestMove` 注入平手扰动与失误扰动。 */
    const nextRandom = (): number => {
      aiSeed = (aiSeed * 1664525 + 1013904223) >>> 0;
      return aiSeed / 4294967296;
    };

    /* ---------------- HUD ---------------- */

    const syncHud = (bump = false): void => {
      ctx.hud.set("score", clampHud(roundPoints(wins, losses), 5));
      ctx.hud.set("win", clampHud(wins, 1));
      ctx.hud.set("lose", clampHud(losses, 1));
      if (bump) ctx.hud.flash("score", "is-bump");
    };

    /* ---------------- 流程 ---------------- */

    /** 发一个新小局：清盘、玩家先行、光标摆回天元。 */
    const dealRound = (next: number): void => {
      round = next;
      board = emptyBoard();
      turn = PLAYER;
      cursor = START_CURSOR;
      hoverIndex = -1;
      usingKeys = false;
      lastMove = -1;
      winLine = [];
      history = [];
      roundOutcome = -1;
      aiTimer = 0;
      roundTimer = 0;
      // 每小局换一份随机序列：AI 的开局走法不会盘盘一模一样。
      aiSeed = (0x9e3779b9 + next * 2654435761) >>> 0;
      syncHud();
      ctx.toast.show(`第 ${round} 局开始`, { duration: 800 });
      ctx.audio.go();
    };

    const reset = (): void => {
      mode = "ready";
      ended = false;
      wins = 0;
      losses = 0;
      draws = 0;
      totalMoves = 0;
      outcomes = [-1, -1, -1];
      round = 1;
      roundOutcome = -1;
      clock = 0;
      aiTimer = 0;
      roundTimer = 0;
      board = emptyBoard();
      turn = PLAYER;
      cursor = START_CURSOR;
      hoverIndex = -1;
      usingKeys = false;
      lastMove = -1;
      winLine = [];
      history = [];
      syncHud();
      ctx.hud.urgent(false);
      ctx.timer.hide();
    };

    /** 终局：三局打完或一方先到两胜，交给壳层结算（最高分由壳层写）。 */
    const finish = (): void => {
      if (ended) return;
      ended = true;
      mode = "over";
      roundTimer = 0;
      aiTimer = 0;
      hoverIndex = -1;
      ctx.timer.hide();
      ctx.hud.urgent(false);
      syncHud();

      const title = wins > losses ? "赢下这场对局" : wins === losses ? "握手言和" : "这次输了";
      if (wins > losses) ctx.audio.win();
      else if (wins === losses) ctx.audio.ui();
      else ctx.audio.lose();

      render();
      ctx.end({
        score: clampHud(roundPoints(wins, losses), 5),
        title,
        kicker: "GAME SET",
        stats: [
          { label: "战绩", value: `${wins} 胜 ${draws} 平 ${losses} 负` },
          { label: "总落子", value: `${totalMoves} 手` },
        ],
      });
    };

    /** 本小局结束：记账、定格，之后再换盘或结算。 */
    const endRound = (outcome: number): void => {
      if (ended || mode !== "playing") return;
      roundOutcome = outcome;
      outcomes[round - 1] = outcome;
      if (outcome === WIN) wins += 1;
      else if (outcome === LOSE) losses += 1;
      else draws += 1;

      roundTimer = ROUND_PAUSE_MS;
      aiTimer = 0;
      hoverIndex = -1;
      syncHud(true);
      ctx.hud.flash(outcome === WIN ? "win" : "lose", "is-bump");

      if (outcome === WIN) ctx.audio.win();
      else if (outcome === LOSE) ctx.audio.lose();
      else ctx.audio.ui();

      ctx.announce(
        `第 ${round} 局结束，${outcomeLabel(outcome)}。当前 ${wins} 胜 ${draws} 平 ${losses} 负。`,
      );
      render();
    };

    /** 一手落子后统一处理：判胜 → 判满盘 → 交棒。 */
    const settleMove = (index: number, who: number): void => {
      if (checkWin(board, index) === who) {
        winLine = winningLine(board, index);
        endRound(who === PLAYER ? WIN : LOSE);
        return;
      }
      if (isFull(board)) {
        endRound(DRAW);
        return;
      }
      turn = who === PLAYER ? AI : PLAYER;
      // 只在轮到 AI 时留思考时间；轮到我方必须清掉旧计时，免得锁住输入。
      aiTimer = turn === AI ? AI_DELAY_MS : 0;
    };

    /** 玩家落子：只有空点才真正生效，落在已占点最多唤一声提示。 */
    const placeAt = (index: number): void => {
      if (mode !== "playing" || ended || ctx.isPaused()) return;
      if (roundTimer > 0 || turn !== PLAYER || aiTimer > 0) return;
      if (!Number.isInteger(index) || index < 0 || index >= CELLS) return;

      if ((board[index] ?? 0) !== 0) {
        ctx.audio.error();
        return;
      }

      board[index] = PLAYER;
      history.push(index);
      totalMoves += 1;
      lastMove = index;
      cursor = index;
      hoverIndex = -1;
      winLine = [];
      ctx.audio.pop();
      settleMove(index, PLAYER);
      syncHud();
    };

    /** AI 一手：`bestMove` 只会返回空点；万一没有空点就按满盘处理。 */
    const aiMove = (): void => {
      if (mode !== "playing" || ended || roundTimer > 0) return;
      if (turn !== AI) return;

      const index = bestMove(board, AI, nextRandom);
      if (index < 0) {
        endRound(DRAW);
        return;
      }

      board[index] = AI;
      history.push(index);
      totalMoves += 1;
      lastMove = index;
      winLine = [];
      ctx.audio.tick(1);
      settleMove(index, AI);
    };

    /**
     * 悔棋（规格里的 B 键 / X 键）：撤回我方最后一手，连同 AI 的应手一起。
     *
     * 只在轮到我方、没有 AI 计时、没有中场停顿时可用；
     * 已经结算的小局不给悔，避免战绩和盘面打架。
     */
    const undoMove = (): void => {
      if (mode !== "playing" || ended || ctx.isPaused()) return;
      if (roundTimer > 0 || aiTimer > 0 || turn !== PLAYER) return;
      if (history.length === 0) {
        ctx.audio.error();
        ctx.toast.show("还没有落子", { warn: true, duration: 700 });
        return;
      }

      // 末尾可能是 AI 的应手：先撤它，再撤我方那一手。
      const dropLast = (): void => {
        const last = history.pop();
        if (last === undefined) return;
        board[last] = 0;
        totalMoves = Math.max(0, totalMoves - 1);
      };

      if (board[history[history.length - 1] as number] === AI) dropLast();
      if (history.length > 0) dropLast();

      // 关掉 AI 计时，把出手权还给我方，光标落回最后一手旁边。
      aiTimer = 0;
      turn = PLAYER;
      winLine = [];
      lastMove = history.length > 0 ? (history[history.length - 1] as number) : -1;
      cursor = lastMove >= 0 ? lastMove : START_CURSOR;
      hoverIndex = -1;
      usingKeys = true;
      ctx.audio.slide();
      syncHud();
    };

    /* ---------------- 绘制 ---------------- */

    const render = (): void => {
      const c = ctx.ctx;
      const playing = mode === "playing" && !ended;

      // 外框色就是回合指示：轮到我方金、AI 红；结算/定格时退回暗线。
      const accent = !playing
        ? P.line
        : roundTimer > 0
          ? P.line
          : turn === PLAYER
            ? P.gold
            : P.red;
      paintBackdrop(c, accent);
      drawRoundPips(c, outcomes, round, clock);

      for (let index = 0; index < CELLS; index += 1) {
        const who = board[index] ?? 0;
        if (who === 0) continue;
        const cell = indexToCell(index);
        const center = cellCenter(cell.col, cell.row);
        drawStone(c, center.x, center.y, who, 10);
      }

      if (lastMove >= 0 && board[lastMove] !== 0) {
        const cell = indexToCell(lastMove);
        const center = cellCenter(cell.col, cell.row);
        drawLastMove(c, center.x, center.y);
      }

      if (winLine.length >= 2) drawWinLine(c, board, winLine);

      // 光标：只在轮到我方、没有定时器时显示。
      if (playing && turn === PLAYER && aiTimer <= 0 && roundTimer <= 0) {
        const active = usingKeys ? cursor : hoverIndex;
        if (active >= 0) {
          const cell = indexToCell(active);
          const center = cellCenter(cell.col, cell.row);
          drawCorners(
            c,
            center.x - 5,
            center.y - 5,
            10,
            usingKeys ? P.gold : P.lav,
            0,
            3,
          );
        }
      }

      // 中场定格：把小局结果压在棋盘上。
      if (playing && roundTimer > 0) {
        drawBanner(
          c,
          `ROUND ${round}`,
          outcomeLabel(roundOutcome),
          outcomeColor(roundOutcome),
        );
      }
    };

    /* ---------------- 输入 ---------------- */

    const canvasEl = ctx.input.pointer.el;
    const blockMenu = (event: Event): void => {
      event.preventDefault();
    };
    canvasEl.addEventListener("contextmenu", blockMenu);

    ctx.input.pointer.on("down", (info) => {
      ctx.audio.unlock();
      if (mode !== "playing" || ended) return;
      if (info.source.pointerType === "mouse" && info.source.button !== 0) return;

      const index = cellAt(info.x, info.y);
      if (index < 0) return;

      usingKeys = false;
      // 触屏没有悬停，不记住位置，免得手指离开后还留着括线。
      if ((info.source.pointerType || "mouse") !== "touch") hoverIndex = index;
      placeAt(index);
    });

    ctx.input.pointer.on("move", (info) => {
      if (mode !== "playing" || ended) return;
      const type = info.source.pointerType || "mouse";
      if (type === "touch") return;
      hoverIndex = cellAt(info.x, info.y);
    });

    ctx.input.pointer.on("leave", () => {
      hoverIndex = -1;
    });

    ctx.input.pointer.on("cancel", () => {
      hoverIndex = -1;
    });

    ctx.input.keys.onPress((action) => {
      if (mode !== "playing" || ended || ctx.isPaused()) return;

      if (action === "left" || action === "right" || action === "up" || action === "down") {
        usingKeys = true;
        hoverIndex = -1;
        cursor = cursorStep(cursor, action);
        return;
      }

      if (action === "action" || action === "primary") {
        usingKeys = true;
        hoverIndex = -1;
        placeAt(cursor);
        return;
      }

      if (action === "secondary") {
        usingKeys = true;
        undoMove();
      }
    });

    reset();

    return {
      start(): void {
        ctx.audio.unlock();
        ctx.audio.ui();
        reset();
        mode = "playing";
        ctx.timer.hide();
        dealRound(1);
        ctx.announce("五子棋开始，你执黑先行，先连五者胜。三局两胜。");
      },

      update(dt: number): void {
        if (mode !== "playing" || ended) return;
        clock += dt / 1000;

        // 小局间隙：定格结束后换盘或结算。
        if (roundTimer > 0) {
          roundTimer -= dt;
          if (roundTimer > 0) return;
          roundTimer = 0;
          const decided = matchDecided(wins, losses) || round >= ROUNDS;
          if (decided) finish();
          else dealRound(round + 1);
          return;
        }

        if (turn !== AI) return;
        aiTimer -= dt;
        if (aiTimer > 0) return;
        aiTimer = 0;
        aiMove();
      },

      render,

      pause(): void {
        hoverIndex = -1;
      },

      resume(): void {
        hoverIndex = -1;
      },

      destroy(): void {
        ended = true;
        canvasEl.removeEventListener("contextmenu", blockMenu);
      },
    };
  },
});

export default game;
