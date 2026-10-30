/* ==================================================
   game.js · 对局控制器（自旧 static/js/game.js 改写为响应式）

   与旧版的差别：
   - 不再直接碰 DOM：状态全部存 reactive(this)，视图层（GameView/
     HomeArena）读取渲染；棋盘仍通过 Board 实例驱动
   - 弹窗/toast 走 ui store（openModal/showToast），形状同旧 showModal
   - 页面跳转 location.href 改为调用方传 navigator 回调（可注入 router）
   分层契约不变：规则/回合/胜负在本层，渲染在 board.js + Vue 视图
   ================================================== */
import { reactive } from 'vue';
import { Api, getToken } from './api';
import { useUiStore, toast } from '../stores/ui';
import { fmtTime, copyText } from './format';
import { loadSave, saveTo, clearSave } from './gamesave';

export class GameController {
  /**
   * @param {Board} board 棋盘实例
   * @param {Object} deps { onNavigate(path) } 路由跳转注入
   */
  constructor(board, deps = {}) {
    this.board = board;
    this.deps = deps;
    this.ui = useUiStore();

    /* ---------- 响应式状态（视图直接绑定） ---------- */
    this.s = reactive({
      mode: 'idle',            // idle | local | bot | online
      statusTurn: '选择模式开始对局',
      statusMove: '第 0 手',
      timerText: '00:00',
      undoText: '悔棋',
      drawText: '求和',
      resignText: '认输',
      undoDisabled: true,
      drawDisabled: true,
      resignDisabled: true,
      replayVisible: false,    // 复盘面板显隐
      replayCount: '第 0 / 0 手',
      replayPrevDisabled: true,
      replayNextDisabled: true,
      blackName: '黑方',
      whiteName: '白方',
      blackActive: true,
      whiteActive: false,
      gameOver: false,
      /* 对局频道目标（H7 聊天隔离）：online=对局 id，bot=会话 id，其余 null=公屏。
         与 botSessionId/onlineGameId 同步维护，放 s 里让视图响应式可追 */
      channelGameId: null,
    });

    /* ---------- 非响应式内部态 ---------- */
    this.grid = [];
    this.history = [];
    this.current = 1;
    this.winner = null;
    this._winCells = null;
    this._replayIndex = 0;
    this.startTime = 0;
    this.endTime = null;
    this._timerId = null;

    this.botLevel = 1;
    this.botName = '电脑';
    this.botSessionId = null;
    this._botBusy = false;

    /* 在线对战状态（同旧版全部字段） */
    this.onlineGameId = null;
    this.onlineColor = 0;
    this._onlineTimer = null;
    this._onlineStopped = false;
    this._onlineBusy = false;
    this._onlineErrs = 0;
    this._drawPrompted = false;
    this._undoPrompted = false;
    this._onlineCancelled = false;
    this._onlineBegan = false;
    this.opponentName = '';
    this._queueUiTimer = null;
    this._queueStartedAt = 0;
    this._queueHintShown = false;
    this.roomCode = '';
    this._roomMode = null;
    this._roomTimer = null;
    this._roomModalClose = null;
    this._beginTimer = null;
    this._cdTimer = null;
    this._expireAt = null;
    this._autoMine = 0;
    this._autoTheir = 0;
    this._opponentAbsentMs = null;
    this._absentToasted = false;
    this._endReason = null;
    this._suspended = false;
    this._opts = {};

    /* K1：WebSocket 推送通道状态（连接/订阅对局/重连定时器） */
    this._ws = null;
    this._wsSubGameId = null;
    this._wsRetryTimer = null;

    this.setMode('idle');
  }

  /* ---------- 模式切换与状态复位 ---------- */

  setMode(mode, opts = {}) {
    this.s.mode = mode || 'local';
    this._opts = opts;
    this.botLevel = opts.level || 1;
    this.botName = '电脑';
    this.botSessionId = null;
    this._botBusy = false;
    this._onlineStopAll(false);
    this.onlineGameId = null;
    this.onlineColor = 0;
    this._onlineBusy = false;
    this._onlineErrs = 0;
    this._drawPrompted = false;
    this._undoPrompted = false;
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
    this.newGame();
  }

  newGame() {
    const size = this.board.size;
    this.grid = Array.from({ length: size }, () => new Array(size).fill(0));
    this.history = [];
    this.current = 1;
    this.s.gameOver = false;
    this.winner = null;
    this._winCells = null;
    this._replayIndex = 0;
    this.startTime = Date.now();
    this.endTime = null;

    /* 重新开局 = 显式作废旧存档（人机/本地双人不再回到上一局）；
       续局流程（opts.resume）不算重开，setMode 复位后马上回填存档，
       且人机不打新会话（由 restoreBot 用存档 sessionId 接管） */
    const resuming = !!(this._opts && this._opts.resume);
    if (this.s.mode === 'bot' && !resuming) clearSave('bot');
    if (this.s.mode === 'local' && !resuming) clearSave('local');

    this.s.undoText = '悔棋';
    this.s.drawText = '求和';
    this.s.resignText = '认输';
    this.s.replayVisible = false;

    this.board.unlock();
    this.board.setPreviewColor(this.current);
    this.board.draw([], -1);

    if (this.s.mode === 'bot' && !resuming) this._botStart();
    if (this.s.mode === 'online') {
      this._onlineStart();
      this._updateStatus();
      this._updatePlayers();
      this._updateButtons();
      if (this._opts) this._opts.resume = false;
      return;
    }
    if (this._opts) this._opts.resume = false;
    if (this.s.mode === 'idle') {
      this.board.lock();
      this.board.setPreviewColor(null);
      this.board.draw([], -1);
      this.s.timerText = '00:00';
      this.s.statusTurn = '选择模式开始对局';
      this.s.statusMove = '第 0 手';
      this.s.blackName = '黑方';
      this.s.whiteName = '白方';
      this._updatePlayers();
      this._updateButtons();
      return;
    }
    this._startClock();
    this._updateStatus();
    this._updatePlayers();
    this._updateButtons();
  }

  /* ---------- 残局接管/让位 ---------- */

  suspend() {
    this._suspended = true;
    this._onlineStopAll(false);
    this._roomStopAll();
    this._stopTurnTimer();
    this._stopClock();
    this.board.lock();
    this.board.setPreviewColor(null);
  }

