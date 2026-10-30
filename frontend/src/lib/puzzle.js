/* ==================================================
   puzzle.js · 残局挑战控制器（自旧 static/js/puzzle.js 改写为响应式）

   与旧版差别：
   - DOM 查询全部换成 reactive 状态（视图在 GameView 里渲染）
   - 选关弹窗的 100 关网格改为 ui store 弹窗 + PuzzleGrid 组件回调
   - 进度存取（localStorage + 上云）逻辑不变
   ================================================== */
import { reactive } from 'vue';
import { Api } from './api';
import { useUiStore, toast } from '../stores/ui';
import { Sound } from './game';
import { loadSave, saveTo, clearSave } from './gamesave';
import PuzzleGrid from '../components/PuzzleGrid.vue';
import { h } from 'vue';

const PUZZLE_PROGRESS_KEY = 'gomoku.puzzle';

export class PuzzleController {
  constructor(board, data, deps = {}) {
    this.board = board;
    this.deps = deps;
    this.ui = useUiStore();
    this.modes = [
      { key: 'easy', label: '简单', levels: data.easy || [] },
      { key: 'hard', label: '困难', levels: data.hard || [] },
      { key: 'hell', label: '地狱', levels: data.hell || [] },
    ].filter((m) => m.levels.length);
    this.mode = null;
    this.level = null;
    this.index = 0;
    this.gameOver = false;
    this.failed = false;      // 破解失败（白棋成五 / 棋盘下满）
    this._offScript = false;  // 已偏离正解：白方脱离剧本，转入自由防守

    /* 视图绑定的响应式状态（复用 GameController 的状态位语义） */
    this.s = reactive({
      timerText: '',
      statusTurn: '',
      statusMove: '',
      blackName: '黑方',
      whiteName: '白方（守）',
      blackActive: true,
      whiteActive: false,
      undoText: '重玩',
      drawText: '提示',
      resignText: '选关',
      undoDisabled: false,
      drawDisabled: false,
      resignDisabled: false,
      replayVisible: false,
      gameOver: false,
    });

    this.board.onCellClick((cell) => this._onCell(cell));
  }

  /* 换关（含首次进入）：复位全部状态，并把续局存档重置到该关起点 */
  loadLevel(index) {
    this.index = index;
    this.level = this.mode.levels[index];
    const size = this.board.size;
    this.grid = Array.from({ length: size }, () => new Array(size).fill(0));
    this.history = [];
    this.level.preset.forEach((st) => {
      this.grid[st.r][st.c] = st.color;
      this.history.push({ r: st.r, c: st.c, color: st.color });
    });
    this.stepIndex = 0;
    this.gameOver = false;
    this.failed = false;
    this._offScript = false;
    this.s.timerText = this.mode.label + ' · ' + this.level.name;
    clearSave('puzzle');
    this._saveOpenLevel();
    this.board.unlock();
    this.board.setPreviewColor(1);
    this.board.draw(this.history.slice(), -1);
    this._updateStatus();
  }

  /** 续局存档：{ 模式, 关卡, 已走步数, 黑白应招历史 }，刷新回场即恢复 */
  _saveOpenLevel() {
    if (!this.mode || !this.level || this.gameOver) return;
    saveTo('puzzle', {
      modeKey: this.mode.key,
      levelId: this.level.id,
      stepIndex: this.stepIndex,
      extra: this.history.slice(this.level.preset.length),
    });
  }

  /** 把存档里的已下手数回放回来，同时重建 stepIndex / 是否偏离正解 */
  restoreOpenLevel(saved) {
    if (!saved || !this.mode || saved.modeKey !== this.mode.key) return false;
    const idx = this.mode.levels.findIndex((lv) => lv.id === saved.levelId);
    if (idx < 0) return false;
    if (PuzzleController.clearedList().includes(saved.levelId)) return false; // 已通关无须续
    this.loadLevel(idx);
    if (!this.level) return false;
    if (Array.isArray(saved.extra)) {
      /* 顺序回放：黑子对照剧本推进 stepIndex，对不上即偏离正解；
         白子只校验落点合法（自由防守的手不重算，照摆） */
      let expectWhite = false;
      saved.extra.forEach((st) => {
        if (!st || !Number.isInteger(st.r) || !Number.isInteger(st.c)) return;
        if (!this.grid[st.r] || this.grid[st.r][st.c] !== 0) return; // 脏数据跳过
        if (st.color === 1 && !expectWhite) {
          const step = !this._offScript ? this.level.steps[this.stepIndex] : null;
          if (step && step.accept.some((p) => p.r === st.r && p.c === st.c)) {
            this.stepIndex += 1;
            expectWhite = !!step.reply;
          } else {
            this._offScript = true;
            expectWhite = true;
          }
        } else if (st.color === 2) {
          expectWhite = false;
        }
        this.grid[st.r][st.c] = st.color;
        this.history.push({ r: st.r, c: st.c, color: st.color });
      });
    }
    this.board.draw(this.history.slice(), this.history.length - 1);
    this._updateStatus();
    this._saveOpenLevel(); // 回放后把进度覆盖回存档槽
    return true;
  }

