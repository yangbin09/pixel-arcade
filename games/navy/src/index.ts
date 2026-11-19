import {
  P,
  clamp,
  defineGame,
  rect,
  type GameContext,
  type GameInstance,
} from "@arcade/core";

import {
  CELL,
  RULE_Y,
  BOTTOM_RULE_Y,
  cellX,
  cellY,
  drawBanner,
  drawBoardBase,
  drawBoardLabel,
  drawCenteredText,
  drawCursor,
  drawFleetBars,
  drawHit,
  drawMiss,
  drawOwnHull,
  drawRule,
  drawSunkPips,
  drawWreck,
  enemyCellAt,
  paintWater,
} from "./art";
import { meta } from "./meta";
import {
  CELLS,
  HIT,
  HIT_POINTS,
  MISS,
  SIZE,
  SINK_BONUS,
  TOTAL_SHIP_CELLS,
  UNKNOWN,
  WIPE_BONUS,
  allSunk,
  emptyBoard,
  isSunk,
  noteHit,
  pickShot,
  placeFleet,
  resolveShot,
  stepCursor,
  sunkCount,
  type Ship,
} from "./logic";

type Mode = "ready" | "playing" | "over";
type Turn = "player" | "ai";

/** AI 每炮之间的停顿（毫秒）。玩家先手，AI 慢一点才看得清它在追哪。 */
const AI_SHOT_MS = 380;
/** 命中星芒的持续时间（毫秒）。 */
const FLASH_MS = 260;

const clampHud = (value: number, digits: number): number =>
  clamp(Math.round(value), 0, Math.pow(10, digits) - 1);

