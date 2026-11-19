import { describe, expect, it } from "vitest";

import {
  BEAM_CLEARANCE,
  BIRD_MAX_Y,
  BIRD_MIN_Y,
  COIN_SCORE,
  GRAVITY,
  GROUND_Y,
  HOLD_MS,
  JUMP_V,
  JUMP_V_MAX,
  OBSTACLE_SIZE,
  PLAYER_H,
  PLAYER_HIT_W,
  PLAYER_W,
  PLAYER_X,
  SLIDE_H,
  SPEED_BASE,
  SPEED_MAX,
  SPEED_STEP,
  SPEED_STEP_DIST,
  W,
  addScore,
  airTimeMs,
  clampHud,
  coinArc,
  coinPicked,
  collisionAt,
  createPlayer,
  jumpHeight,
  jumpVelocity,
  makeObstacle,
  metersOf,
  obstacleBox,
  overlaps,
  pickObstacleKind,
  playerBox,
  safeCoins,
  spawnGap,
  spawnGapPx,
  speedAt,
  speedLevel,
  stepPlayer,
  takeOff,
  type Coin,
  type Obstacle,
} from "../src/logic";

/** 可复现随机源：同一个种子跑出同一串数。 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** 一直推进到落地（或超过 5 秒），返回经过的毫秒。 */
function simulateJump(holdMs: number, holdJump: boolean): number {
  const player = createPlayer();
  takeOff(player);
  let elapsed = 0;
  while (elapsed < 5000) {
    stepPlayer(player, 16, holdJump);
    elapsed += 16;
    if (!player.airborne) return elapsed;
  }
  return elapsed;
}

describe("场景常量与跑道", () => {
  it("168×210，地面 y=170，玩家固定 x=40", () => {
    expect(W).toBe(168);
    expect(PLAYER_X).toBe(40);
    expect(GROUND_Y).toBe(170);
    expect(OBSTACLE_SIZE.box).toEqual({ w: 28, h: 18 });
    expect(OBSTACLE_SIZE.bird.w).toBe(16);
    expect(PLAYER_W).toBe(16);
    expect(PLAYER_H).toBe(30);
    expect(SLIDE_H).toBe(16);
  });
});

describe("speedAt · 速度曲线", () => {
  it("120px/s 起步，每 200 米 +14px/s", () => {
    expect(speedAt(0)).toBe(SPEED_BASE);
    expect(speedAt(199)).toBe(120);
    expect(speedAt(200)).toBe(134);
    expect(speedAt(400)).toBe(148);
    expect(speedAt(600)).toBe(162);
  });

  it("封顶 300px/s，再远也不涨", () => {
    // 120 + 14*13 = 302 → 从 2600 米起被封顶 300 夹住
    expect(speedAt(2400)).toBe(288);
    expect(speedAt(2600)).toBe(SPEED_MAX);
    expect(speedAt(2600 + 5000)).toBe(SPEED_MAX);
    expect(speedAt(999999)).toBe(SPEED_MAX);
  });

  it("非法输入按 0 米处理，永不小于起步速度", () => {
    expect(speedAt(-500)).toBe(SPEED_BASE);
    expect(speedAt(Number.NaN)).toBe(SPEED_BASE);
    expect(speedAt(Number.POSITIVE_INFINITY)).toBe(SPEED_MAX);
    expect(speedAt(Number.NEGATIVE_INFINITY)).toBe(SPEED_BASE);
  });

  it("速度档从 1 起，每 200 米 +1，夹在两位数字内", () => {
    expect(speedLevel(0)).toBe(1);
    expect(speedLevel(199)).toBe(1);
    expect(speedLevel(200)).toBe(2);
    expect(speedLevel(2600)).toBe(14);
    expect(speedLevel(Number.NaN)).toBe(1);
    expect(speedLevel(999999)).toBe(99);
  });

  it("metersOf 与像素换算一比一", () => {
    expect(metersOf(0)).toBe(0);
    expect(metersOf(500)).toBeGreaterThan(0);
    expect(metersOf(-10)).toBe(0);
    expect(metersOf(Number.NaN)).toBe(0);
  });
});

