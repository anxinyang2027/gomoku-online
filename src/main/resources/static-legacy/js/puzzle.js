/* ==================================================
   puzzle.js · 残局挑战控制器（M6 / M6.9 三模式 × 100 关）

   玩法（正解闯关制）：每关预置一个棋局，玩家执黑找出正解；
   走错 toast 提示且不落子；白方按剧本应对；黑成五即过关。
   入口链路：选模式（简单/困难/地狱）→ 关卡格（100 格，✓ 标进度）→ 进关。
   闯关制：每模式只放行已通关（重玩）与首个未通关；后面的格子亮锁图
   （assets/sysytem/lock.png）且不可点；?level= 深链同样过这道闸。

   分层说明：
   - board.js 一行不动（纯渲染）；不复用 Game 类——
     其 newGame / undo / resign / history 语义绑死本地双人，与残局冲突
   - _checkWin 为 game.js M2.6 的同源复刻（约 20 行），
     二期抽公共规则模块时一并收敛
   - 进度存 localStorage['gomoku.puzzle']（已通关卡 id 数组，id 形如
     'easy-12'），读写同 gomoku.sound 模式，异常静默（隐私模式不影响游玩）
   - 关卡数据由 tools/gen-puzzles.js 生成（js/puzzles-data.js），
     二期换成后端接口时本文件零改动
   ================================================== */
'use strict';

const PUZZLE_PROGRESS_KEY = 'gomoku.puzzle';

class Puzzle {
  /**
   * @param {Board} board 已建好的棋盘实例
   * @param {Object} data Api.getPuzzles() 的三模式关卡数据 {easy,hard,hell}
   */
  constructor(board, data) {
    this.board = board;
    this.modes = [
      { key: 'easy', label: '简单', levels: data.easy || [] },
      { key: 'hard', label: '困难', levels: data.hard || [] },
      { key: 'hell', label: '地狱', levels: data.hell || [] },
    ].filter((m) => m.levels.length);
    this.mode = null;   // 当前模式 {key,label,levels}
    this.level = null;  // 当前关卡
    this.index = 0;     // 关卡在模式内的下标

    this.el = {
      timer: document.getElementById('timer'),
      statusTurn: document.getElementById('status-turn'),
      statusMove: document.getElementById('status-move'),
      players: document.querySelectorAll('.players__item'),
      btnUndo: document.getElementById('btn-undo'),
      btnDraw: document.getElementById('btn-draw'),
      btnResign: document.getElementById('btn-resign'),
      btnExit: document.getElementById('btn-exit'),
      btnRules: document.getElementById('btn-rules'),
    };

    this._adaptUI();
    this._bindUI();
  }

  /* M6.4：对局页 UI 适配——复用既有按钮换文案，页面结构不动
     （game.html 独立页与首页竞技场均共用同一批 id 契约） */
  _adaptUI() {
    this.el.btnUndo.textContent = '重玩';
    this.el.btnDraw.textContent = '提示';
    this.el.btnResign.textContent = '选关';
    // 首页就地接管时，Game 待机/终局态把这三个按钮 disabled 过；
    // 残局语义里它们永远可用（重玩/提示/选关），必须复活
    this.el.btnUndo.disabled = false;
    this.el.btnDraw.disabled = false;
    this.el.btnResign.disabled = false;
    // 玩家条：黑方恒高亮（残局里不存在换手）；白方文案换"（守）"——
    // 用 lastChild 改文本节点，保住前面的棋子图标 span（textContent 会抹掉它）
    this.el.players[0].classList.add('players__item--active');
    this.el.players[1].classList.remove('players__item--active');
    if (this.el.players[1].lastChild) {
      this.el.players[1].lastChild.nodeValue = '白方（守）';
    }
  }

  _bindUI() {
    this.board.onCellClick((cell) => this._onCell(cell));
    // 监听存引用：首页就地开局时（M6 首页共用棋盘）切回其他模式
    // 需 destroy() 摘除，避免与 Game 的按钮语义叠加
    this._handlers = {
      undo: () => this.restart(),
      draw: () => {
        if (this.level) showModal({ title: '提示', body: this.level.hint });
      },
      resign: () => {
        // 进过关直接回本模式关卡格；尚未进关（数据未到/直跳失败）则回模式选择
        if (this.mode) this.showLevelSelect(this.mode);
        else this.showModeSelect();
      },
      exit: () => this._exit(),
      rules: () => {
        showModal({
          title: '残局规则',
          body: '黑先制胜。每关藏着一手正解（或一套连招），走对才会落子；' +
                '白方按剧本防守。黑棋连成五子即过关。',
        });
      },
    };
    this.el.btnUndo.addEventListener('click', this._handlers.undo);
    this.el.btnDraw.addEventListener('click', this._handlers.draw);
    this.el.btnResign.addEventListener('click', this._handlers.resign);
    this.el.btnExit.addEventListener('click', this._handlers.exit);
    this.el.btnRules.addEventListener('click', this._handlers.rules);
  }

