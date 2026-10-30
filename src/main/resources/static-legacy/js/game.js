/* ==================================================
   game.js · 对局逻辑（规则、回合、胜负）

   分层契约（test2.txt M2）：
   - 只管规则与状态，通过回调驱动 board.js，不直接碰画布
   - 胜负判定收敛在 checkWin（M2.6），二期挪后端时只动它
   ================================================== */
'use strict';

/* ---------- 落子音效（M2.14） ---------- */

/**
 * Web Audio 合成短促"嗒"声（快速衰减正弦 + 噪声瞬态）。
 * AudioContext 只在用户手势内（落子点击链路）首次创建 / resume，
 * 避开自动播放拦截；播放前现读设置开关（M3.5 的 gomoku.sound，缺省开）。
 */
const Sound = {
  /** @type {AudioContext} */
  ctx: null,

  enabled() {
    return localStorage.getItem('gomoku.sound') !== 'off';
  },

  play() {
    if (!this.enabled()) return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      const t = this.ctx.currentTime;

      // 主体：高频正弦快速下滑 + 指数衰减（"嗒"的音头）
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, t);
      osc.frequency.exponentialRampToValueAtTime(400, t + 0.08);
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.1);

      // 瞬态：20ms 线性衰减白噪声（棋子磕在木板上的质感）
      const len = Math.floor(this.ctx.sampleRate * 0.02);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const noise = this.ctx.createBufferSource();
      const noiseGain = this.ctx.createGain();
      noiseGain.gain.value = 0.12;
      noise.buffer = buf;
      noise.connect(noiseGain).connect(this.ctx.destination);
      noise.start(t);
    } catch (e) {
      /* 音频不可用（老浏览器 / 策略拦截）时静默降级，不影响对局 */
    }
  },
};

/* ---------- 工具 ---------- */

/** ms → "mm:ss"（M2.5 计时与 M2.9 结算共用同一格式） */
function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

/** 复制文本到剪贴板（九期房间号分享）：优先剪贴板 API，降级选中文本域 */
function copyText(text) {
  const done = () => toast('房间号已复制：' + text);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    return;
  }
  fallbackCopy(text, done);
}

function fallbackCopy(text, done) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    done();
  } catch (e) {
    toast('复制失败，请手动记下：' + text);
  }
}

/* ==================================================
   Game · 一局对局（M2.1–M2.14）
   ================================================== */

class Game {
  /**
   * @param {Board} board 已初始化的棋盘实例（M2.2：对局页只建这一份）
   * @param {Object} [opts] 七期 bot 模式参数：{ level: 1|2|3 }
   */
  constructor(board, mode, opts) {
    this.board = board;
    this.mode = mode || 'local';
    this._opts = opts || {};
    this.botLevel = this._opts.level || 1;
    this.botName = '电脑';
    this.botSessionId = null;
    this._botBusy = false;

    /* 九期在线对战状态（HTTP 轮询，服务端权威） */
    this.onlineGameId = null;    // 成局后的服务端会话 id
    this.onlineColor = 0;        // 我执色：0 未定 / 1 黑 / 2 白
    this._onlineTimer = null;    // 排队 / 快照轮询的共用定时器句柄
    this._onlineStopped = false; // 置 true 后所有轮询链自断
    this._onlineBusy = false;    // 乐观落子 awaiting 服务端应答
    this._onlineErrs = 0;        // 连续网络失败计数（≥4 判中断）
    this._drawPrompted = false;  // 对方求和弹窗只弹一次

    /* 九期匹配弹窗态：排队 UI、成局确认、自动开始/超时提醒 */
    this._onlineCancelled = false; // 本次会话内用户取消过匹配
    this._onlineBegan = false;     // 已点过"开始对局"（防自动重复入场）
    this.opponentName = '';        // 匹配弹窗展示对手名
    this._matchModalClose = null;  // "匹配中……"弹窗 close 句柄
    this._queueUiTimer = null;     // 排队秒表 interval
    this._queueStartedAt = 0;      // 排队起点（动态显示匹配时间）
    this._queueHintShown = false;  // "人数较少"提醒只弹一次
    this._successModalClose = null;// "匹配成功"弹窗 close 句柄
    /* 九期房间组队态：房主等待 / 凭号加入 */
    this.roomCode = '';            // 我创建的房间号（房主侧展示/复制）
    this._roomMode = null;         // 'host'=我是房主等待中 / 'guest'=凭号加入
    this._roomTimer = null;        // 房间轮询 setTimeout 句柄
    this._roomModalClose = null;   // 房间等待/加入弹窗 close 句柄
    this._joinInput = null;        // 加入弹窗的房间号输入框（复聚焦用）
    this._beginTimer = null;       // 成局 2.5s 未点 → 自动开始
    this._cdTimer = null;          // 在线回合倒计时 interval
    this._expireAt = null;         // 服务端给出的当前回合截止（epoch ms）
    this._autoMine = 0;            // 我被托管累计回数（diff 播报用）
    this._autoTheir = 0;           // 对方被托管累计回数
    this._opponentAbsentMs = null; // 对手已离席毫秒数（快照给值；30s 服务端判负）
    this._absentToasted = false;   // "对方已离开"提示只弹一次
    this._endReason = null;        // 在线终局原因（结算弹窗补一句说明）
    this._suspended = false;       // 残局就地接管后冻结自身交互（M6 首页共用棋盘）

    /* DOM 引用集中一处（M2.2 / M3.6–M3.8 的顶栏与操作栏） */
    this.el = {
      timer: document.getElementById('timer'),
      turn: document.getElementById('status-turn'),
      move: document.getElementById('status-move'),
      undo: document.getElementById('btn-undo'),
      draw: document.getElementById('btn-draw'),
      resign: document.getElementById('btn-resign'),
      exit: document.getElementById('btn-exit'),
      rules: document.getElementById('btn-rules'),
      players: Array.from(document.querySelectorAll('.players__item')),
      /* 复盘面板（M4.1） */
      playPanel: document.getElementById('play-panel'),
      replayPanel: document.getElementById('replay-panel'),
      replayCount: document.getElementById('replay-count'),
      prev: document.getElementById('btn-prev'),
      next: document.getElementById('btn-next'),
      exitReplay: document.getElementById('btn-exit-replay'),
    };

    this._timerId = null;
    this.newGame();
    this._bindUI();
  }

  /* ---------- 状态与重置（M2.1） ---------- */

  /** 一键复位全部状态；首次进入与"再来一局"（M2.9）都走这里，
   *  是 M4.4"再来一局状态洁净"的保证 */
  newGame() {
    const size = this.board.size;
    this.grid = Array.from({ length: size }, () => new Array(size).fill(0));
    this.history = [];      // [{r, c, color}]，按落子顺序
    this.current = 1;       // 黑先（1 黑 2 白）
    this.gameOver = false;
    this.winner = null;     // null = 未结束；0 = 平局；1/2 = 胜方
    this._winCells = null;  // 终局五连坐标（退出复盘时恢复高亮用，M4.1）
    this._replayIndex = 0;  // 复盘游标（M4.1）
    this.startTime = Date.now();
    this.endTime = null;

    this.board.unlock();
    this.board.setPreviewColor(this.current);
    this.board.draw([], -1);
    this.el.replayPanel.hidden = true; // 复盘面板复位（M4.1：再来一局必须干净）
    this.el.playPanel.hidden = false;

    if (this.mode === 'bot') this._botStart();
    if (this.mode === 'online') {
      // 在线模式：匹配期间不走表，成局点"开始对局"才开表
      this._onlineStart();
      this._updateStatus();
      this._updatePlayers();
      this._updateButtons();
      return;
    }
    this._startClock();
  }

  /* ---------- 事件接线（M2.2） ---------- */

