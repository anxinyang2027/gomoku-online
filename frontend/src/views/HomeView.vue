<script setup>
/* 首页（旧 index.html）：顶栏 + 模式卡片 + 中央竞技场 + 排行榜速览 + 聊天 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Board } from '../lib/board';
import { GameController } from '../lib/game';
import { PuzzleController } from '../lib/puzzle';
import { Api } from '../lib/api';
import { loadSave, clearSave } from '../lib/gamesave';
import { useUserStore } from '../stores/user';
import { useUiStore, toast } from '../stores/ui';
import {
  authVisible, accountVisible, checkinVisible, settingsVisible,
  openAuthModal, onAuthSuccess,
} from '../lib/useAuth';
import AuthModal from '../components/AuthModal.vue';
import AccountModal from '../components/AccountModal.vue';
import CheckinModal from '../components/CheckinModal.vue';
import SettingsModal from '../components/SettingsModal.vue';

const router = useRouter();
const userStore = useUserStore();
const ui = useUiStore();

const canvasEl = ref(null);
const arenaEl = ref(null);
let board = null;
let game = null;
let puzzle = null;

/* 响应式桥：game/puzzle 都是命令式实例，模板绑定不了实例本身；
   state 指向当前接管方（ puzz任或 game）的 reactive s，接线切换时整体替换触发重渲 */
const state = ref(null);
function bindState(ctrl) {
  state.value = ctrl ? ctrl.s : null;
}

/* 动作分发：按当前接管方（残局挑战 or 普通对局）转调 */
function onUndo() { if (puzzle) puzzle.restart(); else if (game) game.undo(); }
function onDraw() { if (puzzle) puzzle.showHint(); else if (game) game.offerDraw(); }
function onResign() { if (puzzle) puzzle.backToSelect(); else if (game) game.resign(); }
function onRules() { if (puzzle) puzzle.showRules(); else if (game) game.showRules(); }
function onExit() { if (puzzle) puzzle.exit(); else if (game) game.exit(); }

function onNavigateHome(p) {
  /* 首页竞技场里 router.push('/') 是同路由 no-op：就地退回模式选择 */
  if (p === '/' || p === '') { exitToModes(); return; }
  router.push(p);
}

/* 就地退场：清残局接管、复位棋盘（清盘+计时归零）、回到模式卡片 */
function exitToModes() {
  if (puzzle) {
    puzzle.discard(); // 显式退出：清残局续局存档，刷新不再被拉回来
    puzzle.destroy();
    puzzle = null;
    window.gomokuPuzzle = null;
  }
  if (game) game.resume(); // 重绑棋盘点击 + setMode('idle')
  bindState(game);
  arenaIdle.value = true;
  refitSoon();
}

const puzzleBadge = ref('');
const rankList = ref([]);
const rankFailed = ref(false);

/* ---------- 顶栏（登录态/游客态） ---------- */
const user = computed(() => userStore.user);

/* ---------- 竞技场显隐 ---------- */
const arenaIdle = ref(true);

function goPlaying() {
  if (puzzle) {
    puzzle.destroy();
    puzzle = null;
    window.gomokuPuzzle = null;
    game.resume(); // 棋盘点击从残局接管切回对局控制器
    bindState(game);
  }
  arenaIdle.value = false;
  refitSoon();
}

/* ---------- 模式切换闸门（对局进行中先确认） ---------- */
function gameInProgress() {
  if (puzzle) return !!(puzzle.level && !puzzle.gameOver);
  if (!game) return false;
  if (game.s.mode === 'online' && !game.s.gameOver) return true;
  return (game.s.mode === 'local' || game.s.mode === 'bot') && !game.s.gameOver;
}

function discardOnlineNow() {
  if (!game || game.s.mode !== 'online' || game.s.gameOver) return;
  if (game.onlineGameId) Api.onlineResign(game.onlineGameId).catch(() => {});
  else Api.onlineQueueCancel().catch(() => {});
}

/* 显式弃局：人机/本地双人的本地存档一并清掉（服务端人机会话同步中止） */
function discardLocalBot() {
  if (!game || game.s.gameOver) return;
  if (game.s.mode === 'bot' && game.botSessionId) {
    Api.botStop(game.botSessionId).catch(() => {});
    game.botSessionId = null;
    clearSave('bot');
  } else if (game.s.mode === 'local') {
    clearSave('local');
  }
}