describe("spawnGap · 生成间隔", () => {
  it("clamp(72 - speed*0.12, 44, 72)", () => {
    expect(spawnGap(0)).toBeCloseTo(72, 6);
    expect(spawnGap(120)).toBeCloseTo(72 - 14.4, 6);
    expect(spawnGap(200)).toBeCloseTo(48, 6);
  });

  it("间隔落在 44–72 米之间，满速卡在下限", () => {
    for (let speed = 0; speed <= 600; speed += 7) {
      const gap = spawnGap(speed);
      expect(gap).toBeGreaterThanOrEqual(44);
      expect(gap).toBeLessThanOrEqual(72);
    }
    expect(spawnGap(SPEED_MAX)).toBe(44);
    expect(spawnGap(10000)).toBe(44);
    expect(spawnGap(-50)).toBe(72);
  });

  it("换算成像素后，任何速度都容得下一次跳跃滞空", () => {
    // 间隔时间（秒）= 间隔像素 / 速度；必须大于不蓄力跳跃的 0.6 秒
    for (let speed = SPEED_BASE; speed <= SPEED_MAX; speed += 4) {
      const seconds = spawnGapPx(speed) / speed;
      expect(seconds).toBeGreaterThan(airTimeMs(0) / 1000);
    }
  });
});

describe("jumpVelocity / jumpHeight / airTimeMs · 蓄力映射", () => {
  it("0ms → -270，180ms 及以上 → -330", () => {
    expect(jumpVelocity(0)).toBe(JUMP_V);
    expect(jumpVelocity(HOLD_MS)).toBe(JUMP_V_MAX);
    expect(jumpVelocity(HOLD_MS + 500)).toBe(JUMP_V_MAX);
    expect(jumpVelocity(-30)).toBe(JUMP_V);
    expect(jumpVelocity(Number.NaN)).toBe(JUMP_V);
  });

  it("中间线性插值，90ms 正好是中点", () => {
    expect(jumpVelocity(90)).toBeCloseTo((JUMP_V + JUMP_V_MAX) / 2, 6);
    const low = jumpVelocity(45);
    const high = jumpVelocity(135);
    expect(high - low).toBeCloseTo((JUMP_V_MAX - JUMP_V) / 2, 6);
  });

  it("两端顶点高度：不蓄 40.5px，蓄满 60.5px", () => {
    // v²/(2g)
    const shortPeak = (JUMP_V * JUMP_V) / (2 * GRAVITY);
    const longPeak = (JUMP_V_MAX * JUMP_V_MAX) / (2 * GRAVITY);
    expect(shortPeak).toBeCloseTo(40.5, 6);
    expect(longPeak).toBeCloseTo(60.5, 6);

    const shortAirMs = (-JUMP_V / GRAVITY) * 1000;
    const longAirMs = (-JUMP_V_MAX / GRAVITY) * 1000;
    expect(jumpHeight(shortAirMs, 0)).toBeCloseTo(shortPeak, 4);
    expect(jumpHeight(longAirMs, HOLD_MS)).toBeCloseTo(longPeak, 4);
  });

  it("蓄力越高，同一时刻离地越高", () => {
    const at = 200;
    expect(jumpHeight(at, HOLD_MS)).toBeGreaterThan(jumpHeight(at, 90));
    expect(jumpHeight(at, 90)).toBeGreaterThan(jumpHeight(at, 0));
  });

  it("滞空 600ms（不蓄）到 733ms（蓄满）", () => {
    expect(airTimeMs(0)).toBe(600);
    expect(airTimeMs(HOLD_MS)).toBe(733);
    expect(airTimeMs(999)).toBe(airTimeMs(HOLD_MS));
  });

  it("不蓄力的一跳已经够跨过 18px 的箱子", () => {
    const peak = jumpHeight(300, 0);
    expect(peak).toBeGreaterThan(OBSTACLE_SIZE.box.h);
  });
});

describe("stepPlayer · 起跳落地", () => {
  it("起跳后腾空，落地回到地面且状态归零", () => {
    const player = createPlayer();
    expect(player.airborne).toBe(false);
    expect(player.feetY).toBe(GROUND_Y);

    takeOff(player);
    expect(player.airborne).toBe(true);

    stepPlayer(player, 200, true);
    expect(player.airborne).toBe(true);
    expect(player.feetY).toBeLessThan(GROUND_Y);

    const total = simulateJump(HOLD_MS, true);
    const fresh = createPlayer();
    takeOff(fresh);
    let guard = 0;
    while (fresh.airborne && guard < 400) {
      stepPlayer(fresh, 16, false);
      guard += 1;
    }
    expect(fresh.airborne).toBe(false);
    expect(fresh.feetY).toBe(GROUND_Y);
    expect(fresh.airMs).toBe(0);
    expect(fresh.holdMs).toBe(0);
    expect(total).toBeGreaterThan(500);
  });

  it("按住比不按滞空更久", () => {
    expect(simulateJump(HOLD_MS, true)).toBeGreaterThan(simulateJump(0, false));
  });

  it("地面上的玩家再推进也不会离地", () => {
    const player = createPlayer();
    for (let i = 0; i < 10; i += 1) stepPlayer(player, 16, true);
    expect(player.airborne).toBe(false);
    expect(player.feetY).toBe(GROUND_Y);
  });
});

