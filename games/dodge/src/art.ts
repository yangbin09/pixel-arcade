import { P, fillCircle, mulberry32, rect, sparkle } from "@arcade/core";

/**
 * 陨石雨的像素素材。全部按逻辑像素绘制：
 * - 深空背景（固定星尘 + 地平线光带，只画一次）
 * - 9×9 飞船 / 两层拖影 / 护盾虚线环
 * - 5–11px 带旋转陨坑的陨石
 * - 护盾掉落图标
 */

/** 只画一次的静态背景：深空底色、稀疏星尘、底部地平线光带。 */
export function paintBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  rect(ctx, 0, 0, w, h, P.night);

  // 顶部两段微亮，给纯色深空一点层次
  ctx.save();
  ctx.globalAlpha = 0.4;
  rect(ctx, 0, 0, w, 24, P.panel);
  ctx.globalAlpha = 0.18;
  rect(ctx, 0, 24, w, 34, P.panel);
  ctx.restore();

  // 远处的固定星尘，用固定种子保证每次打开构图一致
  const random = mulberry32(20261118);
  for (let i = 0; i < 64; i += 1) {
    const x = Math.floor(random() * w);
    const y = Math.floor(random() * (h - 20));
    const tone = random();
    rect(ctx, x, y, 1, 1, tone > 0.86 ? P.lav : tone > 0.6 ? P.purple : P.line);
  }

  // 地平线：一条中间微拱的亮弧，下面压两层淡光
  const base = h - 10;
  for (let x = 0; x < w; x += 1) {
    const arch = Math.round(Math.sin((x / Math.max(1, w - 1)) * Math.PI) * 2);
    rect(ctx, x, base + arch, 1, 1, P.lineHi);
    rect(ctx, x, base + arch + 1, 1, 1, P.purple);
  }
  ctx.save();
  ctx.globalAlpha = 0.16;
  rect(ctx, 0, base + 4, w, 4, P.lineHi);
  ctx.restore();
  rect(ctx, 0, h - 2, w, 2, P.void);
}

/** 飞船：9×9，薄荷色机身、奶白机鼻与座舱、琥珀尾焰。 */
export function drawShip(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  flame: boolean,
): void {
  const x = Math.round(cx) - 4;
  const y = Math.round(cy) - 4;

  rect(ctx, x + 4, y, 1, 1, P.white);
  rect(ctx, x + 3, y + 1, 3, 1, P.cream);
  rect(ctx, x + 2, y + 2, 5, 1, P.mint);
  rect(ctx, x + 1, y + 3, 7, 1, P.mint);
  rect(ctx, x, y + 4, 9, 1, P.grassHi);
  rect(ctx, x + 1, y + 5, 7, 1, P.mint);
  rect(ctx, x + 2, y + 6, 5, 1, P.grass);

  // 座舱与翼尖灯
  rect(ctx, x + 4, y + 2, 1, 2, P.white);
  rect(ctx, x, y + 4, 1, 1, P.gold);
  rect(ctx, x + 8, y + 4, 1, 1, P.gold);

  // 尾焰两帧交替
  if (flame) {
    rect(ctx, x + 3, y + 7, 1, 1, P.orange);
    rect(ctx, x + 4, y + 7, 1, 2, P.gold);
    rect(ctx, x + 5, y + 7, 1, 1, P.orange);
  } else {
    rect(ctx, x + 4, y + 7, 1, 1, P.amber);
    rect(ctx, x + 4, y + 8, 1, 1, P.orange);
  }
}

/** 拖影：只画轮廓剪影，调用方给透明度。 */
export function drawShipGhost(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  alpha: number,
): void {
  const x = Math.round(cx) - 4;
  const y = Math.round(cy) - 4;
  ctx.globalAlpha = alpha;
  rect(ctx, x + 4, y + 1, 1, 3, P.purple);
  rect(ctx, x + 2, y + 2, 5, 3, P.purple);
  rect(ctx, x + 1, y + 3, 7, 2, P.purple);
  ctx.globalAlpha = 1;
}