function guardMode(next) {
  if (!gameInProgress()) { next(); return; }
  const onlineLive = game.s.mode === 'online' && !game.s.gameOver;
  ui.openModal({
    title: '你正在游戏中',
    body: onlineLive
      ? '当前在线对局尚未结束，中途退出将记为认输：对方获胜并结算积分；排队/等待将自动取消。确定要开新的一局吗？'
      : '当前对局尚未结束。开新局会放弃当前存档（含人机会话），确定要换吗？',
    buttons: [
      { text: '继续当前对局' },
      { text: '退出并开新局', type: 'primary', onClick: () => {
        discardOnlineNow();
        discardLocalBot();
        if (puzzle) puzzle.discard(); // 弃残局进度：切模式同样是明确退出
        next();
      } },
    ],
  });
}

/* ---------- 顶栏头像点击 ---------- */
function onMeClick() {
  if (Api.isLogin()) {
    accountVisible.value = true; // 账号弹窗（退出回调在 AccountModal 里走 userStore.refresh）
    return;
  }
  if (gameInProgress()) {
    ui.openModal({
      title: '你正在游戏中',
      body: '登录不影响当前对局，弹窗关闭后可继续下棋。',
      buttons: [
        { text: '暂不登录' },
        { text: '去登录', type: 'primary', onClick: () => askLogin() },
      ],
    });
    return;
  }
  askLogin();
}

function askLogin(after) {
  openAuthModal((r) => {
    userStore.refresh();
    if (typeof after === 'function') after();
    setTimeout(() => openCheckinOnce(), 300);
  });
  authVisible.value = true;
}

/* ---------- 签到：每天首次进首页自动弹一次 ---------- */
const CHECKIN_KEY = 'gomoku.checkin.last';
const checkin = reactive({ shown: false });

function openCheckinOnce() {
  if (checkin.shown || !Api.isLogin()) return;
  let last = '';
  try { last = localStorage.getItem(CHECKIN_KEY) || ''; } catch (e) { /* 忽略 */ }
  const today = new Date();
  const todayStr = today.getFullYear() + '-' +
    String(today.getMonth() + 1).padStart(2, '0') + '-' +
    String(today.getDate()).padStart(2, '0');
  if (last === todayStr) return;
  checkin.shown = true;
  try { localStorage.setItem(CHECKIN_KEY, todayStr); } catch (e) { /* 忽略 */ }
  checkinVisible.value = true;
}

function onCheckinChange(p) {
  if (p && userStore.user) {
    userStore.user.coins = p.coins != null ? p.coins : userStore.user.coins;
    userStore.user.diamonds = p.diamonds != null ? p.diamonds : userStore.user.diamonds;
  }
}

/* ---------- 模式入口 ---------- */
const BOT_BODY = '选择电脑棋力档位，你执黑先行：<ol style="text-align:left;margin:6px 0 0 1.2em">' +
  '<li>入门 · 会堵冲四，会犯小错</li><li>进阶 · 两步推理，不易失误</li>' +
  '<li>高手 · 四步推理，最强防御</li></ol>';

function askBot() {
  ui.openModal({
    title: '人机对战',
    body: BOT_BODY,
    buttons: [
      { text: '入门', onClick: () => { goPlaying(); game.setMode('bot', { level: 1 }); } },
      { text: '进阶', type: 'primary', onClick: () => { goPlaying(); game.setMode('bot', { level: 2 }); } },
      { text: '高手', onClick: () => { goPlaying(); game.setMode('bot', { level: 3 }); } },
    ],
  });
}

function modeBot() {
  guardMode(() => {
    if (!Api.isLogin()) {
      toast('人机对战需要先登录');
      askLogin(() => {
        if (!Api.isLogin()) return;
        askBot();
      });
      return;
    }
    askBot();
  });
}

function modeLocal() {
  guardMode(() => {
    ui.openModal({
      title: '本地双人',
      body: '两人同屏轮流落子，黑先白后，先连成五子者胜。<br><br>' +
            '本局进度自动存档：刷新页面或中途退出，都可接着上局继续。',
      buttons: [
        { text: '再想想' },
        { text: '开始对局', type: 'primary', onClick: () => { goPlaying(); game.setMode('local'); } },
      ],
    });
  });
}

