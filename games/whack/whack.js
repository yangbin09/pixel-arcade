/* ============================================================
   打地鼠 · Whack-a-Mole
   内部画面 168 x 168：3 x 3 土坑，48px 格子
   纯 Canvas 2D 像素绘制 / WebAudio 合成 / 原生键盘与指针输入
   ============================================================ */
(function (window, document) {
  "use strict";

  var A = window.Arcade;
  var P = A.P;
  var Art = A.Art;
  var util = A.util;
  var Sound = A.Sound;

  var W = 168;
  var CELL = 48;
  var GAP = 4;
  var GRID = CELL + GAP;
  var MARGIN = 8;
  var ROUND_MS = 30000;
  var CD_MS = 3000;

  var LEVELS = [
    { spawn: 500, up: 1050, goldUp: 520, cap: 2, goldChance: 0.07 },
    { spawn: 420, up: 920, goldUp: 480, cap: 3, goldChance: 0.09 },
    { spawn: 340, up: 780, goldUp: 430, cap: 3, goldChance: 0.11 },
  ];

  var TIER_COLORS = [P.cream, P.gold, P.orange, P.mint];

  var S = {
    mode: "ready",
    prevMode: "playing",
    clock: 0,
    running: false,
    raf: 0,
    lastTs: 0,
    playStart: 0,
    nextSpawn: 0,
    lastCd: 4,
    lastSec: 30,
    lastBarPct: 100,
    level: -1,
    lastTier: 1,
    holes: [],
    hover: { x: 0, y: 0, inside: false },
    strike: null,
    markCell: -1,
    markUntil: 0,
    particles: [],
    popups: [],
    shake: 0,
    flash: 0,
    score: 0,
    combo: 0,
    maxCombo: 0,
    hits: 0,
    taps: 0,
    golds: 0,
    lastSpawn: -1,
    best: 0,
    hammerVisible: false,
  };

  var els = {};
  var ui = {};
  var ctx = null;
  var unit = 1;
  var bgLayer = null;
  var frontLayer = null;
  var layoutQueued = false;
  var toastTimer = 0;

  function $(id) {
    return document.getElementById(id);
  }

  /* ---------------- 几何 ---------------- */

  function cellRect(index) {
    var col = index % 3;
    var row = (index / 3) | 0;
    var x = MARGIN + col * GRID;
    var y = MARGIN + row * GRID;
    return { x: x, y: y, cx: x + CELL / 2, cy: y + 30 };
  }

  function cellAt(x, y) {
    if (x < MARGIN || y < MARGIN || x >= W - MARGIN || y >= W - MARGIN) {
      return -1;
    }
    var rx = x - MARGIN;
    var ry = y - MARGIN;
    var col = Math.floor(rx / GRID);
    var row = Math.floor(ry / GRID);
    if (col < 0 || col > 2 || row < 0 || row > 2) return -1;
    if (rx - col * GRID >= CELL) return -1;
    if (ry - row * GRID >= CELL) return -1;
    return row * 3 + col;
  }

  function multFor(combo) {
    if (combo >= 20) return 4;
    if (combo >= 10) return 3;
    if (combo >= 5) return 2;
    return 1;
  }

  function levelFor(elapsed) {
    if (elapsed >= 20000) return 2;
    if (elapsed >= 10000) return 1;
    return 0;
  }

  /* ---------------- 静态画面 ---------------- */

  function buildStaticLayers() {
    bgLayer = document.createElement("canvas");
    bgLayer.width = W;
    bgLayer.height = W;
    var bg = bgLayer.getContext("2d");
    bg.imageSmoothingEnabled = false;
    Art.paintGrass(bg, W, W, 4242);

    frontLayer = document.createElement("canvas");
    frontLayer.width = W;
    frontLayer.height = W;
    var front = frontLayer.getContext("2d");
    front.imageSmoothingEnabled = false;

    for (var i = 0; i < 9; i++) {
      var c = cellRect(i);
      Art.drawHoleBack(bg, c.cx, c.cy);
      Art.drawHoleFront(front, c.cx, c.cy);
    }
  }

  /* ---------------- 数值显示 ---------------- */

  function setupText() {
    ui.time = new A.PixelText(els.timeDisplay, {
      size: 3,
      color: P.cream,
      pad: 2,
      minChars: 2,
    });
    ui.score = new A.PixelText(els.scoreDisplay, {
      size: 3,
      color: P.gold,
      pad: 5,
      minChars: 5,
    });
    ui.combo = new A.PixelText(els.comboDisplay, {
      size: 3,
      color: P.cream,
      pad: 2,
      minChars: 2,
    });
    ui.final = new A.PixelText(els.finalScore, {
      size: 5,
      color: P.gold,
      pad: 5,
      minChars: 5,
      shadow: P.dirtDeep,
    });
  }

  function updateTimeDisplay(remainingMs, force) {
    var seconds = Math.max(0, Math.ceil(remainingMs / 1000));
    if (force || seconds !== S.lastSec) {
      S.lastSec = seconds;
      ui.time.set(seconds);
      els.timeDisplay.setAttribute("aria-label", "剩余时间 " + seconds + " 秒");

      var critical = seconds <= 5 && seconds > 0;
      var low = seconds <= 10 && seconds > 0;
      els.hud.classList.toggle("is-urgent", critical);
      els.timerWrap.classList.toggle("is-critical", critical);
      els.timerWrap.classList.toggle("is-low", low && !critical);
      ui.time.setColor(critical ? P.red : P.cream);
    }

    var pct = Math.max(0, Math.min(100, (remainingMs / ROUND_MS) * 100));
    var half = Math.round(pct * 2) / 2;
    if (force || half !== S.lastBarPct) {
      S.lastBarPct = half;
      els.timeFill.style.width = half + "%";
    }
  }

  function setScore(value, bump) {
    S.score = value;
    ui.score.set(value);
    els.scoreDisplay.setAttribute("aria-label", "分数 " + value);
    if (bump) flashStat(els.scoreStat, "is-bump");
  }

  function setCombo(value, bump) {
    S.combo = value;
    var tier = multFor(value);
    ui.combo.setColor(TIER_COLORS[tier - 1]);
    ui.combo.set(value);
    els.comboDisplay.setAttribute(
      "aria-label",
      "连击 " + value + "，倍率 " + tier
    );
    els.comboMult.textContent = "×" + tier;
    els.comboMult.classList.toggle("is-hot", tier >= 2 && tier < 4);
    els.comboMult.classList.toggle("is-max", tier >= 4);
    if (bump) flashStat(els.comboStat, "is-bump");
  }

  function resetHUD() {
    S.score = 0;
    S.combo = 0;
    S.lastTier = 1;
    S.lastSec = -1;
    S.lastBarPct = -1;
    setScore(0, false);
    setCombo(0, false);
    updateTimeDisplay(ROUND_MS, true);
    els.hud.classList.remove("is-urgent");
    els.timerWrap.classList.remove("is-low", "is-critical");
  }

  function flashStat(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    if (el._flashTimer) window.clearTimeout(el._flashTimer);
    el._flashTimer = window.setTimeout(function () {
      el.classList.remove(cls);
    }, 430);
  }

  function showToast(text, warn) {
    if (!els.toast) return;
    els.toast.textContent = text;
    els.toast.classList.toggle("is-warn", !!warn);
    els.toast.hidden = false;
    els.toast.classList.remove("is-show");
    void els.toast.offsetWidth;
    els.toast.classList.add("is-show");
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      els.toast.hidden = true;
      els.toast.classList.remove("is-show");
    }, 1040);
  }

  function announce(text) {
    if (els.live) els.live.textContent = text;
  }

  /* ---------------- 模式 / 弹层 ---------------- */

  function setMode(mode) {
    S.mode = mode;
    document.body.setAttribute("data-game-state", mode);
    els.pauseBtn.disabled = !(
      mode === "playing" ||
      mode === "countdown" ||
      mode === "paused"
    );
    updatePauseUI();
  }

  function updatePauseUI() {
    var paused = S.mode === "paused";
    A.Icons.paint(els.pauseIcon, paused ? "play" : "pause", 22);
    els.pauseBtn.setAttribute("aria-label", paused ? "继续游戏" : "暂停游戏");
    els.pauseBtn.setAttribute("aria-pressed", paused ? "true" : "false");
    els.pauseBtn.title = paused ? "继续" : "暂停";
  }

  function updateMuteUI() {
    A.Icons.paint(els.muteIcon, Sound.muted ? "muted" : "sound", 22);
    els.muteBtn.setAttribute("aria-pressed", Sound.muted ? "true" : "false");
    els.muteBtn.setAttribute("aria-label", "静音");
    els.muteBtn.title = Sound.muted ? "开启音效" : "关闭音效";
  }

  function showOverlay(panel, skipFocus) {
    els.overlay.hidden = false;
    els.readyPanel.hidden = panel !== "ready";
    els.pausePanel.hidden = panel !== "pause";
    els.resultPanel.hidden = panel !== "result";

    if (skipFocus) return;

    var target =
      panel === "result"
        ? els.replayBtn
        : panel === "pause"
        ? els.resumeBtn
        : els.overlay;

    window.requestAnimationFrame(function () {
      focusEl(target);
    });
  }

  function hideOverlay(focusField) {
    els.overlay.hidden = true;
    els.readyPanel.hidden = true;
    els.pausePanel.hidden = true;
    els.resultPanel.hidden = true;
    if (focusField) focusEl(els.field);
  }

  function focusEl(el) {
    if (!el) return;
    try {
      el.focus({ preventScroll: true });
    } catch (err) {
      el.focus();
    }
  }

  function visibleDialog() {
    if (els.overlay.hidden) return null;
    if (!els.readyPanel.hidden) return els.readyPanel;
    if (!els.pausePanel.hidden) return els.pausePanel;
    if (!els.resultPanel.hidden) return els.resultPanel;
    return null;
  }

  function trapFocus(e) {
    var dialog = visibleDialog();
    if (!dialog) return;
    var nodes = dialog.querySelectorAll("button:not(:disabled), a[href]");
    if (!nodes.length) return;
    var first = nodes[0];
    var last = nodes[nodes.length - 1];
    var active = document.activeElement;

    if (active !== els.overlay && dialog.contains(active)) {
      if (!e.shiftKey && active === last) {
        e.preventDefault();
        focusEl(first);
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        focusEl(last);
      }
      return;
    }

    e.preventDefault();
    focusEl(e.shiftKey ? last : first);
  }

  /* ---------------- 布局 ---------------- */

  function layout() {
    if (!els.screen) return;
    var width = els.screen.clientWidth;
    if (!width) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 4);
    var nextUnit = Math.max(1, Math.floor((width * dpr) / W));
    var css = (W * nextUnit) / dpr;
    var backing = W * nextUnit;

    if (els.field.width !== backing || els.field.height !== backing) {
      els.field.width = backing;
      els.field.height = backing;
    }
    els.field.style.width = css + "px";
    els.field.style.height = css + "px";

    unit = nextUnit;
    ctx = els.field.getContext("2d");
    ctx.setTransform(unit, 0, 0, unit, 0, 0);
    ctx.imageSmoothingEnabled = false;

    A.Icons.paintAll(document);
    ui.time.refresh();
    ui.score.refresh();
    ui.combo.refresh();
    ui.final.refresh();
    render();
  }

  function scheduleLayout() {
    if (layoutQueued) return;
    layoutQueued = true;
    window.requestAnimationFrame(function () {
      layoutQueued = false;
      layout();
    });
  }

  /* ---------------- 绘制 ---------------- */

  function render() {
    if (!ctx) return;

    // 底色铺满，震动时边缘不会露出透明
    ctx.fillStyle = P.grassDeep;
    ctx.fillRect(0, 0, W, W);

    var sx = 0;
    var sy = 0;
    if (S.shake > 0.2) {
      sx = Math.round(Math.sin(S.clock * 0.09) * S.shake);
      sy = Math.round(Math.cos(S.clock * 0.115) * S.shake * 0.7);
    }

    ctx.save();
    ctx.translate(sx, sy);

    ctx.drawImage(bgLayer, 0, 0);

    if (S.mode === "playing") drawHover();

    for (var i = 0; i < 9; i++) {
      var mole = S.holes[i];
      if (mole) drawMole(i, mole);
    }

    ctx.drawImage(frontLayer, 0, 0);

    drawParticles();

    if (S.flash > 0) {
      ctx.globalAlpha = Math.min(0.18, S.flash * 0.18);
      ctx.fillStyle = P.white;
      ctx.fillRect(0, 0, W, W);
      ctx.globalAlpha = 1;
    }

    drawHammer();
    drawPopups();

    ctx.restore();

    if (els.field.classList) {
      els.field.classList.toggle("has-hammer", S.hammerVisible);
    }

    if (S.mode === "countdown") {
      drawCountdown();
    } else if (S.mode === "playing" && S.clock - S.playStart < 430) {
      drawGo();
    }
  }

  function drawHover() {
    var index = -1;
    if (S.hover.inside) index = cellAt(S.hover.x, S.hover.y);
    if (index < 0 && S.markCell >= 0 && S.clock < S.markUntil) {
      index = S.markCell;
    }
    if (index < 0) return;

    var c = cellRect(index);
    var arm = 7;
    var pad = 2;
    var x = c.x + pad;
    var y = c.y + pad;
    var right = c.x + CELL - pad;
    var bottom = c.y + CELL - pad;

    ctx.globalAlpha = 0.82;
    ctx.fillStyle = P.amber;
    ctx.fillRect(x, y, arm, 1);
    ctx.fillRect(x, y, 1, arm);
    ctx.fillRect(right - arm, y, arm, 1);
    ctx.fillRect(right, y, 1, arm);
    ctx.fillRect(x, bottom - 1, arm, 1);
    ctx.fillRect(x, bottom - arm, 1, arm);
    ctx.fillRect(right - arm, bottom - 1, arm, 1);
    ctx.fillRect(right, bottom - arm, 1, arm);
    ctx.globalAlpha = 1;
  }

  function drawMole(index, mole) {
    var c = cellRect(index);
    var offset = 0;

    if (mole.hitAt) {
      var hitT = util.clamp((S.clock - mole.hitAt) / 180, 0, 1);
      offset = Math.round(34 * util.easeInQuad(hitT));
    } else {
      var riseT = util.clamp((S.clock - mole.born) / 125, 0, 1);
      offset = Math.round(34 * (1 - util.easeOutBack(riseT)));
      var retractStart = mole.hideAt - 130;
      if (S.clock > retractStart) {
        var rT = util.clamp((S.clock - retractStart) / 130, 0, 1);
        offset = Math.max(offset, Math.round(34 * util.easeInQuad(rT)));
      }
    }

    var flash = !!mole.hitAt && S.clock - mole.hitAt < 60;

    ctx.save();
    ctx.beginPath();
    ctx.rect(c.x, c.y, CELL, 38);
    ctx.clip();
    Art.drawMole(
      ctx,
      c.cx,
      c.cy - 24 + offset,
      mole.kind,
      { hit: !!mole.hitAt, flash: flash }
    );
    ctx.restore();

    if (mole.kind === "gold" && !mole.hitAt && S.clock - mole.born > 80) {
      var t = (S.clock - mole.born) / 260 + mole.seed;
      Art.drawSparkle(
        ctx,
        c.cx - 18 + Math.round(Math.sin(t) * 2),
        c.cy - 26,
        Math.sin(t * 1.7) > 0.2 ? 2 : 1,
        P.gold
      );
      Art.drawSparkle(
        ctx,
        c.cx + 18,
        c.cy - 9 + Math.round(Math.cos(t * 1.3) * 2),
        1,
        P.amber
      );
    }
  }

  function drawParticles() {
    var list = S.particles;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.life <= 0) continue;
      ctx.globalAlpha = Math.min(1, p.life / 160);
      if (p.star) {
        Art.drawSparkle(ctx, p.x, p.y, p.size + 1, p.color);
      } else {
        Art.rect(ctx, p.x, p.y, p.size, p.size, p.color);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawHammer() {
    S.hammerVisible = false;
    if (S.mode !== "playing") return;
    var strike = !!(S.strike && S.clock < S.strike.until);
    var point = null;

    if (S.hover.inside) {
      point = S.hover;
    } else if (strike) {
      point = S.strike;
    }
    if (!point) return;

    Art.drawHammer(ctx, point.x, point.y, strike);
    S.hammerVisible = true;
  }

  function drawPopups() {
    for (var i = 0; i < S.popups.length; i++) {
      var p = S.popups[i];
      var age = S.clock - p.born;
      if (age < 0 || age > p.life) continue;
      var k = age / p.life;
      var alpha = 1 - k * k;
      var width = A.Font.measure(p.text, 2);
      var x = util.clamp(p.x, width / 2 + 3, W - width / 2 - 3);
      var y = p.y - Math.round(k * 13);
      ctx.globalAlpha = Math.max(0, alpha);
      A.Font.draw(ctx, p.text, x - width / 2, y, 2, p.color, P.void);
      ctx.globalAlpha = 1;
    }
  }

  function drawCountdown() {
    var remaining = Math.max(0, CD_MS - S.clock);
    var n = util.clamp(Math.ceil(remaining / 1000), 1, 3);
    var color = n === 1 ? P.red : n === 2 ? P.gold : P.amber;

    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = P.void;
    ctx.fillRect(0, 0, W, W);
    ctx.globalAlpha = 1;

    // 硬阴影 + 面板
    Art.rect(ctx, 24, 28, 128, 122, P.void);
    Art.rect(ctx, 20, 24, 128, 122, P.night);
    Art.rect(ctx, 20, 24, 128, 2, P.lineHi);
    Art.rect(ctx, 20, 144, 128, 2, P.lineHi);
    Art.rect(ctx, 20, 24, 2, 122, P.lineHi);
    Art.rect(ctx, 146, 24, 2, 122, P.lineHi);
    Art.rect(ctx, 22, 26, 124, 2, P.amber);

    // 角上的像素铆钉
    Art.rect(ctx, 24, 30, 2, 2, P.cream);
    Art.rect(ctx, 142, 30, 2, 2, P.cream);
    Art.rect(ctx, 24, 138, 2, 2, P.cream);
    Art.rect(ctx, 142, 138, 2, 2, P.cream);

    var label = "GET READY";
    var labelW = A.Font.measure(label, 2);
    A.Font.draw(ctx, label, (W - labelW) / 2, 39, 2, P.lav, P.void);

    var text = String(n);
    var textW = A.Font.measure(text, 10);
    A.Font.draw(ctx, text, (W - textW) / 2, 60, 10, color, P.orange);

    for (var i = 0; i < 3; i++) {
      Art.rect(
        ctx,
        71 + i * 10,
        135,
        6,
        4,
        i < n ? color : P.line
      );
    }

    ctx.restore();
  }

  function drawGo() {
    var t = S.clock - S.playStart;
    if (t < 0 || t > 430) return;
    var k = util.clamp(t / 430, 0, 1);
    ctx.save();
    ctx.globalAlpha = 0.26 * (1 - k * 0.5);
    ctx.fillStyle = P.void;
    ctx.fillRect(0, 0, W, W);
    ctx.globalAlpha = 1;
    var size = 8;
    var width = A.Font.measure("GO!", size);
    A.Font.draw(ctx, "GO!", (W - width) / 2, 52, size, P.mint, P.dirtDeep);
    ctx.restore();
  }

  /* ---------------- 粒子 / 飘字 ---------------- */

  function addParticles(list) {
    for (var i = 0; i < list.length; i++) {
      S.particles.push(list[i]);
      if (S.particles.length > 90) S.particles.shift();
    }
  }

  function addHitBurst(index, gold) {
    var c = cellRect(index);
    var colors = gold
      ? [P.gold, P.cream, P.white, P.amber]
      : [P.cream, P.amber, P.white, P.grassHi];
    var count = gold ? 16 : 10;
    var items = [];
    for (var i = 0; i < count; i++) {
      var life = util.rand(330, 540);
      items.push({
        x: c.cx + util.rand(-8, 8),
        y: c.y + 20 + util.rand(-6, 6),
        vx: util.rand(-95, 95),
        vy: util.rand(-185, -45),
        life: life,
        max: life,
        color: util.pick(colors),
        size: util.randInt(1, 2),
        star: Math.random() < (gold ? 0.32 : 0.16),
      });
    }
    addParticles(items);
  }

  function addDust(x, y, count, gold) {
    var items = [];
    for (var i = 0; i < count; i++) {
      var life = util.rand(280, 520);
      items.push({
        x: x + util.rand(-8, 8),
        y: y + util.rand(-2, 4),
        vx: util.rand(-35, 35),
        vy: util.rand(-72, -16),
        life: life,
        max: life,
        color: gold
          ? util.pick([P.gold, P.amber, P.cream])
          : util.pick([P.dirtHi, P.dirt, P.grassHi]),
        size: 1,
        star: gold && Math.random() < 0.35,
      });
    }
    addParticles(items);
  }

  function addPopup(text, x, y, color) {
    S.popups.push({
      text: text,
      x: x,
      y: y,
      color: color,
      born: S.clock,
      life: 720,
    });
    if (S.popups.length > 12) S.popups.shift();
  }

  function updateParticles(dt) {
    var seconds = dt / 1000;
    var list = S.particles;
    for (var i = list.length - 1; i >= 0; i--) {
      var p = list[i];
      p.life -= dt;
      if (p.life <= 0) {
        list.splice(i, 1);
        continue;
      }
      p.x += p.vx * seconds;
      p.y += p.vy * seconds;
      p.vy += 520 * seconds;
    }
  }

  function updatePopups() {
    var list = S.popups;
    for (var i = list.length - 1; i >= 0; i--) {
      if (S.clock - list[i].born > list[i].life) list.splice(i, 1);
    }
  }

  /* ---------------- 游戏流程 ---------------- */

  function resetRun() {
    S.clock = 0;
    S.playStart = 0;
    S.nextSpawn = 0;
    S.lastCd = 4;
    S.level = -1;
    S.lastTier = 1;
    S.holes = [null, null, null, null, null, null, null, null, null];
    S.particles = [];
    S.popups = [];
    S.shake = 0;
    S.flash = 0;
    S.maxCombo = 0;
    S.hits = 0;
    S.taps = 0;
    S.golds = 0;
    S.lastSpawn = -1;
    S.hover.inside = false;
    S.strike = null;
    S.markCell = -1;
    S.markUntil = 0;
    S.hammerVisible = false;
    resetHUD();
    els.recordBadge.hidden = true;
    els.toast.hidden = true;
    els.finalScore.setAttribute("aria-label", "本局得分 0");
  }

  function startRound() {
    Sound.unlock();
    Sound.ui();
    stopLoop();
    resetRun();
    S.best = A.Store.best("whack");
    hideOverlay(true);
    setMode("countdown");
    announce("倒计时三秒。");
    startLoop();
  }

  function beginPlaying() {
    S.playStart = S.clock;
    S.nextSpawn = S.clock + 430;
    S.level = -1;
    S.lastCd = 0;
    setMode("playing");
    Sound.go();
    updateTimeDisplay(ROUND_MS, true);
    announce("开始，30 秒。");
  }

  function finishRound() {
    var previousBest = A.Store.best("whack");
    var isRecord = S.score > previousBest && S.score > 0;
    if (isRecord) A.Store.setBest("whack", S.score);
    S.best = Math.max(previousBest, S.score);

    setMode("result");
    Sound.end();
    stopLoop();

    S.holes = [null, null, null, null, null, null, null, null, null];
    S.particles = [];
    S.popups = [];
    S.strike = null;
    S.hover.inside = false;
    S.shake = 0;
    S.flash = 0;

    updateTimeDisplay(0, true);

    var accuracy = S.taps ? Math.round((S.hits / S.taps) * 100) : 0;
    els.finalCombo.textContent = String(S.maxCombo);
    els.finalAccuracy.textContent = accuracy + "%";
    els.finalBest.textContent = String(S.best);
    els.recordBadge.hidden = !isRecord;
    ui.final.set(S.score);
    els.finalScore.setAttribute("aria-label", "本局得分 " + S.score);

    showOverlay("result");
    announce(
      "时间到。本局得分 " +
        S.score +
        " 分，最高连击 " +
        S.maxCombo +
        "，命中率 " +
        accuracy +
        "%。" +
        (isRecord ? "新纪录！" : "")
    );
    render();
  }

  function pauseGame(skipFocus) {
    if (S.mode !== "playing" && S.mode !== "countdown") return;
    S.prevMode = S.mode;
    Sound.ui();
    stopLoop();
    S.hover.inside = false;
    S.strike = null;
    S.hammerVisible = false;
    els.toast.hidden = true;
    setMode("paused");
    showOverlay("pause", skipFocus);
    announce("游戏已暂停。");
    render();
  }

  function resumeGame() {
    if (S.mode !== "paused") return;
    Sound.unlock();
    Sound.ui();
    var next = S.prevMode === "countdown" ? "countdown" : "playing";
    hideOverlay(true);
    setMode(next);
    S.hover.inside = false;
    announce("继续游戏。");
    startLoop();
  }

  function togglePause() {
    if (S.mode === "paused") resumeGame();
    else pauseGame(false);
  }

  /* ---------------- 生成 / 敲击 ---------------- */

  function updateSpawning() {
    if (S.clock < S.nextSpawn) return;
    var cfg = LEVELS[S.level] || LEVELS[0];

    var active = 0;
    var i;
    for (i = 0; i < 9; i++) if (S.holes[i]) active++;

    if (active >= cfg.cap) {
      S.nextSpawn = S.clock + 150;
      return;
    }

    var free = [];
    for (i = 0; i < 9; i++) if (!S.holes[i]) free.push(i);
    if (!free.length) {
      S.nextSpawn = S.clock + 120;
      return;
    }

    if (free.length > 1 && S.lastSpawn >= 0) {
      var filtered = free.filter(function (n) {
        return n !== S.lastSpawn;
      });
      if (filtered.length) free = filtered;
    }

    var index = free[Math.floor(Math.random() * free.length)];
    var gold = S.golds < 3 && Math.random() < cfg.goldChance;
    var up = gold ? cfg.goldUp : cfg.up;
    var c = cellRect(index);

    S.holes[index] = {
      kind: gold ? "gold" : "brown",
      born: S.clock,
      hideAt: S.clock + up,
      hitAt: 0,
      seed: Math.random() * 6.28,
    };
    if (gold) S.golds++;
    S.lastSpawn = index;
    S.nextSpawn = S.clock + cfg.spawn * util.rand(0.85, 1.15);

    addDust(c.cx, c.cy + 1, gold ? 6 : 3, gold);
    Sound.spawn(gold);
  }

  function hitMole(index, mole) {
    var c = cellRect(index);
    S.hits++;
    S.combo++;
    if (S.combo > S.maxCombo) S.maxCombo = S.combo;

    var tier = multFor(S.combo);
    var base = mole.kind === "gold" ? 30 : 10;
    var points = base * tier;

    mole.hitAt = S.clock;
    mole.hideAt = Math.min(mole.hideAt, S.clock + 185);

    setScore(S.score + points, true);
    setCombo(S.combo, true);
    flashStat(els.comboStat, "is-bump");

    if (tier > S.lastTier) {
      S.lastTier = tier;
      showToast("倍率 ×" + tier);
      Sound.tier();
    }

    if (mole.kind === "gold") Sound.gold(S.combo);
    else Sound.hit(S.combo);

    addHitBurst(index, mole.kind === "gold");
    addPopup(
      "+" + points,
      c.cx,
      Math.max(20, c.y + 9),
      mole.kind === "gold" ? P.gold : P.cream
    );

    if (!util.prefersReducedMotion()) {
      S.shake = Math.max(S.shake, 2.5);
      S.flash = 1;
    } else {
      S.flash = 0.55;
    }
  }

  function missAt(x, y, index) {
    var previousCombo = S.combo;
    if (index >= 0) {
      var c = cellRect(index);
      x = c.cx;
      y = c.cy + 4;
    }

    // 敲空不扣分，只中断连击（扣分会让随机敲的期望为负，手感极差）
    setCombo(0, false);
    S.lastTier = 1;
    flashStat(els.comboStat, "is-broken");
    Sound.miss();

    addPopup("MISS", x, Math.max(20, y - 2), P.red);
    addDust(x, y, 5, false);

    if (previousCombo >= 3) showToast("连击中断", true);
  }

  function tapAt(x, y, forcedIndex) {
    if (S.mode !== "playing") return;
    S.taps++;

    var index =
      typeof forcedIndex === "number" ? forcedIndex : cellAt(x, y);

    if (index >= 0) {
      S.markCell = index;
      S.markUntil = S.clock + 180;
    }

    if (index < 0) {
      missAt(x, y, -1);
      return;
    }

    var mole = S.holes[index];
    if (!mole) {
      missAt(x, y, index);
      return;
    }

    if (mole.hitAt || S.clock >= mole.hideAt) {
      // 已经敲中、正在缩回去的地鼠不再罚分
      return;
    }

    hitMole(index, mole);
  }

  /* ---------------- 更新 ---------------- */

  function update(dt) {
    if (S.mode === "countdown") {
      var remaining = Math.max(0, CD_MS - S.clock);
      var n = Math.max(1, Math.ceil(remaining / 1000));
      if (n !== S.lastCd) {
        S.lastCd = n;
        Sound.tick(n);
      }
      if (S.clock >= CD_MS) beginPlaying();
      return;
    }

    if (S.mode !== "playing") return;

    var i;
    for (i = 0; i < 9; i++) {
      if (S.holes[i] && S.clock >= S.holes[i].hideAt) {
        S.holes[i] = null;
      }
    }

    var elapsed = S.clock - S.playStart;
    if (elapsed >= ROUND_MS) {
      finishRound();
      return;
    }

    var level = levelFor(elapsed);
    if (level !== S.level) {
      if (S.level >= 0 && level > S.level) {
        showToast("速度提升", false);
        Sound.tier();
      }
      S.level = level;
    }

    updateSpawning();
    updateTimeDisplay(ROUND_MS - elapsed);
    updateParticles(dt);
    updatePopups();

    S.shake = Math.max(0, S.shake - dt * 0.024);
    S.flash = Math.max(0, S.flash - dt * 0.02);
  }

  /* ---------------- 主循环 ---------------- */

  function startLoop() {
    if (S.running) return;
    S.running = true;
    S.lastTs = window.performance.now();
    S.raf = window.requestAnimationFrame(frame);
  }

  function stopLoop() {
    S.running = false;
    if (S.raf) {
      window.cancelAnimationFrame(S.raf);
      S.raf = 0;
    }
  }

  function frame(ts) {
    if (!S.running) return;
    var dt = ts - S.lastTs;
    if (!isFinite(dt) || dt < 0) dt = 0;
    if (dt > 50) dt = 50;
    S.lastTs = ts;
    S.clock += dt;
    update(dt);
    render();
    if (S.running) {
      S.raf = window.requestAnimationFrame(frame);
    } else {
      S.raf = 0;
    }
  }

  /* ---------------- 输入 ---------------- */

  function toLogical(event) {
    var rect = els.field.getBoundingClientRect();
    var x = ((event.clientX - rect.left) / rect.width) * W;
    var y = ((event.clientY - rect.top) / rect.height) * W;
    return {
      x: util.clamp(x, 0, W - 0.001),
      y: util.clamp(y, 0, W - 0.001),
    };
  }

  function clientToLogical(clientX, clientY) {
    var rect = els.field.getBoundingClientRect();
    if (
      clientX < rect.left ||
      clientY < rect.top ||
      clientX > rect.right ||
      clientY > rect.bottom
    ) {
      return null;
    }
    return {
      x: ((clientX - rect.left) / rect.width) * W,
      y: ((clientY - rect.top) / rect.height) * W,
    };
  }

  function isFinePointer() {
    try {
      return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    } catch (err) {
      return false;
    }
  }

  function onPointerDown(event) {
    Sound.unlock();
    if (S.mode !== "playing") return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    var point = toLogical(event);
    if (event.pointerType === "mouse" || event.pointerType === "pen") {
      S.hover.x = point.x;
      S.hover.y = point.y;
      S.hover.inside = true;
    } else {
      S.hover.inside = false;
    }
    S.strike = {
      x: point.x,
      y: point.y,
      until: S.clock + 155,
    };
    tapAt(point.x, point.y);
  }

  function onPointerMove(event) {
    if (S.mode !== "playing") return;
    if (event.pointerType === "touch") return;
    var point = toLogical(event);
    S.hover.x = point.x;
    S.hover.y = point.y;
    S.hover.inside = true;
  }

  function onPointerLeave(event) {
    if (event.pointerType === "touch") return;
    S.hover.inside = false;
    S.hammerVisible = false;
    els.field.classList.remove("has-hammer");
  }

  function keyStrike(index) {
    if (S.mode !== "playing") return;
    var c = cellRect(index);
    S.hover.inside = false;
    S.markCell = index;
    S.markUntil = S.clock + 200;
    S.strike = {
      x: c.cx,
      y: c.cy,
      until: S.clock + 165,
    };
    Sound.unlock();
    tapAt(c.cx, c.cy, index);
  }

  function isInteractive(target) {
    if (!target || !target.closest) return false;
    return !!target.closest(
      'button, a[href], input, select, textarea, [contenteditable="true"]'
    );
  }

  function onKeyDown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    if (event.key === "Tab") {
      trapFocus(event);
      return;
    }

    if (event.key === "m" || event.key === "M") {
      event.preventDefault();
      toggleMute();
      return;
    }

    if (event.key === "Escape") {
      if (S.mode === "playing" || S.mode === "countdown") {
        event.preventDefault();
        pauseGame(false);
      } else if (S.mode === "paused") {
        event.preventDefault();
        resumeGame();
      }
      return;
    }

    if (event.code === "Space" || event.key === "Enter") {
      if (isInteractive(event.target)) return;
      if (S.mode === "playing" || S.mode === "countdown") {
        event.preventDefault();
        pauseGame(false);
      } else if (S.mode === "paused") {
        event.preventDefault();
        resumeGame();
      } else if (S.mode === "ready" || S.mode === "result") {
        event.preventDefault();
        startRound();
      }
      return;
    }

    if (event.key === "p" || event.key === "P") {
      if (
        S.mode === "playing" ||
        S.mode === "countdown" ||
        S.mode === "paused"
      ) {
        event.preventDefault();
        togglePause();
      }
      return;
    }

    if (S.mode === "playing" && !event.repeat) {
      var n = parseInt(event.key, 10);
      if (n >= 1 && n <= 9) {
        event.preventDefault();
        keyStrike(n - 1);
      }
    }
  }

  function toggleMute() {
    Sound.unlock();
    Sound.toggleMuted();
    updateMuteUI();
    announce(Sound.muted ? "音效已关闭。" : "音效已开启。");
  }

  function onVisibilityChange() {
    if (document.hidden) {
      if (S.mode === "playing" || S.mode === "countdown") {
        pauseGame(true);
      }
      return;
    }
    if (S.mode === "paused") {
      focusEl(els.resumeBtn);
      render();
    }
  }

  function bindEvents() {
    els.startBtn.addEventListener("click", function (event) {
      startRound();
      if (isFinePointer() && event.clientX) {
        var point = clientToLogical(event.clientX, event.clientY);
        if (point) {
          S.hover.x = point.x;
          S.hover.y = point.y;
          S.hover.inside = true;
        }
      }
    });

    els.replayBtn.addEventListener("click", function (event) {
      startRound();
      if (isFinePointer() && event.clientX) {
        var point = clientToLogical(event.clientX, event.clientY);
        if (point) {
          S.hover.x = point.x;
          S.hover.y = point.y;
          S.hover.inside = true;
        }
      }
    });

    els.resumeBtn.addEventListener("click", resumeGame);
    els.restartBtn.addEventListener("click", startRound);
    els.pauseBtn.addEventListener("click", togglePause);
    els.muteBtn.addEventListener("click", toggleMute);

    els.field.addEventListener("pointerdown", onPointerDown);
    els.field.addEventListener("pointermove", onPointerMove);
    els.field.addEventListener("pointerleave", onPointerLeave);
    els.field.addEventListener("pointercancel", onPointerLeave);
    els.field.addEventListener("contextmenu", function (event) {
      event.preventDefault();
    });

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("visibilitychange", onVisibilityChange);

    window.addEventListener("resize", scheduleLayout);
    window.addEventListener("load", scheduleLayout);
    window.addEventListener("orientationchange", scheduleLayout);
    if ("ResizeObserver" in window) {
      try {
        new ResizeObserver(scheduleLayout).observe(els.screen);
      } catch (err) {
        /* ignore */
      }
    }
  }

  /* ---------------- 启动 ---------------- */

  function init() {
    els = {
      field: $("field"),
      screen: $("screen"),
      overlay: $("overlay"),
      hud: $("hud"),
      timeStat: $("timeStat"),
      scoreStat: $("scoreStat"),
      comboStat: $("comboStat"),
      timeDisplay: $("timeDisplay"),
      scoreDisplay: $("scoreDisplay"),
      comboDisplay: $("comboDisplay"),
      comboMult: $("comboMult"),
      timerWrap: $("timerWrap"),
      timeFill: $("timeFill"),
      pauseBtn: $("pauseBtn"),
      muteBtn: $("muteBtn"),
      pauseIcon: document.querySelector("#pauseBtn .icon"),
      muteIcon: document.querySelector("#muteBtn .icon"),
      readyPanel: $("readyPanel"),
      pausePanel: $("pausePanel"),
      resultPanel: $("resultPanel"),
      startBtn: $("startBtn"),
      resumeBtn: $("resumeBtn"),
      restartBtn: $("restartBtn"),
      replayBtn: $("replayBtn"),
      finalScore: $("finalScore"),
      finalCombo: $("finalCombo"),
      finalAccuracy: $("finalAccuracy"),
      finalBest: $("finalBest"),
      recordBadge: $("recordBadge"),
      toast: $("toast"),
      live: $("live"),
    };

    setupText();
    buildStaticLayers();
    bindEvents();

    S.best = A.Store.best("whack");
    setMode("ready");
    updateMuteUI();
    resetHUD();
    S.lastSec = -1;
    S.lastBarPct = -1;
    updateTimeDisplay(ROUND_MS, true);

    layout();
    render();
    showOverlay("ready", true);
    focusEl(els.overlay);

    // 初次进入时，让对话框在无动画干扰的情况下就位
    window.requestAnimationFrame(function () {
      layout();
    });
  }

  A.ready(init);
})(window, document);