const game = defineGame({
  meta,
  create(ctx: GameContext): GameInstance {
    /* ---------------- 本局状态 ---------------- */

    let mode: Mode = "ready";
    let turn: Turn = "player";

    /** 敌方棋盘：玩家打出去的炮。 */
    let enemyBoard: number[] = emptyBoard();
    let enemyShips: Ship[] = placeFleet(Math.random);
    /** 我方棋盘：AI 打过来的炮。 */
    let ownBoard: number[] = emptyBoard();
    let ownShips: Ship[] = placeFleet(Math.random);

    let score = 0;
    let hits = 0;

    /** AI 的追残舰队列：命中点四邻。 */
    let aiStack: number[] = [];
    let aiTimer = 0;

    /** 键盘光标（只落在敌方棋盘上）。 */
    let cursor = 27;
    let usingKeys = false;
    let hoverIndex = -1;

    /** 最近一次命中的格子 + 星芒剩余时间。 */
    let flashSide: "own" | "enemy" | null = null;
    let flashIndex = -1;
    let flashTimer = 0;
    /** 横幅里那行小字（MISS / HIT / SUNK）的剩余时间。 */
    let callout = "";
    let calloutTimer = 0;
    /** 呼吸动画用的秒表。 */
    let clock = 0;

    /* ---------------- HUD ---------------- */

    const syncHud = (bump = false): void => {
      ctx.hud.set("score", clampHud(score, 5));
      ctx.hud.set("hits", clampHud(hits, 2));
      ctx.hud.set("left", clampHud(TOTAL_SHIP_CELLS - hits, 2));
      if (bump) ctx.hud.flash("score", "is-bump");
    };

    /* ---------------- 流程 ---------------- */

    const reset = (): void => {
      mode = "ready";
      turn = "player";
      enemyBoard = emptyBoard();
      enemyShips = placeFleet(Math.random);
      ownBoard = emptyBoard();
      ownShips = placeFleet(Math.random);
      score = 0;
      hits = 0;
      aiStack = [];
      aiTimer = 0;
      cursor = 27;
      usingKeys = false;
      hoverIndex = -1;
      flashSide = null;
      flashIndex = -1;
      flashTimer = 0;
      callout = "";
      calloutTimer = 0;
      clock = 0;
      syncHud();
      ctx.hud.urgent(false);
      ctx.timer.hide();
    };

    /** 结算只走这里一次；最高分由壳层按 high 模式写入。 */
    const finish = (won: boolean): void => {
      if (mode === "over") return;
      mode = "over";
      aiTimer = 0;
      aiStack = [];
      hoverIndex = -1;
      flashTimer = 0;
      calloutTimer = 0;
      syncHud();

      if (won) ctx.audio.win();
      else ctx.audio.lose();

      // 让结算层背后的棋盘停在同一帧（亮出最后那炮）。
      render();

      ctx.end({
        score: clampHud(score, 5),
        title: won ? "全歼敌舰" : "我方舰队覆没",
        kicker: won ? "VICTORY" : "DEFEAT",
        stats: [
          { label: "命中", value: `${hits}/${TOTAL_SHIP_CELLS}` },
          { label: "击沉", value: `${sunkCount(enemyShips)}/${enemyShips.length}` },
        ],
      });
    };

    /** 记一条横幅小字，几百毫秒后自动消失。 */
    const say = (text: string): void => {
      callout = text;
      calloutTimer = 900;
    };

    /** 玩家开炮。命中就再打一次，打空换手。 */
    const playerFire = (index: number): void => {
      if (mode !== "playing" || ctx.isPaused()) return;
      if (turn !== "player") return;

      const shot = resolveShot(enemyBoard, enemyShips, index);
      if (shot.already) return;

      cursor = index;
      hoverIndex = -1;
      flashSide = "enemy";
      flashIndex = index;
      flashTimer = shot.hit ? FLASH_MS : 0;

      if (shot.hit) {
        hits += 1;
        score += HIT_POINTS;
        syncHud(true);

        if (shot.sunk !== null) {
          score += SINK_BONUS;
          syncHud(true);
          say(shot.sunk === 5 ? "SUNK A CARRIER!" : "SUNK!");
          ctx.audio.gold(shot.sunk);
          ctx.hud.flash("left", "is-bump");
        } else {
          say("HIT - FIRE AGAIN");
          ctx.audio.hit(1);
        }

        if (allSunk(enemyShips)) {
          score += WIPE_BONUS;
          syncHud();
          finish(true);
        }
        return; // 命中不换手
      }

      say("MISS - CPU TURN");
      ctx.audio.miss();
      turn = "ai";
      aiTimer = AI_SHOT_MS;
      syncHud();
    };

    /** AI 开一炮。命中继续追，打空交还回合。 */
    const aiFire = (): void => {
      if (mode !== "playing") return;

      const index = pickShot(ownBoard, ownShips, aiStack, Math.random);
      if (index < 0) return;

      const shot = resolveShot(ownBoard, ownShips, index);
      if (shot.already) return;

      flashSide = "own";
      flashIndex = index;
      flashTimer = shot.hit ? FLASH_MS : 0;

      if (shot.hit) {
        noteHit(aiStack, ownBoard, index);
        // 打沉了就把队列清掉：那条线上剩下的格子全是空的。
        if (shot.sunk !== null) aiStack = [];
        say("CPU HIT");
        ctx.audio.blip();

        if (allSunk(ownShips)) {
          say("FLEET LOST");
          finish(false);
        }
        return; // AI 命中继续
      }

      aiStack = aiStack.filter((cell) => ownBoard[cell] === UNKNOWN);
      say("CPU MISSED");
      ctx.audio.tick(1);
      turn = "player";
      aiTimer = 0;
    };

    /** 玩家点「随机」：从没打过的格子里挑一个，等价于随手一炮。 */
    const randomFire = (): void => {
      if (mode !== "playing" || ctx.isPaused()) return;
      if (turn !== "player") return;

      const pool: number[] = [];
      for (let index = 0; index < CELLS; index += 1) {
        if (enemyBoard[index] === UNKNOWN) pool.push(index);
      }
      if (pool.length === 0) return;
      ctx.audio.slide();
      playerFire(pool[Math.floor(Math.random() * pool.length)] as number);
    };

    /* ---------------- 绘制 ---------------- */

    const drawOwnCell = (c: CanvasRenderingContext2D, index: number): void => {
      const x = cellX("own", index % SIZE);
      const y = cellY(Math.floor(index / SIZE));
      const state = ownBoard[index];
      const fresh = flashSide === "own" && flashIndex === index && flashTimer > 0;

      if (state === UNKNOWN) {
        // 自己的舰体一直可见：没挨打就画薄荷绿外壳。
        const ship = ownShips.find((item) => item.cells.includes(index));
        if (ship) drawOwnHull(c, x, y);
        return;
      }

      if (state === HIT) {
        const ship = ownShips.find((item) => item.cells.includes(index));
        if (ship && isSunk(ship)) drawWreck(c, x, y);
        else drawHit(c, x, y, fresh);
        return;
      }

      drawMiss(c, x, y);
    };

    const drawEnemyCell = (c: CanvasRenderingContext2D, index: number): void => {
      const x = cellX("enemy", index % SIZE);
      const y = cellY(Math.floor(index / SIZE));
      const state = enemyBoard[index];
      const fresh = flashSide === "enemy" && flashIndex === index && flashTimer > 0;

      if (state === MISS) {
        drawMiss(c, x, y);
        return;
      }
      if (state !== HIT) return; // 未打：底板已经画过了

      const ship = enemyShips.find((item) => item.cells.includes(index));
      if (ship && isSunk(ship)) drawWreck(c, x, y);
      else drawHit(c, x, y, fresh);
    };

    const render = (): void => {
      const c = ctx.ctx;
      const playing = mode === "playing";

      paintWater(c, clock);

      const playerTurn = playing && turn === "player";
      // 外框就是回合指示：我方金、AI 红。
      drawBoardBase(c, "own", playing ? (playerTurn ? P.gold : P.lineHi) : P.line);
      drawBoardBase(c, "enemy", playing ? (playerTurn ? P.gold : P.lineHi) : P.line);

      for (let index = 0; index < CELLS; index += 1) {
        drawOwnCell(c, index);
        drawEnemyCell(c, index);
      }

      // 键盘 / 鼠标光标：只在轮到我方时出现。
      if (playerTurn && !ctx.isPaused()) {
        if (usingKeys) {
          drawCursor(c, cellX("enemy", cursor % SIZE), cellY(Math.floor(cursor / SIZE)), P.gold);
        } else if (hoverIndex >= 0 && enemyBoard[hoverIndex] === UNKNOWN) {
          drawCursor(
            c,
            cellX("enemy", hoverIndex % SIZE),
            cellY(Math.floor(hoverIndex / SIZE)),
            P.lav,
          );
        }
      }

      drawBoardLabel(c, "own", "YOU", P.mint);
      drawBoardLabel(c, "enemy", "CPU", P.red);
      drawRule(c, RULE_Y);

      // 左边：我的五艘舰还剩多少格；右边：对手沉了几艘（不暴露舰长分布）。
      drawFleetBars(c, "own", ownShips, P.mint);
      drawSunkPips(c, "enemy", enemyShips, P.gold);

      drawRule(c, BOTTOM_RULE_Y);

      // 顶部：回合状态 + 最近一炮的结果。
      if (mode === "over") {
        const won = allSunk(enemyShips);
        drawBanner(c, won ? "VICTORY" : "DEFEAT", won ? "FLEET WIPED" : "YOU WERE SUNK", won ? P.gold : P.red);
      } else if (!playing) {
        drawBanner(c, "NAVY DUEL", "GET READY", P.cream);
      } else if (turn === "ai") {
        drawBanner(c, "CPU TURN", calloutTimer > 0 ? callout : "AIMING...", P.red);
      } else {
        drawBanner(c, "YOUR SHOT", calloutTimer > 0 ? callout : "TAP THE ENEMY GRID", P.gold);
      }

      // 底部提示条：把「命中再打一次」这条规则常驻在画面上。
      const tip =
        !playing
          ? "SHIPS CANNOT TOUCH"
          : turn === "player"
            ? "HIT = FIRE AGAIN"
            : "HOLD ON...";
      drawCenteredText(c, tip, 84, 159, 1, playing ? P.cream : P.lav);

      // 命中星芒的收尾：时间快到时闪一下，提醒「这一炮打实了」。
      if (flashTimer > 0 && flashIndex >= 0) {
        const side = flashSide ?? "enemy";
        const x = cellX(side, flashIndex % SIZE);
        const y = cellY(Math.floor(flashIndex / SIZE));
        rect(c, x + CELL - 1, y, 1, 1, P.white);
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
      if (mode !== "playing" || ctx.isPaused()) return;
      if (info.source.pointerType === "mouse" && info.source.button !== 0) return;

      const index = enemyCellAt(info.x, info.y);
      if (index < 0) return;

      usingKeys = false;
      if ((info.source.pointerType || "mouse") !== "touch") hoverIndex = index;
      playerFire(index);
    });

    ctx.input.pointer.on("move", (info) => {
      if (mode !== "playing") return;
      const type = info.source.pointerType || "mouse";
      if (type === "touch") return;
      hoverIndex = enemyCellAt(info.x, info.y);
    });

    ctx.input.pointer.on("leave", () => {
      hoverIndex = -1;
    });

    ctx.input.pointer.on("cancel", () => {
      hoverIndex = -1;
    });

    ctx.input.keys.onPress((action) => {
      if (mode !== "playing" || ctx.isPaused()) return;

      if (action === "left" || action === "right" || action === "up" || action === "down") {
        usingKeys = true;
        hoverIndex = -1;
        cursor = stepCursor(cursor, action, enemyBoard);
        return;
      }

      if (action === "action" || action === "primary") {
        usingKeys = true;
        playerFire(cursor);
        return;
      }

      if (action === "secondary") {
        usingKeys = true;
        randomFire();
      }
    });

    reset();

    return {
      start(): void {
        ctx.audio.unlock();
        reset();
        mode = "playing";
        turn = "player";
        aiTimer = 0;
        ctx.timer.hide();
        ctx.audio.go();
        ctx.announce("海战棋开始，你先开炮。命中可以再打一次。");
      },

      update(dt: number): void {
        if (mode !== "playing") return;

        clock += dt / 1000;
        if (flashTimer > 0) flashTimer = Math.max(0, flashTimer - dt);
        if (calloutTimer > 0) calloutTimer = Math.max(0, calloutTimer - dt);

        if (ctx.isPaused()) return;
        if (turn !== "ai") {
          aiTimer = 0;
          return;
        }

        aiTimer -= dt;
        if (aiTimer > 0) return;
        aiTimer = AI_SHOT_MS;
        aiFire();
      },

      render,

      pause(): void {
        hoverIndex = -1;
      },

      resume(): void {
        hoverIndex = -1;
      },

      destroy(): void {
        mode = "over";
        canvasEl.removeEventListener("contextmenu", blockMenu);
      },
    };
  },
});

export default game;
