/* 首页：绘制缩略图、读取最高分、维护一点点待机动画 */
(function (window, document) {
  "use strict";

  var A = window.Arcade;
  var P = A.P;
  var Art = A.Art;
  var W = 80;
  var H = 50;

  var whackCanvas = null;
  var idleTimer = null;

  function thumbContext(canvas) {
    var ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.imageSmoothingEnabled = false;
    return ctx;
  }

  function border(ctx, color) {
    Art.rect(ctx, 0, 0, W, 1, color);
    Art.rect(ctx, 0, H - 1, W, 1, color);
    Art.rect(ctx, 0, 0, 1, H, color);
    Art.rect(ctx, W - 1, 0, 1, H, color);
  }

  function drawWhack(canvas, time) {
    var ctx = thumbContext(canvas);
    var t = time || 0;

    Art.paintGrass(ctx, W, H, 1337);

    // 顶部与底部压暗，像一块街机屏幕
    Art.rect(ctx, 0, 0, W, 2, P.night);
    Art.rect(ctx, 0, H - 2, W, 2, P.night);

    // 主土坑
    var holeX = 28;
    var holeY = 38;
    Art.drawHoleBack(ctx, holeX, holeY);

    var bob = Math.round(1 + Math.sin(t * 2.1));
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, holeY + 8);
    ctx.clip();
    Art.drawMole(ctx, holeX, holeY - 24 + bob, "gold", {});
    ctx.restore();
    Art.drawHoleFront(ctx, holeX, holeY);

    // 锤子
    var hammerY = 33 + (Math.sin(t * 1.7 + 1) > 0 ? 0 : 1);
    Art.drawHammer(ctx, 58, hammerY, false);

    // 金闪闪
    var pulse = (Math.sin(t * 3.1) + 1) / 2;
    Art.drawSparkle(ctx, 13, 15, pulse > 0.55 ? 2 : 1, P.gold);
    Art.drawSparkle(ctx, 52, 8, 1, P.amber);
    Art.drawSparkle(ctx, 72, 43, pulse > 0.7 ? 1 : 0, P.cream);

    // 像素边框 + 两颗铆钉
    border(ctx, P.dirtDeep);
    Art.rect(ctx, 2, 2, 1, 1, P.cream);
    Art.rect(ctx, W - 3, H - 3, 1, 1, P.cream);
  }

  function drawSoon(canvas, seed) {
    var ctx = thumbContext(canvas);
    var rng = A.util.mulberry32(seed * 7919 + 13);
    var centerX = 40;
    var baseY = 16;

    Art.rect(ctx, 0, 0, W, H, P.night);

    // 背景点阵
    for (var y = 4; y < H; y += 6) {
      for (var x = 4; x < W; x += 6) {
        Art.rect(ctx, x, y, 1, 1, P.panel2);
      }
    }

    // 背景星点
    for (var s = 0; s < 12; s++) {
      var sx = 2 + Math.floor(rng() * 76);
      var sy = 2 + Math.floor(rng() * 46);
      Art.rect(ctx, sx, sy, 1, 1, rng() < 0.4 ? P.lineHi : P.purple);
    }

    // 半张对称小怪物，每次都长得不一样
    var half = [];
    for (var row = 0; row < 7; row++) {
      var line = [];
      for (var col = 0; col < 5; col++) {
        line.push(rng() < 0.48 ? 1 : 0);
      }
      half.push(line);
    }
    // 保证有身体、有头、有脚
    half[0][0] = 1;
    half[1][0] = 1;
    half[1][1] = 1;
    half[2][0] = 1;
    half[5][2] = 1;
    half[6][1] = 1;
    half[6][2] = 1;

    var bodyColor = seed % 3 === 0 ? P.purple : P.lav;
    var shadeColor = seed % 3 === 0 ? P.lineHi : P.purple;
    var unit = 3;
    var baseX = centerX - 14;

    // 身体强制对称，并且保证眼睛的位置有肉
    half[2][2] = 1;
    half[2][3] = 1;

    function eachBlock(callback) {
      for (var r = 0; r < 7; r++) {
        for (var c = 0; c < 5; c++) {
          if (!half[r][c]) continue;
          callback(baseX + (4 - c) * unit, baseY + r * unit, r, c, -1);
          if (c > 0) {
            callback(baseX + (4 + c) * unit, baseY + r * unit, r, c, 1);
          }
        }
      }
    }

    // 阴影
    eachBlock(function (x, y) {
      Art.rect(ctx, x + 1, y + 2, unit, unit, P.void);
    });

    // 身体（左右镜像）
    eachBlock(function (x, y, r, c) {
      Art.rect(ctx, x, y, unit, unit, bodyColor);
      if (r < 2 || (r === 2 && c === 1)) {
        Art.rect(ctx, x, y, unit - 1, 1, shadeColor);
      }
    });

    // 眼睛
    var eyeColor = seed % 2 === 0 ? P.amber : P.mint;
    Art.rect(ctx, centerX - 8, baseY + 6, unit, unit, P.void);
    Art.rect(ctx, centerX + 5, baseY + 6, unit, unit, P.void);
    Art.rect(ctx, centerX - 7, baseY + 6, unit - 1, unit - 1, eyeColor);
    Art.rect(ctx, centerX + 6, baseY + 6, unit - 1, unit - 1, eyeColor);
    Art.rect(ctx, centerX - 7, baseY + 6, 1, 1, P.white);
    Art.rect(ctx, centerX + 6, baseY + 6, 1, 1, P.white);

    // 天线
    if (seed % 3 !== 1) {
      Art.rect(ctx, centerX - 10, baseY - 6, 1, 6, shadeColor);
      Art.rect(ctx, centerX + 9, baseY - 6, 1, 6, shadeColor);
      Art.rect(ctx, centerX - 11, baseY - 7, 3, 3, bodyColor);
      Art.rect(ctx, centerX + 9, baseY - 7, 3, 3, bodyColor);
    }

    border(ctx, P.line);
  }

  function paint() {
    var active = document.querySelector('[data-thumb="whack"]');
    var soon = document.querySelectorAll('[data-thumb="soon"]');

    whackCanvas = active;
    if (active) drawWhack(active, 0);

    for (var i = 0; i < soon.length; i++) {
      var canvas = soon[i];
      drawSoon(canvas, Number(canvas.dataset.seed) || i + 2);
    }
  }

  function refreshBest() {
    var best = A.Store.best("whack");
    var nodes = document.querySelectorAll('[data-best="whack"]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = String(best).padStart(5, "0");
      var card = nodes[i].closest(".game-card");
      if (card) {
        card.setAttribute(
          "aria-label",
          "打地鼠，30 秒挑战，最高分 " + best + "，开始游戏"
        );
      }
    }
  }

  function startIdle() {
    if (!whackCanvas || A.util.prefersReducedMotion()) return;
    if (idleTimer) return;
    idleTimer = window.setInterval(function () {
      drawWhack(whackCanvas, performance.now() / 1000);
    }, 110);
  }

  function stopIdle() {
    if (idleTimer) {
      window.clearInterval(idleTimer);
      idleTimer = null;
    }
  }

  function onVisibility() {
    if (document.hidden) stopIdle();
    else startIdle();
  }

  A.ready(function () {
    A.Icons.paintAll();
    paint();
    refreshBest();
    startIdle();

    window.addEventListener("resize", function () {
      A.Icons.paintAll();
    });

    window.addEventListener("pageshow", refreshBest);

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", stopIdle);
  });
})(window, document);
