import {
  P,
  approach,
  clamp,
  defineGame,
  type GameContext,
  type GameInstance,
} from "@arcade/core";

import {
  RAIL_Y,
  drawAimGuide,
  drawBurst,
  drawCabinet,
  drawCable,
  drawChanceMeter,
  drawClaw,
  drawFloatText,
  drawPrizeArt,
  drawShelfPrize,
  drawTrolley,
} from "./art";
import { meta } from "./meta";
import {
  CHANCE_OFFSET_MAX,
  CLAW_MAX,
  CLAW_MIN,
  CLAW_Y,
  CLOSE_MS,
  HOOK_BOTTOM,
  HOOK_DESCENT_SPEED,
  HOOK_LIFT_SPEED,
  HOOK_TOP,
  SHELF_Y,
  SETTLE_MS,
  TRIES,
  W,
  clampClaw,
  grabChance,
  layoutPrizes,
  offsetToPrize,
  pickPrize,
  resolveGrab,
  scoreForPrize,
  stepClaw,
  type Prize,
} from "./logic";

type Phase = "ready" | "aim" | "drop" | "close" | "lift" | "settle" | "over";

interface Burst {
  x: number;
  y: number;
  life: number;
  tone: string;
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  life: number;
  color: string;
}

interface DragAnchor {
  startX: number;
  startClaw: number;
  moved: number;
}

/** 指针按下后移动超过这个距离就不算「轻点」，不会触发下钩。 */
const TAP_SLOP = 8;

/** 三档奖品的特效色调。 */
const PRIZE_TONE: Record<Prize["tier"], string> = {
  small: P.mint,
  mid: P.lav,
  big: P.gold,
};

/** HUD 数值只能吃像素字库，按各栏位宽夹住。 */
const hudNumber = (value: number, max: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(clamp(value, 0, max));
};