  _bindUI() {
    // 落子点击。onHover 一期无处理（预览 board 自己画），
    // 订阅位留给四期在线对战做"等待对方…"提示。
    // 残局接管后 board 的落子订阅被 Puzzle 覆盖（onCellClick 是替换式），
    // 守卫只兜"接管中残留回调"的极端时序
    this.board.onCellClick((cell) => { if (!this._suspended) this._place(cell); });
    this.board.onHover(() => {});

    // 按钮监听只挂一份；残局接管期间（_suspended）全部冻结，
    // 让位给 Puzzle 的"重玩/提示/选关"语义，避免双控制器同按钮叠加触发
    this.el.undo.addEventListener('click', () => { if (!this._suspended) this._undo(); });
    this.el.draw.addEventListener('click', () => { if (!this._suspended) this._offerDraw(); });
    this.el.resign.addEventListener('click', () => { if (!this._suspended) this._resign(); });
    this.el.exit.addEventListener('click', () => { if (!this._suspended) this._exit(); });
    this.el.rules.addEventListener('click', () => { if (!this._suspended) this._showRules(); });
    this.el.prev.addEventListener('click', () => { if (!this._suspended) this._prevMove(); });
    this.el.next.addEventListener('click', () => { if (!this._suspended) this._nextMove(); });
    this.el.exitReplay.addEventListener('click', () => { if (!this._suspended) this._exitReplay(); });
  }

  /* ---------- 模式切换（首页中央竞技场） ---------- */

  /**
   * 切模式并开局；mode='idle' 为首页待机（锁盘清屏停表）。
   * 画布与操作栏监听只在构造时挂一份，切模式 = 状态复位（不重建实例）。
   * @param {string} mode 'idle' | 'local' | 'bot'
   * @param {Object} [opts] bot 模式：{ level }
   */
  setMode(mode, opts) {
    this.mode = mode || 'local';
    this._opts = opts || {};
    this.botLevel = this._opts.level || 1;
    this.botName = '电脑';
    this.botSessionId = null;
    this._botBusy = false;
    /* 九期：切模式先断干净在线轮询链与临时态 */
    this._onlineStopAll(false);
    this.onlineGameId = null;
    this.onlineColor = 0;
    this._onlineBusy = false;
    this._onlineErrs = 0;
    this._drawPrompted = false;
    this._onlineCancelled = false;
    this._onlineBegan = false;
    this.opponentName = '';
    this._queueHintShown = false;
    this._roomStopAll();
    this._stopTurnTimer();
    this._expireAt = null;
    this._autoMine = 0;
    this._autoTheir = 0;
    this._opponentAbsentMs = null;
    this._absentToasted = false;
    this._endReason = null;
    this._stopClock();
    if (this.mode === 'idle') {
      this.gameOver = true;
      this.winner = null;
      this.current = 1;
      this.el.timer.textContent = '00:00';
      this.board.lock();
      this.board.setPreviewColor(null);
      this.board.draw([], -1);
      this.el.turn.textContent = '选择模式开始对局';
      this.el.move.textContent = '第 0 手';
      this._updatePlayers();
      this._updateButtons();
      return;
    }
    // 非 bot 模式把白方名从上一局的 bot 名还原
    const white = this.el.players[1];
    if (white) {
      white.innerHTML = '<span class="players__stone players__stone--white" aria-hidden="true"></span>白方';
    }
    this.newGame();
  }

  /* ---------- 残局就地接管 / 让位（M6 首页竞技场共用棋盘） ---------- */

  /**
   * 残局挑战接管中央棋盘前的交接：停一切轮询/计时（含在线排队与 bot 会话）、
   * 锁盘清预览，并冻结自身按钮语义。页面不刷新，等用户切走或残局退出时 resume。
   */
  suspend() {
    this._suspended = true;
    this._onlineStopAll(false); // 内含成局确认倒计时 _beginTimer 的清理
    this._roomStopAll();
    this._stopTurnTimer();
    this._stopClock();
    if (this.mode === 'bot') this._botStopIfPending(); // 弃局通知服务端（不计分）
    this.board.lock();
    this.board.setPreviewColor(null);
  }

  /**
   * 残局让位（首页点其他模式卡）：恢复按钮文案与白方名、
   * 重新订阅棋盘落子，并回到待机态（等用户点模式再开局）。
   */
  resume() {
    this._suspended = false;
    this.el.undo.textContent = '悔棋';
    this.el.draw.textContent = '求和';
    this.el.resign.textContent = '认输';
    const white = this.el.players[1];
    if (white) {
      white.innerHTML = '<span class="players__stone players__stone--white" aria-hidden="true"></span>白方';
    }
    this.board.onCellClick((cell) => { if (!this._suspended) this._place(cell); });
    this.setMode('idle');
  }

  /* ---------- 落子主链路（M2.3） ---------- */

  _place(cell) {
    if (this.mode === 'online') { this._onlinePlace(cell); return; }
    if (this.gameOver || this._botBusy) return;
    if (this.grid[cell.r][cell.c] !== 0) return; // 空位校验（board 只报格点，不管规则）

    this.grid[cell.r][cell.c] = this.current;
    this.history.push({ r: cell.r, c: cell.c, color: this.current });

    this.board.draw(this.history, this.history.length - 1); // 落子动画在 draw 内
    Sound.play();

    // 胜负判定收敛在这两处（二期挪后端时只动它们）
    const win = this.checkWin(cell.r, cell.c);
    if (win) {
      this._finish(this.current, win);
      return;
    }
    if (this.history.length === this.board.size * this.board.size) {
      this._finish(0, null); // 棋盘下满 = 平局（M2.7）
      return;
    }

    this.current = this.current === 1 ? 2 : 1;
    if (this.mode === 'bot') {
      this._botTurn();
      return;
    }
    this.board.setPreviewColor(this.current);
    this._updateStatus();
    this._updatePlayers();
    this._updateButtons();
  }

  /* ---------- 人机对战（七期 J6–J10） ---------- */

  /** 右侧信息条文字 = bot 名（以开局应答 botName 为准） */
  _setPlayerLabel() {
    if (this.mode !== 'bot') return;
    const item = this.el.players[1];
    if (!item) return;
    item.innerHTML = '<span class="players__stone players__stone--white" aria-hidden="true"></span>'
      + String(this.botName);
  }

  /** 服务端开局面（D8/D9：服务端权威会话；玩家执黑先行） */
  _botStart() {
    this._botBusy = true;
    this.board.lock();
    this._setPlayerLabel();
    Api.botStart(this.botLevel).then((resp) => {
      this._botBusy = false;
      this.botSessionId = resp.sessionId;
      this.botName = resp.botName || this.botName;
      this._setPlayerLabel();
      this.board.unlock();
      this.board.setPreviewColor(1);
      this._updateStatus();
      this._updatePlayers();
      this._updateButtons();
    }).catch((e) => {
      this._botBusy = false;
      this.gameOver = true;
      this.board.lock();
      this._updateButtons();
      if (/登录/.test(e.message || '')) {
        this._needLogin();
        return;
      }
      this._botFatal(e.message);
    });
  }

  /** 会话失效/未登录：弹登录窗（common.js 全页可用），成功后原地重开当前模式 */
  _needLogin() {
    toast('请先登录');
    if (typeof showAuthModal !== 'function') {
      setTimeout(() => { location.href = 'login.html'; }, 600); // 极端兜底
      return;
    }
    showAuthModal(() => {
      if (typeof Api !== 'undefined' && Api.isLogin()) {
        if (typeof refreshTopbar === 'function') refreshTopbar(); // 首页顶栏原地刷新
        this.gameOver = false;
        this.newGame(); // 登录成功：原地重开本模式（bot/online 走各自 _start）
      }
    });
  }

