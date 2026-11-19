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

import {
  HUB_CX,
  HUB_CY,
  PAD_BOTTOM,
  PAD_MARGIN_X,
  PAD_SIZE,
  PAD_TOP,
  VIEW_W,
  drawHub,
  drawPad,
  drawStatus,
  padAt,
  paintBackdrop,
  quadOf,
  type PadState,
} from "./art";
import { meta } from "./meta";
import {
  TONE_HZ,
  advanceRound,
  beginInput,
  createState,
  isColor,
  pauseForRound,
  playbackSpeedForRound,
  press,
  replayRound,
  type SimonColor,
  type SimonState,
} from "./logic";

/** HUD 数字按栏位宽度夹住，避免 5 位数把布局撑开。 */
const clampHud = (value: number, digits: number): number =>
  clamp(Math.round(value), 0, Math.pow(10, digits) - 1);

const BOARD_LEFT = PAD_MARGIN_X;
const BOARD_RIGHT = PAD_MARGIN_X + PAD_SIZE * 2 + 6;

/**
 * 逻辑坐标 → 颜色。
 * 先精确命中键面；落在十字缝里就按中心线就近归到最靠近的那块，
 * 这样手指按在缝上也有反应，不会「点空」。
 */
const colorAt = (x: number, y: number): SimonColor | null => {
  const exact = padAt(x, y);
  if (exact) return exact;
  if (x < BOARD_LEFT || x >= BOARD_RIGHT || y < PAD_TOP || y >= PAD_BOTTOM) return null;

  const dx = x - HUB_CX;
  const dy = y - HUB_CY;
  if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "down" : "up";
};