const game = defineGame({
  meta,
  create(ctx: GameContext): GameInstance {
    /* ---------------- 本局状态 ---------------- */

    let phase: Phase = "ready";
    /** 本轮累计时间（秒），用于灯珠闪烁和待机动画。 */
    let clock = 0;

    let clawX = (CLAW_MIN + CLAW_MAX) / 2;
    let clawY = CLAW_Y;
    /** 爪指张开程度：1 全开，0 闭合。 */
    let open = 1;

    let prizes: Prize[] = layoutPrizes(W);
    let carrying: Prize | null = null;
    /** 这一钩盯上的奖品（下钩瞬间锁定）。 */
    let aimed: Prize | null = null;

    let tries = TRIES;
    let score = 0;
    let streak = 0;
    let bestStreak = 0;
    let caught = 0;

    /** 下钩时锁定的概率（含连抓加成），用于结算面板与命中判定。 */
    let lastChance = 0;
    let lastBase = 0;
    let grabbed = false;

    let closeLeft = 0;
    let settleLeft = 0;
    let shake = 0;
    /**
     * 本局是否已经真正开跑：壳层的 3-2-1 倒计时期间只 render 不 update，
     * 用它挡掉倒计时里误触的按键 / 触摸，免得白掉一次机会。
     */
    let live = false;

    const bursts: Burst[] = [];
    const floats: FloatText[] = [];

    let drag: DragAnchor | null = null;

    /* ---------------- HUD ---------------- */

    const syncHud = (): void => {
      ctx.hud.set("score", hudNumber(score, 99999));
      ctx.hud.set("tries", hudNumber(tries, 99));
      ctx.hud.set("streak", hudNumber(streak, 99));
    };

    /* ---------------- 特效 ---------------- */

    const addBurst = (x: number, y: number, tone: string): void => {
      if (ctx.reducedMotion) return;
      bursts.push({ x, y, life: 1, tone });
      if (bursts.length > 6) bursts.shift();
    };

    const addFloat = (x: number, y: number, text: string, color: string): void => {
      floats.push({ x, y, text, life: 1, color });
      if (floats.length > 4) floats.shift();
    };

    const updateEffects = (dt: number): void => {
      for (let i = bursts.length - 1; i >= 0; i -= 1) {
        const burst = bursts[i];
        if (!burst) continue;
        burst.life -= dt / 430;
        if (burst.life <= 0) bursts.splice(i, 1);
      }
      for (let i = floats.length - 1; i >= 0; i -= 1) {
        const item = floats[i];
        if (!item) continue;
        item.life -= dt / 900;
        if (item.life <= 0) floats.splice(i, 1);
      }
    };

    /* ---------------- 流程 ---------------- */

    const restock = (): void => {
      prizes = layoutPrizes(W);
      ctx.audio.spawn(true);
      ctx.toast.show("补货完成", { duration: 800 });
    };

    const reset = (): void => {
      phase = "ready";
      clock = 0;
      clawX = (CLAW_MIN + CLAW_MAX) / 2;
      clawY = CLAW_Y;
      open = 1;
      prizes = layoutPrizes(W);
      carrying = null;
      aimed = null;
      tries = TRIES;
      score = 0;
      streak = 0;
      bestStreak = 0;
      caught = 0;
      lastChance = 0;
      lastBase = 0;
      grabbed = false;
      closeLeft = 0;
      settleLeft = 0;
      shake = 0;
      drag = null;
      bursts.length = 0;
      floats.length = 0;
      live = false;
      syncHud();
      ctx.hud.urgent(false);
      ctx.timer.hide();
    };

    /** 结算只走这里一次；最高分由壳层按 high 模式写入。 */
    const finish = (): void => {
      if (phase === "over") return;
      phase = "over";
      drag = null;
      syncHud();

      if (caught > 0) ctx.audio.win();
      else ctx.audio.lose();
      ctx.announce(`机会用完，抓中 ${caught} 次，共 ${score} 分`);

      render();

      ctx.end({
        score,
        title: caught > 0 ? "机会用完了" : "空手而归",
        kicker: caught > 0 ? "SOLD OUT" : "EMPTY",
        stats: [
          { label: "抓中次数", value: `${caught}/${TRIES}` },
          { label: "最高连抓", value: bestStreak },
        ],
      });
    };

    /* ---------------- 下钩 ---------------- */

    const dropHook = (): void => {
      if (!live || phase !== "aim" || ctx.isPaused()) return;
      if (tries <= 0) return;

      tries -= 1;
      syncHud();
      ctx.hud.flash("tries", "is-broken");

      aimed = pickPrize(prizes, clawX);
      const offset = aimed ? offsetToPrize(aimed, clawX) : CHANCE_OFFSET_MAX;
      lastBase = grabChance(offset, 0);
      lastChance = aimed ? grabChance(offset, streak) : 0;
      grabbed = aimed !== null && resolveGrab(offset, streak, Math.random());

      phase = "drop";
      clawY = HOOK_TOP;
      open = 1;
      drag = null;
      ctx.audio.blip();
      ctx.audio.slide();
    };

    /** 钩子触底：开始闭合。 */
    const reachBottom = (): void => {
      phase = "close";
      closeLeft = CLOSE_MS;
      ctx.audio.pop();
    };

    /** 闭合结束：决定这一钩抓没抓中，把奖品从台面挪到爪子里。 */
    const finishClose = (): void => {
      open = 0;
      if (grabbed && aimed) {
        carrying = aimed;
        prizes = prizes.filter((prize) => prize.id !== aimed?.id);
        aimed = null;
        ctx.audio.coin();
        addBurst(clawX, clawY + 8, P.gold);
      } else if (aimed) {
        addBurst(aimed.x + aimed.w / 2, SHELF_Y - 4, P.lineHi);
      }
      phase = "lift";
    };

    /** 回到顶部：计分 / 清零连抓。 */
    const reachTop = (): void => {
      clawY = HOOK_TOP;
      phase = "settle";
      settleLeft = SETTLE_MS;
      open = carrying ? 0 : 1;

      if (carrying) {
        const gained = scoreForPrize(carrying.tier, streak);
        score += gained;
        caught += 1;
        streak += 1;
        bestStreak = Math.max(bestStreak, streak);
        syncHud();
        ctx.hud.flash("score", "is-bump");
        if (streak > 1) ctx.hud.flash("streak", "is-bump");
        addBurst(clawX, clawY + 6, PRIZE_TONE[carrying.tier]);
        addFloat(clawX, clawY + 2, `+${gained}`, P.gold);
        if (!ctx.reducedMotion) shake = carrying.tier === "big" ? 2.5 : 1.2;
        if (carrying.tier === "big") {
          ctx.audio.gold(streak);
          ctx.toast.show("抓到大的了！", { duration: 900 });
        } else {
          ctx.audio.hit(streak);
        }
        carrying = null;
      } else {
        streak = 0;
        syncHud();
        ctx.hud.flash("streak", "is-broken");
        addFloat(clawX, clawY + 8, "MISS", P.red);
        ctx.audio.miss();
      }
    };

    /** 两次下钩之间的停顿走完：补货或结算。 */
    const afterSettle = (): void => {
      if (tries <= 0) {
        finish();
        return;
      }
      if (prizes.length === 0) restock();
      phase = "aim";
      aimed = null;
    };

    /* ---------------- 运行 ---------------- */

    /**
     * 键盘 / 手柄瞄准：按规格恒速 90px/s，按住持续移动。
     * 精确对位靠轻点（一帧约 1.4px）或直接拖拽。
     */
    const updateAim = (dt: number): void => {
      const right = ctx.input.keys.isDown("right");
      const left = ctx.input.keys.isDown("left");
      const dir = (right ? 1 : 0) - (left ? 1 : 0);
      if (dir === 0) return;
      clawX = stepClaw(clawX, dir, 1, dt);
    };

    /* ---------------- 绘制 ---------------- */

    const render = (): void => {
      const c = ctx.ctx;

      let sx = 0;
      let sy = 0;
      if (shake > 0.2 && !ctx.reducedMotion) {
        sx = Math.round(Math.sin(clock * 90) * shake);
        sy = Math.round(Math.cos(clock * 70) * shake * 0.6);
      }

      c.save();
      c.translate(sx, sy);

      drawCabinet(c, clock);

      // 瞄准中的概率（面板 + 括线都用它）
      let hotPrize: Prize | null = null;
      let panelChance = lastChance;
      let panelBonus = Math.max(0, lastChance - lastBase);

      if (phase === "aim" || phase === "ready") {
        hotPrize = pickPrize(prizes, clawX);
        const offset = hotPrize ? offsetToPrize(hotPrize, clawX) : CHANCE_OFFSET_MAX;
        const base = grabChance(offset, 0);
        panelChance = hotPrize ? grabChance(offset, streak) : 0;
        panelBonus = Math.max(0, panelChance - base);
      } else if (phase === "drop" || phase === "close") {
        hotPrize = aimed;
      }

      for (const prize of prizes) {
        drawShelfPrize(c, prize, clock, hotPrize !== null && hotPrize.id === prize.id);
      }

      if (phase === "aim" || phase === "ready") {
        drawAimGuide(c, clawX, panelChance, true);
      }

      // 爪子：小车 + 吊索 + 爪身
      drawTrolley(c, clawX);
      drawCable(c, clawX, RAIL_Y + 4, clawY - 4);

      if (carrying) {
        // 奖品被爪指夹住：底边略低于爪尖，和台面上的位置几乎无缝衔接；
        // 到顶后奖品跟着升到灯箱下方，再看它被收走。
        const bottom = Math.min(clawY + 13, SHELF_Y);
        drawPrizeArt(
          c,
          clawX - carrying.w / 2,
          bottom - carrying.h,
          carrying.w,
          carrying.h,
          carrying.tier,
          clock,
        );
      }
      drawClaw(c, clawX, clawY, open);

      for (const burst of bursts) drawBurst(c, burst.x, burst.y, burst.life, burst.tone);
      for (const item of floats) drawFloatText(c, item.x, item.y, item.text, item.life, item.color);

      c.restore();

      // 底部面板：概率条 + 加成
      drawChanceMeter(c, panelChance, panelBonus);
    };

    /* ---------------- 输入 ---------------- */

    ctx.input.pointer.on("down", (info) => {
      ctx.audio.unlock();
      if (!live || phase !== "aim" || ctx.isPaused()) return;
      const type = info.source.pointerType || "mouse";
      if (type === "mouse" && info.source.button !== 0) return;

      // 鼠标点哪走哪；触摸按相对位移拖动，手指不挡住爪子。
      if (type === "mouse") clawX = clampClaw(info.x);
      drag = { startX: info.x, startClaw: clawX, moved: 0 };
    });

    ctx.input.pointer.on("move", (info) => {
      if (!live || phase !== "aim" || ctx.isPaused()) return;
      const type = info.source.pointerType || "mouse";

      if (!drag) {
        // 鼠标悬停也能瞄准，端着鼠标就能玩。
        if (type === "mouse") clawX = clampClaw(info.x);
        return;
      }
      const delta = info.x - drag.startX;
      drag.moved = Math.max(drag.moved, Math.abs(delta));
      clawX = clampClaw(drag.startClaw + delta);
    });

    const endDrag = (): void => {
      const held = drag;
      drag = null;
      if (!held) return;
      if (phase !== "aim" || ctx.isPaused()) return;
      // 轻点（几乎没拖动）＝ 下钩；拖动只是瞄准。
      if (held.moved <= TAP_SLOP) dropHook();
    };

    ctx.input.pointer.on("up", endDrag);
    ctx.input.pointer.on("cancel", () => {
      drag = null;
    });
    ctx.input.pointer.on("leave", () => {
      drag = null;
    });

    ctx.input.keys.onPress((action) => {
      if (!live || ctx.isPaused()) return;
      if (action === "action" || action === "primary") {
        dropHook();
      }
    });

    reset();

    return {
      start(): void {
        ctx.audio.unlock();
        ctx.audio.ui();
        reset();
        phase = "aim";
        syncHud();
        ctx.announce("像素抓娃娃，十次机会，对准了再下钩。");
      },

      update(dt: number): void {
        // 壳层的 3-2-1 倒计时只 render 不 update，第一帧 update 才是真正开跑。
        if (!live) live = true;
        if (phase === "over" || phase === "ready") return;
        clock += dt / 1000;
        updateEffects(dt);
        if (shake > 0) shake = Math.max(0, shake - dt * 0.012);

        if (phase === "aim") {
          updateAim(dt);
          return;
        }

        if (phase === "drop") {
          clawY = Math.min(HOOK_BOTTOM, clawY + (HOOK_DESCENT_SPEED * dt) / 1000);
          if (clawY >= HOOK_BOTTOM) reachBottom();
          return;
        }

        if (phase === "close") {
          closeLeft -= dt;
          open = clamp(closeLeft / CLOSE_MS, 0, 1);
          if (closeLeft <= 0) finishClose();
          return;
        }

        if (phase === "lift") {
          clawY = Math.max(HOOK_TOP, clawY - (HOOK_LIFT_SPEED * dt) / 1000);
          open = carrying ? 0 : approach(open, 1, dt / 140);
          if (clawY <= HOOK_TOP) reachTop();
          return;
        }

        if (phase === "settle") {
          settleLeft -= dt;
          if (settleLeft <= 0) afterSettle();
        }
      },

      render,

      pause(): void {
        drag = null;
      },

      resume(): void {
        drag = null;
      },

      destroy(): void {
        drag = null;
        bursts.length = 0;
        floats.length = 0;
      },
    };
  },
});

export default game;
