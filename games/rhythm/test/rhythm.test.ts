import { describe, expect, it } from "vitest";

import {
  BPM_END,
  BPM_START,
  GOOD_MS,
  HIT_Y,
  LANES,
  NOTE_FALL_MS,
  NOTE_SPAWN_Y,
  PERFECT_MS,
  SONG_MS,
  accuracy,
  beatIntervalMs,
  bpmAt,
  createChart,
  fallSpeed,
  hitScore,
  judge,
  laneAt,
  laneX,
  nearestNote,
  noteFallMs,
  noteY,
  type Note,
} from "../src/logic";

/** 可复现随机源（LCG），与 core 的 mulberry32 用法一致。 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe("常量与几何", () => {
  it("四条轨道，判定线 140，出生点 -12", () => {
    expect(LANES).toBe(4);
    expect(HIT_Y).toBe(140);
    expect(NOTE_SPAWN_Y).toBe(-12);
    expect(PERFECT_MS).toBe(45);
    expect(GOOD_MS).toBe(90);
    expect(SONG_MS).toBe(75_000);
  });

  it("laneX 按 21 + i * 42 落点：21 / 63 / 105 / 147", () => {
    expect([0, 1, 2, 3].map(laneX)).toEqual([21, 63, 105, 147]);
  });

  it("laneX 越界会被夹进 0..3，不会画出画面外", () => {
    expect(laneX(-5)).toBe(21);
    expect(laneX(99)).toBe(147);
  });

  it("laneAt 把指针 x 平均分成四条轨道", () => {
    expect(laneAt(0)).toBe(0);
    expect(laneAt(41)).toBe(0);
    expect(laneAt(42)).toBe(1);
    expect(laneAt(83)).toBe(1);
    expect(laneAt(84)).toBe(2);
    expect(laneAt(126)).toBe(3);
    expect(laneAt(167)).toBe(3);
  });
});

describe("judge · 判定窗口边界", () => {
  it("Δ=0 与 ±45 都是 PERFECT（闭区间）", () => {
    expect(judge(0)).toBe("perfect");
    expect(judge(45)).toBe("perfect");
    expect(judge(-45)).toBe("perfect");
  });

  it("Δ=±46 跌到 GOOD，Δ=±90 仍然是 GOOD", () => {
    expect(judge(46)).toBe("good");
    expect(judge(-46)).toBe("good");
    expect(judge(90)).toBe("good");
    expect(judge(-90)).toBe("good");
  });

  it("Δ=±91 与更大误差都是 MISS", () => {
    expect(judge(91)).toBe("miss");
    expect(judge(-91)).toBe("miss");
    expect(judge(1000)).toBe("miss");
    expect(judge(-1000)).toBe("miss");
  });

  it("非有限数按 MISS 处理，不会抛错", () => {
    expect(judge(Number.NaN)).toBe("miss");
    expect(judge(Number.POSITIVE_INFINITY)).toBe("miss");
  });
});

describe("bpmAt · BPM 递增", () => {
  it("进度 0 是 96，进度 1 是 144", () => {
    expect(bpmAt(0)).toBe(BPM_START);
    expect(bpmAt(1)).toBe(BPM_END);
    expect(BPM_START).toBe(96);
    expect(BPM_END).toBe(144);
  });

  it("中点是 120，且整段严格单调不降（BPM 递增）", () => {
    expect(bpmAt(0.5)).toBe(120);
    let last = -Infinity;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const bpm = bpmAt(p);
      expect(bpm).toBeGreaterThanOrEqual(last);
      last = bpm;
    }
  });

  it("进度越界会被夹到 0..1", () => {
    expect(bpmAt(-1)).toBe(BPM_START);
    expect(bpmAt(2)).toBe(BPM_END);
  });
});

describe("beatIntervalMs · 与 BPM 反比", () => {
  it("120 BPM 的八分音符是 250ms", () => {
    expect(beatIntervalMs(120)).toBeCloseTo(250, 6);
  });

  it("BPM 翻倍，间隔减半；非法 BPM 回落到起始值", () => {
    expect(beatIntervalMs(192)).toBeCloseTo(beatIntervalMs(96) / 2, 6);
    expect(beatIntervalMs(0)).toBeCloseTo(beatIntervalMs(BPM_START), 6);
    expect(beatIntervalMs(Number.NaN)).toBeCloseTo(beatIntervalMs(BPM_START), 6);
  });
});

describe("回落时长与速度", () => {
  it("下落时长恒为 900ms，不随 BPM 变", () => {
    expect(noteFallMs(96)).toBe(NOTE_FALL_MS);
    expect(noteFallMs(144)).toBe(NOTE_FALL_MS);
    expect(NOTE_FALL_MS).toBe(900);
  });

  it("下落速度 ≈ 169 px/s（(140 + 12) / 900 * 1000）", () => {
    expect(fallSpeed()).toBeCloseTo((152 / 900) * 1000, 6);
    expect(fallSpeed()).toBeGreaterThan(160);
    expect(fallSpeed()).toBeLessThan(180);
  });

  it("noteY：出生时在 -12，落线时正好 140", () => {
    const noteTime = 3000;
    expect(noteY(noteTime, noteTime - NOTE_FALL_MS)).toBeCloseTo(NOTE_SPAWN_Y, 6);
    expect(noteY(noteTime, noteTime)).toBeCloseTo(HIT_Y, 6);
    // 中途线性：落线前 450ms 大约在中间高度。
    expect(noteY(noteTime, noteTime - NOTE_FALL_MS / 2)).toBeCloseTo(64, 6);
  });
});

describe("hitScore · 连击加成", () => {
  it("0 连击：PERFECT 100、GOOD 50、MISS 0", () => {
    expect(hitScore("perfect", 0)).toBe(100);
    expect(hitScore("good", 0)).toBe(50);
    expect(hitScore("miss", 0)).toBe(0);
  });

  it("连击 50 时倍率 ×2，连击越高分越高", () => {
    expect(hitScore("perfect", 50)).toBe(200);
    expect(hitScore("good", 50)).toBe(100);
    expect(hitScore("perfect", 100)).toBe(300);
    expect(hitScore("perfect", 99)).toBeGreaterThan(hitScore("perfect", 10));
  });

  it("MISS 无论连击多高都是 0 分", () => {
    expect(hitScore("miss", 0)).toBe(0);
    expect(hitScore("miss", 999)).toBe(0);
  });

  it("负连击按 0 处理，不会出现负分", () => {
    expect(hitScore("perfect", -20)).toBe(100);
    expect(hitScore("good", Number.NaN)).toBe(50);
  });
});

describe("accuracy · 加权准确率", () => {
  it("分母为 0 时返回 1", () => {
    expect(accuracy(0, 0, 0)).toBe(1);
    expect(accuracy(3, 2, 0)).toBe(1);
    expect(accuracy(0, 0, -5)).toBe(1);
  });

  it("全 PERFECT 是 1，全 GOOD 是 0.5，全漏是 0", () => {
    expect(accuracy(10, 0, 10)).toBe(1);
    expect(accuracy(0, 10, 10)).toBe(0.5);
    expect(accuracy(0, 0, 10)).toBe(0);
  });

  it("GOOD 按半权计入，结果夹在 0..1", () => {
    expect(accuracy(6, 4, 10)).toBeCloseTo(0.8, 6);
    expect(accuracy(10, 10, 10)).toBe(1);
  });
});

describe("createChart · 谱面生成", () => {
  it("谱面非空、时间非降、id 与下标一致", () => {
    const chart = createChart(seeded(7));
    expect(chart.length).toBeGreaterThan(50);

    let last = -Infinity;
    for (let i = 0; i < chart.length; i += 1) {
      const note = chart[i]!;
      expect(note.id).toBe(i);
      expect(note.time).toBeGreaterThanOrEqual(last);
      last = note.time;
    }
  });

  it("全部音符落在轨道 0..3 且不晚于曲目结束", () => {
    const chart = createChart(seeded(23), SONG_MS);
    for (const note of chart) {
      expect(note.lane).toBeGreaterThanOrEqual(0);
      expect(note.lane).toBeLessThan(LANES);
      expect(note.time).toBeLessThan(SONG_MS);
    }
  });

  it("同一种子生成同一张谱面（随机源注入而非 Math.random）", () => {
    const a = createChart(seeded(99));
    const b = createChart(seeded(99));
    expect(a).toEqual(b);
    expect(createChart(seeded(100))).not.toEqual(a);
  });

  it("第一个音符恰好在 900ms 落线，给玩家留出下落时间", () => {
    const chart = createChart(seeded(1));
    expect(chart[0]!.time).toBe(NOTE_FALL_MS);
  });

  it("短曲目也能生成合理的谱面；非法时长回落到 75 秒", () => {
    expect(createChart(seeded(3), 2000).length).toBeGreaterThan(0);
    expect(createChart(seeded(3), Number.NaN).length).toBe(createChart(seeded(3), SONG_MS).length);
  });
});

describe("nearestNote · 命中查找", () => {
  const chart: Note[] = [
    { id: 0, lane: 0, time: 1000 },
    { id: 1, lane: 1, time: 1100 },
    { id: 2, lane: 2, time: 1200 },
  ];

  it("窗口内取最近的音符，返回下标", () => {
    const judged = [false, false, false];
    expect(nearestNote(chart, judged, 1090, 1)).toBe(1);
    expect(nearestNote(chart, judged, 1085, null)).toBe(1);
  });

  it("超出 GOOD 窗口就返回 -1，不会隔空命中", () => {
    const judged = [false, false, false];
    expect(nearestNote(chart, judged, 1100 + GOOD_MS + 1, 1)).toBe(-1);
    expect(nearestNote(chart, judged, 1100 - GOOD_MS - 1, 1)).toBe(-1);
  });

  it("已判定的音符不会再被命中，指定轨道只在该轨道找", () => {
    const judged = [false, true, false];
    expect(nearestNote(chart, judged, 1100, null)).toBe(-1);
    expect(nearestNote(chart, judged, 1050, 0)).toBe(0);
    expect(nearestNote(chart, judged, 1050, 3)).toBe(-1);
  });
});