  /** 首页就地嵌入时被其他模式替换：摘掉按钮监听、让回棋盘，
   *  Game.resume() 随后重新订阅落子并复原文案（game.html 独立页用不到它） */
  destroy() {
    const h = this._handlers;
    if (h) {
      this.el.btnUndo.removeEventListener('click', h.undo);
      this.el.btnDraw.removeEventListener('click', h.draw);
      this.el.btnResign.removeEventListener('click', h.resign);
      this.el.btnExit.removeEventListener('click', h.exit);
      this.el.btnRules.removeEventListener('click', h.rules);
    }
    this.board.onCellClick(() => {});
    window.gomokuPuzzle = null;
  }

  /* 换关（含首次进入）：复位全部状态，同 Game.newGame 的洁净标准 */
  loadLevel(index) {
    this.index = index;
    this.level = this.mode.levels[index];
    const size = this.board.size;
    this.grid = Array.from({ length: size }, () => new Array(size).fill(0));
    this.history = [];
    this.level.preset.forEach((s) => {
      this.grid[s.r][s.c] = s.color;
      this.history.push({ r: s.r, c: s.c, color: s.color });
    });
    this.stepIndex = 0;
    this.gameOver = false;
    // 计时槽不跑表（残局不限时），当"模式 · 关名"展示位
    this.el.timer.textContent = this.mode.label + ' · ' + this.level.name;
    this.board.unlock();
    this.board.setPreviewColor(1); // 玩家恒执黑，设一次即可（draw 不重置预览色）
    // 预置子一次全量画：不满足"差一子"动画条件，正好表现为"摆好的残局"
    this.board.draw(this.history.slice(), -1);
    this._updateStatus();
  }

  restart() {
    this.loadLevel(this.index);
  }

  /* 状态栏：引导文案 + 手数（不含预置子） */
  _updateStatus() {
    this.el.statusTurn.textContent = this.gameOver ? '破解成功！' : '找出黑棋制胜一手';
    const n = this.history.length - this.level.preset.length;
    this.el.statusMove.textContent = '第 ' + n + ' 手';
  }

  /* 落子主链路：命中正解 → 黑落 → 未胜则白剧本手跟上；错手只提示不动盘 */
  _onCell(cell) {
    if (this.gameOver || !this.level) return;
    const { r, c } = cell;
    if (this.grid[r][c] !== 0) return; // 占位忽略

    const step = this.level.steps[this.stepIndex];
    const hit = step.accept.some((p) => p.r === r && p.c === c);
    if (!hit) {
      toast('不对，再想想');
      return;
    }

    this._place(r, c, 1);
    const winCells = this._checkWin(r, c);
    if (winCells) {
      this._win(winCells);
      return;
    }

    // 白剧本应手（同步落；白手永不构成白五——关卡数据经生成器裁判验证）
    const reply = step.reply;
    this._place(reply.r, reply.c, 2);
    this.stepIndex += 1;
    this._updateStatus();
  }

  /* 落子公共尾：写盘 + 入史 + 全量重绘（差一子触发落子动画）+ 音效。
     slice() 传副本，防 board 持有的数组与 history 意外同源 */
  _place(r, c, color) {
    this.grid[r][c] = color;
    this.history.push({ r, c, color });
    this.board.draw(this.history.slice(), this.history.length - 1);
    Sound.play(); // 均发生在点击链路内，满足 AudioContext 手势要求
  }

