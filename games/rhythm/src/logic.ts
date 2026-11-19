/**
 * 四轨节拍纯规则层：判定窗口、分数曲线、BPM 表、谱面生成、音符几何。
 *
 * 不碰 DOM / Canvas，也不调用 Math.random —— 随机源由调用方注入，
 * 所以判定边界、连击加成、准确率、谱面生成都能直接单测。
 */

export const LANES = 4;

/** 轨道中心 x：21 / 63 / 105 / 147（规格写死）。 */
export const LANE_FIRST_X = 21;
export const LANE_GAP = 42;

/** 判定线 y 与音符出生 y（规格：HIT_Y = 140，出生 -12）。 */
export const HIT_Y = 140;
export const NOTE_SPAWN_Y = -12;

/** 判定窗口（毫秒）：|Δ| ≤ 45 PERFECT；45 < |Δ| ≤ 90 GOOD；更大 MISS。 */
export const PERFECT_MS = 45;
export const GOOD_MS = 90;

/** 音符从出生到落线的固定时长；不随 BPM 变，保证低 BPM 时看得清。 */
export const NOTE_FALL_MS = 900;

/** 曲目 75 秒。 */
export const SONG_MS = 75_000;

/** BPM 从 96 线性升到 144。 */
export const BPM_START = 96;
export const BPM_END = 144;

/** 键盘方向键 → 轨道：← ↓ ↑ → 依次对应 0 / 1 / 2 / 3。 */
export const KEY_LANES = ["left", "down", "up", "right"] as const;

export type JudgeKind = "perfect" | "good" | "miss";

export interface Note {
  /** 谱面内唯一序号。 */
  id: number;
  /** 轨道 0..3。 */
  lane: number;
  /** 应该被击中的时刻（songTime 毫秒）。 */
  time: number;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** 轨道序号夹到 0..3，避免越界坐标画出画面。 */
export function laneIndex(i: number): number {
  if (!Number.isFinite(i)) return 0;
  return Math.min(LANES - 1, Math.max(0, Math.round(i)));
}

/** 轨道中心 x。 */
export function laneX(i: number): number {
  return LANE_FIRST_X + laneIndex(i) * LANE_GAP;
}

/** 逻辑坐标 x → 轨道序号；轨道等分画面宽度（边界 42 / 84 / 126）。 */
export function laneAt(x: number, width = 168): number {
  if (!Number.isFinite(x) || !Number.isFinite(width) || width <= 0) return 0;
  const step = width / LANES;
  return Math.min(LANES - 1, Math.max(0, Math.floor(x / step)));
}

/** 曲目进度 0..1 → BPM（96 线性升到 144）。 */
export function bpmAt(progress: number): number {
  const p = clamp01(Number.isFinite(progress) ? progress : 0);
  return BPM_START + (BPM_END - BPM_START) * p;
}

/** 八分音符间隔：60000 / bpm / 2。 */
export function beatIntervalMs(bpm: number): number {
  const safe = Number.isFinite(bpm) && bpm > 0 ? bpm : BPM_START;
  return 60000 / safe / 2;
}

/**
 * 音符下落时长：规格固定 900ms，**不随 BPM 变**。
 * 参数保留给调用方表达「按当前 BPM 取、但结果恒定」。
 */
export function noteFallMs(_bpm: number = BPM_START): number {
  return NOTE_FALL_MS;
}

/** 下落速度（px/s）：(140 + 12) / 900 * 1000 ≈ 168.9。 */
export function fallSpeed(): number {
  return ((HIT_Y - NOTE_SPAWN_Y) / NOTE_FALL_MS) * 1000;
}

/** 音符在 songTime 时刻的 y：线性下落，落线时正好等于 HIT_Y。 */
export function noteY(noteTime: number, songTime: number): number {
  const t = (songTime - (noteTime - NOTE_FALL_MS)) / NOTE_FALL_MS;
  return NOTE_SPAWN_Y + (HIT_Y - NOTE_SPAWN_Y) * t;
}

/** 判定纯函数：边界 ±45 / ±90 都算在内。 */
export function judge(deltaMs: number): JudgeKind {
  if (!Number.isFinite(deltaMs)) return "miss";
  const abs = Math.abs(deltaMs);
  if (abs <= PERFECT_MS) return "perfect";
  if (abs <= GOOD_MS) return "good";
  return "miss";
}

/**
 * 单次命中得分：PERFECT 基数 100、GOOD 基数 50，再乘 1 + combo/50。
 * combo 传「本次命中之前」的连击数；MISS 恒 0。
 */
export function hitScore(kind: JudgeKind, combo: number): number {
  if (kind === "miss") return 0;
  const base = kind === "perfect" ? 100 : 50;
  const streak = Number.isFinite(combo) ? Math.max(0, combo) : 0;
  return Math.round(base * (1 + streak / 50));
}

/**
 * 加权准确率：PERFECT 计 1、GOOD 计 0.5，分母是谱面音符总数。
 * total ≤ 0 时返回 1（还没开始 / 空谱面）。
 */
export function accuracy(perfect: number, good: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 1;
  const p = Number.isFinite(perfect) ? Math.max(0, perfect) : 0;
  const g = Number.isFinite(good) ? Math.max(0, good) : 0;
  return clamp01((p + g * 0.5) / total);
}

/**
 * 生成谱面：第一个音符在 900ms 落线（正好等于下落时长），
 * 之后按八分音符间隔排，间隔随曲目进度变短；偶尔压双押。
 * 时间严格非降，id 与数组下标一致。
 */
export function createChart(rng: () => number, durationMs = SONG_MS): Note[] {
  const notes: Note[] = [];
  const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : SONG_MS;
  const random = (): number => clamp01(rng());

  let time = NOTE_FALL_MS;
  let lastLane = -1;

  while (time < duration - GOOD_MS) {
    const interval = beatIntervalMs(bpmAt(time / duration));

    let lane = Math.floor(random() * LANES);
    if (lane >= LANES) lane = LANES - 1;
    // 同一轨不连续排三次以上，读谱更舒服。
    if (lane === lastLane) lane = (lane + 1 + Math.floor(random() * (LANES - 1))) % LANES;

    notes.push({ id: notes.length, lane, time: Math.round(time) });
    lastLane = lane;

    if (random() < 0.08) {
      let twin = Math.floor(random() * LANES);
      if (twin >= LANES) twin = LANES - 1;
      if (twin === lane) twin = (twin + 1) % LANES;
      notes.push({ id: notes.length, lane: twin, time: Math.round(time) });
    }

    time += interval;
  }

  return notes;
}

/**
 * 找 songTime 附近最近的未判定音符，返回下标；没有返回 -1。
 * lane 传 null 表示不限轨道（备用击打键打「当前最近的那个」）。
 */
export function nearestNote(
  notes: readonly Note[],
  judged: readonly boolean[],
  songTime: number,
  lane: number | null = null,
  windowMs = GOOD_MS,
): number {
  let best = -1;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (let i = 0; i < notes.length; i += 1) {
    if (judged[i]) continue;
    const note = notes[i];
    if (!note) continue;
    if (lane !== null && note.lane !== lane) continue;
    const delta = Math.abs(songTime - note.time);
    if (delta > windowMs) continue;
    if (delta < bestDelta) {
      bestDelta = delta;
      best = i;
    }
  }

  return best;
}