describe("playerBox · 滑行变矮", () => {
  it("站立 30 高、脚底贴地，碰撞盒比视觉窄（擦边不算撞）", () => {
    const box = playerBox(GROUND_Y, false);
    expect(box.h).toBe(PLAYER_H);
    expect(box.y + box.h).toBe(GROUND_Y);
    expect(box.w).toBe(PLAYER_HIT_W);
    expect(box.w).toBeLessThan(PLAYER_W);
    // 水平居中在 PLAYER_X 上
    expect(box.x + box.w / 2).toBe(PLAYER_X);
  });

  it("滑行 16 高，脚底不变、顶边下移 14px", () => {
    const standing = playerBox(GROUND_Y, false);
    const sliding = playerBox(GROUND_Y, true);
    expect(sliding.h).toBe(SLIDE_H);
    expect(sliding.x).toBe(standing.x);
    expect(sliding.w).toBe(standing.w);
    expect(sliding.y + sliding.h).toBe(standing.y + standing.h);
    expect(sliding.y - standing.y).toBe(PLAYER_H - SLIDE_H);
  });

  it("腾空时脚底跟着升，盒子整体上移", () => {
    const ground = playerBox(GROUND_Y, false);
    const air = playerBox(GROUND_Y - 40, false);
    expect(air.y).toBe(ground.y - 40);
    expect(air.x).toBe(ground.x);
  });
});