const game = defineGame({
  meta,
  create(ctx: GameContext): GameInstance {
    let state: SimonState = createState();
    let best = 0;
    let ended = false;
    /** 是否以「通关」收尾（轮次打满），结算牌子用。 */
    let endedPerfect = false;
    /** 是否已经开过局：准备界面显示 READY，开局后才进入回放。 */
    let armed = false;

    /** 回放游标：当前亮到序列的哪一步（-1 表示还没开始）。 */
    let playIndex = -1;
    /** 当前这一拍是「亮」还是「步间暗」；暗的时候按键不着色。 */
    let playLit = false;
    let playTimer = 0;
    /** 画面上正在亮的颜色（回放和玩家按键共用）。 */
    let activeColor: SimonColor | null = null;
    /** 玩家按键的残影结束时刻（毫秒），保证短按也能看见一下。 */
    let flashUntil = 0;
    /** 按错的那一块；结算画面上要单独染成告警红。 */
    let failedColor: SimonColor | null = null;
    /** 鼠标悬停的键；触屏不记。 */
    let hoverColor: SimonColor | null = null;
    let clock = 0;

    /* ---------------- HUD ---------------- */

    const syncHud = (bump = false): void => {
      ctx.hud.set("round", clampHud(state.round, 2));
      ctx.hud.set("score", clampHud(state.score, 5));
      ctx.hud.set("best", clampHud(Math.max(best, state.score), 5));
      if (bump) {
        ctx.hud.flash("score", "is-bump");
        ctx.hud.flash("round", "is-bump");
      }
    };

    /* ---------------- 音效 ---------------- */

    /** 四个音高：回放和玩家按键都走这里，听感一一对应。 */
    const playTone = (color: SimonColor, soft = false): void => {
      const stepMs = playbackSpeedForRound(state.round);
      const duration = Math.max(0.05, Math.min(0.2, (stepMs / 1000) * 0.85));
      ctx.audio.tone(TONE_HZ[color], duration, "square", soft ? 0.055 : 0.09);
    };

    /* ---------------- 回放 ---------------- */

    /** 从第一步重新回放本回合序列。 */
    const startPlayback = (): void => {
      playIndex = 0;
      playLit = true;
      playTimer = playbackSpeedForRound(state.round);
      activeColor = state.sequence[0] ?? null;
      if (activeColor) playTone(activeColor);
    };

    /** 回放播完：把控制权交给玩家。 */
    const endPlayback = (): void => {
      playIndex = -1;
      playLit = false;
      playTimer = 0;
      activeColor = null;
      state = beginInput(state);
      // 读屏播报节制使用：只有第 1 轮提示一次「轮到你了」。
      if (state.round === 1) ctx.announce("按回去。");
    };

    /**
     * 推进回放时钟。
     * dt 已被壳层夹在 50ms，亮/暗时长都在 120ms 以上，
     * 所以这里用有上限的循环就足够稳，且不会因为某一帧卡顿跳过整拍。
     */
    const stepPlayback = (dt: number): void => {
      playTimer -= dt;
      let guard = 0;
      while (playTimer <= 0 && guard < 8) {
        guard += 1;
        if (playLit) {
          playLit = false;
          activeColor = null;
          playTimer += pauseForRound(state.round);
          continue;
        }
        playIndex += 1;
        if (playIndex >= state.sequence.length) {
          endPlayback();
          return;
        }
        playLit = true;
        activeColor = state.sequence[playIndex] ?? null;
        if (activeColor) playTone(activeColor);
        playTimer += playbackSpeedForRound(state.round);
      }
    };

    /* ---------------- 流程 ---------------- */

    const reset = (): void => {
      state = createState();
      best = ctx.store.best(meta.id, "high") ?? 0;
      ended = false;
      endedPerfect = false;
      armed = false;
      clock = 0;
      hoverColor = null;
      flashUntil = 0;
      failedColor = null;
      playIndex = -1;
      playLit = false;
      playTimer = 0;
      activeColor = null;
      syncHud();
      ctx.hud.urgent(false);
      ctx.timer.hide();
    };

    /** 结算只走这里一次；高分由壳层按 scoreMode 写入。 */
    const finish = (cleared: boolean, reason: string): void => {
      if (ended) return;
      ended = true;
      endedPerfect = cleared;
      state = { ...state, phase: "over" };
      activeColor = null;
      playLit = false;
      ctx.timer.hide();
      ctx.hud.urgent(false);

      if (cleared) ctx.audio.win();
      else ctx.audio.lose();

      // 结算面板背后停在按错（或收尾）的那一帧。
      render();

      ctx.end({
        score: state.score,
        title: cleared ? "记忆满格" : reason,
        kicker: cleared ? "PERFECT" : "MISS",
        stats: [
          { label: "最长序列", value: state.longest },
          { label: "轮次", value: cleared ? state.round : Math.max(0, state.round - 1) },
        ],
      });
    };

    /** 一整轮复现正确：加分、进入下一轮、重新回放。 */
    const clearRound = (): void => {
      const cleared = state.round;
      ctx.audio.coin();
      ctx.toast.show(`第 ${cleared} 轮通过`, { duration: 700 });

      // HUD 的轮次只有两位；上到 99 就当作「记忆满格」收尾，不再硬撑。
      if (cleared >= 99) {
        syncHud(true);
        finish(true, "记忆满格");
        return;
      }

      state = advanceRound(state);
      startPlayback();
      syncHud(true);
    };

    /** 按下一种颜色：回放阶段直接被规则层拦掉。 */
    const handleColor = (color: SimonColor): void => {
      if (ended || !armed || ctx.isPaused()) return;

      const outcome = press(state, color);
      if (outcome.result === "ignored") return;

      state = outcome.state;
      activeColor = color;
      flashUntil = clock + 130;
      playTone(color, true);
      hoverColor = null;

      if (outcome.result === "wrong") {
        ctx.audio.miss();
        ctx.hud.flash("round", "is-broken");
        failedColor = color;
        finish(false, "按错了");
        return;
      }

      if (outcome.result === "correct") clearRound();
    };

    /** 重听本回合（确认键 / Z）：只在等待复现时有效。 */
    const handleReplay = (): void => {
      if (ended || !armed || ctx.isPaused()) return;
      if (state.phase !== "awaiting-input") return;
      state = replayRound(state);
      hoverColor = null;
      flashUntil = 0;
      ctx.audio.blip();
      startPlayback();
      ctx.announce("重听这一轮。");
    };

    /* ---------------- 绘制 ---------------- */

    const statusOf = (): { label: string; progress: string; color: string } => {
      if (!armed) return { label: "READY", progress: "0/0", color: P.cream };
      if (state.phase === "over") {
        return { label: "OVER", progress: "0/0", color: P.red };
      }
      if (state.phase === "playing-back") {
        const total = state.sequence.length;
        const shown = Math.min(total, Math.max(1, playIndex + 1));
        return { label: "WATCH", progress: `${shown}/${total}`, color: P.gold };
      }
      return {
        label: "REPEAT",
        progress: `${state.inputs.length}/${state.sequence.length}`,
        color: P.mint,
      };
    };

    const render = (): void => {
      const c = ctx.ctx;
      paintBackdrop(c);

      const showing =
        activeColor && (playLit || clock < flashUntil) ? activeColor : null;
      // 按错的那一下：被按的键整块转成告警红，其余保持原样。
      const failed = ended && !endedPerfect ? failedColor : null;

      for (const color of ["up", "right", "down", "left"] as const) {
        const quad = quadOf(color);
        const state: PadState =
          failed === color ? "fail" : showing === color ? "lit" : "idle";
        drawPad(c, quad.x, quad.y, PAD_SIZE, color, state);
      }

      drawHub(c, state.round, showing);

      // 鼠标悬停：给键面补一圈奶白括线（触屏没有悬停，自然不会画）。
      if (hoverColor && showing !== hoverColor && !ended) {
        const quad = quadOf(hoverColor);
        strokeRect(c, quad.x - 1, quad.y - 1, PAD_SIZE + 2, PAD_SIZE + 2, P.cream);
      }

      const status = statusOf();
      drawStatus(c, status.label, status.progress, status.color);

      // 结束那一帧：中间压一块暗色牌子写结果（像素字字符集内）。
      if (state.phase === "over") {
        const label = endedPerfect ? "PERFECT" : "MISS";
        const size = 2;
        const width = measurePixelText(label, size);
        const plateW = width + 12;
        const plateH = 20;
        const plateX = Math.round((VIEW_W - plateW) / 2);
        const plateY = HUB_CY - Math.floor(plateH / 2);
        rect(c, plateX, plateY, plateW, plateH, P.void);
        strokeRect(c, plateX, plateY, plateW, plateH, endedPerfect ? P.gold : P.red);
        drawPixelText(
          c,
          label,
          Math.round((VIEW_W - width) / 2),
          plateY + 6,
          size,
          endedPerfect ? P.gold : P.red,
          null,
        );
      }
    };

    /* ---------------- 输入 ---------------- */

    ctx.input.pointer.on("down", (info) => {
      ctx.audio.unlock();
      if (ended || !armed) return;
      if (info.source.pointerType === "mouse" && info.source.button !== 0) return;

      let color = colorAt(info.x, info.y);
      if (!color) return;

      hoverColor = info.source.pointerType === "touch" ? null : color;
      handleColor(color);
    });

    ctx.input.pointer.on("move", (info) => {
      if (info.source.pointerType === "touch") return;
      hoverColor = ended ? null : colorAt(info.x, info.y);
    });

    ctx.input.pointer.on("leave", () => {
      hoverColor = null;
    });

    ctx.input.pointer.on("cancel", () => {
      hoverColor = null;
    });

    ctx.input.keys.onPress((action) => {
      if (ended || !armed || ctx.isPaused()) return;

      // 回放期间全部输入无效：规则层 press 也会再挡一次。
      if (state.phase === "playing-back") return;

      if (isColor(action)) {
        handleColor(action);
        return;
      }
      if (action === "primary" || action === "action") handleReplay();
    });

    reset();

    return {
      start(): void {
        ctx.audio.unlock();
        ctx.audio.ui();
        reset();
        armed = true;
        ctx.timer.hide();
        startPlayback();
        ctx.announce("记住亮灯顺序。");
      },

      update(dt: number): void {
        if (ended || !armed) return;
        clock += dt;

        if (state.phase === "playing-back") {
          stepPlayback(dt);
          return;
        }

        // 玩家按下的残影到点就收掉。
        if (activeColor && clock >= flashUntil) activeColor = null;
      },

      render,

      pause(): void {
        hoverColor = null;
      },

      resume(): void {
        hoverColor = null;
      },

      destroy(): void {
        ended = true;
        hoverColor = null;
        activeColor = null;
      },
    };
  },
});

export default game;