function modeOnline() {
  guardMode(() => {
    if (!Api.isLogin()) {
      toast('在线对战需要先登录');
      askLogin(() => {
        if (!Api.isLogin()) return;
        goPlaying();
        game.setMode('online');
      });
      return;
    }
    goPlaying();
    game.setMode('online');
  });
}

function modeRoom() {
  guardMode(() => {
    if (!Api.isLogin()) {
      toast('房间组队需要先登录');
      askLogin(() => {
        if (!Api.isLogin()) return;
        modeRoom();
      });
      return;
    }
    ui.openModal({
      title: '房间组队',
      body: '<div style="text-align:left;margin:4px 0 0">创建房间把 6 位房间号告诉好友，' +
            '或输入对方的房间号加入对局。</div>',
      buttons: [
        { text: '加入房间', onClick: () => { goPlaying(); askRoomCode('', ''); } },
        { text: '创建房间', type: 'primary', onClick: () => { goPlaying(); game.setMode('online', { room: 'host' }); } },
      ],
    });
  });
}

function askRoomCode(errMsg, prefill) {
  let inputRef = { value: (prefill || '') };
  const close = ui.openModal({
    title: '加入房间',
    body: '<div class="match-wait__line">输入好友的 6 位房间号：</div>' +
          '<input class="room-input" id="home-room-input" type="text" inputmode="numeric"' +
          ' maxlength="6" placeholder="如 386402" value="' + (prefill || '') + '">' +
          (errMsg ? '<div class="match-wait__hint">' + errMsg + '</div>' : ''),
    buttons: [
      { text: '取消' },
      { text: '加入', type: 'primary', onClick: () => {
        const el = document.getElementById('home-room-input');
        const val = ((el && el.value) || inputRef.value || '').replace(/\D/g, '');
        if (val.length !== 6) {
          askRoomCode('房间号为 6 位数字', val);
          return;
        }
        game.setMode('online', { room: 'join', code: val });
      } },
    ],
  });
  setTimeout(() => {
    const input = document.getElementById('home-room-input');
    if (!input) return;
    input.focus();
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const val = input.value.replace(/\D/g, '');
      if (val.length === 6) {
        close();
        game.setMode('online', { room: 'join', code: val });
      }
    });
  }, 0);
}

function modePuzzle() {
  if (puzzle) return;
  guardMode(() => {
    if (game.s.mode === 'online') {
      router.push('/game?mode=puzzle');
      return;
    }
    enterPuzzle();
  });
}

/* 竞技场切入残局挑战：就地接管棋板（选模式/续关由 boot 自行决定） */
function enterPuzzle() {
  goPlaying();
  game.suspend();
  PuzzleController.boot(board, { onNavigate: onNavigateHome }, {}).then((p) => {
    puzzle = p;
    window.gomokuPuzzle = p || null;
    if (p) bindState(p);
  });
}

/* 深链 ?mode=puzzle；登录态自动接回未完成的在线对局 */
onMounted(() => {
  /* 大屏全宽标记：html[data-arena="1"] 让全局 fixed 的顶/底导航条
     （挂在 App.vue，不在本组件子树内）也吃到 --app-max: 100%；
     离开首页摘掉，列表页回到 1280 内容带 */
  document.documentElement.setAttribute('data-arena', '1');

  try {
    const cleared = JSON.parse(localStorage.getItem('gomoku.puzzle')) || [];
    if (Array.isArray(cleared) && cleared.length) {
      puzzleBadge.value = '已通 ' + cleared.length + '/300 关';
    }
  } catch (e) { /* 读不到进度就不显示角标 */ }

  if (Api.isLogin()) openCheckinOnce();

  /* 排行榜速览 */
  Api.getRank().then((list) => {
    rankList.value = list || [];
  }).catch(() => { rankFailed.value = true; });

  /* 大屏棋盘自适应 */
  window.addEventListener('resize', refitSoon);
});

/* 终局结算回调：对局在首页就地结束不重挂载，手动刷顶栏积分与排行榜速览 */
function onGameSettled() {
  userStore.refresh(); // 左上角积分/金币
  Api.getRank().then((list) => {
    rankList.value = list || [];
    rankFailed.value = false;
  }).catch(() => {});
}

onBeforeUnmount(() => {
  document.documentElement.removeAttribute('data-arena');
  window.removeEventListener('resize', refitSoon);
  if (game) game.destroy();
  if (puzzle) puzzle.destroy();
});