  /** 对战主循环：玩家最后一手提交 /api/game/bot/move，
   *  成功即由服务端返回 AI 应答（D8：敌手行为完全受服务器裁决） */
  _botTurn() {
    this._botBusy = true;
    this.board.lock();
    this.board.setPreviewColor(null);
    this.el.turn.textContent = '等待 ' + this.botName + ' 落子…';

    const last = this.history[this.history.length - 1];
    Api.botMove(this.botSessionId, last.r, last.c).then((resp) => {
      this._botBusy = false;
      if (resp.status === 'finished') {
        if (resp.botR !== null && resp.botR !== undefined) {
          const m = { r: resp.botR, c: resp.botC, color: 2 };
          this.grid[m.r][m.c] = 2;
          this.history.push(m);
          this.board.draw(this.history, this.history.length - 1);
          Sound.play();
          this._finish(2, this.checkWin(m.r, m.c));
        }
        return;
      }
      const m = { r: resp.botR, c: resp.botC, color: 2 };
      this.grid[m.r][m.c] = 2;
      this.history.push(m);
      Sound.play();
      this.board.draw(this.history, this.history.length - 1);
      this.current = 1;
      this.board.unlock();
      this.board.setPreviewColor(1);
      this._updateStatus();
      this._updatePlayers();
      this._updateButtons();
    }).catch((e) => {
      this._botBusy = false;
      this.gameOver = true;
      this.board.lock();
      this._updateButtons();
      this._botFatal(e.message);
    });
  }

  /** 对局中断/网络异常弹窗；残局(bot 会话)没能自动续，只能重开 */
  _botFatal(msg) {
    this.board.lock();
    showModal({
      title: '对局中断',
      body: (msg || '与电脑的连接异常，本局已无法继续。') + '<br>重开一局，或返回首页。',
      buttons: [
        { text: '返回首页', onClick: () => { location.href = 'index.html'; } },
        { text: '重开一局', type: 'primary', onClick: () => this.newGame() },
      ],
    });
  }

  /* ---------- 在线对战（九期：匹配池 + HTTP 轮询；D8 服务端权威） ---------- */

  /** 入口：加入匹配池 → 弹"匹配中……"动态时间弹窗
   *  （续上仍在进行的局则直接进成局确认；掉线重进自动恢复） */
  _onlineStart() {
    this._onlineStopped = false;
    this._onlineErrs = 0;
    this._onlineBusy = false;
    this._drawPrompted = false;
    this._onlineCancelled = false;
    this._onlineBegan = false;
    this._queueHintShown = false;
    this._opponentAbsentMs = null;
    this._absentToasted = false;
    this._endReason = null;
    this._onlineClearTimer();
    this._onlineStopQueueUi();
    this.board.lock(); // 匹配期间锁盘（棋盘已清空待机）
    this.board.setPreviewColor(null);
    this.el.timer.textContent = '00:00'; // 本地同面积显示，匹配成功才走表
    this._updateStatus();

    // 房间组队：opts.room = 'host'（我是房主）/ 'join'（凭号加入，号在 opts.code）
    if (this._opts && this._opts.room === 'host') {
      this._roomHostStart();
      return;
    }
    if (this._opts && this._opts.room === 'join' && this._opts.code) {
      this._roomJoinStart(this._opts.code);
      return;
    }
    this._roomMode = null; // 普通匹配路径：清房间等待态（状态栏文案用）

    Api.onlineQueueJoin().then((resp) => {
      if (this._onlineStopped) return;
      if (resp && resp.status === 'matched') {
        this._onlineMatched(resp);
        return;
      }
      this._onlineQueueUi();
      this._onlineQueueTick();
    }).catch((e) => {
      if (this._onlineStopped) return;
      if (/登录/.test(e.message || '')) { this._onlineFatalLogin(); return; }
      this._onlineFatal(e.message);
    });
  }

  /** "匹配中……"弹窗：动态显示匹配时间，≥30s 提示人数较少建议人机 */
  _onlineQueueUi() {
    this._onlineStopQueueUi();
    this._queueStartedAt = Date.now();
    this._matchModalClose = showModal({
      title: '在线匹配',
      body: '<div class="match-wait__line">匹配中……</div>' +
            '<div class="match-wait__time" id="match-wait-time">已等待 0 秒</div>' +
            '<div class="match-wait__hint" id="match-wait-hint" hidden>' +
            '当前在线人数较少，推荐先玩人机对战。</div>',
      buttons: [{ text: '取消匹配', onClick: () => this._onlineCancelQueue() }],
    });
    this._queueUiTimer = setInterval(() => {
      const el = document.getElementById('match-wait-time');
      if (!el) { this._onlineStopQueueUi(); return; } // 弹窗被其他流程关了
      const sec = Math.round((Date.now() - this._queueStartedAt) / 1000);
      el.textContent = '已等待 ' + sec + ' 秒';
      if (sec >= 30 && !this._queueHintShown) {
        this._queueHintShown = true;
        toast('当前在线人数较少，推荐先玩人机对战');
        const hint = document.getElementById('match-wait-hint');
        if (hint) hint.hidden = false;
      }
    }, 500);
  }

  /** 取消匹配（弹窗按钮回调在弹窗关闭后执行） */
  _onlineCancelQueue() {
    this._onlineStopQueueUi();
    this._onlineStopAll(false);
    Api.onlineQueueCancel().catch(() => {});
    this._onlineCancelled = true;
    this.board.lock();
    this.board.setPreviewColor(null);
    this._updateStatus();
    this._updateButtons();
    toast('已取消匹配');
  }

  /* ---------- 房间组队（九期：凭房间号邀请好友） ---------- */

  /** 房主入口：创建房间 → 等待弹窗（房间号 + 复制 + 已等待秒数）+ 轮询成局 */
  _roomHostStart() {
    this._roomMode = 'host';
    this._roomStopUi();
    this.board.lock();
    this.board.setPreviewColor(null);
    this.el.turn.textContent = '房间等待中…';
    this._updateButtons();

    Api.onlineRoomCreate().then((resp) => {
      if (this._onlineStopped) return;
      if (resp && resp.status === 'matched') {
        // 已有进行中的局（如上一局没结束）：直接进成局确认
        this._roomToMatched(resp);
        return;
      }
      this.roomCode = (resp && resp.roomCode) || '';
      this._roomHostUi();
      this._roomHostTick();
    }).catch((e) => {
      if (this._onlineStopped) return;
      if (/登录/.test(e.message || '')) { this._onlineFatalLogin(); return; }
      this._onlineFatal(e.message);
    });
  }

  /** 房主等待弹窗：大号房间号 + 复制按钮 + 等待秒数（复用 match-wait 样式） */
  _roomHostUi() {
    this._roomStopUi();
    this._queueStartedAt = Date.now();
    this._roomModalClose = showModal({
      title: '房间组队',
      body: '<div class="match-wait__line">把房间号告诉好友，等 TA 加入：</div>' +
            '<div class="room-code">' + this.roomCode + '</div>' +
            '<button type="button" class="btn room-copy" id="room-copy">复制房间号</button>' +
            '<div class="match-wait__time" id="room-wait-time">已等待 0 秒</div>' +
            '<div class="match-wait__hint">好友在左侧"房间组队"输入此号即可加入</div>',
      buttons: [{ text: '解散房间', onClick: () => this._roomCancel() }],
    });
    document.getElementById('room-copy').addEventListener('click', () => {
      copyText(this.roomCode);
    });
    this._queueUiTimer = setInterval(() => {
      const el = document.getElementById('room-wait-time');
      if (!el) { this._roomStopUi(); return; } // 弹窗被其他流程关了
      const sec = Math.round((Date.now() - this._queueStartedAt) / 1000);
      el.textContent = '已等待 ' + sec + ' 秒';
    }, 500);
  }

