import {
  P,
  clamp,
  defineGame,
  drawPixelText,
  measurePixelText,
  mulberry32,
  rect,
  type GameContext,
  type GameInstance,
} from "@arcade/core";

import {
  drawBeatLamp,
  drawHitBurst,
  drawHitLine,
  drawJudgeText,
  drawLaneBed,
  drawNote,
} from "./art";
import { meta } from "./meta";
import {
  GOOD_MS,
  HIT_Y,
  KEY_LANES,
  LANES,
  SONG_MS,
  accuracy,
  beatIntervalMs,
  bpmAt,
  createChart,
  hitScore,
  judge,
  laneAt,
  laneX,
  nearestNote,
  noteY,
  type JudgeKind,
  type Note,
} from "./logic";

const W = meta.size.w;
const H = meta.size.h;

/** 判定文字基线：压在判定线下方，底部的进度条还留得下。 */
const JUDGE_Y = HIT_Y + 6;
/** 击打反馈圈的存在时长。 */
const BURST_MS = 240;
/** 判定文字弹出的存在时长。 */
const POPUP_MS = 420;
/** 轨道被击亮的存在时长。 */
const LANE_FLASH_MS = 130;

/** 键盘方向动作（含 WASD）→ 轨道：左 / 下 / 上 / 右 依次 0 / 1 / 2 / 3。 */
const KEY_LANE: Record<string, number> = Object.fromEntries(
  KEY_LANES.map((action, lane) => [action, lane]),
);

type Mode = "ready" | "playing" | "over";

const JUDGE_TEXT: Record<JudgeKind, string> = {
  perfect: "PERFECT",
  good: "GOOD",
  miss: "MISS",
};

const JUDGE_COLOR: Record<JudgeKind, string> = {
  perfect: P.gold,
  good: P.mint,
  miss: P.red,
};

interface Burst {
  lane: number;
  until: number;
  color: string;
}

interface Popup {
  text: string;
  color: string;
  lane: number;
  until: number;
}

