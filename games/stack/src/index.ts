import {
  P,
  clamp,
  defineGame,
  drawPixelText,
  measurePixelText,
  rect,
  type GameContext,
  type GameInstance,
} from "@arcade/core";

import {
  drawBlock,
  drawGround,
  drawMovingBlock,
  drawPerfectBurst,
  drawShard,
  paintBackdrop,
  toneForFloor,
} from "./art";
import {
  BASE_TOP,
  BLOCK_H,
  DROP_Y,
  GROUND_Y,
  H,
  START_WIDTH,
  W,
  cameraFor,
  cropOverlap,
  isCollapsed,
  isPerfect,
  railCenterX,
  refundWidth,
  scoreForFloor,
  speedForFloor,
  spawnPhase,
  swingRangeFor,
  swingX,
} from "./logic";
import { meta } from "./meta";

/** 方块左右各留 2px，不贴死画布边缘。 */
const FIELD_PAD = 2;

/** HUD 位数上限：score 5 位、floor / combo 2 位。 */
const MAX_SCORE = 99_999;
const MAX_TWO_DIGIT = 99;

/** 落下动画的速度（px/s）与最短 / 最长时长。 */
const DROP_SPEED = 900;
const DROP_MIN_MS = 70;
const DROP_MAX_MS = 260;

/** 塔塌之后的停顿，让碎片落一会儿再进结算。 */
const SETTLE_MS = 900;

/** 完美飘字的存在时间。 */
const POPUP_LIFE = 620;
/** 完美星芒的存在时间。 */
const BURST_LIFE = 340;

/** 摄像机缓动：每毫秒逼近目标的比例。 */
const CAMERA_EASE = 0.02;

type Mode = "ready" | "playing" | "toppling" | "over";

interface Block {
  x: number;
  w: number;
}

interface Shard {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  /** 已经存活的时间（毫秒）。 */
  life: number;
  /** 总寿命（毫秒）。 */
  max: number;
  color: string;
}

interface Popup {
  /** 空字符串表示这是一次星芒爆点，不画文字。 */
  text: string;
  x: number;
  y: number;
  life: number;
  max: number;
  color: string;
}

interface DropState {
  /** 落点横坐标：按下瞬间冻结，动画期间不再变化。 */
  x: number;
  /** 起始屏幕纵坐标。 */
  from: number;
  /** 目标屏幕纵坐标：按下瞬间冻结。 */
  to: number;
  /** 当前屏幕纵坐标。 */
  y: number;
  /** 已经过的时间（毫秒）。 */
  elapsed: number;
  /** 整段下落时长（毫秒）。 */
  duration: number;
  /** 这一块的宽度：和坐标一起冻结。 */
  w: number;
}

/** HUD 只吃像素字库，数字全部夹到自己的位宽里。 */
const hudNumber = (value: number, max: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(clamp(value, 0, max));
};

/** 把方块横坐标夹在场地内。 */
const clampX = (x: number, w: number): number =>
  Math.round(clamp(x, FIELD_PAD, Math.max(FIELD_PAD, W - FIELD_PAD - w)));

