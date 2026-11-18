import {
  P,
  clamp,
  defineGame,
  drawPixelText,
  measurePixelText,
  pick,
  rand,
  randInt,
  rect,
  sparkle,
  type GameContext,
  type GameInstance,
} from "@arcade/core";

import { drawBlock, laneBase, laneLight, paintTrack } from "./art";
import { meta } from "./meta";
import {
  BLOCK_H,
  BLOCK_W,
  H,
  HIT_Y,
  LANES,
  LANE_W,
  MAX_BLOCKS,
  SPAWN_Y,
  blockBottom,
  blockX,
  isHittable,
  isMissed,
  lowestHittable,
  lowestHittableAny,
  multiplierFor,
  pointsFor,
  speedForLevel,
  speedLevelFor,
  spawnIntervalFor,
  type Block,
} from "./logic";

type Mode = "ready" | "playing" | "over";

/** 连击越高，HUD 上的数字越亮。 */
const MULT_COLORS = [P.cream, P.mint, P.amber, P.orange, P.gold];

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  star: boolean;
}

interface Popup {
  text: string;
  x: number;
  y: number;
  born: number;
  life: number;
  color: string;
}

/** 命中后原地留一帧白影，配合粒子做「闪白」。 */
interface Ghost {
  lane: number;
  y: number;
  born: number;
}

/** 准备面板背后的静止画面：三块方块停在半空，最低一块已经亮白边。 */
const PREVIEW: ReadonlyArray<{ lane: number; y: number }> = [
  { lane: 0, y: 92 },
  { lane: 2, y: 148 },
  { lane: 3, y: 210 },
];