  /* 胜负判定：game.js M2.6 checkWin 的同源复刻——
     只从最后一手出发向 4 方向数连子，≥5 返回首尾有序的连子数组 */
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
    this._saveProgress();
    this._updateStatus();
    setTimeout(() => this._showWinModal(), 500); // 同 Game：高亮先演 0.5s
  }

  _saveProgress() {
    try {
      const done = Puzzle.clearedList();
      if (!done.includes(this.level.id)) {
        done.push(this.level.id);
        localStorage.setItem(PUZZLE_PROGRESS_KEY, JSON.stringify(done));
      }
    } catch (e) { /* 写不进（隐私模式等）不影响过关 */ }

    // H4.3：登录态双写上云（静默失败，云端仅作跨端保存）
    if (typeof Api !== 'undefined' && Api.isLogin && Api.isLogin()) {
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
    return Puzzle.clearedList().filter((id) => id.startsWith(modeKey + '-')).length;
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
    buttons.push({ text: '返回首页', block: true, onClick: () => { location.href = 'index.html'; } });
    showModal({
      title: '残局破解！',
      body: this.mode.label + ' · ' + this.level.name + '（' + this.level.flavor +
            '），共 ' + this.history.length + ' 手',
      buttons,
    });
  }

  /* 选模式 → 选关卡。关卡格 = 100 个小按钮塞进弹窗 body 的滚动网格
     （showModal 只认按钮列表，100 关分页太碎，滚动网格体感更好） */
  showModeSelect() {
    this.level = null;
    this.board.lock();
    const cleared = Puzzle.clearedList();
    const buttons = this.modes.map((m) => ({
      text: m.label + '（已通 ' +
            cleared.filter((id) => id.startsWith(m.key + '-')).length + '/' + m.levels.length + '）',
      block: true,
      type: Puzzle.clearedCountIn(m.key) >= m.levels.length ? undefined : 'primary',
      onClick: () => this.showLevelSelect(m),
    }));
    buttons.push({ text: '返回首页', onClick: () => { location.href = 'index.html'; } });
    showModal({
      title: '残局挑战',
      body: '黑先制胜 · 走错不落子，找出每关的正解',
      buttons,
    });
  }

  showLevelSelect(mode) {
    this.mode = mode;
    const close = showModal({
      title: mode.label + ' · 选关',
      body: '<div class="pz-grid" id="pz-grid"></div>',
      buttons: [
        { text: '换模式', onClick: () => this.showModeSelect() },
        { text: '返回首页', onClick: () => { location.href = 'index.html'; } },
      ],
    });
    // showModal 只支持按钮列表，关卡网格在弹窗建好后填充
    const grid = document.getElementById('pz-grid');
    if (!grid) return;
    const cleared = Puzzle.clearedList();
    // 闯关制闸门：开锁位 = 本模式首个未通关（顺次闯下）；已通关的自由重玩，
    // 其余格子一律锁死——只给一张锁图看方向，不给进
    const openIdx = mode.levels.findIndex((lv) => !cleared.includes(lv.id));
    mode.levels.forEach((lv, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      const done = cleared.includes(lv.id);
      if (done) {
        b.className = 'pz-grid__cell pz-grid__cell--cleared';
      } else if (i === openIdx) {
        b.className = 'pz-grid__cell';
      } else {
        b.className = 'pz-grid__cell pz-grid__cell--locked';
        b.disabled = true;
        // 锁图格：锁压在上、格号在下——锁得住也认得出第几关
        // （相对路径写死 + 纯数字文案，无注入面）
        b.innerHTML = '<img src="assets/sysytem/lock.png" alt="未解锁">' +
                      '<span>' + (i + 1) + '</span>';
        grid.appendChild(b);
        return;
      }
      b.textContent = String(i + 1);
      b.addEventListener('click', () => {
        close();
        // 防误触（与首页 guardMode 同规则）：当前关已落子未破解时，换关先确认。
        // 重进同一关 = 重玩语义，直接放行；残局无存档，进度丢了就真丢了
        const moved = this.level && !this.gameOver &&
                      this.history.length > this.level.preset.length;
        if (moved && i !== this.index) {
          showModal({
            title: '你正在游戏中',
            body: '当前关卡尚未破解，换关后进度不会保存。确定要换吗？',
            buttons: [
              { text: '继续当前关' },
              { text: '换关', type: 'primary', onClick: () => this.loadLevel(i) },
            ],
          });
          return;
        }
        this.loadLevel(i);
      });
      grid.appendChild(b);
    });
  }

  /* 退出确认：同 Game 的语义——有进展先确认，否则直接回首页 */
  _exit() {
    const presetN = this.level ? this.level.preset.length : 0;
    const moved = this.history && this.history.length > presetN;
    if (!this.level || this.gameOver || !moved) {
      location.href = 'index.html';
      return;
    }
    showModal({
      title: '退出挑战？',
      body: '当前关卡进度不会保存',
      buttons: [
        { text: '继续挑战' },
        { text: '退出', type: 'primary', onClick: () => { location.href = 'index.html'; } },
      ],
    });
  }

  /* 页面入口（game.js IIFE 调用）：先锁盘再异步取关卡——
     mock 有 200ms 延迟，防止数据到达前在空盘上落子。
     ?level=<id>（如 hard-42）直进该关，但过闯关闸门：仅已通关（重玩）
     或其首个未通关放行；锁关则提示并回本模式选关；无参进选模式弹窗 */
  static boot(board) {
    board.lock();
    Api.getPuzzles().then((data) => {
      if (!data) {
        toast('关卡数据为空');
        return;
      }
      const puzzle = new Puzzle(board, data);
      window.gomokuPuzzle = puzzle; // 首页就地开局时供 goPlaying 判断/destroy 让位
      if (!puzzle.modes.length) {
        toast('关卡数据为空');
        return;
      }
      const want = new URLSearchParams(location.search).get('level');
      if (want) {
        for (const m of puzzle.modes) {
          const idx = m.levels.findIndex((lv) => lv.id === want);
          if (idx >= 0) {
            const cleared = Puzzle.clearedList();
            const openIdx = m.levels.findIndex((lv) => !cleared.includes(lv.id));
            if (cleared.includes(want) || idx === openIdx) {
              puzzle.mode = m;
              puzzle.loadLevel(idx);
              return;
            }
            toast('该关口还未解锁，先通前面的关');
            puzzle.showLevelSelect(m);
            return;
          }
        }
      }
      puzzle.showModeSelect();
    }).catch(() => toast('加载失败，请稍后再试'));
  }
}