const game = defineGame({
  meta,
  create(ctx: GameContext): GameInstance {
    let mode: Mode = "ready";

    /** 已经落定的塔：下标 0 是底部第一块。 */
    let blocks: Block[] = [];
    /** 正在摆动的那一块的宽度。 */
    let movingW = START_WIDTH;
    /**
     * 摆动的累计相位（弧度）。
     *
     * 不能直接用「秒数 × 角速度」：角速度每层都在涨，
     * 那样方块会在提速的瞬间瞬移。这里逐帧积分相位，
     * 再反解成 swingX 需要的时间参数，位置才连续。
     */
    let swingPhase = 0;

    let drop: DropState | null = null;

    /** 摄像机下移量：只增不减，塔顶永远不会往回掉。 */
    let camera = 0;

    let score = 0;
    let combo = 0;
    let perfects = 0;
    let floors = 0;

    let shards: Shard[] = [];
    let popups: Popup[] = [];

    let shake = 0;
    let settleLeft = 0;
    let ended = false;
    let clock = 0;

    let backdrop: HTMLCanvasElement | null = null;

    /* ---------------- 坐标换算 ---------------- */

    /** 第 index 块的世界顶边（index 0 就是底座）。 */
    const worldTop = (index: number): number => BASE_TOP - index * BLOCK_H;

    /** 第 index 块在屏幕上的顶边。 */
    const screenTop = (index: number): number => worldTop(index) + camera;

    /** 塔顶（最上面那块的世界顶边）。 */
    const stackTop = (): number => worldTop(blocks.length - 1);

    /** 塔顶在屏幕上的位置。 */
    const stackTopScreen = (): number => stackTop() + camera;

    /** 新块落定后，它的屏幕顶边。 */
    const landingTop = (): number => stackTopScreen() - BLOCK_H;

    /** 新块当前摆到的横坐标。 */
    const movingX = (): number => {
      const center = railCenterX(movingW);
      const range = swingRangeFor(movingW);
      return Math.round(center + swingX(swingPhase, 1, range));
    };

    /* ---------------- HUD ---------------- */

    const syncHud = (): void => {
      ctx.hud.set("score", hudNumber(score, MAX_SCORE));
      ctx.hud.set("floor", hudNumber(floors, MAX_TWO_DIGIT));
      ctx.hud.set("combo", hudNumber(combo, MAX_TWO_DIGIT));
      // 连击 ≥ 3 时 HUD 转金，和音效升级同步。
      ctx.hud.setColor("combo", combo >= 3 ? P.gold : P.lav);
    };

    /* ---------------- 静态背景 ---------------- */

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

    /* ---------------- 碎块 / 飘字 ---------------- */

    const addShard = (
      x: number,
      screenY: number,
      w: number,
      h: number,
      vx: number,
      vy: number,
      color: string,
    ): void => {
      if (w <= 0 || h <= 0) return;
      // 存世界坐标：摄像机缓动时碎片跟着塔一起走，不会脱节。
      shards.push({ x, y: screenY - camera, w, h, vx, vy, life: 0, max: 900, color });
      if (shards.length > 24) shards.shift();
    };

    /** 把裁下来的料做成碎块：落在左半边的往左飞，右半边的往右飞。 */
    const spawnCutShards = (
      top: number,
      cuts: readonly { x: number; w: number }[],
      floor: number,
    ): void => {
      const color = toneForFloor(floor).body;
      const limit = ctx.reducedMotion ? Math.min(1, cuts.length) : cuts.length;
      for (let i = 0; i < limit; i += 1) {
        const cut = cuts[i];
        if (!cut) continue;
        const leftSide = cut.x + cut.w / 2 <= W / 2;
        addShard(cut.x, top, cut.w, BLOCK_H, leftSide ? -34 : 34, -22, color);
      }
    };

    const addPopup = (
      text: string,
      x: number,
      screenY: number,
      color: string,
      max = POPUP_LIFE,
    ): void => {
      popups.push({ text, x, y: screenY - camera, life: max, max, color });
      if (popups.length > 4) popups.shift();
    };

    /* ---------------- 流程 ---------------- */

    const resetRun = (): void => {
      mode = "ready";
      blocks = [{ x: Math.round((W - START_WIDTH) / 2), w: START_WIDTH }];
      movingW = START_WIDTH;
      swingPhase = spawnPhase();
      drop = null;
      camera = 0;
      score = 0;
      combo = 0;
      perfects = 0;
      floors = 0;
      shards = [];
      popups = [];
      shake = 0;
      settleLeft = 0;
      ended = false;
      clock = 0;
      ctx.hud.urgent(false);
      ctx.timer.hide();
      syncHud();
    };

    const finish = (): void => {
      if (ended) return;
      ended = true;
      mode = "over";
      syncHud();
      render();

      ctx.end({
        score,
        title: "塔塌了",
        kicker: "TOPPLED",
        stats: [
          { label: "最高层", value: floors },
          { label: "完美次数", value: perfects },
        ],
      });
    };

    /** 整块落空：塔塌，抖一下、撒一把碎片，停一拍再结算。 */
    const topple = (landedX: number, landedW: number): void => {
      mode = "toppling";
      settleLeft = SETTLE_MS;
      combo = 0;
      syncHud();
      ctx.hud.flash("floor", "is-broken");

      const top = Math.round(landingTop());
      const color = toneForFloor(blocks.length).body;
      const total = ctx.reducedMotion ? 3 : 6;
      const pieceW = Math.max(2, Math.round(landedW / total));
      for (let i = 0; i < total; i += 1) {
        addShard(
          clampX(landedX + i * pieceW, pieceW),
          top + (i % 2) * 2,
          pieceW,
          4,
          (i % 2 === 0 ? -1 : 1) * (18 + i * 7),
          -40 - i * 6,
          color,
        );
      }

      if (!ctx.reducedMotion) shake = 4;
      ctx.audio.miss();
      ctx.announce(`塔塌了，一共堆到 ${floors} 层。`);
    };

    /** 一次落定：裁剪 → 完美判定 → 计分 → 碎块 → 生成下一块。 */
    const land = (): void => {
      const current = drop;
      drop = null;
      if (!current) return;

      const prev = blocks[blocks.length - 1];
      if (!prev) return;

      const crop = cropOverlap(prev.x, prev.w, current.x, current.w);
      const top = Math.round(current.to);

      // 重叠舍入到 0 宽度也算落空，否则会留下一块画不出来的残片。
      if (isCollapsed(crop) || Math.round(crop.w) <= 0) {
        topple(current.x, current.w);
        return;
      }

      const nextFloor = blocks.length;

      if (isPerfect(crop.offset)) {
        // 完美：保留右边缘，在这块基础上回赠 4px 宽度（最多回到 96）。
        const nextW = refundWidth(crop.w);
        const rightEdge = crop.x + crop.w;
        const nextX = clampX(rightEdge - nextW, nextW);
        blocks.push({ x: nextX, w: nextW });
        movingW = nextW;

        combo += 1;
        perfects += 1;
        score += scoreForFloor(nextFloor, combo);

        // 完美也切掉了几像素，照样让它落下去，视觉上才连贯。
        spawnCutShards(top, crop.cuts, nextFloor);

        addPopup(combo >= 2 ? `PERFECT X${combo}` : "PERFECT", nextX + nextW / 2, top - 5, P.gold);
        addPopup("", nextX + nextW / 2, top + 6, P.gold, BURST_LIFE);

        ctx.hud.flash("combo", "is-bump");
        ctx.hud.flash("score", "is-bump");
        if (combo >= 3) ctx.audio.gold(combo);
        else ctx.audio.coin();
        if (!ctx.reducedMotion) shake = Math.max(shake, 0.8);
      } else {
        const nextW = Math.round(crop.w);
        const nextX = clampX(crop.x, nextW);
        blocks.push({ x: nextX, w: nextW });
        movingW = nextW;

        combo = 0;
        score += scoreForFloor(nextFloor, 0);

        spawnCutShards(top, crop.cuts, nextFloor);
        ctx.hud.flash("score", "is-bump");
        ctx.audio.pop();
        if (!ctx.reducedMotion) shake = Math.max(shake, 1.2);
      }

      floors = nextFloor;
      // 新块从摆动的随机相位出生，不能接着上一块的相位，否则会连吃完美。
      swingPhase = spawnPhase();
      syncHud();
    };

    /* ---------------- 落下 ---------------- */

    const pressDrop = (): void => {
      if (mode !== "playing" || ctx.isPaused() || drop) return;

      const from = DROP_Y;
      const to = landingTop();
      const distance = Math.max(0, to - from);
      const duration = clamp((distance / DROP_SPEED) * 1000, DROP_MIN_MS, DROP_MAX_MS);

      drop = { x: movingX(), from, to, y: from, w: movingW, elapsed: 0, duration };
      ctx.audio.blip();
    };

    /* ---------------- 绘制 ---------------- */

    /** 塔顶那条落点提示：能完美就亮薄荷，否则金色标出会保住的区间。 */
    const drawLandingHint = (x: number, width: number): void => {
      const prev = blocks[blocks.length - 1];
      if (!prev) return;

      const left = Math.max(prev.x, x);
      const right = Math.min(prev.x + prev.w, x + width);
      const y = Math.round(stackTopScreen()) - 1;

      if (right <= left) {
        rect(ctx.ctx, Math.round(x), y, Math.max(1, Math.round(width)), 1, P.red);
        return;
      }

      const offset = x + width / 2 - (prev.x + prev.w / 2);
      rect(ctx.ctx, left, y, right - left, 1, isPerfect(offset) ? P.mint : P.gold);
    };

    const render = (): void => {
      const c = ctx.ctx;

      if (backdrop) c.drawImage(backdrop, 0, 0);
      else paintBackdrop(c, W, H);

      let sx = 0;
      let sy = 0;
      if (!ctx.reducedMotion && shake > 0.2) {
        sx = Math.round(Math.sin(clock * 0.09) * shake);
        sy = Math.round(Math.cos(clock * 0.13) * shake * 0.6);
      }

      c.save();
      c.translate(sx, sy);

      // 地面跟着摄像机往下走，塔越高地面越沉。
      drawGround(c, Math.round(GROUND_Y + camera), W, H);

      for (let i = 0; i < blocks.length; i += 1) {
        const block = blocks[i];
        if (!block) continue;
        const top = Math.round(screenTop(i));
        if (top + BLOCK_H < 0 || top > H) continue;
        drawBlock(c, block.x, top, block.w, toneForFloor(i));
      }

      if (mode === "playing") {
        const live = drop ? drop.x : movingX();
        drawLandingHint(live, drop ? drop.w : movingW);
      }

      if (drop) {
        const tone = toneForFloor(blocks.length);
        drawBlock(c, drop.x, Math.round(drop.y), drop.w, tone);
        c.globalAlpha = 0.4;
        rect(c, drop.x, Math.round(drop.y) - 3, drop.w, 2, tone.light);
        c.globalAlpha = 1;
      } else if (mode === "playing" || mode === "ready") {
        // ready 阶段也画出待落的块，准备面板背后的画面才不空。
        drawMovingBlock(c, movingX(), DROP_Y, movingW, toneForFloor(blocks.length), stackTopScreen());
      }

      for (const shard of shards) {
        const k = shard.life / shard.max;
        drawShard(c, shard.x, shard.y + camera, shard.w, shard.h, 1 - k * 0.85, shard.color);
      }

      for (const popup of popups) {
        const k = clamp(popup.life / popup.max, 0, 1);
        const sy = popup.y + camera;
        if (!popup.text) {
          drawPerfectBurst(c, popup.x, sy, k);
          continue;
        }
        const width = measurePixelText(popup.text, 1);
        c.globalAlpha = k;
        drawPixelText(
          c,
          popup.text,
          clamp(popup.x - width / 2, 4, W - width - 4),
          Math.round(sy - (1 - k) * 8),
          1,
          popup.color,
          P.void,
        );
        c.globalAlpha = 1;
      }

      c.restore();
    };

    /* ---------------- 输入 ---------------- */

    ctx.input.pointer.on("down", (info) => {
      ctx.audio.unlock();
      if (info.source.pointerType === "mouse" && info.source.button !== 0) return;
      pressDrop();
    });

    ctx.input.keys.onPress((action) => {
      if (action !== "action" && action !== "primary") return;
      pressDrop();
    });

    buildBackdrop();
    resetRun();

    return {
      start(): void {
        ctx.audio.unlock();
        ctx.audio.ui();
        resetRun();
        mode = "playing";
        syncHud();
        ctx.announce("像素堆塔，对准了再落下。");
      },

      update(dt: number): void {
        clock += dt;
        shake = Math.max(0, shake - dt * 0.014);

        // 碎块与飘字在塔塌之后也要继续动。
        for (let i = shards.length - 1; i >= 0; i -= 1) {
          const shard = shards[i];
          if (!shard) continue;
          shard.life += dt;
          shard.x += (shard.vx * dt) / 1000;
          shard.y += (shard.vy * dt) / 1000;
          shard.vy += 640 * (dt / 1000);
          if (shard.life >= shard.max || shard.y > H + 24) shards.splice(i, 1);
        }
        for (let i = popups.length - 1; i >= 0; i -= 1) {
          const popup = popups[i];
          if (!popup) continue;
          popup.life -= dt;
          if (popup.life <= 0) popups.splice(i, 1);
        }

        if (mode === "toppling") {
          settleLeft -= dt;
          if (settleLeft <= 0) finish();
          return;
        }

        if (mode !== "playing") return;

        // 摄像机只朝目标逼近，目标本身单调不减，所以永远不会倒退。
        // 下落途中不动摄像机：落点纵坐标在按下瞬间就冻结了，
        // 这时候再挪镜头会让方块落到塔顶上方或插进去。
        if (!drop) {
          const target = cameraFor(stackTop());
          if (target > camera) {
            camera += (target - camera) * Math.min(1, dt * CAMERA_EASE);
            if (target - camera < 0.4) camera = target;
          }
        }

        if (drop) {
          drop.elapsed += dt;
          const k = clamp(drop.elapsed / drop.duration, 0, 1);
          // 加速下坠，落得更实。
          drop.y = drop.from + (drop.to - drop.from) * k * k;
          if (k >= 1) land();
          return;
        }

        swingPhase += (dt / 1000) * speedForFloor(blocks.length);
        // 相位只关心 sin，收进一圈避免长时间累积掉精度。
        if (swingPhase > Math.PI * 2) swingPhase -= Math.PI * 2;
      },

      render,

      pause(): void {
        // 壳层停掉 update，摆动与下落自然冻结。
      },

      resume(): void {
        // 所有动画都只吃 dt，不需要补偿时间。
      },

      destroy(): void {
        shards = [];
        popups = [];
        drop = null;
      },
    };
  },
});

export default game;
