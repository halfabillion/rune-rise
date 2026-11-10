/* Rune Rise v2 — rendering, input, juice, audio, progression, economy. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var cv = $('cv'), ctx = cv.getContext('2d', { alpha: false });
  var CAP = Core.CAP, MERGE = Core.MERGE;
  var BUILD = window.RR_BUILD || {};
  var ADS = BUILD.ads !== false, SHOP = BUILD.shop !== false, SHARE_LINK = BUILD.shareLink !== false;
  var SHARE_URL = SHARE_LINK ? (window.RR_SHARE_URL || (/^https?:$/.test(location.protocol) && !/localhost|127\.0\.0\.1/.test(location.hostname) ? location.origin + location.pathname : '')) : '';
  var LS = window.localStorage;
  function load(k, d) { try { var v = LS.getItem('rr_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function save(k, v) { try { LS.setItem('rr_' + k, JSON.stringify(v)); } catch (e) {} }
  var fmt = function (n) { return n.toLocaleString('en-GB'); };

  /* ================= profile & economy ================= */
  var COST = { undo: 10, shatter: 30, revive: 60, deals: 50 };
  var LIMIT = { shatter: 3 };
  var prefersReduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var prof = Object.assign({ best: 0, bestTier: 2, shards: 50, noAds: false, runs: 0, owned: {}, tut: false, level: 1, stars: {}, tierRewards: {},
    set: { sound: true, music: true, haptics: true, reduce: prefersReduce } }, load('profile', {}));
  prof.set = Object.assign({ sound: true, music: true, haptics: true, reduce: prefersReduce }, prof.set || {});
  function saveProf() { save('profile', prof); }
  function addShards(n, why) {
    if (!n) return; prof.shards = Math.max(0, prof.shards + n); saveProf();
    var el = $('btnShards'); el.classList.remove('gain'); void el.offsetWidth; el.classList.add('gain');
    if (n > 0 && why) toast('+' + n + ' ◆  ' + why);
    hud(true);
  }
  function spend(n) { if (prof.shards < n) return false; prof.shards -= n; saveProf(); hud(true); return true; }

  /* ================= tier look (colour + shape + numeral) ================= */
  // Okabe-Ito-inspired hues + a unique shape per tier, so colour is never the only cue.
  var PAL = [null, ['#7cc8f2', '#2f86c4'], ['#4fe0ad', '#16946a'], ['#f4e04d', '#b39a0c'], ['#ffb02e', '#b86a00'], ['#ff7146', '#b8361a'],
    ['#e07ab8', '#9a3b7a'], ['#5a8cff', '#2747b8'], ['#a57cff', '#5b34c4'], ['#ff6aa8', '#b02a63'], ['#e9ecf5', '#8a90aa'], ['#ffd76a', '#c48f12'], ['#5ef0f0', '#139a9a']];
  var SHAPES = ['circle', 'tri', 'square', 'diamond', 'penta', 'hexa', 'star', 'plus', 'octa', 'star6', 'ring', 'crown'];
  function pal(l) { return PAL[((l - 1) % 12) + 1]; }
  function shapeOf(l) { return SHAPES[(l - 1) % 12]; }
  var EMOJI = ['🟦', '🟩', '🟨', '🟧', '🟥', '🟪', '🔷', '💜', '💗', '⬜', '⭐', '👑'];

  /* ================= audio: sfx + generative ambient music ================= */
  var AC = null, sfxBus = null, musBus = null, musTimer = null, musStep = 0;
  function audio() {
    if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      var comp = AC.createDynamicsCompressor(); comp.connect(AC.destination);
      sfxBus = AC.createGain(); sfxBus.gain.value = prof.set.sound ? .55 : 0; sfxBus.connect(comp);
      musBus = AC.createGain(); musBus.gain.value = prof.set.music ? .22 : 0; musBus.connect(comp);
      startMusic();
    } catch (e) { AC = null; }
  }
  function tone(f, d, type, v, slide, when, bus) {
    if (!AC) return; var t = AC.currentTime + (when || 0), o = AC.createOscillator(), g = AC.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v || .2, t + .008); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(bus || sfxBus); o.start(t); o.stop(t + d + .03);
  }
  var noiseBuf = null;
  function noise(d, v, freq, when) {
    if (!AC) return; var t = AC.currentTime + (when || 0);
    if (!noiseBuf) { var n = AC.sampleRate * .4; noiseBuf = AC.createBuffer(1, n, AC.sampleRate); var a = noiseBuf.getChannelData(0); for (var i = 0; i < n; i++) a[i] = (Math.random() * 2 - 1) * (1 - i / n); }
    var s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain(); s.buffer = noiseBuf; f.type = 'bandpass'; f.frequency.value = freq || 2000; f.Q.value = 1.2;
    g.gain.setValueAtTime(v || .2, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); s.connect(f); f.connect(g); g.connect(sfxBus); s.start(t); s.stop(t + d + .02);
  }
  var SCALE = [0, 2, 4, 7, 9]; // major pentatonic: anything sounds nice together
  function note(i) { return 261.63 * Math.pow(2, (Math.floor(i / 5) * 12 + SCALE[((i % 5) + 5) % 5]) / 12); }
  var combo = 0, comboT = 0;
  var sfx = {
    select: function (l) { tone(note(l + 3), .07, 'triangle', .16); },
    land: function (n) { for (var i = 0; i < Math.min(n, 5); i++) { noise(.035, .14, 3200 - i * 200, i * .028); tone(1400 - i * 60, .03, 'square', .025, 0, i * .028); } },
    fuse: function (l, c) { var b = l + c * 2; tone(note(b), .14, 'triangle', .22); tone(note(b + 2), .14, 'triangle', .2, 0, .05); tone(note(b + 4), .3, 'triangle', .22, 0, .1); tone(note(b + 9), .45, 'sine', .08, 0, .14); noise(.18, .06, 6000, .1); },
    whoosh: function () { noise(.16, .12, 900); },
    deal: function (n) { for (var i = 0; i < Math.min(n, 12); i++) { noise(.04, .1, 1600 + (i % 4) * 500, i * .025); } },
    bad: function () { tone(150, .12, 'square', .07, 100); },
    win: function () { [0, 2, 4, 5, 7, 10].forEach(function (k, i) { tone(note(8 + k), .3, 'triangle', .2, 0, i * .07); }); },
    lose: function () { tone(392, .25, 'triangle', .14, 0); tone(330, .25, 'triangle', .14, 0, .18); tone(262, .5, 'triangle', .14, 0, .36); },
    coin: function () { tone(1568, .06, 'square', .05); tone(2093, .12, 'square', .05, 0, .06); },
    shatter: function () { noise(.35, .3, 900); tone(420, .3, 'sawtooth', .06, 70); },
    star: function (i) { tone(note(10 + i * 2), .25, 'triangle', .2); }
  };
  var CHORDS = [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]]; // I vi IV V (semitones from C4)
  function startMusic() {
    if (musTimer || !AC) return;
    var nextT = AC.currentTime + .1;
    musTimer = setInterval(function () {
      if (!AC || AC.state !== 'running') return;
      while (nextT < AC.currentTime + .5) {
        var bar = Math.floor(musStep / 8), beat = musStep % 8, ch = CHORDS[bar % 4];
        if (beat === 0) ch.forEach(function (s) { pad(130.81 * Math.pow(2, s / 12), nextT, 2.6); });
        if (beat % 2 === 0 || Math.random() < .3) { var s2 = ch[(beat + bar) % 3] + 12 * (1 + (beat % 3 === 0 ? 1 : 0)); pluck(261.63 * Math.pow(2, s2 / 12), nextT); }
        nextT += .34; musStep++;
      }
    }, 120);
  }
  function pad(f, t, d) {
    var o = AC.createOscillator(), o2 = AC.createOscillator(), g = AC.createGain(), lp = AC.createBiquadFilter();
    o.type = 'sawtooth'; o2.type = 'sine'; o.frequency.value = f; o2.frequency.value = f * 2.003; lp.type = 'lowpass'; lp.frequency.value = 700;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(.05, t + .8); g.gain.linearRampToValueAtTime(0.0001, t + d);
    o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(musBus); o.start(t); o2.start(t); o.stop(t + d + .05); o2.stop(t + d + .05);
  }
  function pluck(f, t) {
    var o = AC.createOscillator(), g = AC.createGain(); o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(.07, t + .01); g.gain.exponentialRampToValueAtTime(0.0001, t + .6);
    o.connect(g); g.connect(musBus); o.start(t); o.stop(t + .65);
  }
  function applyAudio() { if (sfxBus) sfxBus.gain.value = prof.set.sound ? .55 : 0; if (musBus) musBus.gain.value = prof.set.music ? .22 : 0; }
  Ads.on('pause', function () { if (AC) AC.suspend(); });
  Ads.on('resume', function () { if (AC) AC.resume(); });
  document.addEventListener('visibilitychange', function () { if (!AC) return; if (document.hidden) AC.suspend(); else AC.resume(); });
  function haptic(kind) {
    if (!prof.set.haptics) return;
    var H = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics;
    try {
      if (H) { kind === 'heavy' ? H.impact({ style: 'HEAVY' }) : kind === 'medium' ? H.impact({ style: 'MEDIUM' }) : kind === 'error' ? H.notification({ type: 'ERROR' }) : kind === 'success' ? H.notification({ type: 'SUCCESS' }) : H.impact({ style: 'LIGHT' }); }
      else if (navigator.vibrate) navigator.vibrate(kind === 'heavy' ? 30 : kind === 'medium' ? 18 : kind === 'error' ? [20, 40, 20] : kind === 'success' ? [15, 30, 30] : 8);
    } catch (e) {}
  }

  /* ================= layout & sprite cache ================= */
  var dprCap = 2, slowSecs = 0;
  var W = 0, H = 0, DPR = 1, G = {}, sprites = {}, bgCanvas = null, pillarSprite = null;
  function resize() {
    var r = cv.getBoundingClientRect(); W = r.width; H = r.height; DPR = Math.min(dprCap, window.devicePixelRatio || 1);
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    layout(true);
  }
  function layout(force) {
    if (!S) return;
    var n = S.cols.length;
    if (!force && G.n === n && G.W === W && G.H === H) return;
    var hudB = $('hud').getBoundingClientRect().bottom, barT = $('bar').getBoundingClientRect().top;
    var side = 8, slot = (W - side * 2) / n;
    var tileW = Math.min(slot - 6, 100);
    var previewH = Math.max(26, Math.min(40, tileW * .42));
    var availTop = hudB + 14 + previewH + 8, availBot = barT - 10;
    var tileH = Math.min((availBot - availTop - 12) / CAP, tileW * .9);
    var boardH = tileH * CAP + 12;
    var bottom = availBot, top = bottom - boardH;
    G = { n: n, W: W, H: H, slot: slot, x0: side, tileW: tileW, tileH: tileH, top: top, bottom: bottom, previewY: top - 8 - previewH / 2, previewH: previewH };
    sprites = {}; buildBg(); buildPillar();
  }
  function colX(i) { return G.x0 + G.slot * (i + .5); }
  function slotY(j) { return G.bottom - 6 - G.tileH * (j + .5); }

  function rrect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function shapePath(c, kind, x, y, r) {
    var i, pts = function (n, rot, rr) { c.beginPath(); for (i = 0; i < n; i++) { var a = rot + i / n * Math.PI * 2, q = rr ? (i % 2 ? r * rr : r) : r; c[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * q, y + Math.sin(a) * q); } c.closePath(); };
    switch (kind) {
      case 'circle': c.beginPath(); c.arc(x, y, r * .85, 0, 7); break;
      case 'tri': pts(3, -Math.PI / 2); break;
      case 'square': c.beginPath(); c.rect(x - r * .72, y - r * .72, r * 1.44, r * 1.44); break;
      case 'diamond': pts(4, -Math.PI / 2); break;
      case 'penta': pts(5, -Math.PI / 2); break;
      case 'hexa': pts(6, 0); break;
      case 'star': pts(10, -Math.PI / 2, .45); break;
      case 'plus': c.beginPath(); var a = r * .32; c.moveTo(x - a, y - r); c.lineTo(x + a, y - r); c.lineTo(x + a, y - a); c.lineTo(x + r, y - a); c.lineTo(x + r, y + a); c.lineTo(x + a, y + a); c.lineTo(x + a, y + r); c.lineTo(x - a, y + r); c.lineTo(x - a, y + a); c.lineTo(x - r, y + a); c.lineTo(x - r, y - a); c.lineTo(x - a, y - a); c.closePath(); break;
      case 'octa': pts(8, Math.PI / 8); break;
      case 'star6': pts(12, -Math.PI / 2, .55); break;
      case 'ring': c.beginPath(); c.arc(x, y, r * .9, 0, 7); c.arc(x, y, r * .45, 0, 7, true); break;
      default: c.beginPath(); c.moveTo(x - r, y + r * .6); c.lineTo(x - r, y - r * .5); c.lineTo(x - r * .5, y); c.lineTo(x, y - r * .8); c.lineTo(x + r * .5, y); c.lineTo(x + r, y - r * .5); c.lineTo(x + r, y + r * .6); c.closePath();
    }
  }
  // Pre-render each tier's stone once per size (big perf win vs. per-frame gradients).
  function sprite(l, w, h, mode) {
    var key = l + '|' + mode + '|' + Math.round(w) + 'x' + Math.round(h);
    if (sprites[key]) return sprites[key];
    var pad = 10, c = document.createElement('canvas'); c.width = Math.ceil((w + pad * 2) * DPR); c.height = Math.ceil((h + pad * 2) * DPR);
    var g = c.getContext('2d'); g.scale(DPR, DPR); g.translate(pad, pad);
    var p = pal(l), r = Math.min(h * .3, 14), th = Math.max(3, h * .13);
    if (mode === 'ghost') {
      rrect(g, 1, 1, w - 2, h - 2, r); g.setLineDash([5, 4]); g.lineWidth = 2; g.strokeStyle = p[0]; g.globalAlpha = .8; g.stroke();
    } else {
      if (mode === 'glow') { g.shadowColor = p[0]; g.shadowBlur = 14; }
      rrect(g, 0, th * .5, w, h - th * .5, r); g.fillStyle = p[1]; g.fill(); g.shadowBlur = 0;
      rrect(g, 0, 0, w, h - th, r);
      var gr = g.createLinearGradient(0, 0, 0, h - th); gr.addColorStop(0, shade(p[0], .35)); gr.addColorStop(.55, p[0]); gr.addColorStop(1, shade(p[0], -.12));
      g.fillStyle = gr; g.fill();
      g.save(); g.clip(); g.globalAlpha = .35; g.fillStyle = '#fff'; rrect(g, w * .08, h * .07, w * .84, (h - th) * .22, r * .6); g.fill(); g.restore();
      g.lineWidth = 1.5; g.strokeStyle = 'rgba(255,255,255,.55)'; rrect(g, .75, .75, w - 1.5, h - th - 1.5, r); g.stroke();
      if (l > 12) { g.strokeStyle = '#ffd25f'; g.lineWidth = 2.5; rrect(g, 1.5, 1.5, w - 3, h - th - 3, r); g.stroke(); }
      var cy = (h - th) / 2, wide = w > h * 1.3, sr, sx, sy, nx, ty, fs;
      if (wide) { sr = Math.min(h * .2, w * .14); sx = w * .25; sy = cy; nx = w * .6; ty = cy + 1; fs = Math.round((h - th) * .62); }
      else { sr = Math.max(4, h * .11); sx = w * .19; sy = h * .2; nx = w * .54; ty = cy + 1; fs = Math.round((h - th) * .6); }
      // emblem shape (colour-blind cue: every tier has its own shape)
      shapePath(g, shapeOf(l), sx, sy, sr); g.fillStyle = wide ? 'rgba(20,10,45,.32)' : 'rgba(255,255,255,.92)'; g.fill();
      g.lineWidth = 1.4; g.strokeStyle = wide ? 'rgba(255,255,255,.95)' : 'rgba(20,10,45,.45)'; g.stroke();
      // numeral
      g.font = '900 ' + fs + 'px ui-rounded,system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = Math.max(3, fs * .16); g.strokeStyle = 'rgba(25,12,55,.65)'; g.lineJoin = 'round'; g.strokeText(String(l), nx, ty);
      g.fillStyle = '#fff'; g.fillText(String(l), nx, ty);
    }
    var o = { c: c, w: w + pad * 2, h: h + pad * 2, pad: pad };
    sprites[key] = o; return o;
  }
  function shade(hex, k) {
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    var f = function (v) { return Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k)); };
    return 'rgb(' + f(r) + ',' + f(g) + ',' + f(b) + ')';
  }
  function buildBg() {
    bgCanvas = document.createElement('canvas'); bgCanvas.width = cv.width; bgCanvas.height = cv.height;
    var g = bgCanvas.getContext('2d'); g.scale(DPR, DPR);
    var gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#1d1450'); gr.addColorStop(.5, '#140d35'); gr.addColorStop(1, '#0c0822');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    var rg = g.createRadialGradient(W / 2, G.top + (G.bottom - G.top) * .45, 10, W / 2, G.top + (G.bottom - G.top) * .45, Math.max(W, H) * .7);
    rg.addColorStop(0, 'rgba(122,92,255,.22)'); rg.addColorStop(1, 'rgba(122,92,255,0)'); g.fillStyle = rg; g.fillRect(0, 0, W, H);
    for (var i = 0; i < 60; i++) { g.globalAlpha = Math.random() * .5 + .1; g.fillStyle = '#fff'; var s = Math.random() * 1.6 + .4; g.fillRect(Math.random() * W, Math.random() * H, s, s); }
    g.globalAlpha = 1;
  }
  function buildPillar() {
    var w = G.tileW + 8, h = G.bottom - G.top, c = document.createElement('canvas'); c.width = Math.ceil(w * DPR); c.height = Math.ceil(h * DPR);
    var g = c.getContext('2d'); g.scale(DPR, DPR);
    rrect(g, 0, 0, w, h, 16); var gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, 'rgba(255,255,255,.07)'); gr.addColorStop(.5, 'rgba(255,255,255,.025)'); gr.addColorStop(1, 'rgba(255,255,255,.07)');
    g.fillStyle = 'rgba(8,4,24,.45)'; g.fill(); g.fillStyle = gr; g.fill();
    g.lineWidth = 1.5; g.strokeStyle = 'rgba(200,180,255,.22)'; g.stroke();
    for (var j = 1; j < CAP; j++) { var y = h - 6 - G.tileH * j; g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(6, y, w - 12, 1); }
    pillarSprite = { c: c, w: w, h: h };
  }

  /* ================= state ================= */
  var S = null, hist = [], sel = -1, drag = null, armed = null, idleT = 0, hint = null, busy = false, paused = false, ended = false;
  var vis = {}, ghosts = [], parts = [], floats = [], rings = [], shake = 0, time = 0, flashA = 0;
  var tut = null; // tutorial controller
  var runShards = 0;
  function today() { return ds(new Date()); }
  function ds(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function yesterday() { var d = new Date(); d.setDate(d.getDate() - 1); return ds(d); }
  function dayNum(s) { var p = s.split('-'); return Math.round((Date.UTC(+p[0], p[1] - 1, +p[2]) - Date.UTC(2026, 0, 1)) / 864e5) + 1; }
  function daily() { var d = load('daily', null); return d && d.date === today() ? d : { date: today(), done: false, S: null }; }
  function persist() {
    if (!S || tut) return;
    if (S.mode === 'endless') save('run', S.over ? null : { S: S, runShards: runShards });
    else if (S.mode === 'daily') { var d = daily(); if (!d.done) { d.S = S; save('daily', d); } }
  }

  function begin(newS) {
    S = newS; hist = []; sel = -1; drag = null; armed = null; idleT = 0; hint = null; ended = false; paused = false;
    vis = {}; ghosts = []; parts = []; floats = []; rings = []; combo = 0;
    closeAll(); document.body.classList.remove('inmenu'); layout(true);
    // stones fall in from the preview strip, column by column
    S.cols.forEach(function (c, i) { c.forEach(function (x, j) { vis[x.id] = mkVis(colX(i), G.previewY - 30, j * .03 + i * .04); }); });
    sfx.deal(10); hud(true); Ads.gameplayStart(); persist();
  }
  function mkVis(x, y, delay) { return { x: x, y: y, vx: 0, vy: 0, s: 1, sv: 0, sq: 0, d: delay || 0, wob: 0 }; }
  function startLevel(n) {
    var L = Core.level(n);
    begin(Core.newGame('level', L.seed, L));
  }
  function startEndless(resume) {
    var r = resume && load('run', null);
    if (r && r.S && !r.S.over) { runShards = r.runShards || 0; begin(r.S); }
    else { runShards = 0; prof.runs++; saveProf(); begin(Core.newGame('endless', (Math.random() * 4294967296) >>> 0)); }
  }
  function startDaily() { var d = daily(); begin(d.S || Core.newGame('daily', Core.seedFromString('runerise-' + d.date))); }
  function startTutorial() {
    var T = Core.newGame('level', 7, { cols: 4, deals: 3, goal: { t: 'tier', l: 3 },
      preset: [[1, 1, 1, 1], [1], [2, 2, 2], []], presetNext: [[1], [2], [], [1]] });
    T.tutorial = true;
    tut = { step: 0, steps: [
      { col: 1, say: 'Tap' }, { col: 0, say: 'Tap to move' }, { col: 0, say: 'Tap' }, { col: 2, say: 'Stack' },
      { deal: true, say: 'Deal more' }, { col: 1, say: 'Tap' }, { col: 2, say: 'Fuse!' }] };
    begin(T); $('coach').classList.add('on');
  }

  /* ================= effects ================= */
  var MAXP = 260;
  function burst(x, y, l, n, power) {
    if (prof.set.reduce) n = Math.min(6, n);
    var c = pal(l);
    for (var i = 0; i < n && parts.length < MAXP; i++) {
      var a = Math.random() * Math.PI * 2, v = (Math.random() * .9 + .35) * (power || 300);
      parts.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 140, life: .5 + Math.random() * .45, t: 0, c: Math.random() < .3 ? '#fff' : c[0], r: 2 + Math.random() * 3.2, sq: i % 2 });
    }
  }
  function handle(ev, quiet) {
    var fuses = 0, landed = 0, won = false;
    ev.forEach(function (e) {
      if (e.t === 'move') { landed += e.ids.length; e.ids.forEach(function (id, i) { var v = vis[id]; if (v) { v.d = i * .025; v.arc = 1; } }); }
      if (e.t === 'merge') {
        fuses++; combo = comboT > 0 ? combo + 1 : 1; comboT = 1.6;
        var c = combo, tx = colX(e.col), ty = slotY(S.cols[e.col].length - 1), delay = .12 + (fuses - 1) * .2;
        e.removed.forEach(function (id, i) { var v = vis[id]; if (v) ghosts.push({ x: v.x, y: v.y, tx: tx, ty: ty, l: e.l - 1, t: -(i * .018) - (fuses - 1) * .2 }); delete vis[id]; });
        var nv = mkVis(tx, ty, delay); nv.s = 1.45; nv.pop = 1; vis[e.id] = nv;
        setTimeout(function () {
          burst(tx, ty, e.l, 22 + e.l * 3); rings.push({ x: tx, y: ty, t: 0, c: pal(e.l)[0] });
          floats.push({ x: tx, y: ty - G.tileH * .6, t: 0, s: '+' + e.pts, c: '#fff', big: 0 });
          if (c > 1) { floats = floats.filter(function (f) { return !f.big; }); floats.push({ x: W / 2, y: G.top + (G.bottom - G.top) * .3, t: 0, s: 'COMBO ×' + c, c: '#ffd25f', big: 1 }); }
          if (!prof.set.reduce) shake = Math.min(12, 3 + e.l * 1.1 + c);
          sfx.fuse(e.l, c - 1); haptic(e.l >= 5 ? 'heavy' : 'medium');
          if (e.l >= 5 && !prof.set.reduce) flashA = .18;
        }, delay * 1000);
        if (S.mode === 'endless') {
          var sh = Math.max(0, e.l - 3); if (sh) { runShards += sh; addShards(sh); }
          if (e.newPeak && !prof.tierRewards[e.l] && e.l >= 4) { prof.tierRewards[e.l] = 1; var rw = e.l * 5; addShards(rw); setTimeout(function () { toast('Tier ' + e.l + ' reached!  +' + rw + ' ◆'); }, 450); }
        }
        if (e.l > prof.bestTier) { prof.bestTier = e.l; saveProf(); Ads.happyTime(); }
        if (e.unlocked) setTimeout(function () { layout(true); toast('New pillar unlocked!'); sfx.win(); }, 500);
      }
      if (e.t === 'dissolve') { var v = vis[e.id]; if (v) { burst(v.x, v.y, e.l, 8, 200); delete vis[e.id]; } }
      if (e.t === 'win') won = true;
    });
    for (var k in vis) if (!findChip(+k)) delete vis[k];
    if (landed && !fuses && !quiet) { sfx.land(landed); haptic('light'); }
    hud(); if (won) setTimeout(levelWon, 650 + fuses * 200);
  }
  function findChip(id) { for (var i = 0; i < S.cols.length; i++) for (var j = 0; j < S.cols[i].length; j++) if (S.cols[i][j].id === id) return true; return false; }
  function toast(s) { var t = $('toast'); t.textContent = s; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 1500); }
  function invalid(ci) { sfx.bad(); haptic('error'); if (ci >= 0) S.cols[ci].slice(-Core.topRun(S.cols[ci]).n).forEach(function (c) { var v = vis[c.id]; if (v) v.wob = .3; }); }

  /* ================= actions ================= */
  function pushHist() { hist.push(Core.snapshot(S)); if (hist.length > 12) hist.shift(); }
  function act() { idleT = 0; hint = null; }
  function select(c) { sel = c; var r = Core.topRun(S.cols[c]); sfx.select(r.l); haptic('light'); act(); }
  function doMove(s, d) {
    if (!Core.canMove(S, s, d)) { invalid(s); return false; }
    pushHist(); var ev = Core.move(S, s, d); sel = -1; act(); handle(ev); persist(); tutAdvance(); return true;
  }
  function doDeal() {
    if (busy || paused || ended || !S || S.over) return;
    if (tut && !tutAllows({ deal: true })) return;
    if (S.mode === 'daily' && S.dealsLeft === 0) { finishDaily(); return; }
    if (S.mode === 'level' && S.dealsLeft === 0) { outOfDeals(); return; }
    pushHist(); sel = -1; armed = null; act();
    var preview = S.next.map(function (a) { return a.length; });
    var res = Core.deal(S), n = 0;
    res.events.forEach(function (e) { if (e.t === 'deal') { vis[e.id] = mkVis(colX(e.col), G.previewY, e.col * .03 + e.order * .045); n++; } });
    sfx.deal(n); haptic('light');
    handle(res.events.filter(function (e) { return e.t !== 'deal'; }), true);
    persist(); tutAdvance();
    var b = $('btnDeal'); b.classList.add('press'); setTimeout(function () { b.classList.remove('press'); }, 90);
    if (S.over) { if (!prof.set.reduce) shake = 14; sfx.lose(); haptic('error'); ended = true; setTimeout(overflowed, 650); }
    else if (S.mode === 'level' && S.dealsLeft === 0 && !S.won) toast('Last deal! Make it count');
  }
  function undo() {
    if (busy || ended || !hist.length) { invalid(-1); return; }
    var go = function () { S = hist.pop(); sel = -1; layout(); handle([]); persist(); toast('Undone'); };
    if (spend(COST.undo)) go();
    else if (ADS) { busy = true; Ads.rewarded('undo').then(function (ok) { busy = false; if (ok) go(); }); }
    else { toast('Need ' + COST.undo + ' ◆'); }
  }
  function armShatter() {
    if (ended) return;
    if ((S._sh || 0) >= LIMIT.shatter) { toast('Max ' + LIMIT.shatter + ' per game'); return; }
    if (prof.shards < COST.shatter) { toast('Need ' + COST.shatter + ' ◆'); if (SHOP) openShop(); return; }
    armed = armed ? null : 'shatter'; sel = -1; hud(); if (armed) toast('Tap a pillar to shatter its top');
  }
  function doShatter(ci) {
    var ev = Core.shatter(S, ci); armed = null;
    if (!ev) { invalid(ci); hud(); return; }
    pushHist(); spend(COST.shatter); S._sh = (S._sh || 0) + 1; sfx.shatter(); haptic('heavy'); if (!prof.set.reduce) shake = 10; handle(ev); persist();
  }

  /* ================= tutorial ================= */
  function tutAllows(a) {
    var st = tut.steps[tut.step]; if (!st) return true;
    if (a.deal) return !!st.deal;
    return st.col === a.col;
  }
  function tutAdvance() {
    if (!tut) return; tut.step++;
    if (tut.step >= tut.steps.length) { $('coach').classList.remove('on'); }
  }
  function placeCoach() {
    if (!tut) return; var st = tut.steps[tut.step], hand = $('hand'), bub = $('bubble');
    if (!st) { $('coach').classList.remove('on'); return; }
    var x, y;
    if (st.deal) { var r = $('btnDeal').getBoundingClientRect(), ar = $('app').getBoundingClientRect(); x = r.left - ar.left + r.width / 2; y = r.top - ar.top + r.height / 2; }
    else { x = colX(st.col); var len = S.cols[st.col].length; y = slotY(Math.max(0, len - 1)) + 4; }
    hand.style.transform = ''; hand.style.left = x + 'px'; hand.style.top = y + 'px';
    var by = st.deal ? y - 30 : slotY(S.cols[st.col].length) - G.tileH * .2; bub.style.left = x + 'px'; bub.style.top = by + 'px'; if (bub.textContent !== st.say) bub.textContent = st.say;
  }

  /* ================= outcomes ================= */
  function closeAll() { ['menu', 'levels', 'pause', 'settings', 'result', 'shop'].forEach(function (id) { $(id).classList.remove('show'); }); }
  function result(o) {
    $('resTitle').textContent = o.title; $('resBig').textContent = o.big || ''; $('resMeta').textContent = o.meta || ''; $('resReward').textContent = o.reward || '';
    var st = $('resStars'); st.innerHTML = '';
    if (o.stars != null) for (var i = 0; i < 3; i++) { var s = document.createElement('i'); s.className = 'star' + (i === 1 ? ' mid' : '') + (i < o.stars ? ' on' : ''); st.appendChild(s);
      (function (s, i) { setTimeout(function () { s.classList.add('in'); if (i < o.stars) { sfx.star(i); haptic('light'); } }, 250 + i * 260); })(s, i); }
    var b = $('resBtns'); b.innerHTML = '';
    o.btns.forEach(function (x) { if (!x) return; var e = document.createElement('button'); e.className = 'btn ' + (x.cls || 'ghost');
      e.innerHTML = x.html; if (x.disabled) e.disabled = true; e.onclick = function () { audio(); x.fn(e); }; b.appendChild(e); });
    $('shareTxt').style.display = o.share ? 'block' : 'none'; $('shareTxt').textContent = o.share || '';
    $('result').classList.add('show'); Ads.gameplayStop();
  }
  var G_ = function (s) { return '<i class="gem"></i>' + s; };
  function levelWon() {
    if (ended) return; ended = true; sel = -1;
    if (S.tutorial) {
      tut = null; $('coach').classList.remove('on'); prof.tut = true; saveProf(); sfx.win(); haptic('success'); addShards(50);
      result({ title: 'You got it!', big: '', meta: 'Stack 5 matching stones to fuse them.\nKeep pillars from overflowing.', reward: '+50 ◆ starter gift', stars: 3,
        btns: [{ cls: 'primary big', html: 'Play Level 1', fn: function () { startLevel(1); } }] });
      return;
    }
    var n = S.levelN, st = Core.stars(S), prev = prof.stars[n] || 0, reward = 10 + Math.max(0, st - prev) * 10 + (prev ? 0 : 10);
    prof.stars[n] = Math.max(prev, st); prof.level = Math.max(prof.level, n + 1); saveProf();
    addShards(reward); sfx.win(); haptic('success'); confetti();
    var dbl = ADS && reward > 0;
    result({ title: 'Level ' + n + ' complete!', stars: st, big: '', meta: S.dealsLeft + ' deals to spare', reward: '+' + reward + ' ◆',
      btns: [{ cls: 'primary big', html: 'Next level', fn: function () { nextLevel(n + 1); } },
        dbl && { cls: 'secondary', html: 'Claim ×2 ' + G_('') + ' <em class="ad">AD</em>', fn: function (el) { el.disabled = true; busy = true; Ads.rewarded('double').then(function (ok) { busy = false; if (ok) { addShards(reward, 'doubled'); sfx.coin(); $('resReward').textContent = '+' + reward * 2 + ' ◆'; el.remove(); } else el.disabled = false; }); } },
        { html: 'Menu', fn: showMenu }] });
  }
  function nextLevel(n) { if (n > 3 && ADS) { busy = true; Ads.interstitial().then(function () { busy = false; startLevel(n); }); } else startLevel(n); }
  function outOfDeals() {
    ended = true; sfx.lose();
    var gp = Core.goalProgress(S), can = !S.extra;
    result({ title: 'Out of deals', big: gp.have + ' / ' + gp.need, meta: goalText(S.goal, true) + (gp.have / gp.need >= .6 ? '\nSo close!' : ''),
      btns: [can && ADS && { cls: 'primary big', html: '+5 deals <em class="ad">AD</em>', fn: function () { busy = true; Ads.rewarded('deals').then(function (ok) { busy = false; if (ok) moreDeals(); }); } },
        can && { cls: ADS ? 'secondary' : 'primary big', html: '+5 deals · ' + G_(COST.deals), disabled: prof.shards < COST.deals, fn: function () { if (spend(COST.deals)) moreDeals(); } },
        { cls: can ? 'ghost' : 'primary big', html: 'Retry level', fn: function () { startLevel(S.levelN); } },
        { html: 'Menu', fn: showMenu }] });
  }
  function moreDeals() { Core.addDeals(S, 5); ended = false; closeAll(); hud(true); Ads.gameplayStart(); toast('+5 deals'); }
  function overflowed() {
    var isDaily = S.mode === 'daily', canRevive = !isDaily && !S.revived;
    if (isDaily) { finishDaily(true); return; }
    var bonus = 0;
    if (S.mode === 'endless') { if (S.score > prof.best) prof.best = S.score; saveProf(); }
    result({ title: 'Overflow!', big: S.mode === 'endless' ? fmt(S.score) : '', meta: S.mode === 'endless' ? 'Best ' + fmt(prof.best) + ' · tier ' + S.peak : 'A pillar ran out of room',
      btns: [canRevive && ADS && { cls: 'primary big', html: 'Revive <em class="ad">AD</em>', fn: function () { busy = true; Ads.rewarded('revive').then(function (ok) { busy = false; if (ok) revive(); }); } },
        canRevive && { cls: ADS ? 'secondary' : 'primary big', html: 'Revive · ' + G_(COST.revive), disabled: prof.shards < COST.revive, fn: function () { if (spend(COST.revive)) revive(); } },
        { cls: canRevive ? 'ghost' : 'primary big', html: S.mode === 'level' ? 'Retry level' : 'New game', fn: function () { if (S.mode === 'level') startLevel(S.levelN); else endRun(); } },
        { html: 'Menu', fn: function () { if (S.mode === 'endless') endRun(true); else showMenu(); } }] });
  }
  function endRun(toMenu) {
    var b = Math.floor(S.score / 500); if (b) addShards(b, 'run bonus');
    save('run', null);
    if (toMenu) showMenu(); else { if (ADS) { busy = true; Ads.interstitial().then(function () { busy = false; startEndless(false); }); } else startEndless(false); }
  }
  function revive() { closeAll(); ended = false; var ev = Core.revive(S); sfx.shatter(); haptic('heavy'); if (!prof.set.reduce) shake = 10; handle(ev); hist = []; persist(); Ads.gameplayStart(); toast('Revived! Lowest tiers cleared'); }
  function streakUpdate() { var st = load('streak', { last: '', n: 0 }), t = today(); if (st.last !== t) { st.n = st.last === yesterday() ? st.n + 1 : 1; st.last = t; save('streak', st); } return st.n; }
  function shareText(d) {
    var ladder = ''; for (var i = 1; i <= 10; i++) ladder += i <= d.peak ? EMOJI[i - 1] : '⬛';
    return 'Rune Rise · Daily #' + dayNum(d.date) + '\n' + fmt(d.score) + ' pts · tier ' + d.peak + '\n' + ladder + '\n🔥 ' + d.streak + '-day streak' + (SHARE_URL ? '\n' + SHARE_URL : '');
  }
  function finishDaily(over) {
    ended = true; var d = daily();
    if (!d.done) { d.done = true; d.score = S.score; d.peak = S.peak; d.streak = streakUpdate(); d.S = null; save('daily', d); addShards(25 + Math.min(50, 5 * d.streak)); }
    showDailyResult(d, over);
  }
  function showDailyResult(d, over) {
    sfx.win(); confetti();
    result({ title: over ? 'Daily Rune: overflow' : 'Daily Rune complete', big: fmt(d.score), meta: 'Tier ' + d.peak + ' · 🔥 ' + d.streak + '-day streak\nNew rune tomorrow', share: shareText(d),
      btns: [{ cls: 'primary big', html: 'Share result', fn: function () { share(shareText(d)); } }, { cls: 'secondary', html: 'Play levels', fn: function () { startLevel(prof.level); } }, { html: 'Menu', fn: showMenu }] });
  }
  function share(t) {
    if (navigator.share && SHARE_LINK) navigator.share({ text: t }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { toast('Copied!'); }, function () { toast('Copy the text below'); });
    else toast('Copy the text below');
  }
  function confetti() {
    if (prof.set.reduce) return;
    for (var i = 0; i < 70 && parts.length < MAXP; i++) parts.push({ x: W * Math.random(), y: -10, vx: (Math.random() - .5) * 120, vy: Math.random() * 200 + 60, life: 2.2, t: 0, c: PAL[1 + (i % 12)][0], r: 3 + Math.random() * 3, sq: 1, conf: 1 });
  }

  /* ================= HUD (DOM writes only on change) ================= */
  var hudCache = {};
  function set(id, prop, val) { var k = id + prop; if (hudCache[k] === val) return; hudCache[k] = val; var e = $(id); if (prop === 'text') e.textContent = val; else if (prop === 'html') e.innerHTML = val; else if (prop === 'w') e.style.width = val; else if (prop === 'cls') e.className = val; else if (prop === 'dis') e.disabled = val; }
  function chipHtml(l) { var p = pal(l); return '<span class="chip" style="background:' + p[0] + '">' + l + '</span>'; }
  function goalText(g, plain) {
    if (g.t === 'tier') return plain ? 'Reach tier ' + g.l : 'Reach ' + chipHtml(g.l);
    if (g.t === 'make') return plain ? 'Fuse ' + g.n + '× tier ' + g.l : 'Fuse ' + g.n + '× ' + chipHtml(g.l);
    return plain ? 'Score ' + fmt(g.n) : 'Score ' + fmt(g.n);
  }
  function hud(force) {
    if (!S) return; if (force) hudCache = {};
    var m = S.mode, gp = Core.goalProgress(S);
    if (m === 'level') {
      set('goalLbl', 'text', S.tutorial ? 'TUTORIAL' : 'LEVEL ' + S.levelN);
      set('goalTxt', 'html', goalText(S.goal) + (S.goal.t === 'tier' ? (gp.done ? ' ✓' : '') : ' <small style="opacity:.7;font-size:15px">' + (S.goal.t === 'score' ? fmt(gp.have) : gp.have + '/' + gp.need) + '</small>'));
      set('goalFill', 'w', (S.goal.t === 'tier' ? (gp.done ? 100 : Math.max(0, (S.peak - 1) / (gp.need - 1)) * 100 * .9) : gp.have / gp.need * 100) + '%');
      set('dealsLeft', 'text', S.tutorial ? '' : '· ' + S.dealsLeft + ' DEALS');
    } else {
      set('goalLbl', 'text', m === 'daily' ? 'DAILY #' + dayNum(today()) : 'BEST ' + fmt(Math.max(prof.best, S.score)));
      set('goalTxt', 'html', '<span style="font-size:28px">' + fmt(S.score) + '</span>');
      // progress to next tier = how many peak-tier stones are on top of their pillars toward a fusion
      var best = 0; S.cols.forEach(function (c) { var r = Core.topRun(c); if (r.l === S.peak) best = Math.max(best, r.n); });
      set('goalFill', 'w', (best / MERGE * 100) + '%');
      set('dealsLeft', 'text', m === 'daily' ? '· ' + S.dealsLeft + ' DEALS' : '· TIER ' + S.peak);
    }
    set('shards', 'text', String(prof.shards));
    var risk = Core.overflowRisk(S).some(Boolean), noMoves = Core.usefulMoves(S) === 0;
    var finished = (m === 'daily' && S.dealsLeft === 0) || (m === 'level' && S.dealsLeft === 0);
    set('dealTxt', 'text', finished ? (m === 'daily' ? 'FINISH' : 'NO DEALS') : 'DEAL');
    var incoming = S.next.reduce(function (a, b) { return a + b.length; }, 0);
    set('dealSub', 'text', finished ? '' : '+' + incoming + ' stones');
    set('btnDeal', 'cls', 'deal' + (finished ? ' done' : risk ? ' warn' : '') + (noMoves && !finished && !tut ? ' nudge' : ''));
    var boosters = !S.tutorial && m !== 'daily';
    var showUndo = boosters && (m !== 'level' || S.levelN >= 2), showSh = boosters && (m !== 'level' || S.levelN >= 4);
    set('btnUndo', 'cls', 'tool' + (showUndo ? '' : ' hide')); set('btnShatter', 'cls', 'tool' + (showSh ? '' : ' hide') + (armed ? ' armed' : ''));
    set('btnUndo', 'dis', !hist.length);
    set('undoTag', 'html', prof.shards >= COST.undo || !ADS ? '◆' + COST.undo : 'AD'); set('undoTag', 'cls', prof.shards >= COST.undo || !ADS ? '' : 'ad');
    set('shatterTag', 'text', '◆' + COST.shatter);
  }
  function menuInfo() {
    var d = daily(), st = load('streak', { last: '', n: 0 }), run = load('run', null), alive = st.last === today() || st.last === yesterday();
    $('playLbl').textContent = prof.tut ? 'Level ' + prof.level : 'Play';
    $('playSub').textContent = prof.tut ? goalText(Core.level(prof.level).goal, true) : 'Learn in 20 seconds';
    $('endlessSub').textContent = run && run.S ? 'Continue · ' + fmt(run.S.score) : 'Best ' + fmt(prof.best);
    $('dailySub').textContent = d.done ? '✓ ' + fmt(d.score) + (alive && st.n ? ' · 🔥' + st.n : '') : '#' + dayNum(d.date) + (alive && st.n ? ' · 🔥' + st.n : '');
  }
  function showMenu() { document.body.classList.add('inmenu'); Ads.gameplayStop(); tut = null; $('coach').classList.remove('on'); closeAll(); menuInfo(); $('menu').classList.add('show'); }

  /* ================= input ================= */
  function colAt(x, y) { if (!S || y < G.previewY - G.previewH || y > G.bottom + 16) return -1; var i = Math.floor((x - G.x0) / G.slot); return i >= 0 && i < S.cols.length ? i : -1; }
  function pt(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  cv.addEventListener('pointerdown', function (e) {
    audio(); if (!S || busy || paused || ended || S.over) return;
    var p = pt(e), c = colAt(p.x, p.y);
    if (c < 0) { sel = -1; return; }
    if (tut && !tutAllows({ col: c })) { sfx.bad(); return; }
    if (armed === 'shatter') { doShatter(c); return; }
    if (sel >= 0 && sel !== c) { if (Core.canMove(S, sel, c)) { doMove(sel, c); return; } if (!S.cols[c].length) { invalid(sel); sel = -1; return; } }
    if (sel === c) { sel = -1; return; }
    if (!S.cols[c].length) { invalid(-1); return; }
    select(c); if (tut) tutAdvance();
    drag = { c: c, x0: p.x, y0: p.y, x: p.x, y: p.y, moving: false };
    try { cv.setPointerCapture(e.pointerId); } catch (er) {}
  });
  cv.addEventListener('pointermove', function (e) { if (!drag) return; var p = pt(e); drag.x = p.x; drag.y = p.y; if (!drag.moving && Math.hypot(p.x - drag.x0, p.y - drag.y0) > 14 && !tut) drag.moving = true; });
  cv.addEventListener('pointerup', function (e) {
    if (!drag) return; var d = drag; drag = null; if (!d.moving) return;
    var p = pt(e), t = colAt(p.x, p.y);
    if (t >= 0 && t !== d.c) { if (!doMove(d.c, t)) sel = -1; } else if (t === d.c) { /* dropped back: keep selected */ } else sel = -1;
  });
  cv.addEventListener('pointercancel', function () { drag = null; });
  window.addEventListener('keydown', function (e) {
    if (!S || ended || $('menu').classList.contains('show')) return;
    if (e.code === 'Space' || e.key === 'd') { e.preventDefault(); doDeal(); }
    else if (e.key === 'z') undo();
    else if (e.key === 'Escape') pause();
    else if (/^[1-7]$/.test(e.key)) { var c = +e.key - 1; if (!S.cols[c]) return; if (sel >= 0 && sel !== c) doMove(sel, c); else if (S.cols[c].length) select(c); }
  });

  /* ================= render loop ================= */
  function spring(v, tx, ty, dt, k) {
    var red = prof.set.reduce, K = red ? 900 : (k || 520), C = red ? 2 * Math.sqrt(K) : 2 * Math.sqrt(K) * .72;
    v.vx += (K * (tx - v.x) - C * v.vx) * dt; v.vy += (K * (ty - v.y) - C * v.vy) * dt; v.x += v.vx * dt; v.y += v.vy * dt;
  }
  function blit(sp, x, y, s, a) {
    var w = sp.w * s, h = sp.h * s; ctx.globalAlpha = a == null ? 1 : a;
    ctx.drawImage(sp.c, x - w / 2, y - h / 2 + (sp.pad * 0), w, h); ctx.globalAlpha = 1;
  }
  function stone(l, x, y, s, a, mode, sq) {
    var sp = sprite(l, G.tileW * .94, G.tileH * .94, mode || 'n'), sx = s * (1 + (sq || 0)), sy = s * (1 - (sq || 0));
    var w = sp.w * sx, h = sp.h * sy; ctx.globalAlpha = a == null ? 1 : a; ctx.drawImage(sp.c, x - w / 2, y - h / 2 + G.tileH * .03, w, h); ctx.globalAlpha = 1;
  }
  var last = performance.now(), fpsAcc = 0, fpsN = 0; window.__fps = [];
  window.__ft = [];
  function frame(now) {
    var t0 = performance.now();
    var dt = Math.min(.033, (now - last) / 1000); last = now; time += dt;
    fpsAcc += dt; fpsN++; if (fpsAcc > 1) { var f = Math.round(fpsN / fpsAcc); window.__fps.push(f);
      // adaptive resolution: if the device can't hold ~50fps, render fewer pixels (stays sharp enough, keeps feel smooth)
      if (f < 54 && !document.hidden) { if (++slowSecs >= 2 && dprCap > 1) { dprCap = Math.max(1, dprCap - .5); slowSecs = 0; resize(); } } else slowSecs = 0; if (window.__fps.length > 30) window.__fps.shift(); fpsAcc = 0; fpsN = 0; }
    if (comboT > 0) { comboT -= dt; if (comboT <= 0) combo = 0; }
    if (bgCanvas) ctx.drawImage(bgCanvas, 0, 0); else { ctx.fillStyle = '#120c2c'; ctx.fillRect(0, 0, cv.width, cv.height); }
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (S && G.n) {
      if (G.n !== S.cols.length) layout(true);
      var sx = 0, sy = 0; if (shake > 0) { sx = (Math.random() - .5) * shake; sy = (Math.random() - .5) * shake; shake = Math.max(0, shake - dt * 45); }
      ctx.translate(sx, sy);
      drawBoard(dt);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      if (flashA > 0) { ctx.fillStyle = 'rgba(255,255,255,' + flashA + ')'; ctx.fillRect(0, 0, W, H); flashA = Math.max(0, flashA - dt * 1.2); }
      if (!ended && !paused && !drag && !tut && !$('menu').classList.contains('show')) { idleT += dt; if (idleT > 6 && !hint) hint = findHint() || [-1, -1]; }
      placeCoach();
    }
    window.__ft.push(performance.now() - t0); if (window.__ft.length > 300) window.__ft.shift();
    requestAnimationFrame(frame);
  }
  function findHint() { for (var s = 0; s < S.cols.length; s++) { var d = Core.bestTarget(S, s); if (d >= 0 && S.cols[d].length) return [s, d]; } for (s = 0; s < S.cols.length; s++) { d = Core.bestTarget(S, s); if (d >= 0) return [s, d]; } return null; }

  function drawBoard(dt) {
    var n = S.cols.length, risk = Core.overflowRisk(S), validT = sel >= 0 ? Core.targets(S, sel) : [];
    var selRun = sel >= 0 ? Core.topRun(S.cols[sel]) : null, hoverC = drag && drag.moving ? colAt(drag.x, drag.y) : -1;
    var pw = pillarSprite.w, ph = pillarSprite.h;
    for (var i = 0; i < n; i++) {
      var x = colX(i), col = S.cols[i], isT = validT.indexOf(i) >= 0, dim = sel >= 0 && !isT && i !== sel;
      ctx.globalAlpha = dim ? .45 : 1; ctx.drawImage(pillarSprite.c, x - pw / 2, G.top, pw, ph); ctx.globalAlpha = 1;
      var danger = col.length >= CAP - 2;
      if (danger || risk[i]) { var pa = .35 + .25 * Math.sin(time * 7); ctx.fillStyle = 'rgba(255,60,110,' + (pa * .35) + ')'; rrect(ctx, x - pw / 2, G.top, pw, ph, 16); ctx.fill(); ctx.strokeStyle = 'rgba(255,80,120,' + (pa + .2) + ')'; ctx.lineWidth = 2.5; ctx.stroke(); }
      if (isT) {
        var pulse = .55 + .35 * Math.sin(time * 8); ctx.strokeStyle = 'rgba(78,240,160,' + pulse + ')'; ctx.lineWidth = hoverC === i ? 4 : 3; rrect(ctx, x - pw / 2, G.top, pw, ph, 16); ctx.stroke();
        // landing ghosts
        var k = Core.canMove(S, sel, i); for (var g = 0; g < k; g++) stone(selRun.l, x, slotY(col.length + g), 1, .55, 'ghost');
        // bouncing chevron, or a FUSE tag when this move completes a set of 5
        var cy = slotY(col.length + k) - G.tileH * .2 + Math.sin(time * 9) * 4, tr = Core.topRun(col), fuses = col.length && tr.n + k >= MERGE;
        if (fuses) {
          ctx.strokeStyle = 'rgba(255,210,95,' + (pulse + .2) + ')'; ctx.lineWidth = 4; rrect(ctx, x - pw / 2, G.top, pw, ph, 16); ctx.stroke();
          ctx.fillStyle = '#ffd25f'; rrect(ctx, x - 26, cy - 22, 52, 22, 11); ctx.fill();
          ctx.fillStyle = '#2a1300'; ctx.font = '900 13px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('FUSE!', x, cy - 10);
        } else { ctx.fillStyle = '#4ef0a0'; ctx.beginPath(); ctx.moveTo(x - 9, cy - 8); ctx.lineTo(x + 9, cy - 8); ctx.lineTo(x, cy + 3); ctx.closePath(); ctx.fill(); }
      }
      if (hint && (hint[0] === i || hint[1] === i) && sel < 0) { ctx.strokeStyle = 'rgba(255,210,95,' + (.35 + .35 * Math.sin(time * 5)) + ')'; ctx.lineWidth = 3; rrect(ctx, x - pw / 2, G.top, pw, ph, 16); ctx.stroke(); }
      // incoming preview strip
      var nx = S.next[i] || [], mini = .42, mw = G.tileW * .94 * mini, gap = 2, totalW = nx.length * (mw + gap) - gap;
      var maxShow = Math.max(1, Math.floor((G.slot - 4) / (mw + gap)));
      for (var q = 0; q < nx.length && q < maxShow; q++) stone(nx[q], x - Math.min(totalW, maxShow * (mw + gap)) / 2 + mw / 2 + q * (mw + gap), G.previewY, mini, risk[i] ? .95 : .8);
      if (nx.length > maxShow) { ctx.fillStyle = '#fff'; ctx.font = '800 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText('+' + (nx.length - maxShow), x + G.slot / 2 - 8, G.previewY - 10); }
      if (risk[i]) { ctx.fillStyle = '#ff4f7a'; ctx.font = '900 13px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('FULL!', x, G.previewY - G.previewH * .62); }
    }
    // stones
    var liftIds = {};
    if (sel >= 0) S.cols[sel].slice(-selRun.n).forEach(function (c, k) { liftIds[c.id] = selRun.n - k; });
    for (i = 0; i < n; i++) {
      var col2 = S.cols[i];
      for (var j = 0; j < col2.length; j++) {
        var ch = col2[j], v = vis[ch.id]; if (!v) { v = vis[ch.id] = mkVis(colX(i), slotY(j), 0); v.s = .3; }
        if (v.d > 0) { v.d -= dt; continue; }
        var tx = colX(i), ty = slotY(j), lifted = liftIds[ch.id];
        if (lifted && drag && drag.moving) { tx = drag.x; ty = drag.y - (lifted - 1) * G.tileH * .92 - G.tileH * .6; }
        else if (lifted) ty -= G.tileH * .38;
        var wasFar = Math.abs(ty - v.y) > 2;
        spring(v, tx, ty, dt, v.arc ? 700 : 520);
        if (v.arc && Math.abs(tx - v.x) < 3 && Math.abs(ty - v.y) < 3) { v.arc = 0; v.sq = .16; }
        if (v.vy > 400 && Math.abs(ty - v.y) < 6) v.sq = Math.min(.2, v.vy / 4000);
        v.sq *= Math.pow(.0008, dt);
        v.s += (1 - v.s) * (1 - Math.pow(.00005, dt));
        var arcLift = v.arc ? -Math.min(G.tileH * 1.4, Math.abs(tx - v.x) * .45) : 0;
        var wob = 0; if (v.wob > 0) { v.wob -= dt; wob = Math.sin(v.wob * 70) * 6 * (v.wob / .3); }
        stone(ch.l, v.x + wob, v.y + arcLift, v.s, 1, lifted ? 'glow' : 'n', v.sq);
      }
      // fuse counter badge on top run
      var r = Core.topRun(col2);
      if (r.n >= 2 && !(sel === i)) {
        var bx = colX(i), by = slotY(col2.length - 1) - G.tileH * .62, near = r.n === MERGE - 1;
        var bw = 34, bh = 18; ctx.fillStyle = near ? '#ffd25f' : 'rgba(10,5,30,.8)'; rrect(ctx, bx - bw / 2, by - bh / 2, bw, bh, 9); ctx.fill();
        if (near) { ctx.strokeStyle = 'rgba(255,210,95,' + (.4 + .4 * Math.sin(time * 9)) + ')'; ctx.lineWidth = 2; rrect(ctx, bx - bw / 2 - 2, by - bh / 2 - 2, bw + 4, bh + 4, 11); ctx.stroke(); }
        ctx.fillStyle = near ? '#2a1300' : '#fff'; ctx.font = '900 12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(r.n + '/' + MERGE, bx, by + 1);
      }
    }
    // fusing ghosts converge
    ghosts = ghosts.filter(function (g) {
      g.t += dt * 6.5; if (g.t < 0) { stone(g.l, g.x, g.y, 1, 1); return true; }
      var k = Math.min(1, g.t), e = k * k * (3 - 2 * k);
      stone(g.l, g.x + (g.tx - g.x) * e, g.y + (g.ty - g.y) * e, 1 - e * .3, 1 - e * .6, 'glow'); return g.t < 1;
    });
    rings = rings.filter(function (r) { r.t += dt * 2.6; ctx.beginPath(); ctx.arc(r.x, r.y, 12 + r.t * G.tileW, 0, 7); ctx.strokeStyle = r.c; ctx.globalAlpha = Math.max(0, 1 - r.t); ctx.lineWidth = 5 * (1 - r.t) + 1; ctx.stroke(); ctx.globalAlpha = 1; return r.t < 1; });
    parts = parts.filter(function (p) {
      p.t += dt; if (p.conf) { p.vy = Math.min(p.vy + 40 * dt, 220); p.x += (p.vx + Math.sin(p.t * 6 + p.r) * 40) * dt; } else { p.vy += 900 * dt; p.vx *= .985; p.x += p.vx * dt; }
      p.y += p.vy * dt; var a = 1 - p.t / p.life; if (a <= 0 || p.y > H + 20) return false;
      ctx.globalAlpha = a; ctx.fillStyle = p.c; if (p.sq) ctx.fillRect(p.x - p.r, p.y - p.r * .6, p.r * 2, p.r * 1.2); else { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); }
      ctx.globalAlpha = 1; return true;
    });
    floats = floats.filter(function (f) {
      f.t += dt; var a = Math.max(0, 1 - f.t / 1.1), sc = f.big ? 1 + .3 * Math.max(0, 1 - f.t * 5) : 1;
      ctx.globalAlpha = a; ctx.font = '900 ' + Math.round((f.big ? 30 : 22) * sc) + 'px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(20,8,50,.85)'; ctx.strokeText(f.s, f.x, f.y - f.t * 50); ctx.fillStyle = f.c; ctx.fillText(f.s, f.x, f.y - f.t * 50); ctx.globalAlpha = 1; return f.t < 1.1;
    });
  }

  /* ================= menus, settings, shop ================= */
  function pause() { if (!S || ended || tut) { return; } paused = true; Ads.gameplayStop(); $('pause').classList.add('show'); }
  function resume() { paused = false; $('pause').classList.remove('show'); Ads.gameplayStart(); }
  function openLevels() {
    var g = $('levelGrid'); g.innerHTML = ''; var max = Math.max(prof.level + 4, 30);
    for (var n = 1; n <= max; n++) { var b = document.createElement('button'), st = prof.stars[n] || 0; b.className = 'lv' + (n === prof.level ? ' cur' : '');
      b.innerHTML = n + '<small>' + (st ? '★★★'.slice(0, st) + '☆☆☆'.slice(0, 3 - st) : '') + '</small>'; b.disabled = n > prof.level;
      (function (n) { b.onclick = function () { audio(); startLevel(n); }; })(n); g.appendChild(b); }
    $('levels').classList.add('show');
  }
  var TOGGLES = [['sound', 'Sound'], ['music', 'Music'], ['haptics', 'Vibration'], ['reduce', 'Reduce motion']];
  function openSettings() {
    var t = $('toggles'); t.innerHTML = '';
    TOGGLES.forEach(function (x) { var row = document.createElement('div'); row.className = 'tg'; row.innerHTML = '<span>' + x[1] + '</span><button class="sw' + (prof.set[x[0]] ? ' on' : '') + '" role="switch" aria-label="' + x[1] + '"></button>';
      row.querySelector('button').onclick = function (e) { prof.set[x[0]] = !prof.set[x[0]]; e.currentTarget.classList.toggle('on', prof.set[x[0]]); saveProf(); applySettings(); haptic('light'); }; t.appendChild(row); });
    $('btnRestore').style.display = SHOP ? '' : 'none';
    $('settings').classList.add('show');
  }
  function applySettings() { applyAudio(); document.body.classList.toggle('reduce', !!prof.set.reduce); }
  function openShop() {
    if (!SHOP) return;
    var list = $('shopList'); list.innerHTML = '';
    IAP.products.forEach(function (p) {
      var owned = p.type === 'nonconsumable' && prof.owned[p.id], row = document.createElement('div');
      row.className = 'sku' + (p.id === 'rr.starter' ? ' hot' : '');
      row.innerHTML = '<div><b></b><span></span></div><button class="btn secondary"></button>';
      row.querySelector('b').textContent = p.title; row.querySelector('span').textContent = p.desc;
      var btn = row.querySelector('button'); btn.textContent = owned ? 'Owned' : IAP.price(p.id); btn.disabled = !!owned;
      btn.onclick = function () { IAP.buy(p.id).then(function (r) { if (!r.ok) toast(r.reason === 'web' ? 'Available in the app' : 'Purchase not completed'); }); };
      list.appendChild(row);
    });
    $('btnFreeShards').style.display = ADS ? '' : 'none';
    $('shop').classList.add('show');
  }
  function grant(p, tx, restore) {
    if (p.type === 'nonconsumable') { if (prof.owned[p.id]) return; prof.owned[p.id] = 1; }
    if (p.noAds) { prof.noAds = true; Ads.setNoAds(true); }
    if (p.shards && !restore) addShards(p.shards);
    sfx.coin(); saveProf(); if ($('shop').classList.contains('show')) openShop(); toast('Thank you! ' + p.title);
  }

  /* ================= wiring ================= */
  function on(id, f) { $(id).addEventListener('click', function (e) { audio(); f(e); }); }
  on('btnDeal', doDeal); on('btnUndo', undo); on('btnShatter', armShatter);
  on('btnPause', function () { if (tut) { showMenu(); return; } pause(); });
  on('btnResume', resume);
  on('btnRestart', function () { paused = false; if (S.mode === 'level') startLevel(S.levelN); else if (S.mode === 'endless') { save('run', null); startEndless(false); } else { closeAll(); paused = false; } });
  on('btnHome', function () { paused = false; persist(); showMenu(); });
  on('btnPauseSettings', openSettings);
  on('btnShards', function () { if (SHOP) openShop(); });
  on('btnShop', openShop); on('btnSettings', openSettings); on('btnLevels', openLevels);
  on('btnTutorial', function () { startTutorial(); });
  on('btnRestore', function () { IAP.restore().then(function () { toast('Purchases restored'); }); });
  on('btnPlay', function () { if (!prof.tut) startTutorial(); else startLevel(prof.level); });
  on('btnEndless', function () { startEndless(true); });
  on('btnDaily', function () { var d = daily(); if (d.done) { showDailyResult(d); return; } startDaily(); });
  on('btnFreeShards', function () {
    var k = 'free_' + today(), n = load(k, 0); if (n >= 5) { toast('Come back tomorrow'); return; }
    busy = true; Ads.rewarded('shards').then(function (ok) { busy = false; if (ok) { save(k, n + 1); addShards(25, 'reward'); sfx.coin(); } });
  });
  document.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', function () { b.closest('.overlay').classList.remove('show'); }); });
  window.addEventListener('resize', function () { resize(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) { persist(); if (S && !ended && !tut && !$('menu').classList.contains('show') && !$('result').classList.contains('show')) pause(); } });

  if (!SHOP) { $('btnShop').style.display = 'none'; $('shardPlus').style.display = 'none'; }
  Ads.setNoAds(prof.noAds);
  Ads.init().then(function () { Ads.loadingDone(); });
  if (SHOP && window.IAP) IAP.init(grant);
  applySettings();
  // decorative live board behind the menu
  S = Core.newGame('endless', 4242); resize();
  S.cols.forEach(function (c, i) { c.forEach(function (x, j) { vis[x.id] = mkVis(colX(i), -40 - j * 30, .4 + i * .05 + j * .03); }); });
  menuInfo(); hud(true); document.body.classList.add('inmenu');
  // first launch: skip the menu, straight into the tutorial (top games drop you into play)
  if (!prof.tut && !/[?&]menu=1/.test(location.search)) startTutorial();
  requestAnimationFrame(frame);
  window.__rr = { get S() { return S; }, colX: colX, slotY: slotY, get G() { return G; }, prof: prof, get sel() { return sel; }, get tut() { return tut; }, doDeal: doDeal, startLevel: startLevel };
})();