/* ---------- 大屏竞技场量高写宽（同旧 fitArena） ---------- */
function fitArena() {
  if (!arenaEl.value) return;
  const arena = arenaEl.value;
  if (!window.matchMedia('(min-width: 1200px)').matches) {
    arena.querySelectorAll('.arena-board-box, .players, .arena-bar, .game-bar')
      .forEach((el) => { el.style.width = ''; });
    return;
  }
  const box = arena.querySelector('.arena-board-box');
  if (!box) return;
  const h = box.clientHeight;
  if (h <= 0) return;
  let w = h;
  const colEl = box.parentElement;
  const col = colEl.clientWidth;
  const cs = getComputedStyle(colEl);
  const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  const maxOuter = col - padX;
  if (h > 40 && maxOuter > 0) {
    w = Math.min(Math.round(h * 1.4), maxOuter - 24);
    if (w < h) w = Math.min(h, maxOuter);
  }
  arena.querySelectorAll('.arena-board-box, .players, .arena-bar, .game-bar')
    .forEach((el) => { el.style.width = w + 'px'; });
}

function refitSoon() {
  requestAnimationFrame(() => {
    fitArena();
    if (board) board._handleResize();
  });
}

/* ---------- 棋盘初始化（竞技场矩形棋盘） ---------- */
onMounted(() => {
  nextTick(() => {
    if (!canvasEl.value) return;
    board = new Board(canvasEl.value, { aspect: 1.4 });
    window.gomokuBoard = board;
    game = new GameController(board, {
      onNavigate: onNavigateHome,
      onAuthRequired: (after) => askLogin(after),
      onSettled: onGameSettled, // 终局结算后刷新顶栏积分 + 排行榜速览
      onSystemChat: pushLocalSystem, // 【系统】提示进聊天面板（仅本人可见）
    });
    window.gomokuGame = game;
    board.onCellClick((cell) => game.onCell(cell));
    bindState(game);
    fitArena();
    board._handleResize();

    /* 深链/自动续局：在线（匹配/房间）→ 人机/本地双人/残局 存档续局 */
    const query = new URLSearchParams(location.search);
    if (query.get('mode') === 'puzzle') { modePuzzle(); return; }
    if (!Api.isLogin()) {
      clearSave('bot'); // 人机存档与账号绑定，掉登录态即失效
      resumeSavedGames();
      return;
    }
    Api.onlineQueueStatus().then((resp) => {
      if (resp && (resp.status === 'matched' || resp.status === 'waiting')) {
        goPlaying();
        game.setMode('online', { resume: true });
        return;
      }
      /* 房间等待续局：房主重开仍回同一间房（服务端幂等） */
      return Api.onlineRoomStatus().then((room) => {
        if (room && room.status === 'created' && room.roomCode) {
          toast('已回到房间 ' + room.roomCode + '，继续等好友加入');
          goPlaying();
          game.setMode('online', { room: 'host' });
          return;
        }
        resumeSavedGames();
      });
    }).catch(() => resumeSavedGames());
  });
});

/* 人机/本地双人/残局挑战的存档续局（刷新/离开回场即恢复，最近活动优先）；
   无时间戳的旧档视为最新（上一版存档迁移），同旧档并列时残局优先 */
function resumeSavedGames() {
  const ts = (v) => (v && typeof v.ts === 'number' ? v.ts : Number.MAX_SAFE_INTEGER);
  const cands = [];
  const puz = loadSave('puzzle');
  if (puz && puz.levelId) cands.push({ order: 0, ts: ts(puz), go: enterPuzzle });
  if (Api.isLogin()) {
    const bot = loadSave('bot');
    if (bot && bot.sessionId) cands.push({ order: 1, ts: ts(bot), go: () => { goPlaying(); game.restoreBot(bot); } });
  }
  const local = loadSave('local');
  if (local && Array.isArray(local.history) && local.history.length) {
    cands.push({ order: 2, ts: ts(local), go: () => { goPlaying(); game.restoreLocal(local); } });
  }
  cands.sort((a, b) => b.ts - a.ts || a.order - b.order);
  if (cands.length) cands[0].go();
}

/* ---------- 聊天面板（公屏 + 对局频道自动切换） ---------- */
const chatFeed = ref(null);
const chatInput = ref('');
const chatMsgs = ref([]);
let chatLastId = 0;
let chatMyName = '我';
let chatTimer = null;