/** 护盾提示：绕着飞船转的 8 个点。 */
export function drawShieldRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  phase: number,
): void {
  for (let i = 0; i < 8; i += 1) {
    const angle = phase + (i * Math.PI) / 4;
    rect(
      ctx,
      Math.round(cx + Math.cos(angle) * radius),
      Math.round(cy + Math.sin(angle) * radius),
      1,
      1,
      i % 2 === 0 ? P.mint : P.white,
    );
  }
}

/** 陨石：实心像素圆 + 随 spin 转动的陨坑与凸起。 */
export function drawMeteor(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  spin: number,
  kind: number,
): void {
  let body = P.dirt;
  let rim = P.dirtHi;
  let crater = P.dirtDeep;
  if (kind === 1) {
    body = P.panel2;
    rim = P.lineHi;
    crater = P.line;
  } else if (kind === 2) {
    body = P.purple;
    rim = P.lav;
    crater = P.line;
  } else if (kind === 3) {
    body = P.dirtDeep;
    rim = P.dirt;
    crater = P.hole;
  }

  const px = Math.round(cx);
  const py = Math.round(cy);
  const radius = Math.max(2, Math.round(r));
  fillCircle(ctx, px, py, radius, body);

  // 左上高光弧，让石头的受光方向统一
  const rimSteps = radius >= 4 ? 3 : 2;
  for (let i = 0; i < rimSteps; i += 1) {
    const angle = -2.5 + i * 0.42;
    rect(
      ctx,
      Math.round(px + Math.cos(angle) * (radius - 0.4)),
      Math.round(py + Math.sin(angle) * (radius - 0.4)),
      1,
      1,
      rim,
    );
  }

  // 旋转的陨坑：越大的石头坑越多
  const craters = radius >= 4 ? 3 : 2;
  for (let i = 0; i < craters; i += 1) {
    const angle = spin + kind * 1.9 + (i * Math.PI * 2) / craters;
    const distance = radius * (i === 0 ? 0.35 : 0.55);
    rect(
      ctx,
      Math.round(px + Math.cos(angle) * distance),
      Math.round(py + Math.sin(angle) * distance),
      i === 1 ? 2 : 1,
      1,
      crater,
    );
  }

  // 轮廓外的一个像素凸起，跟着 spin 绕圈，强化旋转感
  rect(
    ctx,
    Math.round(px + Math.cos(spin * 1.3) * radius),
    Math.round(py + Math.sin(spin * 1.3) * radius),
    1,
    1,
    body,
  );
}

/** 护盾掉落：7×7 盾牌，内部十字会闪，外圈有绕转星芒。 */
export function drawShieldPickup(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  phase: number,
): void {
  const x = Math.round(cx) - 3;
  const y = Math.round(cy) - 3;

  // 盾牌轮廓
  rect(ctx, x + 1, y, 5, 1, P.mint);
  rect(ctx, x, y + 1, 7, 3, P.mint);
  rect(ctx, x + 1, y + 4, 5, 1, P.mint);
  rect(ctx, x + 2, y + 5, 3, 1, P.mint);
  rect(ctx, x + 3, y + 6, 1, 1, P.mint);

  // 内层深色底
  rect(ctx, x + 1, y + 1, 5, 3, P.night);
  rect(ctx, x + 2, y + 4, 3, 1, P.night);

  // 十字：呼吸闪烁
  const bright = Math.sin(phase * 2.4) > 0.1;
  const cross = bright ? P.white : P.cream;
  rect(ctx, x + 2, y + 2, 3, 1, cross);
  rect(ctx, x + 3, y + 1, 1, 3, cross);

  // 绕转的星芒
  const angle = phase * 1.6;
  sparkle(
    ctx,
    Math.round(cx + Math.cos(angle) * 7),
    Math.round(cy + Math.sin(angle) * 7),
    1,
    P.mint,
    P.white,
  );
}
