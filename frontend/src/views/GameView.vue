<script setup>
/* 独立对局页（旧 game.html）：?mode=local|bot|online|puzzle
   离开首页就地竞技场时的兜底深链入口（残局从首页跳转过来走这条） */
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { Board } from '../lib/board';
import { GameController } from '../lib/game';
import { PuzzleController } from '../lib/puzzle';
import { Api } from '../lib/api';
import { useUiStore, toast } from '../stores/ui';
import { loadSave, clearSave } from '../lib/gamesave';

const route = useRoute();
const router = useRouter();
const ui = useUiStore();

const canvasEl = ref(null);
let board = null;
let game = null;
let puzzle = null;

/* 响应式桥：game/puzzle 是命令式实例，模板绑不到；
   state 指向当前控制器的 reactive s（Game 与 Puzzle 同形状），
   实例切换时整体替换触发重渲 */
const state = ref(null);
function bindState(ctrl) {
  state.value = ctrl ? ctrl.s : null;
}

function onUndo() {
  if (puzzle) puzzle.restart();
  else if (game) game.undo();
}
function onDraw() {
  if (puzzle) puzzle.showHint();
  else if (game) game.offerDraw();
}
function onResign() {
  if (puzzle) puzzle.backToSelect();
  else if (game) game.resign();
}

const BOT_BODY = '选择电脑棋力档位，你执黑先行：<ol style="text-align:left;margin:6px 0 0 1.2em">' +
  '<li>入门 · 会堵冲四，会犯小错</li><li>进阶 · 两步推理，不易失误</li>' +
  '<li>高手 · 四步推理，最强防御</li></ol>';

function navigate(p) {
  router.push(p);
}

onMounted(() => {
  nextTick(() => {
    if (!canvasEl.value) return;
    board = new Board(canvasEl.value);
    window.gomokuBoard = board;
    window.gomokuGame = null;

    const mode = route.query.mode || 'local';
    const query = { level: route.query.level };

    if (mode === 'puzzle') {
      PuzzleController.boot(board, { onNavigate: navigate }, query).then((p) => {
        puzzle = p;
        window.gomokuPuzzle = p;
        bindState(puzzle);
      });
      return;
    }

    if (mode === 'local') {
      board.lock();
      const saved = loadSave('local');
      const hasSavedGame = !!(saved && Array.isArray(saved.history) && saved.history.length);
      ui.openModal({
        title: '本地双人',
        body: hasSavedGame
          ? '检测到未结束的上一局，可直接续上。'
          : '两人同屏轮流落子，黑先白后，先连成五子者胜。<br><br>' +
            '本局进度自动存档：刷新页面或中途退出，都可接着上局继续。',
        buttons: hasSavedGame
          ? [
            { text: '返回首页', onClick: () => navigate('/') },
            { text: '丢弃重开', onClick: () => { clearSave('local'); game = makeGame(); game.setMode('local'); } },
            { text: '续上上局', type: 'primary', onClick: () => { game = makeGame(); game.restoreLocal(saved); } },
          ]
          : [
            { text: '返回首页', onClick: () => navigate('/') },
            { text: '开始对局', type: 'primary', onClick: () => startFreshLocal() },
          ],
      });
      return;
    }

    const startLoggedIn = (proceed) => {
      if (!Api.isLogin()) {
        toast(mode === 'bot' ? '人机对战需要先登录' : '在线对战需要先登录');
        board.lock();
        // Vue 版：跳回首页让用户在首页登录后续开
        setTimeout(() => navigate('/'), 900);
        return;
      }
      proceed();
    };

    if (mode === 'bot') {
      const level = parseInt(route.query.level, 10);
      startLoggedIn(() => {
        const saved = loadSave('bot');
        const canResume = !!(saved && saved.sessionId && (!level || level === saved.level));
        if (!level && canResume) { // 无 level 参数进来：直接续上存档对局
          game = makeGame();
          game.restoreBot(saved);
          return;
        }
        if (!level || level < 1 || level > 3) {
          board.lock();
          ui.openModal({
            title: '人机对战',
            body: BOT_BODY,
            buttons: [
              { text: '入门', onClick: () => restartBot(1) },
              { text: '进阶', type: 'primary', onClick: () => restartBot(2) },
              { text: '高手', onClick: () => restartBot(3) },
            ],
          });
          return;
        }
        game = makeGame();
        if (canResume) { game.restoreBot(saved); return; }
        game.setMode('bot', { level });
      });
      return;
    }

    if (mode === 'online') {
      /* 房间参数随 URL 保真：刷新后仍能回到房主等待/凭号加入（服务端幂等找回） */
      const roomParam = route.query.room;
      const codeParam = String(route.query.code || '').replace(/\D/g, '');
      startLoggedIn(() => {
        game = makeGame();
        if (roomParam === 'host') { game.setMode('online', { room: 'host' }); return; }
        if (roomParam === 'join' && codeParam) {
          game.setMode('online', { room: 'join', code: codeParam });
          return;
        }
        game.setMode('online');
      });
      return;
    }

    toast('敬请期待');
    board.lock();
  });
});