  restart() {
    this.loadLevel(this.index);
  }

  _updateStatus() {
    this.s.statusTurn = this.gameOver
      ? (this.failed ? '本关未破解' : '破解成功！')
      : '找出黑棋制胜一手';
    const n = this.history.length - this.level.preset.length;
    this.s.statusMove = '第 ' + n + ' 手';
  }

  _onCell(cell) {
    if (this.gameOver || !this.level) return;
    const { r, c } = cell;
    if (this.grid[r][c] !== 0) return;

    /* 任意空位都能落子：落错不收回、不提示，走出正解即转入自由对弈 */
    this._place(r, c, 1);
    const winCells = this._checkWin(r, c);
    if (winCells) { this._win(winCells); return; }
    if (this._full()) { this._fail('棋盘下满，本关未破解'); return; }

    /* 白方应手：在正解上时按剧本防守；一旦黑偏离正解，转自由防守 */
    const step = !this._offScript ? this.level.steps[this.stepIndex] : null;
    if (step && step.accept.some((p) => p.r === r && p.c === c)) {
      this.stepIndex += 1;
      if (step.reply) this._place(step.reply.r, step.reply.c, 2);
      const w2 = this._replyFive(step.reply);
      if (w2) { this._fail('白棋先连成五子，本关未破解'); return; }
    } else {
      this._offScript = true;
      const mv = this._defend();
      if (mv) {
        this._place(mv.r, mv.c, 2);
        const w2 = this._checkWin(mv.r, mv.c);
        if (w2) { this._fail('白棋先连成五子，本关未破解'); return; }
        if (this._full()) { this._fail('棋盘下满，本关未破解'); return; }
      }
    }
    this._updateStatus();
    this._saveOpenLevel(); // 关卡进度实时存档，刷新可续
  }

  /** 棋盘是否已下满 */
  _full() {
    for (const row of this.grid) {
      if (row.some((v) => v === 0)) return false;
    }
    return true;
  }

  /** 剧本应手落白后是否成五（reply 为 null 表示末手黑已成五，不会走到） */
  _replyFive(reply) {
    return reply ? this._checkWin(reply.r, reply.c) : null;
  }