  resume() {
    this._suspended = false;
    this.s.blackName = '黑方';
    this.s.whiteName = '白方';
    this.board.onCellClick((cell) => { if (!this._suspended) this._place(cell); });
    this.setMode('idle');
  }

  /* ---------- 落子主链路 ---------- */

  onCell(cell) {
    if (!this._suspended) this._place(cell);
  }

  _place(cell) {
    if (this.s.mode === 'online') { this._onlinePlace(cell); return; }
    if (this.s.gameOver || this._botBusy) return;
    if (this.grid[cell.r][cell.c] !== 0) return;

    this.grid[cell.r][cell.c] = this.current;
    this.history.push({ r: cell.r, c: cell.c, color: this.current });
    this.board.draw(this.history, this.history.length - 1);
    Sound.play();
    this._saveSlot();

    const win = this.checkWin(cell.r, cell.c);
    if (win) { this._finish(this.current, win); return; }
    if (this.history.length === this.board.size * this.board.size) {
      this._finish(0, null);
      return;
    }
    this.current = this.current === 1 ? 2 : 1;
    if (this.s.mode === 'bot') { this._botTurn(); return; }
    this.board.setPreviewColor(this.current);
    this._updateStatus();
    this._updatePlayers();
    this._updateButtons();
  }

  /* ---------- 刷新续局存档（人机 / 本地双人：每手棋即时落槽） ---------- */

  /** 仅人机与本地双人走存档；在线以服务端为准不落槽 */
  _saveSlot() {
    if (this.s.mode === 'bot') {
      saveTo('bot', {
        level: this.botLevel,
        sessionId: this.botSessionId,
        botName: this.botName,
        startTime: this.startTime,
      });
    } else if (this.s.mode === 'local') {
      saveTo('local', {
        history: this.history.slice(),
        startTime: this.startTime,
      });
    }
  }

  /** 回放历史到网格（复用在本地与人机的续局重建） */
  _replay(history) {
    this.history = (history || [])
      .filter((m) => m && Number.isInteger(m.r) && Number.isInteger(m.c) &&
        (m.color === 1 || m.color === 2) &&
        m.r >= 0 && m.c >= 0 && m.r < this.board.size && m.c < this.board.size)
      .slice(0, this.board.size * this.board.size);
    this.grid = Array.from({ length: this.board.size }, () => new Array(this.board.size).fill(0));
    this.history.forEach((m) => { this.grid[m.r][m.c] = m.color; });
  }

  /* ---------- 续局恢复（刷新后回到上一局） ---------- */

  /** 本地双人续局：回放历史，按手数复原当前执方 */
  restoreLocal(saved) {
    this.setMode('local', { resume: true });
    this.s.mode = 'local';
    if (saved && Array.isArray(saved.history)) {
      this._replay(saved.history);
      if (saved.startTime) this.startTime = saved.startTime;
    }
    const win = this.history.length
      ? this.checkWin(this.history[this.history.length - 1].r, this.history[this.history.length - 1].c)
      : null;
    this._stopClock();
    this.s.timerText = fmtTime(this.startTime);
    this.s.undoText = '悔棋';
    this.board.draw(this.history, this.history.length - 1);
    if (win) {
      this._finish(this.history[this.history.length - 1].color, win);
      return;
    }
    this.current = this.history.length % 2 ? 2 : 1;
    this.board.unlock();
    this.board.setPreviewColor(this.current);
    this._startClock();
    this._saveSlot();
    this._updateStatus();
    this._updatePlayers();
    this._updateButtons();
    toast('已回到上一局，接着下');
  }

  /** 人机续局：会话仍存活 → 服务端快照权威回放；已失效 → 落回开新局 */
  restoreBot(saved) {
    this.setMode('bot', { level: (saved && saved.level) || 1, resume: true });
    this.s.mode = 'bot';
    // 快照回填期间锁盘，防误点（newGame 的解锁只属开新局流程）
    this.board.lock();
    this.board.setPreviewColor(null);
    if (saved && saved.botName) this.botName = saved.botName;
    if (saved && saved.startTime) this.startTime = saved.startTime;
    if (saved && saved.sessionId) this.botSessionId = saved.sessionId;
    this.s.whiteName = this.botName;
    this._updateStatus();
    this._updatePlayers();
    this._updateButtons();
    Api.botState(this.botSessionId).then((snap) => {
      this._botRestoreApply(snap);
    }).catch(() => {
      clearSave('bot');
      toast('上局会话已失效，为你开新一局');
      this.newGame(); // mode=bot 会自动重启会话
    });
  }

  _botRestoreApply(snap) {
    /* 快照字段：moves（SessionSnapshotResp 实际字段名）；旧 stones 仅作兼容兜底 */
    const stones = snap && (snap.moves || snap.stones);
    if (!snap || !Array.isArray(stones)) { // 快照不完整按失效处理
      clearSave('bot');
      toast('上局会话已失效，为你开新一局');
      this.newGame();
      return;
    }
    if (snap.botName) {
      this.botName = snap.botName;
      this.s.whiteName = snap.botName;
    }
    if (snap.sessionId) this.botSessionId = snap.sessionId;
    this._replay(stones);
    this.board.draw(this.history, this.history.length - 1);
    if (snap.status !== 'playing') {
      this._stopClock();
      if (snap.status === 'finished') {
        this.endTime = Date.now();
        this.winner = snap.winnerColor || 0;
        this._endReason = snap.reason || snap.endReason || null;
        this.s.gameOver = true;
        this.board.lock();
        this.board.setPreviewColor(null);
        this._updateStatus();
        this._updatePlayers();
        this._updateButtons();
        setTimeout(() => this._showResult(), 0);
      } else { // aborted（曾主动退出/服务重启）：按结束局面展示
        this.s.gameOver = true;
        this.winner = 0;
        this.board.lock();
        this.board.setPreviewColor(null);
        this._updateStatus();
        this._updatePlayers();
        this._updateButtons();
        toast('上局已中止，可另开一局');
      }
      return;
    }
    /* 进行中：服务端会话总是"落完白子"的平衡态，当前轮到你（黑） */
    this.current = 1;
    this.board.unlock();
    this.board.setPreviewColor(1);
    this._stopClock();
    this.s.timerText = fmtTime(Math.max(0, Date.now() - (this.startTime || Date.now())));
    this._startClock();
    this._saveSlot();
    this._updateStatus();
    this._updatePlayers();
    this._updateButtons();
    toast('已回到上一局，接着下');
  }