/* ---------- 工厂：新建控制器并接线 ---------- */
function makeGame() {
  game = new GameController(board, { onNavigate: navigate });
  window.gomokuGame = game;
  board.onCellClick((cell) => game.onCell(cell));
  bindState(game);
  return game;
}

function startFreshLocal() {
  game = makeGame();
  game.setMode('local');
}

function restartBot(level) {
  navigate('/game?mode=bot&level=' + level);
}

/* 离开页面：停轮询/停表；人机/本地进度已存档，保留会话供刷新续局 */
onBeforeUnmount(() => {
  if (game) game.destroy();
  if (puzzle) puzzle.destroy();
});

/* 路由内守卫：对局进行中离开需确认（残局=未破解关） */
onBeforeRouteLeave((to, from, next) => {
  const inProgress = (() => {
    if (puzzle) return !!(puzzle.level && !puzzle.gameOver);
    if (!game) return false;
    if (game.s.mode === 'online' && !game.s.gameOver && game.onlineGameId) return true;
    return (game.s.mode === 'local' || game.s.mode === 'bot') && !game.s.gameOver;
  })();
  if (!inProgress) { next(); return; }
  const onlineLive = game && game.s.mode === 'online' && !game.s.gameOver;
  ui.openModal({
    title: '你正在游戏中',
    body: onlineLive
      ? '在线对局中途离开将记为认输：对方获胜并结算积分（排队/等待将自动取消）。确定要离开吗？'
      : '当前对局尚未结束。离开后本局进度已自动存档，下次进入可续上；中途转人机将中止其服务端会话。确定要离开吗？',
    buttons: [
      { text: '继续当前对局' },
      { text: '退出并离开', type: 'primary', onClick: () => {
        if (onlineLive && game.onlineGameId) Api.onlineResign(game.onlineGameId).catch(() => {});
        discardBotLocal();
        if (puzzle) puzzle.discard(); // 确认离开 = 明确退出残局，清档防刷新拉回
        next();
      } },
    ],
  });
});

/* 显式弃局：清人机/本地存档；人机会话同步通知服务端中止 */
function discardBotLocal() {
  if (game && game.s.mode === 'bot' && game.botSessionId) {
    Api.botStop(game.botSessionId).catch(() => {});
    game.botSessionId = null;
    clearSave('bot');
  } else if (game && game.s.mode === 'local') {
    clearSave('local');
  }
}
</script>

<template>
  <header class="top-bar">
    <button type="button" class="top-bar__btn" @click="navigate('/')">
      <span class="icon-bar icon-bar--back" aria-hidden="true"></span>退出
    </button>
    <div class="top-bar__timer">{{ state ? state.timerText : '00:00' }}</div>
    <button
      type="button"
      class="top-bar__btn top-bar__btn--right"
      @click="puzzle ? puzzle.showRules() : (game && game.showRules())"
    >规则</button>
  </header>

  <main class="page page--game">
    <div class="players">
      <div class="players__item" data-side="1" :class="{ 'players__item--active': state ? state.blackActive : true }">
        <span class="players__stone players__stone--black" aria-hidden="true"></span>{{ state ? state.blackName : '黑方（你）' }}
      </div>
      <div class="players__item" data-side="2" :class="{ 'players__item--active': state ? state.whiteActive : false }">
        <span class="players__stone players__stone--white" aria-hidden="true"></span>{{ state ? state.whiteName : '白方' }}
      </div>
    </div>
    <div class="board-wrap"><canvas ref="canvasEl" id="board"></canvas></div>
  </main>

  <div class="game-bar">
    <div v-if="!state || !state.replayVisible">
      <div class="game-status">
        <span>{{ state ? state.statusTurn : '' }}</span>
        <span>{{ state ? state.statusMove : '第 0 手' }}</span>
      </div>
      <div class="game-actions">
        <button type="button" class="btn" :disabled="!state || state.undoDisabled" @click="onUndo()">{{ state ? state.undoText : '悔棋' }}</button>
        <button type="button" class="btn" :disabled="!state || state.drawDisabled" @click="onDraw()">{{ state ? state.drawText : '求和' }}</button>
        <button type="button" class="btn" :disabled="!state || state.resignDisabled" @click="onResign()">{{ state ? state.resignText : '认输' }}</button>
      </div>
    </div>
    <div v-if="state && state.replayVisible">
      <div class="game-status">
        <span>复盘</span>
        <span>{{ state.replayCount }}</span>
      </div>
      <div class="game-actions">
        <button type="button" class="btn" :disabled="state.replayPrevDisabled" @click="game && game.prevMove()">上一步</button>
        <button type="button" class="btn" :disabled="state.replayNextDisabled" @click="game && game.nextMove()">下一步</button>
        <button type="button" class="btn" @click="game && game._exitReplay()">退出复盘</button>
      </div>
    </div>
  </div>
</template>