  /** 房主轮询（1.5s）：matched → 进成局确认；closed → 房间没了重弹等待 */
  _roomHostTick() {
    if (this._onlineStopped || this.gameOver) return;
    Api.onlineRoomStatus().then((resp) => {
      if (this._onlineStopped || this.gameOver) return;
      if (resp && resp.status === 'matched') {
        this._roomToMatched(resp);
      } else if (resp && resp.status === 'closed') {
        // 10 分钟过期/服务重启：提示后重新建房（幂等，房主无感续等）
        toast('房间已过期，已为你重新创建');
        this._roomStopUi();
        this._roomHostStart();
      } else {
        if (resp && resp.roomCode && resp.roomCode !== this.roomCode) {
          this.roomCode = resp.roomCode; // 幂等返回的新号（极端：旧房刚过期重建）
          this._roomHostUi();
        }
        this._roomTimer = setTimeout(() => this._roomHostTick(), 1500);
      }
    }).catch(() => {
      if (this._onlineStopped || this.gameOver) return;
      this._roomTimer = setTimeout(() => this._roomHostTick(), 2500);
    });
  }

  /** 凭号加入入口：先弹输入框，提交后调 join（成局即 matched） */
  _roomJoinStart(code) {
    this._roomMode = 'guest';
    this._roomStopUi();
    this.board.lock();
    this.board.setPreviewColor(null);
    this.el.turn.textContent = '加入房间…';
    this._updateButtons();
    if (code) this._roomJoinSubmit(code); // 首页弹窗已收号：直接提交
  }

  /** 提交房间号（错误回弹输入框让用户改号重试） */
  _roomJoinSubmit(code) {
    Api.onlineRoomJoin(code).then((resp) => {
      if (this._onlineStopped) return;
      this._roomToMatched(resp);
    }).catch((e) => {
      if (this._onlineStopped) return;
      if (/登录/.test(e.message || '')) { this._onlineFatalLogin(); return; }
      if (this.gameOver) return; // 中断弹窗已在处理
      this._roomJoinAsk(e.message || '加入失败，请重试', code);
    });
  }

