/* ==================================================
   gen-puzzles.js · 残局关卡生成器（开发工具，不随页面加载）

   用法：node tools/gen-puzzles.js
   输出：../js/puzzles-data.js（三模式 × 100 关，全部经内置裁判验证）

   构造法（逆向摆谱，非盲目搜索）：
   - 末段 = 活四：预置 3 黑连子 + 倒数第二手补成"两头空"的四，
     白只能堵一头，黑下一手取另一头成五。
   - 前段（T-2 手）= 简单冲四梯子：每手"3 预置黑 + 本手"连成
     一端被预置白堵死的真四 → 白被逼只此一应。
   - 结构之间留隔离带，避免意外互动；白子干扰（decoy）只落在
     非保留格且不构成白四。
   - 每关由独立裁判 verifyPuzzle 逐手验证，失败重掷坐标（构造法
     命中率高，重掷代价极小）。
   - 种子由 (模式, 关卡序号) 派生 → 关卡可复现。
   ================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const N = 15;
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

/* ---------- 可复现随机 ---------- */
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const ri = (rnd, lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1)); // 含两端
function shuffle(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const inB = (r, c) => r >= 0 && r < N && c >= 0 && c < N;
const emptyGrid = () => Array.from({ length: N }, () => new Array(N).fill(0));
const key = (r, c) => r * N + c;

function runLen(g, r, c, color, dr, dc) {
  let n = 1;
  for (let i = 1; i < 5; i++) {
    const rr = r - dr * i, cc = c - dc * i;
    if (!inB(rr, cc) || g[rr][cc] !== color) break;
    n++;
  }
  for (let i = 1; i < 5; i++) {
    const rr = r + dr * i, cc = c + dc * i;
    if (!inB(rr, cc) || g[rr][cc] !== color) break;
    n++;
  }
  return n;
}
function isFiveAt(g, r, c) {
  const color = g[r][c];
  if (!color) return false;
  return DIRS.some(([dr, dc]) => runLen(g, r, c, color, dr, dc) >= 5);
}
/* color 方所有"立即成五点"：全盘扫描，O(225×4×8)，构造法只调用 O(次数) */
function allFivePoints(g, color) {
  const pts = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (g[r][c] !== 0) continue;
      g[r][c] = color;
      if (isFiveAt(g, r, c)) pts.push({ r, c });
      g[r][c] = 0;
    }
  }
  return pts;
}
const samePt = (a, b) => a.r === b.r && a.c === b.c;

/* ---------- 裁判：独立于构造逻辑，逐手验证一关 ----------
   steps 约定：accept = 黑可落点（末步可多解）；reply = 白被逼应手 */
function verifyPuzzle(pz) {
  const g = emptyGrid();
  for (const s of pz.preset) {
    if (!inB(s.r, s.c) || g[s.r][s.c] !== 0) return 'preset 点非法或重叠';
    g[s.r][s.c] = s.color;
  }
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (g[r][c] && isFiveAt(g, r, c)) return 'preset 已有五连';
    }
  }
  if (pz.steps.length > 1 && allFivePoints(g, 1).length > 0) return 'preset 黑已有一手胜';
  if (allFivePoints(g, 2).length > 0) return 'preset 白有四威胁';

  let pendingWins = null; // 双杀后白没堵住的成五点
  for (let i = 0; i < pz.steps.length; i++) {
    const st = pz.steps[i];
    if (!st.accept.length) return 'step' + i + ' accept 为空';
    for (const a of st.accept) {
      if (g[a.r][a.c] !== 0) return 'step' + i + ' accept 点被占';
      if (pendingWins && !pendingWins.some((p) => samePt(p, a))) return 'step' + i + ' 未利用双杀点';
    }
    const a = st.accept[0];
    g[a.r][a.c] = 1;

    if (isFiveAt(g, a.r, a.c)) {
      if (st.reply !== null || i !== pz.steps.length - 1) return 'step' + i + ' 成五手必须是末手';
      pendingWins = null;
      continue;
    }
    const F = allFivePoints(g, 1);
    if (F.length === 0) return 'step' + i + ' 无冲四威胁，白应手不强制';
    if (st.reply === null) return 'step' + i + ' 未成五却无白应手';
    if (F.length === 1 && !samePt(F[0], st.reply)) return 'step' + i + ' 白应手非强制点';
    if (F.length >= 2 && !F.some((p) => samePt(p, st.reply))) return 'step' + i + ' 应手不在成五点集';
    g[st.reply.r][st.reply.c] = 2;
    if (isFiveAt(g, st.reply.r, st.reply.c)) return 'step' + i + ' 白落成五';
    if (allFivePoints(g, 2).length > 0) return 'step' + i + ' 白落后有四威胁';
    pendingWins = F.length >= 2 ? F.filter((p) => !samePt(p, st.reply)) : null;
    if (F.length >= 2 && pendingWins.length === 0) return 'step' + i + ' 双杀被全堵';
  }
  const last = pz.steps[pz.steps.length - 1].accept[0];
  if (!isFiveAt(g, last.r, last.c)) return '末手未成五';
  return null;
}