  /* ---------- 人机对战 ---------- */

  _botStart() {
    this._botBusy = true;
    this.board.lock();
    this.s.whiteName = this.botName;
    Api.botStart(this.botLevel).then((resp) => {
      this._botBusy = false;
      this.botSessionId = resp.sessionId;
      this.botName = resp.botName || this.botName;
      this.s.whiteName = this.botName;
      this._saveSlot(); // 会话号落槽，刷新后续局
      this.board.unlock();
      this.board.setPreviewColor(1);
      this._updateStatus();
      this._updatePlayers();
      this._updateButtons();
    }).catch((e) => {
      this._botBusy = false;
      this.s.gameOver = true;
      this.board.lock();
      this._updateButtons();
      if (/登录/.test(e.message || '')) { this._needLogin(); return; }
      this._botFatal(e.message);
    });
  }

  _needLogin() {
    toast('请先登录');
    this.deps.onAuthRequired && this.deps.onAuthRequired(() => {
      this.s.gameOver = false;
      this.newGame();
    });
  }

  _botTurn() {
    this._botBusy = true;
    this.board.lock();
    this.board.setPreviewColor(null);
    this.s.statusTurn = '等待 ' + this.botName + ' 落子…';

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
      this._saveSlot(); // 白子回完再落槽：恢复时总是"该你落"的平衡态
      this.board.unlock();
      this.board.setPreviewColor(1);
      this._updateStatus();
      this._updatePlayers();
      this._updateButtons();
    }).catch((e) => {
      this._botBusy = false;
      this.s.gameOver = true;
      this.board.lock();
      this._updateButtons();
      this._botFatal(e.message);
    });
  }

  _botFatal(msg) {
    this.board.lock();
    this.ui.openModal({
      title: '对局中断',
      body: (msg || '与电脑的连接异常，本局已无法继续。') + '<br>重开一局，或返回首页。',
      buttons: [
        { text: '返回首页', onClick: () => this._navigate('/') },
        { text: '重开一局', type: 'primary', onClick: () => this.newGame() },
      ],
    });
  }

  /* ---------- 在线对战 ---------- */

  _onlineStart() {
    this._onlineStopped = false;
    this._onlineErrs = 0;
    this._onlineBusy = false;
    this._drawPrompted = false;
    this._undoPrompted = false;
    this._onlineCancelled = false;
    this._onlineBegan = false;
    this._queueHintShown = false;
    this._opponentAbsentMs = null;
    this._absentToasted = false;
    this._endReason = null;
    this._onlineClearTimer();
    this._onlineStopQueueUi();
    this.board.lock();
    this.board.setPreviewColor(null);
    this.s.timerText = '00:00';
    this._updateStatus();

    if (this._opts && this._opts.room === 'host') { this._roomHostStart(); return; }
    if (this._opts && this._opts.room === 'join' && this._opts.code) { this._roomJoinStart(this._opts.code); return; }
    this._roomMode = null;

    Api.onlineQueueJoin().then((resp) => {
      if (this._onlineStopped) return;
      if (resp && resp.status === 'matched') { this._onlineMatched(resp); return; }
      this._onlineQueueUi();
      this._onlineQueueTick();
    }).catch((e) => {
      if (this._onlineStopped) return;
      if (/登录/.test(e.message || '')) { this._onlineFatalLogin(); return; }
      this._onlineFatal(e.message);
    });
  }

  _onlineQueueUi() {
    this._onlineStopQueueUi();
    this._queueStartedAt = Date.now();
    this._queueModalClose = this.ui.openModal({
      title: '在线匹配',
      body: '<div class="match-wait__line">匹配中……</div>' +
            '<div class="match-wait__time" id="match-wait-time">已等待 0 秒</div>' +
            '<div class="match-wait__hint" id="match-wait-hint" hidden>' +
            '当前在线人数较少，推荐先玩人机对战。</div>',
      buttons: [{ text: '取消匹配', onClick: () => this._onlineCancelQueue() }],
      xAction: () => this._onlineCancelQueue(), // 右上角 ✕ 同"取消匹配"
    });
    this._queueUiTimer = setInterval(() => {
      const el = document.getElementById('match-wait-time');
      if (!el) { this._onlineStopQueueUi(); return; }
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

  /* ---------- 房间组队 ---------- */

  _roomHostStart() {
    this._roomMode = 'host';
    this._roomStopUi();
    this.board.lock();
    this.board.setPreviewColor(null);
    this.s.statusTurn = '房间等待中…';
    this._updateButtons();

    Api.onlineRoomCreate().then((resp) => {
      if (this._onlineStopped) return;
      if (resp && resp.status === 'matched') { this._roomToMatched(resp); return; }
      this.roomCode = (resp && resp.roomCode) || '';
      this._roomHostUi();
      this._roomHostTick();
    }).catch((e) => {
      if (this._onlineStopped) return;
      if (/登录/.test(e.message || '')) { this._onlineFatalLogin(); return; }
      this._onlineFatal(e.message);
    });
  }

  _roomHostUi() {
    this._roomStopUi();
    this._queueStartedAt = Date.now();
    this._roomModalClose = this.ui.openModal({
      title: '房间组队',
      body: '<div class="match-wait__line">把房间号告诉好友，等 TA 加入：</div>' +
            '<div class="room-code">' + this.roomCode + '</div>' +
            '<button type="button" class="btn room-copy" id="room-copy">复制房间号</button>' +
            '<div class="match-wait__time" id="room-wait-time">已等待 0 秒</div>' +
            '<div class="match-wait__hint">好友在左侧"房间组队"输入此号即可加入</div>',
      buttons: [{ text: '解散房间', onClick: () => this._roomCancel() }],
      xAction: () => this._roomCancel(), // 右上角 ✕ 同"解散房间"
    });
    setTimeout(() => {
      const btn = document.getElementById('room-copy');
      if (btn) btn.addEventListener('click', () => copyText(this.roomCode));
    }, 0);
    this._queueUiTimer = setInterval(() => {
      const el = document.getElementById('room-wait-time');
      if (!el) { this._roomStopUi(); return; }
      const sec = Math.round((Date.now() - this._queueStartedAt) / 1000);
      el.textContent = '已等待 ' + sec + ' 秒';
    }, 500);
  }

  _roomHostTick() {
    if (this._onlineStopped || this.s.gameOver) return;
    Api.onlineRoomStatus().then((resp) => {
      if (this._onlineStopped || this.s.gameOver) return;
      if (resp && resp.status === 'matched') {
        this._roomToMatched(resp);
      } else if (resp && resp.status === 'closed') {
        toast('房间已过期，已为你重新创建');
        this._roomStopUi();
        this._roomHostStart();
      } else {
        if (resp && resp.roomCode && resp.roomCode !== this.roomCode) {
          this.roomCode = resp.roomCode;
          this._roomHostUi();
        }
        this._roomTimer = setTimeout(() => this._roomHostTick(), 1500);
      }
    }).catch(() => {
      if (this._onlineStopped || this.s.gameOver) return;
      this._roomTimer = setTimeout(() => this._roomHostTick(), 2500);
    });
  }

  _roomJoinStart(code) {
    this._roomMode = 'guest';
    this._roomStopUi();
    this.board.lock();
    this.board.setPreviewColor(null);
    this.s.statusTurn = '加入房间…';
    this._updateButtons();
    if (code) this._roomJoinSubmit(code);
  }

  _roomJoinSubmit(code) {
    Api.onlineRoomJoin(code).then((resp) => {
      if (this._onlineStopped) return;
      this._roomToMatched(resp);
    }).catch((e) => {
      if (this._onlineStopped) return;
      if (/登录/.test(e.message || '')) { this._onlineFatalLogin(); return; }
      if (this.s.gameOver) return;
      this._roomJoinAsk(e.message || '加入失败，请重试', code);
    });
  }

  _roomJoinAsk(errMsg, prefill) {
    this._roomStopUi();
    this._roomModalClose = this.ui.openModal({
      title: '加入房间',
      body: '<div class="match-wait__line">输入好友的 6 位房间号：</div>' +
            '<input class="room-input" id="room-join-input" type="text" inputmode="numeric"' +
            ' maxlength="6" placeholder="如 386402" value="' + (prefill || '') + '">' +
            (errMsg ? '<div class="match-wait__hint">' + errMsg + '</div>' : ''),
      buttons: [
        { text: '返回', onClick: () => { this._roomGiveUp(); } },
        { text: '加入', type: 'primary', onClick: () => {
          const input = document.getElementById('room-join-input');
          const val = (input ? input.value : '').replace(/\D/g, '');
          if (val.length !== 6) {
            this._roomJoinAsk('房间号为 6 位数字', val);
            return;
          }
          this._roomJoinSubmit(val);
        } },
      ],
      xAction: () => this._roomGiveUp(), // 右上角 ✕ 同"返回"（放弃加入）
    });
    setTimeout(() => {
      const input = document.getElementById('room-join-input');
      if (!input) return;
      input.focus();
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const val = input.value.replace(/\D/g, '');
        if (val.length !== 6) return;
        if (this._roomModalClose) { this._roomModalClose(); this._roomModalClose = null; }
        this._roomJoinSubmit(val);
      });
    }, 0);
  }

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

  _roomCancel() {
    this._roomStopAll();
    this._onlineCancelled = true;
    Api.onlineQueueCancel().catch(() => {});
    this.board.lock();
    this.board.setPreviewColor(null);
    this.s.statusTurn = '已解散房间，点击左侧房间组队可再来';
    this._updateButtons();
    toast('已解散房间');
  }

  _roomGiveUp() {
    this._roomStopAll();
    this._onlineCancelled = true;
    this.board.lock();
    this.board.setPreviewColor(null);
    this.s.statusTurn = '已取消加入，点击左侧房间组队可再来';
    this._updateButtons();
  }

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

  _roomStopAll() {
    this._roomStopUi();
    if (this._roomTimer) {
      clearTimeout(this._roomTimer);
      this._roomTimer = null;
    }
    this.roomCode = '';
    this._roomMode = null;
  }

  _onlineQueueTick() {
    if (this._onlineStopped || this.s.gameOver) return;
    Api.onlineQueueStatus().then((resp) => {
      if (this._onlineStopped || this.s.gameOver) return;
      if (resp && resp.status === 'matched') {
        this._onlineMatched(resp);
      } else if (resp && resp.status === 'idle') {
        this._onlineStopQueueUi();
        this._onlineStart();
      } else {
        this._onlineTimer = setTimeout(() => this._onlineQueueTick(), 1200);
      }
    }).catch(() => {
      if (this._onlineStopped || this.s.gameOver) return;
      this._onlineTimer = setTimeout(() => this._onlineQueueTick(), 2500);
    });
  }

  _onlineMatched(resp) {
    this._onlineStopQueueUi();
    this._onlineClearTimer();
    this.onlineGameId = resp.gameId;
    this.onlineColor = resp.myColor || 1;
    this.opponentName = resp.opponentName || '对手';
    this.board.draw([], -1);
    this.board.lock();

    const isResume = resp.resumed === true || !!(this._opts && this._opts.resume);
    const isRoom = !!this._roomMode && !isResume;
    this._successModalClose = this.ui.openModal({
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
      this._onlineBegin();
    }, 2500);
  }

  _onlineBegin() {
    if (this._onlineBegan) return;
    this._onlineBegan = true;
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
    this._startTurnTimer();
    this._updateStatus();
    this._updateButtons();
    this._wsSubscribe(); // K1：推送通道优先；断线自动降级轮询
    this._onlinePoll();
  }

  _startTurnTimer() {
    this._stopTurnTimer();
    this.s.timerText = '01:00';
    this._cdTimer = setInterval(() => {
      if (this.s.mode !== 'online' || this.s.gameOver) {
        this._stopTurnTimer();
        return;
      }
      const rem = this._expireAt ? Math.max(0, this._expireAt - Date.now()) : 60000;
      this.s.timerText = fmtTime(rem);
    }, 250);
  }

  _stopTurnTimer() {
    if (this._cdTimer) {
      clearInterval(this._cdTimer);
      this._cdTimer = null;
    }
  }

  _onlineStopQueueUi() {
    if (this._queueUiTimer) {
      clearInterval(this._queueUiTimer);
      this._queueUiTimer = null;
    }
    if (this._queueModalClose) {
      const c = this._queueModalClose;
      this._queueModalClose = null;
      c();
    }
  }

  _onlinePoll() {
    if (this._onlineStopped || this.s.gameOver || !this.onlineGameId) return;
    // K1：WS 已连上并订阅本局 → 不轮询（推送驱动；断线自动回轮询兜底）
    if (this._wsActive()) {
      this._onlineTimer = setTimeout(() => this._onlinePoll(), 1500); // 心跳级保活检查
      return;
    }
    Api.onlineState(this.onlineGameId).then((snap) => {
      if (this._onlineStopped || this.s.gameOver) return;
      this._onlineErrs = 0;
      this._applySnapshot(snap);
      if (!this.s.gameOver) {
        this._onlineTimer = setTimeout(() => this._onlinePoll(), 1500);
      }
    }).catch((e) => {
      if (this._onlineStopped || this.s.gameOver) return;
      if (/登录/.test(e.message || '')) { this._onlineFatalLogin(); return; }
      this._onlineErrs++;
      if (this._onlineErrs >= 4) { this._onlineFatal(e.message); return; }
      this._onlineTimer = setTimeout(() => this._onlinePoll(), 2500);
    });
  }

  /* ---------- K1：WebSocket 推送通道（断线自动降级回轮询） ---------- */

  /** WS 是否处于"已连接且订阅当前对局"状态 */
  _wsActive() {
    return !!(this._ws && this._ws.readyState === 1 && this._wsSubGameId === this.onlineGameId);
  }

  /** 建立/复用 WS 连接并订阅当前对局；成局与重连时调用 */
  _wsSubscribe() {
    if (!this.onlineGameId) return;
    const gameId = this.onlineGameId;
    if (this._wsActive()) return; // 已订阅本局
    const token = getToken();
    if (!token || typeof WebSocket === 'undefined') return;

    if (!this._ws || this._ws.readyState > 1) { // 无连接或已关闭 → 新建
      try {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        this._ws = new WebSocket(proto + '//' + location.host + '/ws/online?token=' + encodeURIComponent(token));
      } catch (e) { return; }
      this._ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg.type === 'snapshot' && msg.data && !this._onlineStopped && !this.s.gameOver) {
          this._onlineErrs = 0;
          this._applySnapshot(msg.data);
        }
      };
      this._ws.onclose = () => {
        this._wsSubGameId = null;
        // 断线重连（对局未终局才有意义）；失败退回轮询（_wsActive 为 false）
        if (!this._onlineStopped && !this.s.gameOver && this.onlineGameId) {
          this._wsRetryTimer = setTimeout(() => this._wsSubscribe(), 3000);
        }
      };
      this._ws.onerror = () => { /* onclose 会跟着触发，统一在那里处理 */ };
    }
    const ws = this._ws;
    const sendSub = () => {
      if (ws.readyState === 1 && !this._onlineStopped) {
        ws.send(JSON.stringify({ type: 'sub', gameId }));
        this._wsSubGameId = gameId;
      }
    };
    if (ws.readyState === 1) sendSub();
    else ws.addEventListener('open', sendSub, { once: true });
  }

  /** 关闭 WS（退出对局/切模式时） */
  _wsClose() {
    clearTimeout(this._wsRetryTimer);
    this._wsRetryTimer = null;
    this._wsSubGameId = null;
    if (this._ws) {
      try { this._ws.close(); } catch (e) { /* 忽略 */ }
      this._ws = null;
    }
  }

  _applySnapshot(snap) {
    if (!snap || typeof snap.status !== 'string') return;
    this._onlineLabels(snap);

    const n = snap.moves ? snap.moves.length : 0;
    if (n !== this.history.length) {
      this.history = (snap.moves || []).map((m) => ({ r: m.r, c: m.c, color: m.color }));
      this.grid = Array.from({ length: this.board.size }, () => new Array(this.board.size).fill(0));
      this.history.forEach((m) => { this.grid[m.r][m.c] = m.color; });
      this.board.draw(this.history, this.history.length - 1);
      const last = this.history[this.history.length - 1];
      if (last && this.onlineColor && last.color !== this.onlineColor) Sound.play();
    }
    if (snap.startAtMs) this.startTime = snap.startAtMs;
    this.current = snap.turnColor || 1;

    if (typeof snap.expireAtMs === 'number') this._expireAt = snap.expireAtMs;
    const mine = this.onlineColor === 1 ? (snap.autoBlack || 0) : (snap.autoWhite || 0);
    const theirs = this.onlineColor === 1 ? (snap.autoWhite || 0) : (snap.autoBlack || 0);
    if (mine > (this._autoMine || 0)) { toast('超时托管已替你落子'); this._sysMsg('你已离线，系统正在托管落子'); }
    if (theirs > (this._autoTheir || 0)) { toast('对方超时，回合已托管'); this._sysMsg('对方离线，托管中'); }
    this._autoMine = mine;
    this._autoTheir = theirs;

    const absent = typeof snap.opponentAbsentMs === 'number'
      && snap.opponentAbsentMs > 0 ? snap.opponentAbsentMs : null;
    if (absent && this._opponentAbsentMs == null && !this._absentToasted) {
      this._absentToasted = true;
      toast('对方疑似已离开，超 30 秒未返回将判负');
      this._sysMsg('对方疑似已离开，超 30 秒未返回将判负');
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

    if (snap.drawPending && !this._drawPrompted) {
      this._drawPrompted = true;
      this.ui.openModal({
        title: '对方求和',
        body: '对方提议双方握手言和，接受平局吗？',
        buttons: [
          { text: '拒绝', onClick: () => {
            Api.onlineDrawReject(this.onlineGameId)
              .then((s2) => this._applySnapshot(s2)).catch(() => {});
          } },
          { text: '接受求和', type: 'primary', onClick: () => {
            Api.onlineDraw(this.onlineGameId)
              .then((s2) => this._applySnapshot(s2)).catch(() => {});
          } },
        ],
      });
    }
    if (!snap.drawPending) this._drawPrompted = false;

    /* 对方悔棋申请：弹窗应答（同意=回退一整个回合） */
    if (snap.undoPending && !this._undoPrompted) {
      this._undoPrompted = true;
      this.ui.openModal({
        title: '对方申请悔棋',
        body: '对方想悔棋，将回退一整个回合（双方各一手）。同意吗？',
        buttons: [
          { text: '拒绝', onClick: () => {
            Api.onlineUndoAnswer(this.onlineGameId, false)
              .then((s2) => this._applySnapshot(s2))
              .catch((e) => toast(e.message || '操作失败'));
          } },
          { text: '同意悔棋', type: 'primary', onClick: () => {
            Api.onlineUndoAnswer(this.onlineGameId, true)
              .then((s2) => this._applySnapshot(s2))
              .catch((e) => toast(e.message || '操作失败'));
          } },
        ],
      });
    }
    if (!snap.undoPending) this._undoPrompted = false;
  }

  _onlineLabels(snap) {
    this.s.blackName = snap.blackName || '黑方';
    this.s.whiteName = snap.whiteName || '白方';
  }

  _onlinePlace(cell) {
    if (this.s.gameOver || this._onlineBusy || !this.onlineGameId) return;
    if (this.current !== this.onlineColor) return;
    if (this.grid[cell.r][cell.c] !== 0) return;

    this.grid[cell.r][cell.c] = this.onlineColor;
    this.history.push({ r: cell.r, c: cell.c, color: this.onlineColor });
    this.board.draw(this.history, this.history.length - 1);
    Sound.play();

    this._onlineBusy = true;
    this.board.lock();
    this.board.setPreviewColor(null);
    this.s.statusTurn = '提交落子…';

    Api.onlineMove(this.onlineGameId, cell.r, cell.c).then((snap) => {
      this._onlineBusy = false;
      this._applySnapshot(snap);
    }).catch((e) => {
      this._onlineBusy = false;
      this._onlineRollback();
      if (/登录/.test(e.message || '')) { this._onlineFatalLogin(); return; }
      toast(e.message || '落子失败，请重试');
    });
  }

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

  _onlineFinish(snap) {
    this._onlineStopAll(true);
    this.s.gameOver = true;
    this.winner = (snap.winnerColor === null || snap.winnerColor === undefined)
      ? 0 : snap.winnerColor;
    this._endReason = snap.endReason || null;
    this._opponentAbsentMs = null;
    this.endTime = Date.now();
    this._stopClock();
    this._stopTurnTimer();
    this.s.timerText = fmtTime(this.endTime - this.startTime);

    this.board.lock();
    this.board.setPreviewColor(null);
    if (snap.endReason === 'five' && this.history.length) {
      const m = this.history[this.history.length - 1];
      const cells = this.checkWin(m.r, m.c);
      this._winCells = cells;
      if (cells) this.board.highlightWin(cells);
    }
    this._updateStatus();
    this._updatePlayers();
    this._updateButtons();

    if (typeof snap.myScoreDelta === 'number') {
      if (snap.myScoreDelta === 0 && snap.myResult !== 0) {
        toast('对方或双方中途离开，本局积分不结算');
      } else {
        toast('积分 ' + (snap.myScoreDelta >= 0 ? '+' : '')
          + snap.myScoreDelta + '，榜单见排行');
      }
      this._notifySettled(); // 服务端已结算：刷新顶栏积分/排行榜
    }
    setTimeout(() => this._showResult(), snap.endReason === 'five' ? 500 : 0);
  }

  onlineExit() {
    if (!this.s.gameOver && this.onlineGameId) {
      this.ui.openModal({
        title: '退出对局',
        body: '对局尚未结束，退出将记为认输：对方获胜并结算积分。确定退出吗？',
        buttons: [
          { text: '继续对局' },
          { text: '退出并认输', type: 'primary', onClick: () => this._onlineLeaveAsResign() },
        ],
      });
      return;
    }
    this._onlineStopAll(true);
    Api.onlineQueueCancel().catch(() => {});
    this._navigate('/');
  }

  _onlineLeaveAsResign() {
    const id = this.onlineGameId;
    this._onlineStopAll(true);
    this.board.lock();
    this.board.setPreviewColor(null);
    this.s.statusTurn = '认输处理中…';
    const go = () => this._navigate('/');
    const bail = setTimeout(go, 1500);
    Api.onlineResign(id).then(go).catch(go).finally(() => clearTimeout(bail));
  }

  _onlineClearTimer() {
    if (this._onlineTimer) {
      clearTimeout(this._onlineTimer);
      this._onlineTimer = null;
    }
  }

  _onlineStopAll(keepId) {
    this._onlineStopped = true;
    this._onlineClearTimer();
    this._onlineStopQueueUi();
    this._roomStopAll();
    this._stopTurnTimer();
    this._wsClose(); // K1：对局终止，推送通道一并关闭
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
    this.s.gameOver = true;
    this.board.lock();
    this._needLogin();
  }

  _onlineFatal(msg) {
    this._onlineStopAll(false);
    this.board.lock();
    this.ui.openModal({
      title: '在线对战中断',
      body: (msg || '与服务器连接异常。') + '<br>可返回首页，或重新开始匹配。',
      buttons: [
        { text: '返回首页', onClick: () => this._navigate('/') },
        { text: '重新匹配', type: 'primary', onClick: () => {
          this.s.gameOver = false;
          this.newGame();
        } },
      ],
    });
  }

  /* ---------- 胜负判定 ---------- */

  checkWin(r, c) {
    const size = this.board.size;
    const color = this.grid[r][c];
    const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (const [dr, dc] of DIRS) {
      const cells = [{ r, c, color }];
      for (const sign of [1, -1]) {
        let rr = r + dr * sign;
        let cc = c + dc * sign;
        while (rr >= 0 && rr < size && cc >= 0 && cc < size && this.grid[rr][cc] === color) {
          const cell = { r: rr, c: cc, color };
          if (sign === 1) cells.push(cell);
          else cells.unshift(cell);
          rr += dr * sign;
          cc += dc * sign;
        }
      }
      if (cells.length >= 5) return cells;
    }
    return null;
  }

  /* ---------- 终局与结算 ---------- */

  _finish(winner, cells) {
    this.s.gameOver = true;
    this.winner = winner;
    this._winCells = cells || null;
    this.endTime = Date.now();
    this._stopClock();
    this.s.timerText = fmtTime(this.endTime - this.startTime);

    /* 终局：人机/本地双人的进度存档使命完成，清槽 */
    if (this.s.mode === 'bot') clearSave('bot');
    if (this.s.mode === 'local') clearSave('local');

    this.board.lock();
    this.board.setPreviewColor(null);
    if (cells) this.board.highlightWin(cells);

    this._updateStatus();
    this._updatePlayers();
    this._updateButtons();

    this._submitResult();
    setTimeout(() => this._showResult(), cells ? 500 : 0);
  }

  _submitResult() {
    if (this.s.mode !== 'local') return;
    if (!Api.isLogin()) return;
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
      this._notifySettled();
    }).catch(() => {});
  }

  /** 终局结算完成：视图刷新积分/排行榜用（deps.onSettled 注入） */
  _notifySettled() {
    if (typeof this.deps.onSettled === 'function') this.deps.onSettled();
  }

  /** 【系统】消息进聊天面板（deps.onSystemChat 注入；公屏事件由服务端广播，这里只发本人可见的提示） */
  _sysMsg(text) {
    if (typeof this.deps.onSystemChat === 'function') this.deps.onSystemChat(text);
  }

  _showResult() {
    let names;
    if (this.s.mode === 'online') {
      names = this.winner === 0
        ? '平局'
        : this.winner === this.onlineColor ? '你获胜！' : '对方获胜！';
    } else if (this.s.mode === 'bot') {
      names = { 0: '平局', 1: '你获胜！', 2: this.botName + ' 获胜！' }[this.winner];
    } else {
      names = { 0: '平局', 1: '黑方胜利！', 2: '白方胜利！' }[this.winner];
    }
    let extra = '';
    if (this.s.mode === 'online') {
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
    this.ui.openModal({
      title: names || '对局结束',
      body: '用时 ' + fmtTime(this.endTime - this.startTime) +
            '<br>总手数 ' + this.history.length +
            (extra ? '<br><span style="font-size:13px;opacity:.75">' + extra + '</span>' : ''),
      buttons: [
        { text: '再来一局', type: 'primary', block: true, onClick: () => this.newGame() },
        { text: '复盘', onClick: () => this._enterReplay() },
        { text: '返回', onClick: () => this._navigate('/') },
      ],
    });
  }

  /* ---------- 复盘 ---------- */

  _enterReplay() {
    if (!this.s.gameOver) return;
    this._replayIndex = this.history.length;
    this.s.replayVisible = true;
    this._drawReplay();
  }

  _drawReplay() {
    const n = this._replayIndex;
    this.board.draw(this.history.slice(0, n), n - 1);
    this.s.replayCount = '第 ' + n + ' / ' + this.history.length + ' 手';
    this.s.replayPrevDisabled = n === 0;
    this.s.replayNextDisabled = n === this.history.length;
  }

  prevMove() {
    if (this._replayIndex > 0) {
      this._replayIndex--;
      this._drawReplay();
    }
  }

  nextMove() {
    if (this._replayIndex < this.history.length) {
      this._replayIndex++;
      this._drawReplay();
    }
  }

  _exitReplay() {
    this.s.replayVisible = false;
    this.board.draw(this.history, this.history.length - 1);
    if (this._winCells) this.board.highlightWin(this._winCells);
    this._showResult();
  }

  /* ---------- 悔棋 / 求和 / 认输 / 退出 / 规则 ---------- */

  undo() {
    if (this.s.gameOver || this.history.length === 0) return;
    if (this.s.mode === 'online') {
      if (!this.onlineGameId) return;
      this.ui.openModal({
        title: '悔棋',
        body: '向对方申请悔棋，回退一整个回合（双方各一手）。对方同意后生效。',
        buttons: [
          { text: '取消' },
          { text: '申请悔棋', type: 'primary', onClick: () => {
            Api.onlineUndo(this.onlineGameId)
              .then((s2) => { this._applySnapshot(s2); toast('已发出悔棋申请，等待对方应答'); })
              .catch((e) => toast(e.message || '操作失败'));
          } },
        ],
      });
      return;
    }
    if (this.s.mode === 'bot') {
      this.ui.openModal({
        title: '悔棋',
        body: '向电脑申请悔棋，回退一整个回合（你与电脑各一手）。电脑可能拒绝。',
        buttons: [
          { text: '取消' },
          { text: '申请悔棋', type: 'primary', onClick: () => this._botUndo() },
        ],
      });
      return;
    }
    /* 本地双人：同屏轮流下，悔棋=撤掉最后一手（通常是想反悔的执子方刚下的那颗），
       回合权自然交回该方重下 */
    const last = this.history.pop();
    this.grid[last.r][last.c] = 0;
    this.current = last.color;
    this.board.unlock();
    this.board.setPreviewColor(this.current);
    this.board.draw(this.history, this.history.length - 1);
    this._saveSlot();
    this._updateStatus();
    this._updatePlayers();
    this._updateButtons();
  }

  /** 人机悔棋：AI 概率应答，同意则按服务端快照回放（字段是 moves，同 botState） */
  _botUndo() {
    if (!this.botSessionId) return;
    Api.botUndo(this.botSessionId).then((r) => {
      toast(r.msg || (r.agree ? '电脑同意了悔棋' : '电脑拒绝了悔棋'));
      if (r.agree && r.snapshot) {
        this._replay(r.snapshot.moves || []);
        this.board.draw(this.history, this.history.length - 1);
        this.current = 1; // 悔棋后总是轮到玩家（黑）
        this.board.unlock();
        this.board.setPreviewColor(1);
        this._saveSlot();
        this._updateStatus();
        this._updatePlayers();
        this._updateButtons();
      }
    }).catch((e) => toast(e.message || '操作失败'));
  }

  offerDraw() {
    if (this.s.gameOver) return;
    if (this.s.mode === 'online') {
      if (!this.onlineGameId) return;
      this.ui.openModal({
        title: '求和',
        body: '对方同意即以平局结算，确定发起求和吗？',
        buttons: [
          { text: '取消' },
          { text: '发起求和', type: 'primary', onClick: () => {
            Api.onlineDraw(this.onlineGameId)
              .then((s2) => this._applySnapshot(s2))
              .catch((e) => toast(e.message || '操作失败'));
          } },
        ],
      });
      return;
    }
    if (this.s.mode === 'bot') {
      this.ui.openModal({
        title: '求和',
        body: '向电脑求和？电脑会视局势决定是否接受。',
        buttons: [
          { text: '取消' },
          { text: '发起求和', type: 'primary', onClick: () => this._botDraw() },
        ],
      });
      return;
    }
    this.ui.openModal({
      title: '求和',
      body: '双方同意后将以平局结算，确定求和吗？',
      buttons: [
        { text: '取消' },
        { text: '同意求和', type: 'primary', onClick: () => this._finish(0, null) },
      ],
    });
  }

  /** 人机求和：AI 应答，接受则按平局终局 */
  _botDraw() {
    if (!this.botSessionId) return;
    Api.botDraw(this.botSessionId).then((r) => {
      toast(r.msg || (r.agree ? '电脑接受了求和' : '电脑拒绝了求和'));
      if (r.agree) this._finish(0, null);
    }).catch((e) => toast(e.message || '操作失败'));
  }

  resign() {
    if (this.s.gameOver) return;
    if (this.s.mode === 'online') {
      if (!this.onlineGameId) return;
      this.ui.openModal({
        title: '认输',
        body: '确定认输吗？对方将获胜并结算积分。',
        buttons: [
          { text: '取消' },
          { text: '认输', type: 'primary', onClick: () => {
            Api.onlineResign(this.onlineGameId)
              .then((s2) => this._applySnapshot(s2))
              .catch((e) => toast(e.message || '操作失败'));
          } },
        ],
      });
      return;
    }
    const isBot = this.s.mode === 'bot';
    const side = isBot ? '你' : (this.current === 1 ? '黑方' : '白方');
    this.ui.openModal({
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

  exit() {
    if (this.s.mode === 'online') { this.onlineExit(); return; }
    if (this.s.gameOver) { this._navigate('/'); return; }
    this.ui.openModal({
      title: '退出对局',
      body: '对局尚未结束，退出将清空本局存档（人机会话一并中止）。确定要退出吗？',
      buttons: [
        { text: '继续对局' },
        { text: '退出', type: 'primary', onClick: () => {
          this._discardLocalBotProgress();
          this._navigate('/');
        } },
      ],
    });
  }

  /** 显式退出 = 本局作废：清本地存档并中止服务端人机会话 */
  _discardLocalBotProgress() {
    if (this.s.mode === 'bot' && this.botSessionId) {
      Api.botStop(this.botSessionId).catch(() => {});
      this.botSessionId = null;
      clearSave('bot');
    } else if (this.s.mode === 'local') {
      clearSave('local');
    }
  }

  _botStopIfPending() {
    if (this.s.mode !== 'bot' || !this.botSessionId) return;
    Api.botStop(this.botSessionId).catch(() => {});
  }

  showRules() {
    this.ui.openModal({
      title: '规则',
      body: '双方轮流在交叉点落子，先在横、竖或斜方向连成五子者获胜。' +
            '<br>本期为自由规则（无禁手）；棋盘下满判平局。',
    });
  }

  /* ---------- 计时 ---------- */

  _startClock() {
    this._stopClock();
    this.s.timerText = '00:00';
    this._timerId = setInterval(() => {
      this.s.timerText = fmtTime(Date.now() - this.startTime);
    }, 500);
  }

  _stopClock() {
    if (this._timerId) {
      clearInterval(this._timerId);
      this._timerId = null;
    }
  }

  /* ---------- 界面同步（写响应式状态） ---------- */

  _updateStatus() {
    /* 对局频道目标同步（H7）：所有会话号变更路径都会经过本方法 */
    this.s.channelGameId = this.s.gameOver ? null
      : this.s.mode === 'online' ? this.onlineGameId
      : this.s.mode === 'bot' ? this.botSessionId
      : null;
    if (this.s.gameOver) {
      this.s.statusTurn = this.s.mode === 'online'
        ? (this.winner === 0 ? '平局'
            : this.winner === this.onlineColor ? '你获胜' : '对方获胜')
        : this.s.mode === 'bot'
          ? (this.winner === 0 ? '平局' : this.winner === 1 ? '你获胜' : this.botName + ' 获胜')
          : (this.winner === 0 ? '平局' : this.winner === 1 ? '黑方胜利' : '白方胜利');
    } else if (this.s.mode === 'online') {
      if (!this.onlineGameId) {
        const waitingRoom = this._roomMode === 'host';
        this.s.statusTurn = this._onlineCancelled
          ? '已取消，点击左侧模式卡可再来'
          : waitingRoom
            ? '房间等待中，等好友凭号加入…'
            : this._onlineBegan ? '等待对方落子…' : '正在匹配对方…';
      } else if (this._opponentAbsentMs != null) {
        const sec = Math.floor(this._opponentAbsentMs / 1000);
        const left = Math.max(0, 30 - sec);
        this.s.statusTurn = left > 0
          ? '对方已离开 ' + sec + ' 秒，' + left + ' 秒后自动判负…'
          : '对方已离开，正在判定胜负…';
      } else {
        this.s.statusTurn = this.onlineColor && this.current === this.onlineColor
          ? '当前回合 你 落子'
          : (this._autoTheir > 0 ? '对方托管中，请稍候' : '等待对方落子…');
      }
    } else {
      const side = this.s.mode === 'bot'
        ? (this.current === 1 ? '你' : this.botName)
        : (this.current === 1 ? '黑方' : '白方');
      this.s.statusTurn = '当前回合 ' + side + ' 落子';
    }
    this.s.statusMove = '第 ' + this.history.length + ' 手';
  }

  _updatePlayers() {
    const focus = this.s.gameOver ? this.winner : this.current;
    this.s.blackActive = focus === 1;
    this.s.whiteActive = focus === 2;
  }

  _updateButtons() {
    this.s.undoDisabled = this.s.gameOver || this.history.length === 0;
    this.s.drawDisabled = this.s.gameOver;
    this.s.resignDisabled = this.s.gameOver;
    if (this.s.mode === 'bot') {
      // 人机：悔棋/求和都开放，AI 概率应答；开局没落子不可悔
      this.s.undoDisabled = this.s.gameOver || this.history.length === 0;
    }
    if (this.s.mode === 'online') {
      // 在线：悔棋开放（对方应答）；未成局前求和/认输不可用
      this.s.undoDisabled = this.s.gameOver || this.history.length === 0;
      if (!this.onlineGameId) {
        this.s.drawDisabled = true;
        this.s.resignDisabled = true;
        this.s.undoDisabled = true;
      }
    }
  }

  _navigate(path) {
    if (this.deps.onNavigate) this.deps.onNavigate(path);
    else location.href = path;
  }

  destroy() {
    this._onlineStopAll(false);
    this._stopClock();
    this._wsClose();
  }
}

/* ---------- 落子音效（Web Audio 合成"嗒"声，同旧版） ---------- */
export const Sound = {
  ctx: null,
  enabled() {
    try { return localStorage.getItem('gomoku.sound') !== 'off'; } catch (e) { return true; }
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
    } catch (e) { /* 音频不可用时静默降级 */ }
  },
};