  /** 加入弹窗：输入房间号（预填上次输入；Enter 提交） */
  _roomJoinAsk(errMsg, prefill) {
    this._roomStopUi();
    let input; // 弹窗内输入框引用：按钮回调时弹窗已关、节点已脱离 DOM，
               // 须靠闭包引用读值（脱离节点的 .value 依然有效）
    this._roomModalClose = showModal({
      title: '加入房间',
      body: '<div class="match-wait__line">输入好友的 6 位房间号：</div>' +
            '<input class="room-input" id="room-join-input" type="text" inputmode="numeric"' +
            ' maxlength="6" placeholder="如 386402" value="' + (prefill || '') + '">' +
            (errMsg ? '<div class="match-wait__hint">' + errMsg + '</div>' : ''),
      buttons: [
        { text: '返回', onClick: () => { this._roomGiveUp(); } },
        { text: '加入', type: 'primary', onClick: () => {
          const val = (input ? input.value : '').replace(/\D/g, '');
          if (val.length !== 6) {
            this._roomJoinAsk('房间号为 6 位数字', val);
            return;
          }
          this._roomJoinSubmit(val);
        } },
      ],
    });
    input = document.getElementById('room-join-input');
    this._joinInput = input;
    if (input) {
      input.focus();
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const val = input.value.replace(/\D/g, '');
        if (val.length !== 6) return;
        // 与按钮同路径：先关弹窗再走提交流程
        if (this._roomModalClose) { this._roomModalClose(); this._roomModalClose = null; }
        this._roomJoinSubmit(val);
      });
    }
  }

  /** 房间成局：关房间弹窗 → 走统一的"匹配成功"确认（复用自动开始/倒计时） */
  _roomToMatched(resp) {
    this._roomStopUi();
    this._onlineClearTimer();
    this._onlineMatched({
      gameId: resp.gameId,
      myColor: resp.myColor,
      opponentName: resp.opponentName,
      resumed: resp.resumed,
    });
  }

  /** 房主解散房间 / 加入者放弃加入：停轮询回待机提示 */
  _roomCancel() {
    this._roomStopAll();
    this._onlineCancelled = true;
    Api.onlineQueueCancel().catch(() => {}); // 服务端一并对齐（解散等待房间）
    this.board.lock();
    this.board.setPreviewColor(null);
    this.el.turn.textContent = '已解散房间，点击左侧房间组队可再来';
    this._updateButtons();
    toast('已解散房间');
  }

  /** 加入者点"返回"放弃：回待机态（不打扰服务端，房间还在等别人） */
  _roomGiveUp() {
    this._roomStopAll();
    this._onlineCancelled = true;
    this.board.lock();
    this.board.setPreviewColor(null);
    this.el.turn.textContent = '已取消加入，点击左侧房间组队可再来';
    this._updateButtons();
  }

  /** 关房间弹窗 + 秒表 */
  _roomStopUi() {
    if (this._queueUiTimer) {
      clearInterval(this._queueUiTimer);
      this._queueUiTimer = null;
    }
    if (this._roomModalClose) {
      const c = this._roomModalClose;
      this._roomModalClose = null;
      c();
    }
  }

  /** 房间链路全停：弹窗 + 轮询定时器（切模式/退出时调用） */
  _roomStopAll() {
    this._roomStopUi();
    if (this._roomTimer) {
      clearTimeout(this._roomTimer);
      this._roomTimer = null;
    }
    this.roomCode = '';
    this._roomMode = null;
  }

  /** 排队轮询（1.2s）：idle = 被移出队（服务重启等）→ 重新入队 */
  _onlineQueueTick() {
    if (this._onlineStopped || this.gameOver) return;
    Api.onlineQueueStatus().then((resp) => {
      if (this._onlineStopped || this.gameOver) return;
      if (resp && resp.status === 'matched') {
        this._onlineMatched(resp);
      } else if (resp && resp.status === 'idle') {
        this._onlineStopQueueUi();
        this._onlineStart();
      } else {
        this._onlineTimer = setTimeout(() => this._onlineQueueTick(), 1200);
      }
    }).catch(() => {
      if (this._onlineStopped || this.gameOver) return;
      this._onlineTimer = setTimeout(() => this._onlineQueueTick(), 2500);
    });
  }

  /** 成局：关排队弹窗 → 弹"匹配成功/回到对局"，2.5s 未确认自动开工 */
  _onlineMatched(resp) {
    this._onlineStopQueueUi();
    this._onlineClearTimer();
    this.onlineGameId = resp.gameId;
    this.onlineColor = resp.myColor || 1;
    this.opponentName = resp.opponentName || '对手';
    this.board.draw([], -1); // 成局开场：清盘（首份快照随后全量对齐）
    this.board.lock();

    // 是否"回到进行中的局"：服务端标记（有子）或首页续局入口自带标记
    const isResume = resp.resumed === true || !!(this._opts && this._opts.resume);
    const isRoom = !!this._roomMode && !isResume; // 房间组队成局：文案以"好友"相称
    this._successModalClose = showModal({
      title: isResume ? '回到对局' : isRoom ? '好友已加入！' : '匹配成功！',
      body: '对手：' + this.opponentName + '<br>' +
        (isResume
          ? '对局仍在进行，棋面即将恢复。'
          : (this.onlineColor === 1 ? '你执黑棋，先行落子。' : '你执白棋，后手应招。')),
      buttons: [{ text: '开始对局', type: 'primary', block: true,
        onClick: () => this._onlineBegin() }],
    });
    this._beginTimer = setTimeout(() => {
      this._beginTimer = null;
      this._onlineBegin(); // 内部幂等；未点过则自动闭弹窗开工
    }, 2500);
  }

  /** 正式开表进局（幂等）：快照首拉后进入正常轮询节奏 */
  _onlineBegin() {
    if (this._onlineBegan) return;
    this._onlineBegan = true;
    // 房间参数只指认一次：终局后"再来一局"回落普通匹配（旧房间号已消费）
    if (this._opts && this._opts.room) this._opts.room = null;
    if (this._opts && this._opts.resume) this._opts.resume = false;
    if (this._beginTimer) {
      clearTimeout(this._beginTimer);
      this._beginTimer = null;
    }
    if (this._successModalClose) {
      this._successModalClose();
      this._successModalClose = null;
    }
    this.startTime = Date.now();
    this._startTurnTimer(); // 在线模式：顶部=每回合 60s 倒计时
    this._updateStatus();
    this._updateButtons();
    this._onlinePoll();
  }

  /** 回合倒计时（服务端 expireAtMs 权威；本地每 250ms 渲染一次） */
  _startTurnTimer() {
    this._stopTurnTimer();
    this.el.timer.textContent = '01:00';
    this._cdTimer = setInterval(() => {
      if (this.mode !== 'online' || this.gameOver) {
        this._stopTurnTimer();
        return;
      }
      const rem = this._expireAt ? Math.max(0, this._expireAt - Date.now()) : 60000;
      this.el.timer.textContent = fmtTime(rem);
    }, 250);
  }

  _stopTurnTimer() {
    if (this._cdTimer) {
      clearInterval(this._cdTimer);
      this._cdTimer = null;
    }
  }

  /** 关资源：关排队弹窗 + 秒表 interval */
  _onlineStopQueueUi() {
    if (this._queueUiTimer) {
      clearInterval(this._queueUiTimer);
      this._queueUiTimer = null;
    }
    if (this._matchModalClose) {
      const c = this._matchModalClose;
      this._matchModalClose = null;
      c();
    }
  }

  /** 对局快照轮询（1.5s）；连续 4 次失败判中断 */
  _onlinePoll() {
    if (this._onlineStopped || this.gameOver || !this.onlineGameId) return;
    Api.onlineState(this.onlineGameId).then((snap) => {
      if (this._onlineStopped || this.gameOver) return;
      this._onlineErrs = 0;
      this._applySnapshot(snap);
      if (!this.gameOver) {
        this._onlineTimer = setTimeout(() => this._onlinePoll(), 1500);
      }
    }).catch((e) => {
      if (this._onlineStopped || this.gameOver) return;
      if (/登录/.test(e.message || '')) { this._onlineFatalLogin(); return; }
      this._onlineErrs++;
      if (this._onlineErrs >= 4) { this._onlineFatal(e.message); return; }
      this._onlineTimer = setTimeout(() => this._onlinePoll(), 2500);
    });
  }

  /** 应用服务端快照：棋面差量重绘 + 回合锁盘 + 求和表决 + 终局转交 */
  _applySnapshot(snap) {
    if (!snap || typeof snap.status !== 'string') return;
    this._onlineLabels(snap);

    const n = snap.moves ? snap.moves.length : 0;
    if (n !== this.history.length) {
      this.history = (snap.moves || []).map((m) => ({ r: m.r, c: m.c, color: m.color }));
      this.grid = Array.from({ length: this.board.size }, () => new Array(this.board.size).fill(0));
      this.history.forEach((m) => { this.grid[m.r][m.c] = m.color; });
      this.board.draw(this.history, this.history.length - 1); // 增一手 → 自带落子动画
      const last = this.history[this.history.length - 1];
      if (last && this.onlineColor && last.color !== this.onlineColor) Sound.play();
    }
    if (snap.startAtMs) this.startTime = snap.startAtMs; // 计时对齐服务端开局
    this.current = snap.turnColor || 1;

    // 回合倒计时目标与托管播报（快照全体量，靠 diff 弹提示）
    if (typeof snap.expireAtMs === 'number') this._expireAt = snap.expireAtMs;
    const mine = this.onlineColor === 1 ? (snap.autoBlack || 0) : (snap.autoWhite || 0);
    const theirs = this.onlineColor === 1 ? (snap.autoWhite || 0) : (snap.autoBlack || 0);
    if (mine > (this._autoMine || 0)) toast('超时托管已替你落子');
    if (theirs > (this._autoTheir || 0)) toast('对方超时，回合已托管');
    this._autoMine = mine;
    this._autoTheir = theirs;

    // 对手离席可视化（服务端 ABANDON 30s 判负；这里只做提示与状态栏倒计时）
    const absent = typeof snap.opponentAbsentMs === 'number'
      && snap.opponentAbsentMs > 0 ? snap.opponentAbsentMs : null;
    if (absent && this._opponentAbsentMs == null && !this._absentToasted) {
      this._absentToasted = true;
      toast('对方疑似已离开，超 30 秒未返回将判负');
    }
    this._opponentAbsentMs = absent;

    if (snap.status === 'finished') { this._onlineFinish(snap); return; }

    const myTurn = this.onlineColor === this.current;
    if (myTurn) {
      this.board.unlock();
      this.board.setPreviewColor(this.onlineColor);
    } else {
      this.board.lock();
      this.board.setPreviewColor(null);
    }
    this._updateStatus();
    this._updatePlayers();
    this._updateButtons();

    // 对方求和表决（一次弹窗；拒绝后本轮不再骚扰）
    if (snap.drawPending && !this._drawPrompted) {
      this._drawPrompted = true;
      showModal({
        title: '对方求和',
        body: '对方提议双方握手言和，接受平局吗？',
        buttons: [
          { text: '拒绝', onClick: () => {
            Api.onlineDrawReject(this.onlineGameId)
              .then((s) => this._applySnapshot(s)).catch(() => {});
          } },
          { text: '接受求和', type: 'primary', onClick: () => {
            Api.onlineDraw(this.onlineGameId)
              .then((s) => this._applySnapshot(s)).catch(() => {});
          } },
        ],
      });
    }
    if (!snap.drawPending) this._drawPrompted = false;
  }

  /** 服务端快照里的双方名（信息条：自己名字带（你）标记） */
  _onlineLabels(snap) {
    if (!snap || this.el.players.length < 2) return;
    const mk = (name, color, isMine) =>
      '<span class="players__stone players__stone--' +
      (color === 1 ? 'black' : 'white') + '" aria-hidden="true"></span>'
      + String(isMine ? name + '（你）' : name);
    this.el.players[0].innerHTML =
      mk(snap.blackName || '黑方', 1, this.onlineColor === 1);
    this.el.players[1].innerHTML =
      mk(snap.whiteName || '白方', 2, this.onlineColor === 2);
  }

  /** 在线落子：本地乐观落子 → 提交服务端；被驳回则回滚最后一手 */
  _onlinePlace(cell) {
    if (this.gameOver || this._onlineBusy || !this.onlineGameId) return;
    if (this.current !== this.onlineColor) return; // 未轮到（正常已被锁盘挡下）
    if (this.grid[cell.r][cell.c] !== 0) return;   // 空位校验

    this.grid[cell.r][cell.c] = this.onlineColor;
    this.history.push({ r: cell.r, c: cell.c, color: this.onlineColor });
    this.board.draw(this.history, this.history.length - 1);
    Sound.play();

    this._onlineBusy = true;
    this.board.lock();
    this.board.setPreviewColor(null);
    this.el.turn.textContent = '提交落子…';

    Api.onlineMove(this.onlineGameId, cell.r, cell.c).then((snap) => {
      this._onlineBusy = false;
      this._applySnapshot(snap); // 服务端应答（含对手可能的连续变化）
    }).catch((e) => {
      this._onlineBusy = false;
      this._onlineRollback();
      if (/登录/.test(e.message || '')) { this._onlineFatalLogin(); return; }
      toast(e.message || '落子失败，请重试');
    });
  }

  /** 服务端驳回落子 → 撤掉刚才的乐观棋子（无动画全量重绘） */
  _onlineRollback() {
    const last = this.history.pop();
    if (!last) return;
    this.grid[last.r][last.c] = 0;
    this.current = last.color;
    this.board.draw(this.history, -1);
    if (this.current === this.onlineColor) {
      this.board.unlock();
      this.board.setPreviewColor(this.onlineColor);
    }
    this._updateStatus();
    this._updatePlayers();
    this._updateButtons();
  }

  /** 在线终局：服务端已结算入库，前端只做定格/高亮/展示 */
  _onlineFinish(snap) {
    this._onlineStopAll(true);
    this.gameOver = true;
    this.winner = (snap.winnerColor === null || snap.winnerColor === undefined)
      ? 0 : snap.winnerColor;
    this._endReason = snap.endReason || null;
    this._opponentAbsentMs = null; // 终局后清离席态，状态栏不再显示倒计时
    this.endTime = Date.now();
    this._stopClock();
    this._stopTurnTimer();
    this.el.timer.textContent = fmtTime(this.endTime - this.startTime);

    this.board.lock();
    this.board.setPreviewColor(null);
    if (snap.endReason === 'five' && this.history.length) {
      const m = this.history[this.history.length - 1];
      const cells = this.checkWin(m.r, m.c);
      this._winCells = cells;
      if (cells) this.board.highlightWin(cells); // M2.8：五连高亮闪烁
    }
    this._updateStatus();
    this._updatePlayers();
    this._updateButtons();

    if (typeof snap.myScoreDelta === 'number') {
      if (snap.myScoreDelta === 0 && snap.myResult !== 0) {
        // 托管局积分冻结：走开的人不扣分，也没资格拿分
        toast('对方或双方中途离开，本局积分不结算');
      } else {
        toast('积分 ' + (snap.myScoreDelta >= 0 ? '+' : '')
          + snap.myScoreDelta + '，榜单见排行');
      }
    }
    setTimeout(() => this._showResult(), snap.endReason === 'five' ? 500 : 0);
  }

  /** 在线退出：排队/房间等待中静默取消；
   *  对局中退出需再次确认 = 认输结算（对手立刻收到终局，不再空等） */
  _onlineExit() {
    if (!this.gameOver && this.onlineGameId) {
      showModal({
        title: '退出对局',
        body: '对局尚未结束，退出将记为认输：对方获胜并结算积分。确定退出吗？',
        buttons: [
          { text: '继续对局' },
          { text: '退出并认输', type: 'primary', onClick: () => this._onlineLeaveAsResign() },
        ],
      });
      return;
    }
    // 排队/房间等待中的退出：取消排队即可（房间的等待房间一并解散）
    this._onlineStopAll(true);
    Api.onlineQueueCancel().catch(() => {});
    location.href = 'index.html';
  }

  /**
   * 退出 = 认输：把认输请求送达服务端后再跳转。
   * 之前的写法是发起请求后立刻 location.href——导航会掐断在途的 fetch，
   * 服务端根本没收到认输，对局继续挂着（对方一直等）。
   * 现在等应答最多 1.5s（超时也跳，不让用户卡死）。
   */
  _onlineLeaveAsResign() {
    const id = this.onlineGameId;
    this._onlineStopAll(true); // 轮询全停；保留 id 供认输调用
    this.board.lock();
    this.board.setPreviewColor(null);
    this.el.turn.textContent = '认输处理中…';
    const go = () => { location.href = 'index.html'; };
    const bail = setTimeout(go, 1500); // 网络差也兜底跳转
    Api.onlineResign(id)
      .then(go)
      .catch(go)
      .finally(() => clearTimeout(bail));
  }

  _onlineClearTimer() {
    if (this._onlineTimer) {
      clearTimeout(this._onlineTimer);
      this._onlineTimer = null;
    }
  }

  /** 停轮询链+排队弹窗+自动开始：keepId=true 保留 gameId（退出前认输用） */
  _onlineStopAll(keepId) {
    this._onlineStopped = true;
    this._onlineClearTimer();
    this._onlineStopQueueUi();
    this._roomStopAll();
    this._stopTurnTimer();
    if (this._beginTimer) {
      clearTimeout(this._beginTimer);
      this._beginTimer = null;
    }
    if (this._successModalClose) {
      const c = this._successModalClose;
      this._successModalClose = null;
      c();
    }
    if (!keepId) this.onlineGameId = null;
  }

  _onlineFatalLogin() {
    this._onlineStopAll(false);
    this.gameOver = true;
    this.board.lock();
    this._needLogin(); // 弹登录窗原地重试（showAuthModal 缺失才兜底跳页）
  }

  /** 在线中断弹窗：可回首页，也可就地重试匹配 */
  _onlineFatal(msg) {
    this._onlineStopAll(false);
    this.board.lock();
    showModal({
      title: '在线对战中断',
      body: (msg || '与服务器连接异常。') + '<br>可返回首页，或重新开始匹配。',
      buttons: [
        { text: '返回首页', onClick: () => { location.href = 'index.html'; } },
        { text: '重新匹配', type: 'primary', onClick: () => {
          this.gameOver = false;
          this.newGame(); // newGame 走 online 分支 → _onlineStart
        } },
      ],
    });
  }

  /* ---------- 胜负判定（M2.6，二期挪后端） ---------- */

  /**
   * 只从最后一手 (r, c) 出发，横 / 竖 / 两斜 4 个方向向两侧数连子。
   * @returns {Array|null} 连子数组（有序，首尾即两端），不足五连返回 null
   */
  checkWin(r, c) {
    const size = this.board.size;
    const color = this.grid[r][c];
    const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (const [dr, dc] of DIRS) {
      const cells = [{ r, c, color }];
      for (const sign of [1, -1]) {
        let rr = r + dr * sign;
        let cc = c + dc * sign;
        while (
          rr >= 0 && rr < size && cc >= 0 && cc < size &&
          this.grid[rr][cc] === color
        ) {
          const cell = { r: rr, c: cc, color };
          if (sign === 1) cells.push(cell);
          else cells.unshift(cell); // 负方向放头部，保证数组首尾即两端
          rr += dr * sign;
          cc += dc * sign;
        }
      }
      if (cells.length >= 5) return cells;
    }
    return null;
  }

  /* ---------- 终局与结算（M2.7–M2.9） ---------- */

  /**
   * 终局统一入口：停表锁盘 → 高亮（有五连时）→ 0.5s 后弹结算。
   * @param {number} winner 0 = 平局；1/2 = 胜方
   * @param {Array|null} cells 五连坐标（平局 / 认输为 null）
   */
  _finish(winner, cells) {
    this.gameOver = true;
    this.winner = winner;
    this._winCells = cells || null; // 退出复盘时恢复高亮用（M4.1）
    this.endTime = Date.now();
    this._stopClock();
    this.el.timer.textContent = fmtTime(this.endTime - this.startTime); // 停表定格

    this.board.lock();
    this.board.setPreviewColor(null);
    if (cells) this.board.highlightWin(cells); // M2.8：五连高亮闪烁

    this._updateStatus();
    this._updatePlayers();
    this._updateButtons();

    this._submitResult(); // H3：对局上报（登录态才有动作，静默失败）
    setTimeout(() => this._showResult(), cells ? 500 : 0);
  }

  /** 对局上报（H3）：仅本地双人 & 登录态；服务端 Referee 重放校验 */
  _submitResult() {
    if (this.mode !== 'local') return;
    if (typeof Api === 'undefined' || !Api.isLogin()) return;
    const reason = this._winCells ? 'five' : this.winner === 0 ? 'draw' : 'resign';
    Api.submitResult({
      winner: this.winner,
      moves: this.history.length,
      timeMs: this.endTime - this.startTime,
      color: 1,
      reason,
      opponent: '白方',
      history: this.history.slice(),
    }).then((r) => {
      if (r && typeof r.scoreDelta === 'number') {
        toast('积分 ' + (r.scoreDelta >= 0 ? '+' : '') + r.scoreDelta + '，当前 ' + r.score);
      }
    }).catch(() => {});
  }

  /** 结算弹窗（M2.9）：复用 common.js 的 showModal；九期在线分支 */
  _showResult() {
    let names;
    if (this.mode === 'online') {
      names = this.winner === 0
        ? '平局'
        : this.winner === this.onlineColor ? '你获胜！' : '对方获胜！';
    } else if (this.mode === 'bot') {
      names = { 0: '平局', 1: '你获胜！', 2: this.botName + ' 获胜！' }[this.winner];
    } else {
      names = { 0: '平局', 1: '黑方胜利！', 2: '白方胜利！' }[this.winner];
    }
    // 在线局给一句终局原因（认输/求和/离开判负），免得玩家猜
    let extra = '';
    if (this.mode === 'online') {
      const iWin = this.winner !== 0 && this.winner === this.onlineColor;
      if (this._endReason === 'away') {
        extra = iWin ? '对方中途离开超时，判你获胜。' : '你中途离开超时，判负。';
      } else if (this._endReason === 'resign') {
        extra = iWin ? '对方认输。' : '你认输。';
      } else if (this._endReason === 'draw') {
        extra = '双方同意求和。';
      } else if (this._endReason === 'full') {
        extra = '棋盘下满，平局。';
      }
    }
    const buttons = this.mode === 'online'
      ? [
          // 在线再战 = 清盘重新入队（终局会话已 finished，服务端不会再配回它）
          { text: '再来一局', type: 'primary', block: true,
            onClick: () => this.newGame() },
          { text: '复盘', onClick: () => this._enterReplay() },
          { text: '返回', onClick: () => { location.href = 'index.html'; } },
        ]
      : [
          { text: '再来一局', type: 'primary', block: true, onClick: () => this.newGame() },
          { text: '复盘', onClick: () => this._enterReplay() }, // M4.1
          { text: '返回', onClick: () => { location.href = 'index.html'; } },
        ];
    showModal({
      title: names || '对局结束',
      body: '用时 ' + fmtTime(this.endTime - this.startTime) +
            '<br>总手数 ' + this.history.length +
            (extra ? '<br><span style="font-size:13px;opacity:.75">' + extra + '</span>' : ''),
      buttons,
    });
  }

  /* ---------- 复盘模式（M4.1） ---------- */

  /** 进入复盘：从终局开始，[上一步]/[下一步] 逐手回放 */
  _enterReplay() {
    if (!this.gameOver) return;
    this._replayIndex = this.history.length;
    this.el.playPanel.hidden = true;
    this.el.replayPanel.hidden = false;
    this._drawReplay();
  }

  /** 按当前游标重绘 + 刷新计数与按钮状态 */
  _drawReplay() {
    const n = this._replayIndex;
    // 前进一步时"恰好多一颗"→ 自动播落子动画，复盘也有落子手感
    this.board.draw(this.history.slice(0, n), n - 1);
    this.el.replayCount.textContent = '第 ' + n + ' / ' + this.history.length + ' 手';
    this.el.prev.disabled = n === 0;
    this.el.next.disabled = n === this.history.length;
  }

  _prevMove() {
    if (this._replayIndex > 0) {
      this._replayIndex--;
      this._drawReplay();
    }
  }

  _nextMove() {
    if (this._replayIndex < this.history.length) {
      this._replayIndex++;
      this._drawReplay();
    }
  }

  /** 退出复盘：恢复终局画面（含五连高亮）并回到结算弹窗——
   *  再来一局 / 返回的入口都在那里；面板隐藏即回到干净状态 */
  _exitReplay() {
    this.el.replayPanel.hidden = true;
    this.el.playPanel.hidden = false;
    this.board.draw(this.history, this.history.length - 1);
    if (this._winCells) this.board.highlightWin(this._winCells);
    this._showResult();
  }

  /* ---------- 悔棋 / 求和 / 认输 / 退出（M2.10–M2.13） ---------- */

  /** 悔棋：本地双人固定悔 1 手；在线模式的"请求-同意"四期另做，UI 复用 */
  _undo() {
    if (this.gameOver || this.history.length === 0) return;
    const last = this.history.pop();
    this.grid[last.r][last.c] = 0;
    this.current = last.color; // 执子方回退到被悔那一手的落子方

    this.board.unlock();
    this.board.setPreviewColor(this.current);
    this.board.draw(this.history, this.history.length - 1); // 全量重绘，不播动画
    this._updateStatus();
    this._updatePlayers();
    this._updateButtons();
  }

  /** 求和：确认后按平局结算（M2.11）；九期在线为服务端表决制 */
  _offerDraw() {
    if (this.gameOver) return;
    if (this.mode === 'online') {
      if (!this.onlineGameId) return;
      showModal({
        title: '求和',
        body: '对方同意即以平局结算，确定发起求和吗？',
        buttons: [
          { text: '取消' },
          { text: '发起求和', type: 'primary', onClick: () => {
            Api.onlineDraw(this.onlineGameId)
              .then((s) => this._applySnapshot(s))
              .catch((e) => toast(e.message || '操作失败'));
          } },
        ],
      });
      return;
    }
    showModal({
      title: '求和',
      body: '双方同意后将以平局结算，确定求和吗？',
      buttons: [
        { text: '取消' },
        { text: '同意求和', type: 'primary', onClick: () => this._finish(0, null) },
      ],
    });
  }

  /** 认输：当前执子方判负（M2.12）；bot 模式固定是玩家认输 */
  _resign() {
    if (this.gameOver) return;
    if (this.mode === 'online') {
      if (!this.onlineGameId) return;
      showModal({
        title: '认输',
        body: '确定认输吗？对方将获胜并结算积分。',
        buttons: [
          { text: '取消' },
          { text: '认输', type: 'primary', onClick: () => {
            Api.onlineResign(this.onlineGameId)
              .then((s) => this._applySnapshot(s))
              .catch((e) => toast(e.message || '操作失败'));
          } },
        ],
      });
      return;
    }
    const isBot = this.mode === 'bot';
    const side = isBot ? '你' : (this.current === 1 ? '黑方' : '白方');
    showModal({
      title: '认输',
      body: side + '确定认输吗？',
      buttons: [
        { text: '取消' },
        { text: '认输', type: 'primary', onClick: () => {
          if (isBot) this._botStopIfPending();
          this._finish(this.current === 1 ? 2 : 1, null);
        } },
      ],
    });
  }

  /** 退出：对局进行中（含开局未落子的空局）二次确认，终局直接回首页（M2.13）；
   *  空≠无价——开局即算进行中，不再静默跳走；
   *  bot 模式退出时通知服务端中止会话（服务端记 abort，不计分；
   *  若会话已结束，服务端会忽略本次 stop） */
  _exit() {
    if (this.mode === 'online') {
      this._onlineExit();
      return;
    }
    if (this.mode === 'bot') this._botStopIfPending();
    if (this.gameOver) {
      location.href = 'index.html';
      return;
    }
    showModal({
      title: '退出对局',
      body: '对局尚未结束，退出后进度不会保存。确定要退出吗？',
      buttons: [
        { text: '继续对局' },
        { text: '退出', type: 'primary', onClick: () => {
          if (this.mode === 'bot') this._botStopIfPending();
          location.href = 'index.html';
        } },
      ],
    });
  }

  /** bot：把仍在 playing 的服务端会话收掉（fire-and-forget；已结束则服务端无感） */
  _botStopIfPending() {
    if (this.mode !== 'bot' || !this.botSessionId) return;
    Api.botStop(this.botSessionId).catch(() => {});
  }

  /** 规则弹窗（M3.6）：五子棋简则 + 本期无禁手说明 */
  _showRules() {
    showModal({
      title: '规则',
      body: '双方轮流在交叉点落子，先在横、竖或斜方向连成五子者获胜。' +
            '<br>本期为自由规则（无禁手）；棋盘下满判平局。',
    });
  }

  /* ---------- 计时器（M2.5） ---------- */

  /**
   * 进对局页即开始计时。setInterval(500ms) 只负责刷显示文案，
   * 数值一律 Date.now() − startTime 差值换算——切后台回来依然准确
   */
  _startClock() {
    this._stopClock();
    this.el.timer.textContent = '00:00';
    this._timerId = setInterval(() => {
      this.el.timer.textContent = fmtTime(Date.now() - this.startTime);
    }, 500);
  }

  _stopClock() {
    if (this._timerId) {
      clearInterval(this._timerId);
      this._timerId = null;
    }
  }

  /* ---------- 界面同步（M2.4 状态栏 / M3.7 信息条） ---------- */

  _updateStatus() {
    if (this.gameOver) {
      this.el.turn.textContent = this.mode === 'online'
        ? (this.winner === 0 ? '平局'
            : this.winner === this.onlineColor ? '你获胜' : '对方获胜')
        : this.mode === 'bot'
          ? (this.winner === 0 ? '平局' : this.winner === 1 ? '你获胜' : this.botName + ' 获胜')
          : (this.winner === 0 ? '平局' : this.winner === 1 ? '黑方胜利' : '白方胜利');
    } else if (this.mode === 'online') {
      if (!this.onlineGameId) {
        const waitingRoom = this._roomMode === 'host';
        this.el.turn.textContent = this._onlineCancelled
          ? '已取消，点击左侧模式卡可再来'
          : waitingRoom
            ? '房间等待中，等好友凭号加入…'
            : this._onlineBegan ? '等待对方落子…' : '正在匹配对方…';
      } else if (this._opponentAbsentMs != null) {
        // 对方离席提示：服务端 30s（ABANDON）判负；倒计时对齐该口径
        const sec = Math.floor(this._opponentAbsentMs / 1000);
        const left = Math.max(0, 30 - sec);
        this.el.turn.textContent = left > 0
          ? '对方已离开 ' + sec + ' 秒，' + left + ' 秒后自动判负…'
          : '对方已离开，正在判定胜负…';
      } else {
        this.el.turn.textContent = this.onlineColor && this.current === this.onlineColor
          ? '当前回合 你 落子'
          : (this._autoTheir > 0 ? '对方托管中，请稍候' : '等待对方落子…');
      }
    } else {
      const side = this.mode === 'bot'
        ? (this.current === 1 ? '你' : this.botName)
        : (this.current === 1 ? '黑方' : '白方');
      this.el.turn.textContent = '当前回合 ' + side + ' 落子';
    }
    this.el.move.textContent = '第 ' + this.history.length + ' 手';
  }

  /** 双方信息条：当前执子方高亮；结束后高亮胜方（平局两边都灭） */
  _updatePlayers() {
    const focus = this.gameOver ? this.winner : this.current;
    this.el.players.forEach((item) => {
      item.classList.toggle(
        'players__item--active',
        Number(item.dataset.side) === focus
      );
    });
  }

  /** 悔棋在无子或已结束时置灰；求和 / 认输在已结束时置灰；
   *  bot 模式悔棋与求和整体禁用（服务端权威，没有"倒带"）；
   *  九期在线：悔棋禁用，求和/认输走服务端表决 */
  _updateButtons() {
    this.el.undo.disabled = this.gameOver || this.history.length === 0;
    this.el.draw.disabled = this.gameOver;
    this.el.resign.disabled = this.gameOver;
    if (this.mode === 'bot') {
      this.el.undo.disabled = true;
      this.el.draw.disabled = true;
    }
    if (this.mode === 'online') {
      this.el.undo.disabled = true;
      if (!this.onlineGameId) { // 匹配/排队阶段不能求和认输
        this.el.draw.disabled = true;
        this.el.resign.disabled = true;
      }
    }
  }
}