/* ---------- 结构构造 ----------
   活四结构（占一行的 6 格 idx 0..5）：白_黑黑黑_黑_白
     预置黑 idx1,2,3；M = idx4 → 活四 idx1..4，两头 idx0/idx5 空。
   真四结构（占一行 6 格 idx 0..5）：白黑黑黑_白
     预置黑 idx1,2,3；M = idx4 → 四 idx1..4，白堵 idx0，唯一成五点 idx5（白应手）。 */
function lineCells(orient, r, c) {
  const cells = [];
  for (let i = 0; i < 6; i++) cells.push(orient === 'h' ? { r, c: c + i } : { r: r + i, c });
  return cells;
}
/* 候选锚点：保证 6 格都在 [1,13] 内 */
function anchors() {
  const out = [];
  for (const orient of ['h', 'v']) {
    for (let a = 1; a <= 13 - 5 + 1; a++) {
      for (let b = 2; b <= 12; b++) out.push({ orient, r: orient === 'h' ? b : a, c: orient === 'h' ? a : b });
    }
  }
  return out;
}

function constructLevel(T, rnd) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const g = emptyGrid();
    const used = new Set();      // 结构占用 + 保留格（含应手点）
    const reserved = new Set();  // decoy 不得触碰
    const blacks = [], whites = [];
    let ok = true;

    /* 放置一个结构：cells = 6 格；blkIdx = 放预置黑的下标；blkEnd 是否白堵 idx0 */
    const placeStruct = (cells, blkIdx, withBlocker) => {
      // 隔离带：结构自身格 + 周围一圈都不与其他结构占用格相邻
      for (const p of cells) {
        if (used.has(key(p.r, p.c))) return false;
        for (const [dr, dc] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (!inB(p.r + dr, p.c + dc)) continue;
          if (used.has(key(p.r + dr, p.c + dc))) return false;
        }
      }
      for (let i = 0; i < 6; i++) {
        used.add(key(cells[i].r, cells[i].c));
        reserved.add(key(cells[i].r, cells[i].c));
      }
      for (const i of blkIdx) {
        g[cells[i].r][cells[i].c] = 1;
        blacks.push(cells[i]);
      }
      if (withBlocker) {
        g[cells[0].r][cells[0].c] = 2;
        whites.push(cells[0]);
      }
      return true;
    };

    /* 前段：T-2 个真四梯子（白堵头） */
    const pool = shuffle(anchors(), rnd);
    let pi = 0;
    const nextFree = (withBlocker) => {
      while (pi < pool.length) {
        const a = pool[pi++];
        const cells = lineCells(a.orient, a.r, a.c);
        if (placeStruct(cells, [1, 2, 3], withBlocker)) return cells;
      }
      return null;
    };

    const ladders = [];
    for (let i = 0; i < T - 2 && ok; i++) {
      const cells = nextFree(true);
      if (!cells) ok = false; else ladders.push(cells);
    }
    /* 末段活四：两头都必须空 → 不带堵头 */
    if (ok) {
      const cells = nextFree(false);
      if (!cells) ok = false; else ladders.push({ finale: cells });
    }
    if (!ok) continue;

    /* 模拟整条链生成 steps */
    const steps = [];
    let F = null;
    for (const lad of ladders) {
      const cells = lad.finale || lad;
      const isFinale = !!lad.finale;
      const M = cells[4];
      g[M.r][M.c] = 1;
      if (isFiveAt(g, M.r, M.c)) { ok = false; break; } // 意外连五 → 重掷
      F = allFivePoints(g, 1);
      const expect = isFinale ? 2 : 1;
      if (F.length !== expect) { ok = false; break; }
      const reply = F[0];
      g[reply.r][reply.c] = 2;
      if (isFiveAt(g, reply.r, reply.c) || allFivePoints(g, 2).length > 0) { ok = false; break; }
      steps.push({ accept: [M], reply });
    }
    if (!ok) continue;
    /* 末手：取白没堵住的成五点（可多解） */
    const rest = F.filter((p) => !samePt(p, steps[steps.length - 1].reply));
    if (!rest.length) continue;
    steps.push({ accept: rest, reply: null });

    const pz = {
      preset: blacks.map((p) => ({ r: p.r, c: p.c, color: 1 }))
        .concat(whites.map((p) => ({ r: p.r, c: p.c, color: 2 }))),
      steps,
    };
    if (verifyPuzzle(pz) === null) return { pz, reserved };
  }
  return null;
}

