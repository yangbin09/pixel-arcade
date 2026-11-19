import {
  P,
  clamp,
  defineGame,
  type GameContext,
  type GameInstance,
} from "@arcade/core";

import {
  CELL,
  cellAt,
  cellX,
  cellY,
  drawBanner,
  drawCorners,
  drawDisc,
  drawHint,
  drawLastMove,
  drawRoundPips,
  paintBackdrop,
} from "./art";
import { meta } from "./meta";
import {
  AI_COLOR,
  CELLS,
  PLAYER_COLOR,
  ROUNDS,
  SIZE,
  aiPick,
  applyMove,
  countDiscs,
  cursorStep,
  firstLegalCursor,
  flipsFor,
  initialBoard,
  isGameOver,
  isLegal,
  legalMoves,
  opponentOf,
  scoreRound,
  type Board,
  type Color,
} from "./logic";

type Mode = "ready" | "playing" | "over";

/** AI 思考节奏：落子后稍等一会儿再下，手感不至于像瞬间秒回。 */
const AI_DELAY_MS = 420;
/** 小局之间的定格时长：先看清算子，再换盘。 */
const ROUND_PAUSE_MS = 1500;
/** 提示高亮时长（规格：1.5 秒）。 */
const HINT_MS = 1500;

/** HUD 数字按栏位宽度夹住，避免超位数把布局撑开。 */
const clampHud = (value: number, digits: number): number =>
  clamp(Math.round(value), 0, Math.pow(10, digits) - 1);

/** 小局结果：2 赢 / 1 平 / 0 输。 */
const outcomeOf = (mine: number, theirs: number): number =>
  mine > theirs ? 2 : mine === theirs ? 1 : 0;

const outcomeLabel = (outcome: number): string =>
  outcome === 2 ? "WIN" : outcome === 1 ? "DRAW" : "LOSE";

const outcomeColor = (outcome: number): string =>
  outcome === 2 ? P.mint : outcome === 1 ? P.gold : P.red;