/* 当前聊天频道：在线/人机进行中 → 对局频道（仅局内可见）；其余 → 公屏。
   读 game.s（响应式），会话号经 _updateStatus 同步进 s.channelGameId */
const chatChannel = computed(() => {
  if (!game || !game.s.channelGameId) return 'lobby';
  return 'game:' + game.s.channelGameId;
});
const chatChannelLabel = computed(() =>
  chatChannel.value === 'lobby' ? '公屏 · 所有玩家可见' : '对局频道 · 仅局内可见');

/* 频道切换：清屏重置 lastId 立即拉新频道（不回放历史，同入座语义） */
watch(chatChannel, (ch, old) => {
  if (ch === old) return;
  chatMsgs.value = [];
  chatLastId = 0;
  chatPoll();
});

function nowLabel() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

/** 【系统】提示进聊天面板（仅本人客户端可见，如"对方离线，托管中"）；
    前缀由模板统一渲染，这里只发正文 */
function pushLocalSystem(text) {
  pushMsg({ id: 0, system: true, content: text });
}

function pushMsg(m) {
  if (m.id) {
    if (m.id <= chatLastId) return;
    chatLastId = m.id;
  }
  chatMsgs.value.push({
    id: m.id || 0,
    system: !!m.system,
    mine: !m.system && m.name === chatMyName,
    time: m.time || nowLabel(),
    name: m.system ? '' : (m.name || ''),
    content: m.content,
  });
  if (chatMsgs.value.length > 200) chatMsgs.value.splice(0, chatMsgs.value.length - 200);
  nextTick(() => {
    if (chatFeed.value) chatFeed.value.scrollTop = chatFeed.value.scrollHeight;
  });
}

async function chatPoll() {
  try {
    const list = await Api.chatRecent(chatLastId, chatChannel.value);
    if (!chatMsgs.value.length) {
      pushMsg({ id: 0, system: true, content: '欢迎来到硕鹏五子棋棋室，请文明发言~' });
    }
    (list || []).forEach(pushMsg);
  } catch (e) {
    if (!chatMsgs.value.length) {
      pushMsg({ id: 0, system: true, content: '欢迎来到硕鹏五子棋棋室，请文明发言~' });
      pushMsg({ id: 0, system: true, content: '仅展示入座后的发言，历史不保存' });
    }
  }
}

async function chatSend() {
  const text = (chatInput.value || '').replace(/\s+/g, ' ').trim();
  if (!text) return;
  if (!Api.isLogin()) {
    toast('请先登录再发言');
    askLogin();
    return;
  }
  chatInput.value = '';
  try {
    const m = await Api.chatSend(text, chatChannel.value);
    if (m && m.id) pushMsg(m);
    else pushMsg({ id: 0, name: chatMyName, content: text });
  } catch (e) {
    if (e && e.message && e.message.indexOf('网络') < 0) {
      toast(e.message);
    } else {
      pushMsg({ id: 0, name: chatMyName, content: text });
    }
  }
}

onMounted(() => {
  if (Api.isLogin()) {
    Api.getUser().then((u) => { if (u && u.name) chatMyName = u.name; }).catch(() => {});
  }
  chatPoll();
  chatTimer = setInterval(chatPoll, 2500);
});

onBeforeUnmount(() => {
  clearInterval(chatTimer);
});

/* ---------- 货币弹窗 ---------- */
function showCoins() {
  if (!Api.isLogin()) { askLogin(); return; }
  const coins = user.value && typeof user.value.coins === 'number' ? user.value.coins : '—';
  ui.openModal({
    title: '金币记录',
    body: '<span class="modal-currency modal-currency--coin" aria-hidden="true"></span>' +
          '当前余额 <b>' + coins + '</b> 金币' +
          '<br><br>获得来源：<br>注册赠送 500 · 对局获胜 +20（残局/人机不计）' +
          '<br><span class="modal-note">明细流水接口规划中，敬请期待</span>',
    buttons: [{ text: '知道了', type: 'primary' }],
  });
}