/* T=1：预置四（一端堵死）+ 唯一成五点 */
function constructOneStep(rnd) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const g = emptyGrid();
    const used = new Set();
    const a = shuffle(anchors(), rnd)[0];
    const cells = lineCells(a.orient, a.r, a.c);
    let clash = false;
    for (const p of cells) {
      for (const [dr, dc] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (inB(p.r + dr, p.c + dc) && used.has(key(p.r + dr, p.c + dc))) clash = true;
      }
    }
    if (clash) continue;
    g[cells[0].r][cells[0].c] = 2; // 堵一端
    for (const i of [1, 2, 3, 4]) g[cells[i].r][cells[i].c] = 1;
    const F = allFivePoints(g, 1);
    if (F.length !== 1 || !samePt(F[0], cells[5])) continue;
    const pz = {
      preset: [1, 2, 3, 4].map((i) => ({ r: cells[i].r, c: cells[i].c, color: 1 }))
        .concat([{ r: cells[0].r, c: cells[0].c, color: 2 }]),
      steps: [{ accept: [cells[5]], reply: null }],
    };
    if (verifyPuzzle(pz) === null) return { pz, reserved: new Set() };
  }
  return null;
}

/* 撒白子干扰：避开保留格与已有子，且不得构成白四；失败少撒 */
function addDecoys(pz, reserved, count, rnd) {
  const g = emptyGrid();
  for (const s of pz.preset) {
    g[s.r][s.c] = s.color;
    reserved.add(key(s.r, s.c));
  }
  for (const st of pz.steps) {
    for (const a of st.accept) reserved.add(key(a.r, a.c));
    if (st.reply) reserved.add(key(st.reply.r, st.reply.c));
  }
  let added = 0;
  for (let t = 0; t < count * 12 && added < count; t++) {
    const r = ri(rnd, 1, 13), c = ri(rnd, 1, 13);
    if (g[r][c] !== 0 || reserved.has(key(r, c))) continue;
    g[r][c] = 2;
    if (allFivePoints(g, 2).length > 0) { g[r][c] = 0; continue; }
    added++;
  }
  const preset = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (g[r][c]) preset.push({ r, c, color: g[r][c] });
    }
  }
  const out = Object.assign({}, pz, { preset });
  return verifyPuzzle(out) === null ? out : pz; // 干扰破坏结构就回退
}