const game = defineGame({
  meta,
  create(ctx: GameContext): GameInstance {
    let mode: Mode = "ready";
    /** 谱面时钟：**只按帧累加**，暂停/恢复后不会与谱面错位。 */
    let songTime = 0;
    let notes: Note[] = [];
    let judged: boolean[] = [];
    let score = 0;
    let combo = 0;
    let maxCombo = 0;
    let perfect = 0;
    let good = 0;
    let laneFlash = new Array<number>(LANES).fill(0);
    let bursts: Burst[] = [];
    let popups: Popup[] = [];
    let hitGlow = 0;

    /* ---------------- HUD ---------------- */

    const syncScore = (): void => {
      ctx.hud.set("score", Math.min(99999, score));
    };

    const syncCombo = (): void => {
      ctx.hud.set("combo", Math.min(999, combo));
      ctx.hud.setColor("combo", combo >= 50 ? P.gold : combo >= 20 ? P.mint : P.cream);
    };

    const syncAccuracy = (): void => {
      const value = Math.round(accuracy(perfect, good, notes.length) * 100);
      ctx.hud.set("acc", `${clamp(value, 0, 100)}%`);
    };

    const syncTimer = (): void => {
      ctx.timer.set(Math.max(0, SONG_MS - songTime), SONG_MS, { low: 0.3, critical: 0.12 });
    };

    /* ---------------- 流程 ---------------- */

    const reset = (): void => {
      mode = "ready";
      songTime = 0;
      // 随机源在这里产生，logic 里的 createChart 保持纯函数（不调 Math.random）。
      notes = createChart(mulberry32((Math.random() * 0xffffffff) >>> 0));
      judged = new Array<boolean>(notes.length).fill(false);
      score = 0;
      combo = 0;
      maxCombo = 0;
      perfect = 0;
      good = 0;
      laneFlash = new Array<number>(LANES).fill(0);
      bursts = [];
      popups = [];
      hitGlow = 0;

      syncScore();
      syncCombo();
      syncAccuracy();
      ctx.hud.urgent(false);
      ctx.timer.hide();
    };

    /** 结算只走这里一次；最高分由壳层按 high 模式写入。 */
    const finish = (): void => {
      if (mode === "over") return;
      mode = "over";

      const accValue = accuracy(perfect, good, notes.length);
      ctx.timer.hide();
      ctx.hud.urgent(false);
      ctx.audio.end();

      // 让结算层背后停在最后一帧。
      render();

      ctx.end({
        score: Math.min(99999, score),
        title: "曲目结束",
        kicker: "SONG CLEAR",
        stats: [
          { label: "准确率", value: `${Math.round(accValue * 100)}%` },
          { label: "最高连击", value: maxCombo },
        ],
      });
    };

    /* ---------------- 击打 ---------------- */

    const addFeedback = (lane: number, kind: JudgeKind): void => {
      const color = JUDGE_COLOR[kind];
      bursts.push({ lane, until: songTime + BURST_MS, color });
      if (bursts.length > 16) bursts.shift();

      popups.push({ text: JUDGE_TEXT[kind], color, lane, until: songTime + POPUP_MS });
      if (popups.length > 10) popups.shift();
    };

    /** 空挥：同一窗口里没有音符可打，只断连击；不计入准确率分子。 */
    const whiff = (lane: number): void => {
      if (combo > 0) {
        combo = 0;
        syncCombo();
        ctx.hud.flash("combo", "is-broken");
      }
      ctx.audio.miss();
      addFeedback(lane, "miss");
    };

    /**
     * 击打一条轨道；lane 为 null 表示「打当前最近的那个音符」，
     * 给空格 / A / B 这几个备用击打键用。
     *
     * 判定误差 = 帧时钟 songTime − 谱面时刻，与真实时钟无关。
     */
    const strike = (lane: number | null): void => {
      if (mode !== "playing") return;

      const index = nearestNote(notes, judged, songTime, lane, GOOD_MS);
      if (index < 0) {
        whiff(lane ?? 0);
        return;
      }

      const note = notes[index];
      if (!note) return;

      judged[index] = true;
      const kind = judge(songTime - note.time);
      const gain = hitScore(kind, combo);

      score += gain;
      if (kind === "perfect") perfect += 1;
      else good += 1;

      combo += 1;
      if (combo > maxCombo) maxCombo = combo;

      laneFlash[note.lane] = songTime + LANE_FLASH_MS;
      hitGlow = 1;
      addFeedback(note.lane, kind);

      syncScore();
      syncCombo();
      syncAccuracy();
      ctx.hud.flash("score", "is-bump");
      ctx.hud.flash("combo", "is-bump");

      ctx.audio.hit(combo);
      // 连击每 10 加一档音效。
      if (combo % 10 === 0) ctx.audio.tier();
    };

    /* ---------------- 绘制 ---------------- */

    const drawBackground = (): void => {
      const c = ctx.ctx;
      rect(c, 0, 0, W, H, P.night);

      for (let lane = 0; lane < LANES; lane += 1) {
        drawLaneBed(c, laneX(lane), 0, HIT_Y, lane, songTime < laneFlash[lane]!);
      }

      drawHitLine(c, W, HIT_Y, hitGlow);

      // 顶部读数条：BPM + 节拍灯。
      rect(c, 0, 0, W, 11, P.void);
      rect(c, 0, 11, W, 1, P.line);

      const bpm = Math.round(bpmAt(clamp(songTime / SONG_MS, 0, 1)));
      drawPixelText(c, `BPM ${bpm}`, 5, 2, 1, P.lav, P.void);

      const beatPhase = Math.floor(songTime / Math.max(1, beatIntervalMs(bpm)));
      drawBeatLamp(c, W - 20, 4, ((beatPhase % 4) + 4) % 4, mode === "playing");
    };

    const drawNotes = (): void => {
      const c = ctx.ctx;

      for (let i = 0; i < notes.length; i += 1) {
        if (judged[i]) continue;
        const note = notes[i];
        if (!note) continue;
        const y = noteY(note.time, songTime);
        if (y < -14 || y > HIT_Y + 24) continue;
        drawNote(c, laneX(note.lane), y, note.lane, clamp(y / HIT_Y, 0, 1));
      }
    };

    const drawFeedback = (): void => {
      const c = ctx.ctx;

      for (const burst of bursts) {
        if (songTime >= burst.until) continue;
        const life = clamp((burst.until - songTime) / BURST_MS, 0, 1);
        drawHitBurst(c, laneX(burst.lane), HIT_Y, life, burst.color);
      }

      for (const popup of popups) {
        if (songTime >= popup.until) continue;
        drawJudgeText(c, popup.text, laneX(popup.lane), JUDGE_Y, popup.color);
      }

      // 最近一次命中把判定线整条点亮一下。
      if (hitGlow > 0) {
        c.globalAlpha = Math.min(0.22, hitGlow * 0.22);
        rect(c, 0, HIT_Y - 3, W, 7, P.white);
        c.globalAlpha = 1;
      }

      // 底部：曲目进度条 + 连击数。
      rect(c, 0, H - 6, W, 6, P.void);
      rect(c, 4, H - 4, W - 8, 2, P.line);
      rect(c, 4, H - 4, Math.round((W - 8) * clamp(songTime / SONG_MS, 0, 1)), 2, P.gold);

      if (combo >= 10) {
        const text = `${combo} COMBO`;
        const width = measurePixelText(text, 1);
        drawPixelText(c, text, Math.round((W - width) / 2), 14, 1, P.gold, P.void);
      }
    };

    const render = (): void => {
      drawBackground();

      if (mode === "ready") {
        const text = "TAP TO PLAY";
        const width = measurePixelText(text, 1);
        drawPixelText(ctx.ctx, text, Math.round((W - width) / 2), HIT_Y + 12, 1, P.lav, P.void);
        return;
      }

      drawNotes();
      drawFeedback();

      if (mode === "over") {
        ctx.ctx.globalAlpha = 0.78;
        rect(ctx.ctx, 0, 12, W, H - 18, P.night);
        ctx.ctx.globalAlpha = 1;

        const title = "SONG END";
        const width = measurePixelText(title, 2);
        drawPixelText(ctx.ctx, title, Math.round((W - width) / 2), 62, 2, P.gold, P.void);

        const line = `ACC ${Math.round(accuracy(perfect, good, notes.length) * 100)}%`;
        const lineWidth = measurePixelText(line, 1);
        drawPixelText(ctx.ctx, line, Math.round((W - lineWidth) / 2), 82, 1, P.mint, P.void);
      }
    };

    /* ---------------- 输入 ---------------- */

    ctx.input.pointer.on("down", (info) => {
      ctx.audio.unlock();
      if (mode !== "playing") return;
      if (info.source.pointerType === "mouse" && info.source.button !== 0) return;
      strike(laneAt(info.x, W));
    });

    ctx.input.keys.onPress((action) => {
      if (mode !== "playing" || ctx.isPaused()) return;

      const lane = KEY_LANE[action];
      if (lane !== undefined) {
        strike(lane);
        return;
      }

      // 空格 / Z / X：打当前最近的那个音符。
      if (action === "action" || action === "primary" || action === "secondary") {
        strike(null);
        return;
      }

      // 数字键 1–4 也是四轨的备用入口。
      if (action.startsWith("slot")) {
        const index = Number(action.slice(4)) - 1;
        if (index >= 0 && index < LANES) strike(index);
      }
    });

    reset();

    return {
      start(): void {
        ctx.audio.unlock();
        reset();
        mode = "playing";
        ctx.audio.go();
        syncTimer();
        ctx.announce("曲目开始，四条轨道，75 秒。");
      },

      update(dt: number): void {
        if (mode !== "playing") return;

        // 关键：谱面时钟只用帧累加，绝不读 performance.now()。
        songTime += dt;

        // 漏过的音符：超过 GOOD 窗口仍未击打，判 MISS 并断连击。
        let missed = false;
        for (let i = 0; i < notes.length; i += 1) {
          if (judged[i]) continue;
          const note = notes[i];
          if (!note) continue;
          if (songTime <= note.time + GOOD_MS) break;
          judged[i] = true;
          missed = true;
          addFeedback(note.lane, "miss");
        }

        if (missed) {
          combo = 0;
          syncCombo();
          ctx.hud.flash("combo", "is-broken");
        }

        hitGlow = Math.max(0, hitGlow - dt / 160);
        syncScore();
        syncAccuracy();
        syncTimer();
        ctx.hud.urgent(SONG_MS - songTime <= SONG_MS * 0.12);

        if (songTime >= SONG_MS) finish();
      },

      render,

      pause(): void {
        // 帧时钟天然停住，这里只清掉瞬时视觉状态。
        hitGlow = 0;
        bursts = [];
        popups = [];
      },

      resume(): void {
        syncTimer();
      },

      destroy(): void {
        bursts = [];
        popups = [];
      },
    };
  },
});

export default game;