const game = defineGame({
  meta,
  create(ctx: GameContext): GameInstance {
    const canvasW = LANES * LANE_W;
    let mode: Mode = "ready";
    let clock = 0;
    let score = 0;
    let combo = 0;
    let maxCombo = 0;
    let hits = 0;
    let spawnTimer = 0;
    let nextId = 1;
    let lastLane = -1;
    let blocks: Block[] = [];
    let bits: Bit[] = [];
    let popups: Popup[] = [];
    let ghosts: Ghost[] = [];
    let flash = 0;

    /* ---------------- HUD ---------------- */

    const syncHud = (bump: boolean): void => {
      const mult = multiplierFor(combo);
      ctx.hud.set("score", score);
      ctx.hud.set("combo", combo);
      ctx.hud.setSuffix("combo", `×${mult}`, mult >= 5 ? "is-max" : mult >= 3 ? "is-hot" : "");
      ctx.hud.setColor("combo", MULT_COLORS[mult - 1]!);
      ctx.hud.set("speed", speedLevelFor(hits));
      if (bump) {
        ctx.hud.flash("score", "is-bump");
        ctx.hud.flash("combo", "is-bump");
      }
    };

    /* ---------------- 流程 ---------------- */

    const resetRun = (): void => {
      mode = "ready";
      clock = 0;
      score = 0;
      combo = 0;
      maxCombo = 0;
      hits = 0;
      spawnTimer = 0;
      nextId = 1;
      lastLane = -1;
      blocks = [];
      bits = [];
      popups = [];
      ghosts = [];
      flash = 0;

      ctx.hud.set("score", 0);
      ctx.hud.set("combo", 0);
      ctx.hud.setSuffix("combo", "×1");
      ctx.hud.setColor("combo", P.mint);
      ctx.hud.set("speed", 1);
      ctx.hud.urgent(false);
      ctx.timer.hide();
    };

    const finish = (reason: "empty" | "floor"): void => {
      if (mode !== "playing") return;
      mode = "over";
      flash = 0;
      ctx.audio.miss();
      ctx.end({
        score,
        title: reason === "empty" ? "踩空了" : "方块落地",
        kicker: "GAME OVER",
        stats: [
          { label: "最高连击", value: maxCombo },
          { label: "命中块数", value: hits },
        ],
      });
    };

    /* ---------------- 方块 ---------------- */

    /** 选一条不拥挤的轨道：避开判定区附近的轨道，也尽量不连续同轨。 */
    const laneForSpawn = (): number => {
      const candidates: number[] = [];
      for (let lane = 0; lane < LANES; lane += 1) {
        let crowded = false;
        for (const block of blocks) {
          if (block.lane === lane && blockBottom(block) >= HIT_Y - 30) {
            crowded = true;
            break;
          }
        }
        if (!crowded) candidates.push(lane);
      }

      let pool = candidates.length > 0 ? candidates : [0, 1, 2, 3];
      if (pool.length > 1) {
        const fresh = pool.filter((lane) => lane !== lastLane);
        if (fresh.length > 0) pool = fresh;
      }
      return pool[Math.floor(Math.random() * pool.length)]!;
    };

    const spawnBlock = (): void => {
      if (blocks.length >= MAX_BLOCKS) return;
      const lane = laneForSpawn();
      lastLane = lane;
      blocks.push({ id: nextId, lane, y: SPAWN_Y });
      nextId += 1;
    };

    /* ---------------- 命中反馈 ---------------- */

    const addBurst = (block: Block): void => {
      const cx = blockX(block.lane) + BLOCK_W / 2;
      const cy = block.y + BLOCK_H / 2;
      for (let i = 0; i < 12; i += 1) {
        const life = rand(240, 460);
        bits.push({
          x: cx + rand(-9, 9),
          y: cy + rand(-6, 6),
          vx: rand(-80, 80),
          vy: rand(-150, -35),
          life,
          max: life,
          color: pick([laneBase(block.lane), laneLight(block.lane), P.white]),
          size: randInt(1, 2),
          star: Math.random() < 0.25,
        });
      }
      if (bits.length > 72) bits.splice(0, bits.length - 72);
    };

    const addPopup = (text: string, x: number, y: number, color: string): void => {
      popups.push({ text, x, y, born: clock, life: 620, color });
      if (popups.length > 8) popups.shift();
    };

    const hitBlock = (block: Block): void => {
      const index = blocks.findIndex((item) => item.id === block.id);
      if (index >= 0) blocks.splice(index, 1);

      hits += 1;
      combo += 1;
      if (combo > maxCombo) maxCombo = combo;

      const mult = multiplierFor(combo);
      const gained = pointsFor(combo);
      score += gained;
      syncHud(true);

      if (hits % 10 === 0) {
        ctx.hud.flash("speed", "is-bump");
        ctx.audio.tier();
        ctx.toast.show(`提速 · 倍率 ×${mult}`, { duration: 800 });
      }

      ctx.audio.hit(combo);
      ghosts.push({ lane: block.lane, y: block.y, born: clock });
      if (ghosts.length > 4) ghosts.shift();
      addBurst(block);
      addPopup(
        `+${gained}`,
        blockX(block.lane) + BLOCK_W / 2,
        Math.max(16, block.y - 6),
        mult >= 4 ? P.gold : P.white,
      );
      flash = 1;
    };

    const tapLane = (lane: number): void => {
      if (mode !== "playing") return;
      const block = lowestHittable(blocks, lane);
      if (!block) {
        finish("empty");
        return;
      }
      hitBlock(block);
    };

    /* ---------------- 输入 ---------------- */

    ctx.input.pointer.on("down", (info) => {
      if (mode !== "playing") return;
      if (info.source.pointerType === "mouse" && info.source.button !== 0) return;
      ctx.audio.unlock();
      const lane = clamp(Math.floor(info.x / LANE_W), 0, LANES - 1);
      tapLane(lane);
    });

    ctx.input.keys.onPress((action) => {
      if (mode !== "playing") return;
      if (action.startsWith("slot")) {
        const lane = Number(action.slice(4)) - 1;
        if (lane >= 0 && lane < LANES) tapLane(lane);
        return;
      }
      // 空格：直接砸最下方的可点方块，方便单手。
      if (action === "action") {
        const block = lowestHittableAny(blocks);
        if (block) tapLane(block.lane);
      }
    });

    /* ---------------- 粒子 / 飘字 ---------------- */

    const updateBits = (dt: number): void => {
      const seconds = dt / 1000;
      for (let i = bits.length - 1; i >= 0; i -= 1) {
        const bit = bits[i]!;
        bit.life -= dt;
        if (bit.life <= 0) {
          bits.splice(i, 1);
          continue;
        }
        bit.x += bit.vx * seconds;
        bit.y += bit.vy * seconds;
        bit.vy += 520 * seconds;
      }
    };

    const updatePopups = (): void => {
      for (let i = popups.length - 1; i >= 0; i -= 1) {
        const popup = popups[i]!;
        if (clock - popup.born > popup.life) popups.splice(i, 1);
      }
      for (let i = ghosts.length - 1; i >= 0; i -= 1) {
        if (clock - ghosts[i]!.born > 110) ghosts.splice(i, 1);
      }
    };

    /* ---------------- 绘制 ---------------- */

    const drawBits = (): void => {
      const c = ctx.ctx;
      for (const bit of bits) {
        c.globalAlpha = clamp(bit.life / bit.max, 0, 1);
        if (bit.star) sparkle(c, bit.x, bit.y, bit.size + 1, bit.color, P.white);
        else rect(c, bit.x, bit.y, bit.size, bit.size, bit.color);
      }
      c.globalAlpha = 1;
    };

    const drawPopups = (): void => {
      const c = ctx.ctx;
      for (const popup of popups) {
        const t = clamp((clock - popup.born) / popup.life, 0, 1);
        if (t >= 1) continue;
        const width = measurePixelText(popup.text, 2);
        const x = clamp(popup.x - width / 2, 2, canvasW - width - 2);
        c.globalAlpha = 1 - t * t;
        drawPixelText(c, popup.text, x, popup.y - Math.round(t * 16), 2, popup.color, P.void);
      }
      c.globalAlpha = 1;
    };

    const render = (): void => {
      const c = ctx.ctx;
      paintTrack(c);

      for (const block of blocks) {
        drawBlock(c, blockX(block.lane), Math.round(block.y), block.lane, isHittable(block));
      }

      for (const ghost of ghosts) {
        const t = clamp((clock - ghost.born) / 110, 0, 1);
        if (t >= 1) continue;
        c.globalAlpha = (1 - t) * 0.85;
        rect(c, blockX(ghost.lane), ghost.y, BLOCK_W, BLOCK_H, P.white);
      }
      c.globalAlpha = 1;

      drawBits();
      drawPopups();

      if (flash > 0) {
        c.globalAlpha = Math.min(0.14, flash * 0.14);
        c.fillStyle = P.white;
        c.fillRect(0, 0, canvasW, H);
        c.globalAlpha = 1;
      }
    };

    /* ---------------- 初始化 ---------------- */

    resetRun();
    blocks = PREVIEW.map((item) => ({ id: nextId++, lane: item.lane, y: item.y }));

    return {
      start(): void {
        ctx.audio.unlock();
        ctx.audio.ui();
        resetRun();
        mode = "playing";
        spawnBlock();
        spawnTimer = spawnIntervalFor(1) * 1000;
      },

      update(dt: number): void {
        if (mode !== "playing") return;
        clock += dt;

        const level = speedLevelFor(hits);
        const speed = speedForLevel(level);
        const seconds = dt / 1000;

        for (const block of blocks) block.y += speed * seconds;

        for (const block of blocks) {
          if (isMissed(block)) {
            finish("floor");
            return;
          }
        }

        spawnTimer -= dt;
        if (spawnTimer <= 0 && blocks.length < MAX_BLOCKS) {
          spawnBlock();
          spawnTimer = spawnIntervalFor(level) * 1000;
        }

        updateBits(dt);
        updatePopups();
        flash = Math.max(0, flash - dt / 180);
      },

      render,
    };
  },
});

export default game;