/* ---------- 主流程 ---------- */
const MODE_CFG = [
  { key: 'easy', label: '简单', count: 100, targets: [1, 1, 1, 2, 2, 2, 2, 3], decoys: [2, 3] },
  { key: 'hard', label: '困难', count: 100, targets: [2, 2, 3, 3, 3, 3, 4, 4], decoys: [4, 6] },
  { key: 'hell', label: '地狱', count: 100, targets: [3, 3, 4, 4, 4, 5, 5, 5], decoys: [6, 9] },
];
const FLAVOR = ['', '一步胜', '两步胜', '三步胜', '四步胜', '五步胜'];

const data = {};
let totalFail = 0;
for (const cfg of MODE_CFG) {
  data[cfg.key] = [];
  const dist = {};
  for (let i = 0; i < cfg.count; i++) {
    const rnd = mulberry32(hashStr(cfg.key + ':' + i));
    const T = cfg.targets[i % cfg.targets.length];
    const built = T === 1 ? constructOneStep(rnd) : constructLevel(T, rnd);
    if (!built) {
      console.error('生成失败:', cfg.key, i, 'T=' + T);
      totalFail++;
      continue;
    }
    const dz = ri(rnd, cfg.decoys[0], cfg.decoys[1]);
    const pz = addDecoys(built.pz, built.reserved, dz, rnd);
    const n = pz.steps.length;
    dist[n] = (dist[n] || 0) + 1;
    data[cfg.key].push({
      id: cfg.key + '-' + (i + 1),
      mode: cfg.key,
      name: '第' + (i + 1) + '关',
      flavor: FLAVOR[n],
      hint: n === 1
        ? '黑棋已有四连在手，找出成五的那一点。'
        : '黑棋' + n + '手可破：连环冲四，每一手都让白棋只此一应。',
      preset: pz.preset,
      steps: pz.steps,
    });
  }
  console.log(cfg.label + ': ' + data[cfg.key].length + '/' + cfg.count, '步数分布', JSON.stringify(dist));
}

/* 终验：全部关卡再过一遍独立裁判 */
let bad = 0;
const ids = new Set();
for (const modeKey of Object.keys(data)) {
  for (const pz of data[modeKey]) {
    if (ids.has(pz.id)) { console.error('id 重复', pz.id); bad++; }
    ids.add(pz.id);
    const err = verifyPuzzle(pz);
    if (err) { console.error('验证失败', pz.id, err); bad++; }
  }
}
if (totalFail || bad) { console.error('=== 生成未通过 ==='); process.exit(1); }

/* 写数据文件 */
const header =
  '/* ==================================================\n' +
  '   puzzles-data.js · 残局关卡数据（M6.8，自动生成，勿手改）\n' +
  '   生成器：tools/gen-puzzles.js（node 运行即重新生成；种子固定可复现）\n' +
  '   形状：{ easy: [关卡×100], hard: [...], hell: [...] }\n' +
  '   关卡：{ id, mode, name, flavor, hint, preset, steps }\n' +
  '   steps 约定：accept = 黑正解点（末步可多解）；reply = 白被逼应手（末步 null）\n' +
  '   全部 300 关已经生成器内置裁判逐手验证（强制胜、白无四五威胁）\n' +
  '   ================================================== */\n' +
  "'use strict';\n\nconst PUZZLE_DATA = ";
const body = JSON.stringify(data);
fs.writeFileSync(path.join(__dirname, '..', 'js', 'puzzles-data.js'), header + body + ';\n', 'utf8');
console.log('=== 300 关全部验证通过 → js/puzzles-data.js 已生成（' + Math.round(body.length / 1024) + ' KB） ===');