const game = defineGame({
  meta,
  create(ctx: GameContext): GameInstance {
    let board: Board = initialBoard();
    let mode: Mode = "ready";
    let ended = false;

    /** 第几局（1 起，共 3 局）。 */
    let round = 1;
    /** 当前轮到谁。 */
    let turn: Color = PLAYER_COLOR;
    /** 三局累计总分（可能是负数，HUD 显示时夹住）。 */
    let totalScore = 0;
    /** 三局累计子数差：我方 - 对手。 */
    let discDiff = 0;
    /** 每局结果：-1 未下 / 0 输 / 1 平 / 2 赢。 */
    let outcomes: number[] = [-1, -1, -1];
    /** 本局刚结算的分数，用于中场的横幅。 */
    let lastRoundPoints = 0;

    let cursor = firstLegalCursor(board, PLAYER_COLOR);
    let usingKeys = false;
    let hoverIndex = -1;
    let lastMove = -1;

    /** 提示高亮剩余时间。 */
    let hintTimer = 0;
    /** AI 思考剩余时间。 */
    let aiTimer = 0;
    /** 小局间隙的定格时间，> 0 时输入全部锁住。 */
    let roundTimer = 0;
    /** 秒表，只用于呼吸动画。 */
    let clock = 0;

    /* ---------------- HUD ---------------- */

    const syncHud = (bump = false): void => {
      const { black, white } = countDiscs(board);
      ctx.hud.set("score", clampHud(totalScore, 5));
      ctx.hud.set("discs", clampHud(black, 2));
      ctx.hud.set("ai", clampHud(white, 2));
      if (bump) ctx.hud.flash("score", "is-bump");
    };

    /* ---------------- 流程 ---------------- */

    /** 发一个新小局：清盘、黑先手、光标摆到第一个合法手。 */
    const dealRound = (next: number): void => {
      round = next;
      board = initialBoard();
      turn = PLAYER_COLOR;
      cursor = firstLegalCursor(board, PLAYER_COLOR);
      hoverIndex = -1;
      usingKeys = false;
      lastMove = -1;
      hintTimer = 0;
      aiTimer = 0;
      roundTimer = 0;
      syncHud();
      ctx.toast.show(`第 ${round} 局开始`, { duration: 800 });
      ctx.announce(`第 ${round} 局，你执黑先行。`);
      ctx.audio.go();
    };

    const reset = (): void => {
      mode = "ready";
      ended = false;
      totalScore = 0;
      discDiff = 0;
      lastRoundPoints = 0;
      outcomes = [-1, -1, -1];
      clock = 0;
      hintTimer = 0;
      aiTimer = 0;
      roundTimer = 0;
      hoverIndex = -1;
      usingKeys = false;
      round = 1;
      turn = PLAYER_COLOR;
      board = initialBoard();
      cursor = firstLegalCursor(board, PLAYER_COLOR);
      lastMove = -1;
      syncHud();
      ctx.hud.urgent(false);
      ctx.timer.hide();
    };

    /** 终局：三局打完，交给壳层结算（最高分由壳层写）。 */
    const finish = (): void => {
      if (ended) return;
      ended = true;
      mode = "over";
      roundTimer = 0;
      aiTimer = 0;
      hintTimer = 0;
      hoverIndex = -1;
      ctx.timer.hide();
      ctx.hud.urgent(false);
      syncHud();

      const wins = outcomes.filter((value) => value === 2).length;
      const draws = outcomes.filter((value) => value === 1).length;
      const losses = outcomes.filter((value) => value === 0).length;

      const title =
        wins > losses ? "赢下三局对抗" : wins === losses ? "握手言和" : "惜败给对手";

      if (wins > losses) ctx.audio.win();
      else if (wins === losses) ctx.audio.ui();
      else ctx.audio.lose();

      render();
      ctx.end({
        // 总分可能是负数（连输且子数差为负），这里和下壳层的口径保持一致按 0 兜底：
        // 结算面板是 4 位补零，负号会被 padStart 挤成「0-90」；壳层 setBest 也按 0 起算。
        score: clampHud(totalScore, 5),
        title,
        kicker: "GAME SET",
        stats: [
          { label: "胜局", value: `${wins} 胜 ${draws} 平 ${losses} 负` },
          { label: "总子数差", value: discDiff > 0 ? `+${discDiff}` : String(discDiff) },
        ],
      });
    };

    /** 本小局结束：算分、记结果、定格，之后再换盘或结算。 */
    const endRound = (): void => {
      if (ended || mode !== "playing") return;
      const { black, white } = countDiscs(board);
      const points = scoreRound(black, white);
      lastRoundPoints = points;
      totalScore += points;
      discDiff += black - white;
      outcomes[round - 1] = outcomeOf(black, white);

      roundTimer = ROUND_PAUSE_MS;
      aiTimer = 0;
      hintTimer = 0;
      hoverIndex = -1;
      syncHud(true);
      ctx.hud.flash("discs", "is-bump");

      const outcome = outcomes[round - 1] as number;
      if (outcome === 2) ctx.audio.win();
      else if (outcome === 1) ctx.audio.ui();
      else ctx.audio.lose();
      ctx.announce(
        `第 ${round} 局结束，${outcomeLabel(outcome)}，本局 ${points} 分，总分 ${totalScore}。`,
      );
      render();
    };

    /**
     * 交棒：判终局 → 判弃手 → 给 AI 排队。
     *
     * `isGameOver` 保证双方都无合法手，所以弃手最多发生一次就会撞上终局，
     * 不会出现互相弃手的死循环。
     */
    const switchTurn = (next: Color): void => {
      turn = next;

      if (isGameOver(board)) {
        endRound();
        return;
      }

      if (legalMoves(board, turn).length === 0) {
        const passing = turn;
        turn = opponentOf(turn);
        ctx.toast.show(
          passing === PLAYER_COLOR ? "你无子可下，自动弃手" : "对手无子可下，弃手",
          { duration: 1000 },
        );
        ctx.audio.miss();
        if (isGameOver(board)) {
          endRound();
          return;
        }
      }

      // 只在轮到 AI 时留思考时间；轮到我方必须清掉旧计时，免得锁住输入。
      aiTimer = turn === AI_COLOR ? AI_DELAY_MS : 0;

      // 轮到我方时，如果光标停在非法位置就挪到第一个合法手，键盘操作不用先找路。
      if (turn === PLAYER_COLOR && !isLegal(board, cursor, PLAYER_COLOR)) {
        cursor = firstLegalCursor(board, PLAYER_COLOR);
      }
    };

    /** 落子：只有合法手才真正生效，非法手最多唤出提示。 */
    const placeAt = (index: number): void => {
      if (mode !== "playing" || ended || ctx.isPaused()) return;
      if (roundTimer > 0 || turn !== PLAYER_COLOR || aiTimer > 0) return;
      if (index < 0 || index >= CELLS) return;

      if (!isLegal(board, index, PLAYER_COLOR)) {
        // 点在非法位置：当作「请求提示」，不消耗回合。
        showHint();
        return;
      }
      const flips = flipsFor(board, index, PLAYER_COLOR).length;
      board = applyMove(board, index, PLAYER_COLOR);
      lastMove = index;
      cursor = index;
      hintTimer = 0;
      hoverIndex = -1;
      syncHud(true);
      if (flips >= 4) ctx.audio.coin();
      else if (flips >= 1) ctx.audio.pop();
      else ctx.audio.blip();

      switchTurn(AI_COLOR);
    };

    /** AI 一步：永远从合法手里挑，没有就弃手。 */
    const aiMove = (): void => {
      if (mode !== "playing" || ended || roundTimer > 0) return;
      if (turn !== AI_COLOR) return;

      const index = aiPick(board, AI_COLOR);
      if (index < 0) {
        switchTurn(PLAYER_COLOR);
        return;
      }

      const flips = flipsFor(board, index, AI_COLOR).length;
      board = applyMove(board, index, AI_COLOR);
      lastMove = index;
      cursor = firstLegalCursor(board, PLAYER_COLOR);
      syncHud();
      if (flips >= 4) ctx.audio.blip();
      else ctx.audio.tick(1);

      switchTurn(PLAYER_COLOR);
    };

    const showHint = (): void => {
      if (mode !== "playing" || ended) return;
      if (turn !== PLAYER_COLOR || roundTimer > 0) return;
      const moves = legalMoves(board, PLAYER_COLOR);
      hintTimer = HINT_MS;
      ctx.audio.slide();
      ctx.toast.show(moves.length > 0 ? `可落子 ${moves.length} 处` : "没有可落子的位置", {
        duration: 900,
      });
    };

    /* ---------------- 绘制 ---------------- */

    const render = (): void => {
      const c = ctx.ctx;
      const playing = mode === "playing" && !ended;
      const playerTurn = turn === PLAYER_COLOR;

      // 外框色就是回合指示：我方金、对手红；结算时退回暗线。
      paintBackdrop(c, playing ? (playerTurn ? P.gold : P.red) : P.line);
      drawRoundPips(c, outcomes, round, clock);

      for (let index = 0; index < CELLS; index += 1) {
        const disc = board[index];
        if (disc !== 0) {
          drawDisc(c, cellX(index % SIZE), cellY(Math.floor(index / SIZE)), CELL, disc);
        }
      }

      if (lastMove >= 0) {
        drawLastMove(c, cellX(lastMove % SIZE), cellY(Math.floor(lastMove / SIZE)));
      }

      // 提示：把当前所有合法手点亮 1.5 秒。
      if (playing && hintTimer > 0 && playerTurn && roundTimer <= 0) {
        for (const index of legalMoves(board, PLAYER_COLOR)) {
          drawHint(c, cellX(index % SIZE), cellY(Math.floor(index / SIZE)), CELL, clock);
        }
      }

      if (playing && playerTurn && roundTimer <= 0) {
        if (usingKeys) {
          drawCorners(c, cellX(cursor % SIZE), cellY(Math.floor(cursor / SIZE)), CELL, P.gold);
        } else if (hoverIndex >= 0) {
          drawCorners(c, cellX(hoverIndex % SIZE), cellY(Math.floor(hoverIndex / SIZE)), CELL, P.lav);
        }
      }

      // 中场定格：把本局结果压在棋盘上。
      if (playing && roundTimer > 0) {
        const outcome = outcomes[round - 1] ?? -1;
        const sign = lastRoundPoints > 0 ? `+${lastRoundPoints}` : String(lastRoundPoints);
        drawBanner(c, `ROUND ${round}`, `${outcomeLabel(outcome)} ${sign}`, outcomeColor(outcome));
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
        hoverIndex = -1;
        showHint();
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
        ctx.announce("黑白棋开始，你执黑先行。");
      },

      update(dt: number): void {
        if (mode !== "playing" || ended) return;
        clock += dt / 1000;
        if (hintTimer > 0) hintTimer = Math.max(0, hintTimer - dt);

        // 小局间隙：定格结束后换盘或结算。
        if (roundTimer > 0) {
          roundTimer -= dt;
          if (roundTimer > 0) return;
          roundTimer = 0;
          if (round >= ROUNDS) finish();
          else dealRound(round + 1);
          return;
        }

        if (turn !== AI_COLOR) return;
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
