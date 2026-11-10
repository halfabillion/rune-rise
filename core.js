/* Rune Rise — pure game logic (no DOM). Browser: window.Core · Node: module.exports */
(function (root) {
  'use strict';
  var CAP = 10, MERGE = 5, MAX_COLS = 7, DAILY_DEALS = 30;

  function rngNext(S) { // mulberry32; state lives in S so undo/snapshots stay deterministic
    var t = (S.rng = (S.rng + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function seedFromString(s) { var h = 2166136261 >>> 0; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }

  /* ---------- hand-tuned levels (1-12), then a formula ---------- */
  // goal: {t:'tier', l} reach tier l · {t:'make', l, n} fuse n tablets of tier l · {t:'score', n}
  var LEVELS = [
    null,
    { cols: 4, deals: 6,  goal: { t: 'tier', l: 3 } },
    { cols: 4, deals: 7,  goal: { t: 'make', l: 3, n: 2 } },
    { cols: 5, deals: 11, goal: { t: 'tier', l: 4 } },
    { cols: 5, deals: 17, goal: { t: 'score', n: 300 } },
    { cols: 5, deals: 16, goal: { t: 'make', l: 3, n: 8 } },
    { cols: 5, deals: 18, goal: { t: 'make', l: 4, n: 2 } },
    { cols: 6, deals: 32, goal: { t: 'score', n: 900 } },
    { cols: 5, deals: 37, goal: { t: 'tier', l: 5 } },
    { cols: 6, deals: 35, goal: { t: 'make', l: 4, n: 6 } },
    { cols: 6, deals: 41, goal: { t: 'make', l: 5, n: 2 } },
    { cols: 6, deals: 48, goal: { t: 'score', n: 1800 } },
    { cols: 6, deals: 60, goal: { t: 'tier', l: 6 } }
  ];
  function level(n) {
    if (n < LEVELS.length) { var L = LEVELS[n]; return { n: n, cols: L.cols, deals: L.deals, goal: L.goal, seed: seedFromString('rr-level-' + n) }; }
    var k = n - 13, kind = k % 3, cols = Math.min(MAX_COLS, 6 + Math.floor(k / 12)), est, goal;
    if (kind === 0) { goal = { t: 'make', l: 4, n: 5 + (k % 5) }; est = goal.n * 5.2; }
    else if (kind === 1) { goal = { t: 'score', n: 1000 + 60 * k }; est = goal.n / 42; }
    else { goal = { t: 'make', l: 5, n: 2 + Math.min(3, Math.floor(k / 9)) }; est = goal.n * 18; }
    return { n: n, cols: cols, deals: Math.ceil(est * 1.15) + 2, goal: goal, seed: seedFromString('rr-level-' + n) };
  }
  function goalProgress(S) {
    var g = S.goal; if (!g) return null;
    if (g.t === 'tier') return { have: Math.min(S.peak, g.l), need: g.l, done: S.peak >= g.l };
    if (g.t === 'make') { var h = S.made[g.l] || 0; return { have: Math.min(h, g.n), need: g.n, done: h >= g.n }; }
    return { have: Math.min(S.score, g.n), need: g.n, done: S.score >= g.n };
  }
  function stars(S) { var left = S.dealsLeft / (S.dealsTotal - S.extra || 1); return S.extra ? 1 : left >= 0.15 ? 3 : left >= 0.05 ? 2 : 1; }

  /* ---------- game ---------- */
  function newGame(mode, seed, o) {
    o = o || {};
    var S = { mode: mode, cols: [], score: 0, peak: 2, deals: 0, nextId: 1, rng: seed >>> 0, revived: false, over: false,
      finished: false, won: false, merges: 0, made: {}, next: [], goal: o.goal || null, levelN: o.n || 0, extra: 0,
      dealsLeft: mode === 'daily' ? DAILY_DEALS : (o.deals || -1), dealsTotal: mode === 'daily' ? DAILY_DEALS : (o.deals || -1) };
    var n = o.cols || 5;
    for (var i = 0; i < n; i++) S.cols.push([]);
    if (o.preset) {
      o.preset.forEach(function (c, i) { c.forEach(function (l) { S.cols[i].push(chip(S, l)); }); });
      S.next = o.presetNext ? o.presetNext.map(function (c) { return c.slice(); }) : [];
      S.scripted = o.scripted || null;
    } else { genNext(S); deal(S, true); }
    if (!S.next.length) genNext(S);
    return S;
  }
  function chip(S, l) { return { id: S.nextId++, l: l }; }
  function topRun(col) {
    if (!col || !col.length) return { l: 0, n: 0 };
    var l = col[col.length - 1].l, n = 0;
    for (var i = col.length - 1; i >= 0 && col[i].l === l; i--) n++;
    return { l: l, n: n };
  }
  function levelRange(S) {
    var hi = Math.max(2, S.peak - 2), spread = S.deals < 12 ? 2 : S.deals < 40 ? 3 : 4;
    return { lo: Math.max(1, hi - spread + 1), hi: hi };
  }
  function maxPer(S) { return S.deals < 1 ? 3 : S.deals < 12 ? 2 : S.deals < 45 ? 3 : 4; }

  // Pre-roll the next deal so the player can see it coming.
  function genNext(S) {
    if (S.scripted && S.scripted.length) { S.next = S.scripted.shift(); return; }
    var r = levelRange(S), mp = maxPer(S), n = S.cols.length, plan = [], total = 0, i, k;
    for (i = 0; i < n; i++) { k = Math.floor(rngNext(S) * (mp + 1)); plan.push(k); total += k; }
    while (total < Math.ceil(n * (S.deals < 12 ? 0.6 : 0.8))) { i = Math.floor(rngNext(S) * n); plan[i]++; total++; }
    S.next = [];
    for (i = 0; i < n; i++) {
      var col = S.cols[i], prev = 0, kind = S.deals < 15 ? 0.45 : 0.3, out = [];
      if (col.length && rngNext(S) < kind && col[col.length - 1].l >= r.lo && col[col.length - 1].l <= r.hi) prev = col[col.length - 1].l;
      for (k = 0; k < plan[i]; k++) {
        var l = (prev && rngNext(S) < 0.7) ? prev : r.lo + Math.floor(rngNext(S) * (r.hi - r.lo + 1));
        prev = l; out.push(l);
      }
      S.next.push(out);
    }
  }
  function overflowRisk(S) { return S.cols.map(function (c, i) { return c.length + ((S.next[i] || []).length) > CAP; }); }

  function deal(S, opening) {
    var ev = [], overflow = false, i, k;
    for (i = 0; i < S.cols.length; i++) {
      var add = S.next[i] || [];
      for (k = 0; k < add.length; k++) {
        if (S.cols[i].length >= CAP) { overflow = true; continue; }
        var c = chip(S, add[k]); S.cols[i].push(c); ev.push({ t: 'deal', col: i, id: c.id, order: k });
      }
    }
    if (!opening) { S.deals++; if (S.dealsLeft > 0) S.dealsLeft--; }
    for (i = 0; i < S.cols.length; i++) ev = ev.concat(resolve(S, i));
    if (overflow) S.over = true;
    genNext(S);
    return { events: ev, overflow: overflow };
  }

  // Fuse MERGE identical top tablets into one of the next tier, chaining.
  function resolve(S, ci) {
    var ev = [], col = S.cols[ci], run;
    while ((run = topRun(col)).n >= MERGE) {
      var removed = col.splice(col.length - MERGE, MERGE).map(function (c) { return c.id; });
      var nl = run.l + 1, c = chip(S, nl);
      col.push(c);
      var pts = 5 * Math.pow(2, run.l);
      S.score += pts; S.merges++; S.made[nl] = (S.made[nl] || 0) + 1;
      var unlocked = false, newPeak = nl > S.peak;
      if (newPeak) {
        S.peak = nl;
        if (S.mode !== 'level' && ((S.peak >= 6 && S.cols.length < 6) || (S.peak >= 9 && S.cols.length < MAX_COLS))) { S.cols.push([]); S.next.push([]); unlocked = true; }
      }
      ev.push({ t: 'merge', col: ci, removed: removed, id: c.id, l: nl, pts: pts, unlocked: unlocked, newPeak: newPeak });
    }
    var gp = goalProgress(S); if (gp && gp.done && !S.won) { S.won = true; ev.push({ t: 'win' }); }
    return ev;
  }
  function canMove(S, s, d) {
    if (s === d) return 0;
    var src = S.cols[s], dst = S.cols[d];
    if (!src || !dst || !src.length) return 0;
    var r = topRun(src), space = CAP - dst.length;
    if (space <= 0) return 0;
    if (dst.length && dst[dst.length - 1].l !== r.l) return 0;
    return Math.min(r.n, space);
  }
  function targets(S, s) { var out = []; for (var d = 0; d < S.cols.length; d++) if (canMove(S, s, d)) out.push(d); return out; }
  function bestTarget(S, s) {
    var best = -1, score = -1e9, r = topRun(S.cols[s]);
    for (var d = 0; d < S.cols.length; d++) {
      var n = canMove(S, s, d); if (!n) continue;
      var dst = S.cols[d], sc;
      if (dst.length) sc = 100 + topRun(dst).n + n + (n === r.n ? 5 : 0) + (topRun(dst).n + n >= MERGE ? 50 : 0);
      else { if (r.n === S.cols[s].length) continue; sc = 10 - d * 0.01; }
      if (sc > score) { score = sc; best = d; }
    }
    return best;
  }
  function usefulMoves(S) { var n = 0; for (var s = 0; s < S.cols.length; s++) { var d = bestTarget(S, s); if (d >= 0) n++; } return n; }
  function move(S, s, d) {
    var n = canMove(S, s, d); if (!n) return null;
    var moved = S.cols[s].splice(S.cols[s].length - n, n);
    for (var i = 0; i < moved.length; i++) S.cols[d].push(moved[i]);
    return [{ t: 'move', from: s, to: d, ids: moved.map(function (c) { return c.id; }) }].concat(resolve(S, d));
  }
  // Revive: dissolve the two lowest tiers on the board.
  function revive(S) {
    var lv = {}, ev = [];
    S.cols.forEach(function (c) { c.forEach(function (x) { lv[x.l] = 1; }); });
    var tiers = Object.keys(lv).map(Number).sort(function (a, b) { return a - b; }).slice(0, 2);
    S.cols.forEach(function (c, ci) {
      for (var i = c.length - 1; i >= 0; i--) if (tiers.indexOf(c[i].l) >= 0) { ev.push({ t: 'dissolve', col: ci, id: c[i].id, l: c[i].l }); c.splice(i, 1); }
      while (c.length > CAP - 3) { var x = c.pop(); ev.push({ t: 'dissolve', col: ci, id: x.id, l: x.l }); }
    });
    S.over = false; S.revived = true; genNext(S);
    for (var i = 0; i < S.cols.length; i++) ev = ev.concat(resolve(S, i));
    return ev;
  }
  function addDeals(S, n) { S.dealsLeft += n; S.dealsTotal += n; S.extra += n; S.over = false; }
  function shatter(S, ci) {
    var col = S.cols[ci]; if (!col || !col.length) return null;
    var r = topRun(col), ev = [];
    for (var i = 0; i < r.n; i++) { var x = col.pop(); ev.push({ t: 'dissolve', col: ci, id: x.id, l: x.l }); }
    return ev;
  }
  function snapshot(S) { return JSON.parse(JSON.stringify(S)); }

  var Core = { CAP: CAP, MERGE: MERGE, DAILY_DEALS: DAILY_DEALS, MAX_COLS: MAX_COLS, newGame: newGame, deal: deal, move: move, canMove: canMove,
    targets: targets, bestTarget: bestTarget, usefulMoves: usefulMoves, revive: revive, shatter: shatter, addDeals: addDeals, topRun: topRun,
    snapshot: snapshot, seedFromString: seedFromString, levelRange: levelRange, overflowRisk: overflowRisk, level: level, goalProgress: goalProgress, stars: stars };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core; else root.Core = Core;
})(this);