describe("obstacleBox / overlaps · 几何与碰撞", () => {
  it("木箱贴地 28×18", () => {
    const box = obstacleBox(makeObstacle("box", 100));
    expect(box).toEqual({ x: 100, y: GROUND_Y - 18, w: 28, h: 18 });
  });

  it("横梁从画面顶端垂到离地 18px，跳不过去只能滑", () => {
    const box = obstacleBox(makeObstacle("beam", 100));
    expect(box.w).toBe(20);
    expect(box.y).toBe(0);
    // 底边 = 地面 - 净空 18
    expect(box.y + box.h).toBe(GROUND_Y - BEAM_CLEARANCE);
  });

  it("飞鸟上沿始终落在 110–130 之间", () => {
    const rng = seeded(2026);
    for (let i = 0; i < 60; i += 1) {
      const bird = makeObstacle("bird", i * 7 - 40, i, rng);
      const box = obstacleBox(bird);
      expect(box.y).toBeGreaterThanOrEqual(BIRD_MIN_Y);
      expect(box.y).toBeLessThanOrEqual(BIRD_MAX_Y);
      expect(box.w).toBe(16);
      expect(box.h).toBe(OBSTACLE_SIZE.bird.h);
    }
  });

  it("严格 AABB：边缘相接不算碰撞", () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    expect(overlaps(a, { x: 9.9, y: 0, w: 10, h: 10 })).toBe(true);
    expect(overlaps(a, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
    expect(overlaps(a, { x: 0, y: 10, w: 10, h: 10 })).toBe(false);
    expect(overlaps(a, { x: 2, y: 2, w: 4, h: 4 })).toBe(true);
    expect(overlaps(a, { x: -20, y: 0, w: 10, h: 10 })).toBe(false);
  });

  it("站着会撞横梁，滑行能从梁下钻过去", () => {
    const beam = makeObstacle("beam", PLAYER_X - 10);
    expect(collisionAt(GROUND_Y, false, [beam])).not.toBeNull();
    expect(collisionAt(GROUND_Y, true, [beam])).toBeNull();
  });

  it("木箱必须跳：站着撞、跳到顶点不撞", () => {
    const box = makeObstacle("box", PLAYER_X - 14);
    expect(collisionAt(GROUND_Y, false, [box])).not.toBeNull();
    expect(collisionAt(GROUND_Y, true, [box])).not.toBeNull();

    const peakFeet = GROUND_Y - jumpHeight(300, 0);
    expect(collisionAt(peakFeet, false, [box])).toBeNull();
  });

  it("飞鸟悬在头顶：跑着安全，跳进它的高度才撞", () => {
    const bird = makeObstacle("bird", PLAYER_X - 8, 1, () => 0);
    expect(obstacleBox(bird).y).toBeGreaterThanOrEqual(BIRD_MIN_Y);
    expect(collisionAt(GROUND_Y, false, [bird])).toBeNull();

    const peakFeet = GROUND_Y - jumpHeight(300, 0);
    expect(collisionAt(peakFeet, false, [bird])).not.toBeNull();
  });

  it("离得远的障碍不误判", () => {
    const far = makeObstacle("box", 120);
    expect(collisionAt(GROUND_Y, false, [far])).toBeNull();
    expect(collisionAt(GROUND_Y, false, [])).toBeNull();
  });
});

describe("金币 · 弧线与计分", () => {
  it("弧线中段最高，两端低于顶点", () => {
    const spots = coinArc(SPEED_BASE);
    expect(spots).toHaveLength(3);
    const [first, middle, last] = spots;
    expect(middle!.y).toBeLessThan(first!.y);
    expect(middle!.y).toBeLessThan(last!.y);
    expect(first!.dx).toBeLessThan(middle!.dx);
    expect(middle!.dx).toBeLessThan(last!.dx);
  });

  it("金币都落在跳跃可达的高度区间里", () => {
    // 金币中心贴身体中线：能到的高度上限 = 顶点 + 半个身位
    const peak = jumpHeight(300, 0) + PLAYER_H / 2;
    for (const spot of coinArc(SPEED_BASE)) {
      const height = GROUND_Y - spot.y;
      expect(height).toBeGreaterThan(0);
      expect(height).toBeLessThanOrEqual(peak + 0.001);
    }
  });

  it("速度越高，弧线铺得越开", () => {
    const slow = coinArc(120);
    const fast = coinArc(300);
    expect(fast[2]!.dx).toBeGreaterThan(slow[2]!.dx);
    // 纵向弧线只跟重力有关，和速度无关
    expect(fast[1]!.y).toBeCloseTo(slow[1]!.y, 6);
  });

  it("maxSpan 会裁掉太远的金币", () => {
    // 120px/s 时三颗金币的 dx ≈ 16.8 / 33.6 / 50.4
    expect(coinArc(SPEED_BASE, 20)).toHaveLength(1);
    expect(coinArc(SPEED_BASE, 40)).toHaveLength(2);
    expect(coinArc(SPEED_BASE, 0)).toHaveLength(0);
    expect(coinArc(SPEED_BASE, Number.NaN)).toHaveLength(3);
  });

  it("金币不会压在障碍上", () => {
    const obstacles: Obstacle[] = [
      makeObstacle("box", 60),
      makeObstacle("beam", 120),
      makeObstacle("bird", 180, 3, seeded(7)),
    ];
    const coins: Coin[] = [];
    for (let x = 20; x < 200; x += 6) {
      coins.push({ x, y: 120, taken: false });
    }
    const kept = safeCoins(coins, obstacles);
    expect(kept.length).toBeLessThan(coins.length);
    for (const coin of kept) {
      for (const obstacle of obstacles) {
        expect(overlaps(
          { x: coin.x - 4, y: coin.y - 4, w: 8, h: 8 },
          obstacleBox(obstacle),
        )).toBe(false);
      }
    }
  });

  it("腾空穿过金币才算吃到，贴地走过吃不到高处的金币", () => {
    const high: Coin = { x: PLAYER_X, y: GROUND_Y - 40, taken: false };
    // 金币在跳跃顶点高度：地面上够不着，跳到顶点才吃到
    expect(coinPicked(GROUND_Y, false, high)).toBe(false);
    expect(coinPicked(GROUND_Y - jumpHeight(300, 0), false, high)).toBe(true);

    const ground: Coin = { x: PLAYER_X, y: GROUND_Y - 6, taken: false };
    expect(coinPicked(GROUND_Y, false, ground)).toBe(true);
    expect(coinPicked(GROUND_Y, true, ground)).toBe(true);
  });

  it("已吃掉的金币不会再被判定", () => {
    const coin: Coin = { x: PLAYER_X, y: GROUND_Y - 15, taken: true };
    expect(coinPicked(GROUND_Y, false, coin)).toBe(false);
  });

  it("金币 +10，可以链式累加", () => {
    expect(COIN_SCORE).toBe(10);
    expect(addScore(true, 0)).toBe(10);
    expect(addScore(false, 50)).toBe(50);
    expect(addScore(true, 90)).toBe(100);
    let score = 0;
    for (let i = 0; i < 7; i += 1) score = addScore(true, score);
    expect(score).toBe(70);
  });
});

describe("pickObstacleKind · 障碍抽取", () => {
  it("按概率分成箱子 / 横梁 / 飞鸟三档", () => {
    expect(pickObstacleKind(() => 0)).toBe("box");
    expect(pickObstacleKind(() => 0.41)).toBe("box");
    expect(pickObstacleKind(() => 0.42)).toBe("beam");
    expect(pickObstacleKind(() => 0.73)).toBe("beam");
    expect(pickObstacleKind(() => 0.74)).toBe("bird");
    expect(pickObstacleKind(() => 0.999999)).toBe("bird");
  });

  it("和上一只同款时顺移一档，不连出两次同款", () => {
    expect(pickObstacleKind(() => 0, "box")).toBe("beam");
    expect(pickObstacleKind(() => 0.5, "beam")).toBe("bird");
    expect(pickObstacleKind(() => 0.9, "bird")).toBe("box");
  });

  it("随便什么随机源都只吐出三种合法障碍", () => {
    const rng = seeded(99);
    for (let i = 0; i < 200; i += 1) {
      const kind = pickObstacleKind(rng);
      expect(["box", "beam", "bird"]).toContain(kind);
    }
  });
});

describe("clampHud · HUD 位数", () => {
  it("超出上限就夹住，负数归零", () => {
    expect(clampHud(123, 99999)).toBe(123);
    expect(clampHud(123456, 99999)).toBe(99999);
    expect(clampHud(-1, 9999)).toBe(0);
    expect(clampHud(42.6, 99)).toBe(43);
    expect(clampHud(Number.NaN, 99)).toBe(0);
    expect(clampHud(Infinity, 99)).toBe(99);
  });
});

describe("三种障碍的解法（规则可玩性）", () => {
  /** 让障碍从右侧滚过来，按指定提前帧数起跳，返回整段是否安全。 */
  const boxJumpSafe = (speed: number, takeoffFrame: number): boolean => {
    const obstacle = makeObstacle("box", PLAYER_X + 5 + 180, 1);
    const player = createPlayer();
    for (let frame = 0; frame < 300; frame += 1) {
      obstacle.x -= (speed * 16) / 1000;
      if (frame === takeoffFrame) takeOff(player);
      stepPlayer(player, 16, false);
      if (collisionAt(player.feetY, false, [obstacle])) return false;
      if (obstacle.x + OBSTACLE_SIZE.box.w < -40) return true;
    }
    return true;
  };

  it("木箱：跳得过去，而且有可用的时间窗", () => {
    for (const speed of [120, 200, 300]) {
      let safe = 0;
      for (let f = 0; f < 120; f += 1) {
        if (boxJumpSafe(speed, f)) safe += 1;
      }
      // 至少 4 帧（≈64ms）的容错窗口，手感不至于苛刻到无法练习
      expect(safe).toBeGreaterThanOrEqual(4);
    }
  });

  it("横梁：无论是站立还是跳到任何高度都过不去，只能滑", () => {
    const beam = makeObstacle("beam", PLAYER_X - 10);
    expect(collisionAt(GROUND_Y, false, [beam])).not.toBeNull();
    expect(collisionAt(GROUND_Y, true, [beam])).toBeNull();

    // 扫一整个跳跃过程：站立姿态的每一帧都撞
    const player = createPlayer();
    takeOff(player);
    let airborneFrames = 0;
    for (let i = 0; i < 120 && player.airborne; i += 1) {
      stepPlayer(player, 16, true);
      if (!player.airborne) break;
      airborneFrames += 1;
      expect(collisionAt(player.feetY, false, [beam])).not.toBeNull();
    }
    expect(airborneFrames).toBeGreaterThan(10);
  });

  it("横梁的滑行净空正好卡在站立 / 滑行两个高度之间", () => {
    const beam = makeObstacle("beam", 0);
    const box = obstacleBox(beam);
    const beamBottom = box.y + box.h;
    expect(beamBottom).toBe(GROUND_Y - 18);
    // 站立顶边（140）在梁底（152）上面 → 撞
    expect(GROUND_Y - PLAYER_H).toBeLessThan(beamBottom);
    // 滑行顶边（154）在梁底（152）下面 → 过
    expect(GROUND_Y - SLIDE_H).toBeGreaterThan(beamBottom);
  });

  it("飞鸟：站着、滑着都能过，只有跳起来才可能撞", () => {
    for (const roll of [0, 0.25, 0.5, 0.75, 1]) {
      const bird = makeObstacle("bird", PLAYER_X - 8, 1, () => roll);
      expect(collisionAt(GROUND_Y, false, [bird])).toBeNull();
      expect(collisionAt(GROUND_Y, true, [bird])).toBeNull();
    }
  });
});
