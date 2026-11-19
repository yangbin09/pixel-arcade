import { describe, expect, it } from "vitest";

import {
  BALL_MAX_X,
  BALL_MIN_X,
  BALL_MIN_Y,
  BALL_R,
  BUMPER_BASE,
  BUMPER_RESTITUTION,
  BUMPERS,
  COMBO_WINDOW_MS,
  DRAIN_Y,
  FIELD_H,
  FIELD_W,
  FLIP_FROM,
  FLIP_LEN,
  FLIP_MS,
  FLIP_THICK,
  FLIP_TO,
  FLIP_XL,
  FLIP_XR,
  FLIP_Y,
  GRAVITY,
  MAX_BALL_SPEED,
  START_BALLS,
  SUB_STEP_MS,
  TARGETS,
  TARGET_COUNT,
  TARGET_POINTS,
  WALL_L,
  WALL_R,
  WALL_RESTITUTION,
  WALL_TOP,
  GUIDES,
  allTargetsLit,
  clampSpeed,
  flipperPointVelocity,
  flipperSegment,
  isDrained,
  multiplierFor,
  scoreForBumper,
  segmentClosest,
  serveBall,
  stepBall,
  stepFlipper,
  subStepsFor,
  targetsInContact,
  type Ball,
  type BallEvent,
  type Segment,
} from "../src/logic";

/** 一个静止在台面中央的球，测试按需改字段。 */
const ballAt = (x: number, y: number, vx = 0, vy = 0): Ball => ({ x, y, vx, vy });

const len = (seg: Segment): number => Math.hypot(seg.x1 - seg.x0, seg.y1 - seg.y0);

describe("规格常量（不许自行改动）", () => {
  it("台面 168×210，球半径 4", () => {
    expect(FIELD_W).toBe(168);
    expect(FIELD_H).toBe(210);
    expect(BALL_R).toBe(4);
  });

  it("重力 150、球速上限 260、子步 4ms", () => {
    expect(GRAVITY).toBe(150);
    expect(MAX_BALL_SPEED).toBe(260);
    expect(SUB_STEP_MS).toBe(4);
  });

  it("恢复系数：墙面 0.92、缓冲器 1.02（略大于 1 才有弹开感）", () => {
    expect(WALL_RESTITUTION).toBe(0.92);
    expect(BUMPER_RESTITUTION).toBe(1.02);
    expect(BUMPER_RESTITUTION).toBeGreaterThan(1);
  });

  it("三个缓冲器的坐标与半径", () => {
    expect(BUMPERS).toEqual([
      { x: 40, y: 72, r: 10 },
      { x: 128, y: 72, r: 10 },
      { x: 84, y: 116, r: 10 },
    ]);
  });

  it("挡板几何：长 34、根部 y=186、左 x=30 右 x=138、28°→-24°、90ms", () => {
    expect(FLIP_LEN).toBe(34);
    expect(FLIP_Y).toBe(186);
    expect(FLIP_XL).toBe(30);
    expect(FLIP_XR).toBe(138);
    expect(FLIP_FROM).toBe(28);
    expect(FLIP_TO).toBe(-24);
    expect(FLIP_MS).toBe(90);
    expect(FLIP_THICK).toBeLessThan(SUB_STEP_MS * MAX_BALL_SPEED / 1000 + FLIP_THICK);
  });

  it("满速下单子步位移 1.04px < 球半径 4px（这就是必须子步的数学理由）", () => {
    const perStep = (MAX_BALL_SPEED * SUB_STEP_MS) / 1000;
    expect(perStep).toBeCloseTo(1.04, 6);
    expect(perStep).toBeLessThan(BALL_R);
  });

  it("球心可活动范围与掉球线", () => {
    expect(BALL_MIN_X).toBe(WALL_L + BALL_R);
    expect(BALL_MAX_X).toBe(WALL_R - BALL_R);
    expect(BALL_MIN_Y).toBe(WALL_TOP + BALL_R);
    expect(DRAIN_Y).toBe(FIELD_H);
  });
});