/* ---------- 页面初始化（M2.2 / M3.8；七期接入 mode=bot） ---------- */

(function () {
  const canvas = document.getElementById('board');
  if (!canvas) return; // 不在对局页（防误引）

  const isHome = document.body.dataset.arena === '1';
  // 首页竞技场：棋盘横向矩形（上下=剩余高不变，左右加宽填满中列）；
  // 对局页仍正方形（缺省 aspect=1）
  const board = new Board(canvas, isHome ? { aspect: 1.4 } : undefined);
  window.gomokuBoard = board; // 首页竞技场与对局页共用同一实例（换页不影响）
  const search = new URLSearchParams(location.search);
  const mode = isHome ? 'idle' : (search.get('mode') || 'local');

  if (mode === 'idle') {
    window.gomokuGame = new Game(board, 'idle');
    window.gomokuGame.setMode('idle');
    return;
  }

  if (mode === 'puzzle') {
    Puzzle.boot(board); // M6：残局挑战走独立控制器，不进 Game
    return;
  }

  if (mode === 'bot') {
    // 七期 J10：人机对战需登录；level 缺省时先弹三档选择。
    // 未登录弹登录窗（不跳页），成功后原地继续
    const startBot = () => {
      const level = parseInt(search.get('level'), 10);
      if (!level || level < 1 || level > 3) {
        board.lock();
        showModal({
          title: '人机对战',
          body: '选择电脑棋力档位，你执黑先行：<ol style="text-align:left;margin:6px 0 0 1.2em">'
            + '<li>入门 · 会堵冲四，会犯小错</li>'
            + '<li>进阶 · 两步推理，不易失误</li>'
            + '<li>高手 · 四步推理，最强防御</li></ol>',
          buttons: [
            { text: '入门', onClick: () => { location.replace('game.html?mode=bot&level=1'); } },
            { text: '进阶', type: 'primary', onClick: () => { location.replace('game.html?mode=bot&level=2'); } },
            { text: '高手', onClick: () => { location.replace('game.html?mode=bot&level=3'); } },
          ],
        });
        return;
      }
      window.gomokuGame = new Game(board, mode, { level });
    };
    if (typeof Api === 'undefined' || !Api.isLogin()) {
      toast('人机对战需要先登录');
      board.lock();
      if (typeof showAuthModal !== 'function') {
        setTimeout(() => { location.href = 'login.html'; }, 700); // 极端兜底
        return;
      }
      showAuthModal(() => {
        if (typeof Api !== 'undefined' && Api.isLogin()) startBot();
      });
      return;
    }
    startBot();
    return;
  }

  if (mode === 'online') {
    // 九期在线对战：需登录；进页即入匹配池，掉线重进会自动续局。
    // 未登录弹登录窗（不跳页），成功后原地继续
    if (typeof Api === 'undefined' || !Api.isLogin()) {
      toast('在线对战需要先登录');
      board.lock();
      if (typeof showAuthModal !== 'function') {
        setTimeout(() => { location.href = 'login.html'; }, 700); // 极端兜底
        return;
      }
      showAuthModal(() => {
        if (typeof Api !== 'undefined' && Api.isLogin()) {
          window.gomokuGame = new Game(board, mode);
        }
      });
      return;
    }
    window.gomokuGame = new Game(board, mode);
    return;
  }

  if (mode !== 'local') {
    // 一期只认 local / puzzle（M3.8 / M6.3）；其他模式棋盘保持空白且锁住
    toast('敬请期待');
    board.lock();
    return;
  }
  // 本地双人（独立页）：先确认再开局——URL 手滑进页静默开打太慌，
  // 开局前把规则与"无存档"说清楚；不放行就保持锁盘空页面
  board.lock();
  showModal({
    title: '本地双人',
    body: '两人同屏轮流落子，黑先白后，先连成五子者胜。<br><br>' +
          '本局没有存档，中途切到其他模式或离开页面即作废。',
    buttons: [
      { text: '返回首页', onClick: () => { location.href = 'index.html'; } },
      { text: '开始对局', type: 'primary', onClick: () => { window.gomokuGame = new Game(board, mode); } },
    ],
  });
})();