  /* 自由防守：优先截断黑棋最长线（>=3 必堵，>=2 择优），否则占相邻活位，
     白自身有冲四/成五机会时先走自己 —— 玩家走偏后是真实对抗，不保底通关 */
  _defend() {
    const N = this.grid.length;
    const cands = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (this.grid[r][c] === 0) cands.push({ r, c });
      }
    }
    if (!cands.length) return null;

    const lineLen = (r, c, color) => {
      let best = 0;
      for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
        let n = 1;
        for (const s of [1, -1]) {
          let rr = r + dr * s, cc = c + dc * s;
          while (rr >= 0 && rr < N && cc >= 0 && cc < N && this.grid[rr][cc] === color) {
            n++; rr += dr * s; cc += dc * s;
          }
        }
        if (n > best) best = n;
      }
      return best;
    };

    // 白自己能成五 → 直接赢；黑能成五 → 必堵
    for (const m of cands) {
      this.grid[m.r][m.c] = 2;
      const five = lineLen(m.r, m.c, 2) >= 5;
      this.grid[m.r][m.c] = 0;
      if (five) return m;
    }
    for (const m of cands) {
      this.grid[m.r][m.c] = 1;
      const five = lineLen(m.r, m.c, 1) >= 5;
      this.grid[m.r][m.c] = 0;
      if (five) return m;
    }
    // 黑活四/冲四（4）> 黑三 (3) > 白自建 (2+) > 黑二 > 随机
    let best = null;
    let bestScore = -1;
    for (const m of cands) {
      this.grid[m.r][m.c] = 2;
      const mine = lineLen(m.r, m.c, 2);
      this.grid[m.r][m.c] = 1;
      const foe = lineLen(m.r, m.c, 1);
      this.grid[m.r][m.c] = 0;
      const score = Math.max(foe, mine * 2) + Math.random() * 0.5;
      if (score > bestScore) { bestScore = score; best = m; }
    }
    return best;
  }

  _place(r, c, color) {
    this.grid[r][c] = color;
    this.history.push({ r, c, color });
    this.board.draw(this.history.slice(), this.history.length - 1);
    Sound.play();
  }

  _checkWin(r, c) {
    const color = this.grid[r][c];
    const n = this.grid.length;
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (const [dr, dc] of dirs) {
      const cells = [{ r, c, color }];
      for (let i = 1; i < 5; i++) {
        const nr = r - dr * i;
        const nc = c - dc * i;
        if (nr < 0 || nr >= n || nc < 0 || nc >= n || this.grid[nr][nc] !== color) break;
        cells.unshift({ r: nr, c: nc, color });
      }
      for (let i = 1; i < 5; i++) {
        const nr = r + dr * i;
        const nc = c + dc * i;
        if (nr < 0 || nr >= n || nc < 0 || nc >= n || this.grid[nr][nc] !== color) break;
        cells.push({ r: nr, c: nc, color });
      }
      if (cells.length >= 5) return cells;
    }
    return null;
  }

  _win(cells) {
    this.gameOver = true;
    this.board.lock();
    this.board.setPreviewColor(null);
    this.board.highlightWin(cells);
    clearSave('puzzle'); // 过关即清续局存档（进度走已通关列表）
    this._saveProgress();
    this._updateStatus();
    setTimeout(() => this._showWinModal(), 500);
  }

  /* 破解失败：白棋成五或棋盘下满，同样终局（可重开本关） */
  _fail(msg) {
    this.gameOver = true;
    this.failed = true;
    this.board.lock();
    this.board.setPreviewColor(null);
    clearSave('puzzle');
    this._updateStatus();
    this.ui.openModal({
      title: '本关未破解',
      body: msg + '。可重玩本关再试一次。',
      buttons: [
        { text: '返回首页', onClick: () => this.quit() },
        { text: '重玩本关', type: 'primary', onClick: () => this.restart() },
      ],
    });
  }

  _saveProgress() {
    try {
      const done = PuzzleController.clearedList();
      if (!done.includes(this.level.id)) {
        done.push(this.level.id);
        localStorage.setItem(PUZZLE_PROGRESS_KEY, JSON.stringify(done));
      }
    } catch (e) { /* 写不进不影响过关 */ }
    if (Api.isLogin()) {
      Api.postPuzzleProgress(this.level.id).catch(() => {});
    }
  }

  static clearedList() {
    try {
      const v = JSON.parse(localStorage.getItem(PUZZLE_PROGRESS_KEY));
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }

  static clearedCountIn(modeKey) {
    return PuzzleController.clearedList().filter((id) => id.startsWith(modeKey + '-')).length;
  }

  _showWinModal() {
    const hasNext = this.index + 1 < this.mode.levels.length;
    const buttons = [];
    if (hasNext) {
      buttons.push({ text: '重玩本关', onClick: () => this.restart() });
      buttons.push({ text: '下一关', type: 'primary', onClick: () => this.loadLevel(this.index + 1) });
    } else {
      buttons.push({ text: '再玩一次', type: 'primary', block: true, onClick: () => this.restart() });
    }
    buttons.push({ text: '返回首页', block: true, onClick: () => this.quit() });
    this.ui.openModal({
      title: '残局破解！',
      body: this.mode.label + ' · ' + this.level.name + '（' + this.level.flavor +
            '），共 ' + this.history.length + ' 手',
      buttons,
    });
  }

  /* 选模式 → 选关卡。关卡网格走 PuzzleGrid 组件（onPick 回调收关号） */
  showModeSelect() {
    this.level = null;
    this.board.lock();
    const cleared = PuzzleController.clearedList();
    const buttons = this.modes.map((m) => ({
      text: m.label + '（已通 ' +
            cleared.filter((id) => id.startsWith(m.key + '-')).length + '/' + m.levels.length + '）',
      block: true,
      type: PuzzleController.clearedCountIn(m.key) >= m.levels.length ? undefined : 'primary',
      onClick: () => this.showLevelSelect(m),
    }));
    buttons.push({ text: '返回首页', onClick: () => this.quit() });
    this.ui.openModal({
      title: '残局挑战',
      body: '黑先制胜 · 走偏后白方自由防守，找出每关的正解',
      buttons,
    });
  }

  showLevelSelect(mode) {
    this.mode = mode;
    const cleared = PuzzleController.clearedList();
    const openIdx = mode.levels.findIndex((lv) => !cleared.includes(lv.id));
    const close = this.ui.openModal({
      title: mode.label + ' · 选关',
      bodyComponent: h(PuzzleGrid, {
        levels: mode.levels,
        cleared,
        openIdx,
        onPick: (i) => {
          close();
          // 防误触：当前关已落子未破解时，换关先确认
          const moved = this.level && !this.gameOver &&
                        this.history.length > this.level.preset.length;
          if (moved && i !== this.index) {
            this.ui.openModal({
              title: '你正在游戏中',
              body: '当前关卡尚未破解，换关后进度会被新关卡存档覆盖。确定要换吗？',
              buttons: [
                { text: '继续当前关' },
                { text: '换关', type: 'primary', onClick: () => this.loadLevel(i) },
              ],
            });
            return;
          }
          this.loadLevel(i);
        },
      }),
      buttons: [
        { text: '换模式', onClick: () => this.showModeSelect() },
        { text: '返回首页', onClick: () => this.quit() },
      ],
    });
  }

  /** 提示（复用"求和"按钮位） */
  showHint() {
    if (this.level) this.ui.openModal({ title: '提示', body: this.level.hint });
  }

  /** 选关（复用"认输"按钮位） */
  backToSelect() {
    if (this.mode) this.showLevelSelect(this.mode);
    else this.showModeSelect();
  }

  showRules() {
    this.ui.openModal({
      title: '残局规则',
      body: '黑先制胜。任意空位都可落子，走出正解前白方按剧本防守，' +
            '走偏后白方转入自由防守。黑棋先连成五子即过关；' +
            '白棋先成五或棋盘下满则本关失败，可重玩再战。',
    });
  }

  exit() {
    const presetN = this.level ? this.level.preset.length : 0;
    const moved = this.history && this.history.length > presetN;
    if (!this.level || this.gameOver || !moved) {
      this.quit(); // 没下过/已终局：退出即清档，刷新不再被拉回来
      return;
    }

    this.ui.openModal({
      title: '退出挑战？',
      body: '退出后本关进度不再保留（想保留可只刷新页面，别点退出）',
      buttons: [
        { text: '继续挑战' },
        { text: '退出', type: 'primary', onClick: () => this.quit() },
      ],
    });
  }

  _navigate(path) {
    if (this.deps.onNavigate) this.deps.onNavigate(path);
    else location.href = path;
  }

  /** 显式弃局：清续局存档（不跳转）。切模式 / 确认离开等出口复用 */
  discard() {
    this._quitting = true;
    clearSave('puzzle');
  }

  /** 显式退出挑战：弃局 + 卸载 + 返回首页 */
  quit() {
    this.discard();
    this.gameOver = true; // 标记终局：路由守卫（GameView）不再二次确认
    this.destroy();
    this._navigate('/');
  }

  destroy() {
    this.board.onCellClick(() => {});
    /* 硬刷新/关页不触发本钩子，存档保留供续局；
       显式退出/弃局（_quitting）时清档，刷新后不再被拉回残局 */
    if (this._quitting) clearSave('puzzle');
  }

  /* 页面入口：锁盘 → 取关卡 → 深链进关 / 自动续上次开的关 / 选模式（闯关闸门同旧版） */
  static boot(board, deps, query = {}) {
    board.lock();
    return Api.getPuzzles().then((data) => {
      if (!data) { toast('关卡数据为空'); return null; }
      const puzzle = new PuzzleController(board, data, deps);
      if (!puzzle.modes.length) { toast('关卡数据为空'); return null; }
      const want = query.level;
      if (want) {
        for (const m of puzzle.modes) {
          const idx = m.levels.findIndex((lv) => lv.id === want);
          if (idx >= 0) {
            const cleared = PuzzleController.clearedList();
            const openIdx = m.levels.findIndex((lv) => !cleared.includes(lv.id));
            if (cleared.includes(want) || idx === openIdx) {
              puzzle.mode = m;
              // 深链关卡若有未完进度（未通关）一并续上
              const saved = loadSave('puzzle');
              if (saved && saved.levelId === want && puzzle.restoreOpenLevel(saved)) {
                toast('已回到上次挑战的关卡');
                return puzzle;
              }
              puzzle.loadLevel(idx);
              return puzzle;
            }
            toast('该关口还未解锁，先通前面的关');
            puzzle.showLevelSelect(m);
            return puzzle;
          }
        }
      }
      // 无深链：优先续上次未破解完的关卡（刷新/离开回场不丢进度）
      const saved = loadSave('puzzle');
      if (saved) {
        for (const m of puzzle.modes) {
          if (m.key === saved.modeKey) {
            puzzle.mode = m;
            if (puzzle.restoreOpenLevel(saved)) {
              toast('已回到上次挑战的关卡');
              return puzzle;
            }
          }
        }
      }
      puzzle.showModeSelect();
      return puzzle;
    }).catch(() => {
      toast('加载失败，请稍后再试');
      return null;
    });
  }
}