describe("clampSpeed · 满速夹取", () => {
  it("未超上限时原样返回", () => {
    expect(clampSpeed(30, -40)).toEqual({ vx: 30, vy: -40 });
    const exactly = clampSpeed(MAX_BALL_SPEED, 0);
    expect(exactly.vx).toBe(MAX_BALL_SPEED);
  });

  it("超上限时长度夹到 260，方向不变", () => {
    const out = clampSpeed(1000, 0);
    expect(Math.hypot(out.vx, out.vy)).toBeCloseTo(MAX_BALL_SPEED, 6);
    expect(out.vx).toBeGreaterThan(0);
    expect(out.vy).toBe(0);

    const diag = clampSpeed(-900, 900);
    expect(Math.hypot(diag.vx, diag.vy)).toBeCloseTo(MAX_BALL_SPEED, 6);
    // 斜向夹取后分量比例保持 1:1，只是都变负
    expect(diag.vx).toBeCloseTo(-diag.vy, 6);
    expect(diag.vx).toBeLessThan(0);
  });

  it("零向量与非有限值都不炸", () => {
    expect(clampSpeed(0, 0)).toEqual({ vx: 0, vy: 0 });
    expect(clampSpeed(Number.NaN, 10)).toEqual({ vx: 0, vy: 0 });
    expect(clampSpeed(10, Number.POSITIVE_INFINITY)).toEqual({ vx: 0, vy: 0 });
  });
});