function showDiamonds() {
  const diamonds = user.value && typeof user.value.diamonds === 'number' ? user.value.diamonds : '—';
  ui.openModal({
    title: '钻石记录',
    body: '<span class="modal-currency modal-currency--diamond" aria-hidden="true"></span>' +
          '当前余额 <b>' + diamonds + '</b> 钻石' +
          '<br><br>获得来源：<br>连续签到第 7 天 +2' +
          '<br><span class="modal-note">商城稀有款（曜石/朱漆棋盘、光头师父/波波阿姐头像）需钻石购买</span>',
    buttons: [{ text: '知道了', type: 'primary' }],
  });
}

/* 排行榜速览前三奖牌 */
const MEDALS = ['/assets/sysytem/rank-1st.png', '/assets/sysytem/rank-2nd.png', '/assets/sysytem/rank-3rd.png'];
const MEDAL_NAMES = ['冠军', '亚军', '季军'];

const gameView = () => game; // 模板里直接用 game.s 可能未初始化，包一层
</script>

<template>
  <div class="home-shell">
    <header class="top-bar">
      <button type="button" class="top-bar__me" @click="onMeClick">
        <span class="top-bar__avatar" aria-hidden="true">
          <img :src="userStore.avatarImg" alt=""
               onerror="this.src='/assets/avatars/avatar01.png'"
               style="width:100%;height:100%;object-fit:contain">
        </span>
        <span class="top-bar__me-text">
          <span class="top-bar__me-name">{{ user ? user.name : '游客 · 点击登录' }}</span>
          <span class="top-bar__me-score" :hidden="!user">积分 {{ user ? user.score : '—' }}</span>
        </span>
      </button>
      <div class="top-bar__currencies">
        <button type="button" class="top-bar__pill top-bar__pill--coin" @click="showCoins">
          金币 <b>{{ user && typeof user.coins === 'number' ? user.coins : '—' }}</b>
        </button>
        <button type="button" class="top-bar__pill top-bar__pill--diamond" @click="showDiamonds">
          钻石 <b>{{ user && typeof user.diamonds === 'number' ? user.diamonds : '0' }}</b>
        </button>
      </div>
      <button type="button" class="top-bar__btn" aria-label="设置" @click="settingsVisible = true">
        <span class="icon-bar icon-bar--settings" aria-hidden="true"></span>
      </button>
    </header>

    <main class="page page--home">
      <div class="home-left">
        <div class="modes">
          <button type="button" class="mode-card" @click="modeOnline">
            <span class="mode-card__name">在线模式</span>
            <span class="mode-card__desc">实时匹配 · 真人对弈</span>
          </button>
          <button type="button" class="mode-card" @click="modeBot">
            <span class="mode-card__name">人机对战</span>
            <span class="mode-card__desc">挑战电脑 · 三档棋力</span>
          </button>
          <button type="button" class="mode-card mode-card--wide" @click="modeRoom">
            <span class="mode-card__name">房间组队</span>
            <span class="mode-card__desc">房间号邀请 · 好友对弈</span>
          </button>
          <button type="button" class="mode-card mode-card--wide" @click="modeLocal">
            <span class="mode-card__name">本地双人</span>
            <span class="mode-card__desc">同屏对弈 · 就地开局</span>
          </button>
          <button type="button" class="mode-card mode-card--wide" @click="modePuzzle">
            <span class="mode-card__name">残局挑战</span>
            <span class="mode-card__desc">正解闯关 · 黑先制胜</span>
            <span v-if="puzzleBadge" class="mode-card__badge">{{ puzzleBadge }}</span>
          </button>
        </div>
      </div>

      <section ref="arenaEl" id="arena" class="arena" :class="{ 'is-idle': arenaIdle }">
        <div class="players">
          <div class="players__item" data-side="1" :class="{ 'players__item--active': state && state.blackActive }">
            <span class="players__stone players__stone--black" aria-hidden="true"></span>{{ state ? state.blackName : '黑方' }}
          </div>
          <div class="players__item" data-side="2" :class="{ 'players__item--active': state && state.whiteActive }">
            <span class="players__stone players__stone--white" aria-hidden="true"></span>{{ state ? state.whiteName : '白方' }}
          </div>
        </div>

        <div class="arena-clock">
          <span class="arena-clock__box">{{ state ? state.timerText : '00:00' }}</span>
        </div>

        <div class="arena-board-box">
          <div class="board-wrap"><canvas ref="canvasEl" id="board"></canvas></div>
          <span class="arena-hint">选择左侧模式开始对局</span>
        </div>

        <div class="arena-bar">
          <button type="button" class="top-bar__btn" @click="onExit">
            <span class="icon-bar icon-bar--back" aria-hidden="true"></span>退出
          </button>
          <button type="button" class="top-bar__btn top-bar__btn--right" @click="onRules">规则</button>
        </div>

        <div class="game-bar">
          <div v-if="state && !state.replayVisible">
            <div class="game-status">
              <span>{{ state.statusTurn }}</span>
              <span>{{ state.statusMove }}</span>
            </div>
            <div class="game-actions">
              <button type="button" class="btn" :disabled="state.undoDisabled" @click="onUndo">{{ state.undoText }}</button>
              <button type="button" class="btn" :disabled="state.drawDisabled" @click="onDraw">{{ state.drawText }}</button>
              <button type="button" class="btn" :disabled="state.resignDisabled" @click="onResign">{{ state.resignText }}</button>
            </div>
          </div>
          <div v-else-if="state && state.replayVisible">
            <div class="game-status">
              <span>复盘</span>
              <span>{{ state.replayCount }}</span>
            </div>
            <div class="game-actions">
              <button type="button" class="btn" :disabled="state.replayPrevDisabled" @click="game.prevMove()">上一步</button>
              <button type="button" class="btn" :disabled="state.replayNextDisabled" @click="game.nextMove()">下一步</button>
              <button type="button" class="btn" @click="game._exitReplay()">退出复盘</button>
            </div>
          </div>
          <div v-else>
            <div class="game-status">
              <span>选择模式开始对局</span>
              <span>第 0 手</span>
            </div>
            <div class="game-actions">
              <button type="button" class="btn" disabled>悔棋</button>
              <button type="button" class="btn" disabled>求和</button>
              <button type="button" class="btn" disabled>认输</button>
            </div>
          </div>
        </div>
      </section>

      <aside class="home-right">
        <section class="home-rank">
          <h2 class="home-rank__title">
            <img class="home-rank__banner" src="/assets/sysytem/leaderboard.png" alt="排行榜">
          </h2>
          <ul class="home-rank__list">
            <li v-if="rankFailed" class="home-rank__empty">榜单加载失败 · 请稍后再试</li>
            <li v-else-if="!rankList.length" class="home-rank__empty">暂无数据 · 等待后端接入</li>
            <li
              v-for="(u, i) in rankList.slice(0, 10)"
              :key="u.id"
              class="home-rank__row"
              :class="{ 'home-rank__row--top': i < 3 }"
            >
              <img v-if="i < 3" class="home-rank__medal" :src="MEDALS[i]" :alt="MEDAL_NAMES[i]">
              <span v-else class="home-rank__no">{{ i + 1 }}</span>
              <span class="home-rank__name">{{ u.name }}</span>
              <span class="home-rank__score">{{ u.score }} 分</span>
            </li>
          </ul>
        </section>

        <section class="home-chat home-chat--board">
          <div ref="chatFeed" class="home-chat__feed" aria-live="polite">
            <div
              v-for="(m, i) in chatMsgs"
              :key="i"
              class="chat-msg"
              :class="{ 'chat-msg--sys': m.system, 'chat-msg--me': m.mine }"
            >
              <span class="chat-msg__time">{{ m.time }}</span>
              <span class="chat-msg__name">{{ m.system ? '【系统】' : m.name + '：' }}</span>
              <span class="chat-msg__text">{{ m.content }}</span>
            </div>
          </div>
          <div class="home-chat__inputrow">
            <input
              v-model="chatInput"
              class="home-chat__input"
              type="text"
              maxlength="60"
              placeholder="和大家打个招呼吧…"
              @keydown.enter="chatSend"
            >
            <button class="home-chat__send" type="button" @click="chatSend">发送</button>
          </div>
          <span class="home-chat__badge">{{ chatChannelLabel }}</span>
        </section>
      </aside>
    </main>

    <!-- 功能弹窗（登录/账号/签到/设置） -->
    <AuthModal v-if="authVisible" @login="onAuthSuccess($event); userStore.refresh()" @close="authVisible = false" />
    <AccountModal v-if="accountVisible" @close="accountVisible = false" />
    <CheckinModal v-if="checkinVisible" @close="checkinVisible = false" @change="onCheckinChange" />
    <SettingsModal v-if="settingsVisible" @close="settingsVisible = false" />
  </div>
</template>