describe("subStepsFor · 4ms 子步", () => {
  it("子步数是 ceil(dt / 4)", () => {
    expect(subStepsFor(4)).toBe(1);
    expect(subStepsFor(5)).toBe(2);
    expect(subStepsFor(16)).toBe(4);
    expect(subStepsFor(50)).toBe(13);
    expect(subStepsFor(1)).toBe(1);
  });

  it("非法 dt 退化成 1 步，绝不返回 0", () => {
    expect(subStepsFor(0)).toBe(1);
    expect(subStepsFor(-10)).toBe(1);
    expect(subStepsFor(Number.NaN)).toBe(1);
    expect(subStepsFor(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("segmentClosest · 点—线段最近点", () => {
  const seg: Segment = { x0: 0, y0: 0, x1: 10, y1: 0 };

  it("垂足在段内时取垂足", () => {
    const hit = segmentClosest(4, 6, seg);
    expect(hit).toEqual({ x: 4, y: 0, dist: 6, t: 0.4 });
  });

  it("投影落在端点外时夹到端点", () => {
    const before = segmentClosest(-7, 0, seg);
    expect(before.x).toBe(0);
    expect(before.y).toBe(0);
    expect(before.dist).toBe(7);
    expect(before.t).toBe(0);

    const after = segmentClosest(20, 3, seg);
    expect(after.x).toBe(10);
    expect(after.y).toBe(0);
    expect(after.dist).toBeCloseTo(Math.hypot(10, 3), 6);
    expect(after.t).toBe(1);
  });

  it("退化成点的线段也不会除零", () => {
    const hit = segmentClosest(3, 4, { x0: 0, y0: 0, x1: 0, y1: 0 });
    expect(hit.x).toBe(0);
    expect(hit.y).toBe(0);
    expect(hit.dist).toBe(5);
  });
});

describe("flipperSegment · 挡板线段", () => {
  it("左侧绕 (30,186) 转、右侧绕 (138,186) 镜像", () => {
    const left = flipperSegment("left", 0);
    expect(left.x0).toBe(FLIP_XL);
    expect(left.y0).toBe(FLIP_Y);
    expect(len(left)).toBeCloseTo(FLIP_LEN, 6);

    const right = flipperSegment("right", 0);
    expect(right.x0).toBe(FLIP_XR);
    expect(right.x1).toBeCloseTo(FLIP_XR - FLIP_LEN, 6);
    expect(right.y1).toBe(left.y1);
  });

  it("静止角向下、抬起角向上", () => {
    const down = flipperSegment("left", FLIP_FROM);
    expect(down.y1).toBeGreaterThan(FLIP_Y);

    const up = flipperSegment("left", FLIP_TO);
    expect(up.y1).toBeLessThan(FLIP_Y);
  });

  it("角度变化时长度不变、根部不动", () => {
    for (const angle of [FLIP_FROM, 10, 0, -10, FLIP_TO]) {
      const seg = flipperSegment("left", angle);
      expect(len(seg)).toBeCloseTo(FLIP_LEN, 6);
      expect(seg.x0).toBe(FLIP_XL);
      expect(seg.y0).toBe(FLIP_Y);
      expect(seg.x1).toBeGreaterThanOrEqual(FLIP_XL);
    }
  });
});

describe("flipperPointVelocity · 挡板尖端速度", () => {
  it("静止时速度为 0", () => {
    const still = flipperPointVelocity({ side: "left", angle: FLIP_FROM, omega: 0 }, 1);
    expect(still.vx).toBe(0);
    expect(still.vy).toBe(0);
  });

  it("以 90ms 从 28° 抬到 -24° 时，尖端约 343px/s 且向上", () => {
    const omega = (FLIP_FROM - FLIP_TO) / FLIP_MS;
    // 取中途角度，此时角速度仍是满值
    const state = { side: "left" as const, angle: 0, omega: -omega };
    const tip = flipperPointVelocity(state, 1);
    expect(Math.hypot(tip.vx, tip.vy)).toBeCloseTo(343, 0);
    expect(tip.vy).toBeLessThan(0);
  });

  it("根部（t=0）线速度恒为 0", () => {
    const root = flipperPointVelocity({ side: "right", angle: 10, omega: -0.5 }, 0);
    expect(root.vx).toBe(0);
    expect(root.vy).toBe(0);
  });
});

describe("stepFlipper · 90ms 内完成抬板", () => {
  it("按住 90ms 正好从 28° 转到 -24°", () => {
    const state = stepFlipper("left", FLIP_FROM, true, FLIP_MS);
    expect(state.angle).toBeCloseTo(FLIP_TO, 6);
    expect(state.omega).toBeLessThan(0);
  });

  it("继续按住不会越过 FLIP_TO", () => {
    const state = stepFlipper("left", FLIP_TO, true, 50);
    expect(state.angle).toBe(FLIP_TO);
    expect(state.omega).toBe(0);
  });

  it("松手 90ms 内转回 FLIP_FROM，且角速度方向相反", () => {
    const mid = stepFlipper("left", FLIP_TO, false, 45);
    expect(mid.angle).toBeCloseTo(FLIP_TO + (FLIP_FROM - FLIP_TO) / 2, 6);
    expect(mid.omega).toBeGreaterThan(0);

    const done = stepFlipper("left", FLIP_TO, false, FLIP_MS);
    expect(done.angle).toBeCloseTo(FLIP_FROM, 6);
  });

  it("角度永远夹在 FLIP_TO..FLIP_FROM 之间", () => {
    let angle = FLIP_FROM;
    for (let i = 0; i < 40; i += 1) {
      angle = stepFlipper("right", angle, i % 7 !== 0, 13).angle;
      expect(angle).toBeGreaterThanOrEqual(FLIP_TO);
      expect(angle).toBeLessThanOrEqual(FLIP_FROM);
    }
  });
});

describe("multiplierFor · 连击倍率", () => {
  it("900ms 内依次 ×1 ×2 ×4 ×8", () => {
    expect(multiplierFor(1, 0)).toBe(1);
    expect(multiplierFor(2, 100)).toBe(2);
    expect(multiplierFor(3, 500)).toBe(4);
    expect(multiplierFor(4, 800)).toBe(8);
  });

  it("倍率封顶 ×8", () => {
    expect(multiplierFor(5, 10)).toBe(8);
    expect(multiplierFor(99, 10)).toBe(8);
  });

  it("超过 900ms 窗口回落到 ×1", () => {
    expect(multiplierFor(4, COMBO_WINDOW_MS)).toBe(1);
    expect(multiplierFor(4, COMBO_WINDOW_MS + 1)).toBe(1);
    expect(multiplierFor(3, 899)).toBe(4);
  });

  it("没有命中 / 非法输入都是 ×1", () => {
    expect(multiplierFor(0, 10)).toBe(1);
    expect(multiplierFor(Number.NaN, 10)).toBe(1);
    expect(multiplierFor(2, Number.NaN)).toBe(1);
  });
});

describe("scoreForBumper · 倍率线性", () => {
  it("基础 100，倍率线性放大", () => {
    expect(BUMPER_BASE).toBe(100);
    expect(scoreForBumper(1)).toBe(100);
    expect(scoreForBumper(2)).toBe(200);
    expect(scoreForBumper(4)).toBe(400);
    expect(scoreForBumper(8)).toBe(800);
  });

  it("非法倍率回落到基础分", () => {
    expect(scoreForBumper(0)).toBe(100);
    expect(scoreForBumper(-2)).toBe(100);
    expect(scoreForBumper(Number.NaN)).toBe(100);
  });
});

describe("isDrained · 掉球判定", () => {
  it("越过底部才算掉球", () => {
    expect(isDrained(FIELD_H)).toBe(false);
    expect(isDrained(FIELD_H + 0.01)).toBe(true);
    expect(isDrained(DRAIN_Y + 1)).toBe(true);
    expect(isDrained(10)).toBe(false);
  });
});

describe("stepBall · 子步积分", () => {
  it("不修改传入的球对象", () => {
    const input = ballAt(84, 40, 10, 0);
    const snapshot = { ...input };
    stepBall(input, 50);
    expect(input).toEqual(snapshot);
  });

  it("自由落体 1 秒的位移约等于 ½gt²（确认 GRAVITY 按 px/s² 用）", () => {
    const ball = ballAt(84, 20);
    let current = ball;
    // 25 帧 × 40ms = 1000ms
    for (let i = 0; i < 25; i += 1) current = stepBall(current, 40);

    const fall = current.y - 20;
    expect(fall).toBeGreaterThan(70);
    expect(fall).toBeLessThan(82);
    // 半隐式欧拉比解析解略大（多出 ½·g·dt_sub）
    expect(fall).toBeCloseTo(75.3, 0);
    expect(current.vy).toBeCloseTo(150, 0);
  });

  it("高速球不会穿出侧墙或顶墙（200 帧、每帧 50ms）", () => {
    let ball = ballAt(84, 30, -MAX_BALL_SPEED, 0);
    let frames = 0;

    for (let i = 0; i < 200; i += 1) {
      ball = stepBall(ball, 50);
      expect(ball.x).toBeGreaterThanOrEqual(WALL_L + BALL_R - 1e-9);
      expect(ball.x).toBeLessThanOrEqual(WALL_R - BALL_R + 1e-9);
      expect(ball.y).toBeGreaterThanOrEqual(WALL_TOP + BALL_R - 1e-9);
      // 掉出底部是合法结局（会被扣球），只在还活着时断言台内。
      if (isDrained(ball.y)) break;
      frames += 1;
    }

    expect(frames).toBeGreaterThan(0);
  });

  it("满速直落正中：被中央缓冲器弹回顶部，400 帧内始终留在台面内", () => {
    // x=84 正对中央缓冲器（84,116），球会在顶墙与缓冲器之间反复弹跳 ——
    // 这同时证明了子步积分没有让球在高速下隧穿。
    let ball = ballAt(84, BALL_MIN_Y, 0, MAX_BALL_SPEED);
    let bumperHits = 0;

    for (let frame = 0; frame < 400; frame += 1) {
      const events: BallEvent[] = [];
      ball = stepBall(ball, 50, [], events);
      bumperHits += events.filter((event) => event.kind === "bumper").length;

      expect(ball.x).toBeGreaterThanOrEqual(WALL_L + BALL_R - 1e-9);
      expect(ball.x).toBeLessThanOrEqual(WALL_R - BALL_R + 1e-9);
      expect(ball.y).toBeGreaterThanOrEqual(WALL_TOP + BALL_R - 1e-9);
      expect(isDrained(ball.y)).toBe(false);
      expect(Math.hypot(ball.vx, ball.vy)).toBeLessThanOrEqual(MAX_BALL_SPEED + 1e-9);
    }

    expect(bumperHits).toBeGreaterThan(0);
  });

  it("没有挡板时，靠边下落的球最终会掉出底部", () => {
    let ball = ballAt(10, BALL_MIN_Y, 0, 80);
    let frames = 0;

    while (!isDrained(ball.y) && frames < 400) {
      ball = stepBall(ball, 50, []);
      frames += 1;
    }

    expect(frames).toBeGreaterThan(0);
    expect(frames).toBeLessThan(400);
    expect(isDrained(ball.y)).toBe(true);
  });

  it("撞缓冲器后沿法线弹开，且速度不超过上限", () => {
    // 从缓冲器正上方 1px 重叠处落下
    const ball = ballAt(BUMPERS[0]!.x, BUMPERS[0]!.y - 13, 0, 120);
    const events: BallEvent[] = [];
    const next = stepBall(ball, 8, [], events);

    expect(events.some((event) => event.kind === "bumper" && event.index === 0)).toBe(true);
    expect(next.vy).toBeLessThan(0);
    expect(Math.hypot(next.vx, next.vy)).toBeLessThanOrEqual(MAX_BALL_SPEED + 1e-9);
  });

  it("子步让高速球被挡板挡住，而不是穿过去", () => {
    // 抬起的左挡板正好挡在球的正下方
    const raised = stepFlipper("left", FLIP_FROM, true, FLIP_MS);
    const segment = flipperSegment("left", raised.angle);
    const midX = (segment.x0 + segment.x1) / 2;
    const midY = (segment.y0 + segment.y1) / 2;

    let ball = ballAt(midX, midY - 22, 0, MAX_BALL_SPEED);
    const events: BallEvent[] = [];
    for (let i = 0; i < 4; i += 1) {
      ball = stepBall(ball, 50, [raised], events);
    }

    expect(events.some((event) => event.kind === "flipper" && event.side === "left")).toBe(true);
    // 没有被挡板甩到台面以下：仍在挡板墨线之上
    expect(ball.y).toBeLessThan(FLIP_Y + 12);
  });

  it("满速下落一帧 50ms 只走 13px，但 13 个子步每步仅 1.04px", () => {
    expect(subStepsFor(50)).toBe(13);
    expect((MAX_BALL_SPEED * SUB_STEP_MS) / 1000).toBeLessThan(FLIP_THICK);
  });

  it("掉出底部时只报告一次 drain", () => {
    const ball = ballAt(84, DRAIN_Y - 1, 0, MAX_BALL_SPEED);
    const events: BallEvent[] = [];
    stepBall(ball, 50, [], events);
    expect(events.filter((event) => event.kind === "drain")).toHaveLength(1);
  });

  it("抬起的挡板能把落下的球救回去（向上弹出，速度超过重力）", () => {
    // 这是「挡板真的有用」的核心断言：球以自由落体速度落到挡板上，
    // 抬板后必须获得向上的速度，而且明显大于同等时间内重力能拉回的量。
    const raised = stepFlipper("left", FLIP_FROM, true, FLIP_MS);
    const seg = flipperSegment("left", raised.angle);
    const midX = (seg.x0 + seg.x1) / 2;
    const midY = (seg.y0 + seg.y1) / 2;

    let ball = ballAt(midX, midY - 10, 0, 150);
    const events: BallEvent[] = [];

    for (let i = 0; i < 8; i += 1) {
      ball = stepBall(ball, 16.7, [raised], events);
      if (events.some((event) => event.kind === "flipper")) break;
    }

    expect(ball.vy).toBeLessThan(0);
    expect(ball.y).toBeLessThan(FLIP_Y);

    // 挡板给的向上速度必须压过重力：否则球只会"蹭"一下就继续掉。
    const upSpeed = Math.abs(ball.vy);
    expect(upSpeed).toBeGreaterThan(GRAVITY * 0.5);
    expect(upSpeed).toBeLessThanOrEqual(MAX_BALL_SPEED + 1e-9);
  });

  it("落下的球若没有挡板就一路掉出底部（挡板不是装饰）", () => {
    // 与上一条对照：同样的初态、同样的帧数，只是挡板不在。
    const noFlipper = ballAt(46, 150, 0, 150);
    let ball = noFlipper;
    for (let i = 0; i < 40; i += 1) ball = stepBall(ball, 16.7, []);

    expect(isDrained(ball.y)).toBe(true);
  });

  it("导轨末端收在挡板扫掠范围内（不能留死角口袋）", () => {
    // 导轨若把球导到挡板根部外侧，球会卡在抬板够不到的地方。
    for (const guide of GUIDES) {
      expect(guide.y1).toBeGreaterThanOrEqual(FLIP_Y);
      expect(guide.y1).toBeLessThanOrEqual(FLIP_Y + 6);

      // 末端到挡板根部的水平距离必须 ≤ 2px
      const rootX = Math.abs(guide.x1 - FLIP_XL) < Math.abs(guide.x1 - FLIP_XR) ? FLIP_XL : FLIP_XR;
      expect(Math.abs(guide.x1 - rootX)).toBeLessThanOrEqual(2);
    }
  });

  it("球不会永久卡在底部：抬板后要么被踢向上、要么已经掉出", () => {
    // 从导轨出口正上方的多个位置投球，全程按住挡板。
    // 断言球不会在底部长时间贴着零速度 —— 那就是卡死。
    const raised = stepFlipper("left", FLIP_FROM, true, FLIP_MS);

    for (const startX of [10, 20, 26, 34, 50]) {
      let ball = ballAt(startX, FLIP_Y - 30, 0, 60);
      let stuckFrames = 0;

      for (let frame = 0; frame < 200; frame += 1) {
        ball = stepBall(ball, 16.7, [raised], []);
        if (isDrained(ball.y)) break;

        const slow = Math.hypot(ball.vx, ball.vy) < 6;
        stuckFrames = slow && ball.y > FLIP_Y - 8 ? stuckFrames + 1 : 0;
        expect(stuckFrames).toBeLessThan(30);
      }
    }
  });
});

describe("靶标与开球", () => {
  it("两侧各 3 个靶标，共 6 个", () => {
    expect(TARGET_COUNT).toBe(6);
    expect(TARGETS.filter((target) => target.side === "left")).toHaveLength(3);
    expect(TARGETS.filter((target) => target.side === "right")).toHaveLength(3);
    expect(TARGET_POINTS).toBe(1000);
  });

  it("打满 6 个才算全亮", () => {
    expect(allTargetsLit([true, true, true, true, true, true])).toBe(true);
    expect(allTargetsLit([true, true, true, true, true, false])).toBe(false);
    expect(allTargetsLit([])).toBe(false);
    expect(allTargetsLit([true, false, true, false, true, false])).toBe(false);
  });

  it("球贴左墙中部时只碰到左侧靶标", () => {
    const hits = targetsInContact(WALL_L + BALL_R, 62);
    expect(hits.length).toBeGreaterThan(0);
    for (const index of hits) expect(TARGETS[index]!.side).toBe("left");
  });

  it("球在台面正中时不碰任何靶标", () => {
    expect(targetsInContact(FIELD_W / 2, 100)).toEqual([]);
  });

  it("开球位置在台内、连续两次方向相反", () => {
    const first = serveBall(0);
    const second = serveBall(1);

    expect(first.x).toBeGreaterThan(BALL_MIN_X);
    expect(first.x).toBeLessThan(BALL_MAX_X);
    expect(first.y).toBeGreaterThan(BALL_MIN_Y);
    expect(first.y).toBeLessThan(DRAIN_Y);
    expect(Math.sign(first.vx)).toBe(-Math.sign(second.vx));
    expect(START_BALLS).toBe(3);
  });
});
