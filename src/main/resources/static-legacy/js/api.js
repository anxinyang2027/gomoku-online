/* ==================================================
   api.js · 数据接口封装（M3.1）

   约定（test2.txt 全局技术约定）：
   - 页面一律通过本文件取数，不直接碰 fetch
   - 一期 USE_MOCK = true，接口形状真实、数据为空；
     二期接后端时只改 request() 的 mock 分支，接口签名不动
   - 接口清单（对应二期后端规划）：
     login / register / getUser / getRank / getHistory / submitResult
     / getShop（M5 商城）/ getPuzzles（M6 残局挑战）
   ================================================== */
'use strict';

/** mock 总开关：true = 不发网络请求，直接回 mock 数据 */
const USE_MOCK = false;

/** 后端服务地址（一体化）：页面由后端同源伺服，置 '' 即可 */
const BASE = '';

const TOKEN_KEY = 'gomoku.token';

function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch (e) {
    return null;
  }
}

function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch (e) { /* 忽略 */ }
}

/* --------- 皮肤缓存（H5）：localStorage 同步注入，游戏页首帧即生效 --------- */

const SKIN_KEY = 'gomoku.skins';

function loadSkinCache() {
  try {
    return JSON.parse(localStorage.getItem(SKIN_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function saveSkinCache(data) {
  try {
    localStorage.setItem(SKIN_KEY, JSON.stringify(data));
  } catch (e) { /* 忽略 */ }
}

function injectSkins(data) {
  const root = document.documentElement.style;
  ['board'].forEach((cat) => {
    const colors = data[cat] && data[cat].colors;
    if (colors) for (const k in colors) root.setProperty(k, colors[k]);
  });
}

/**
 * 统一请求封装。
 * 错误约定：HTTP 非 2xx 抛 Error；后端统一 { code, data } 包裹，
 * 在这里解开——页面永远只拿到业务数据或异常。
 * 兼容钩子：后端未上线的路径（404）与断网时回落 mock，
 * 让"接后端"成为增量过程，商城/残局一期数据继续可用（H4 移除）。
 */
async function request(path, { method = 'GET', data } = {}) {
  if (USE_MOCK) return mockRequest(path);

  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;

  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
    });
  } catch (e) {
    if (MOCK[path] !== undefined) return mockRequest(path);
    throw new Error('网络不可用，请稍后再试');
  }
  if (res.status === 404 && MOCK[path] !== undefined) return mockRequest(path);
  if (!res.ok) throw new Error('HTTP ' + res.status);

  const pkg = await res.json();
  if (pkg.code === 401) clearToken();
  if (pkg.code !== 0) throw new Error(pkg.msg || 'ERR ' + pkg.code);
  return pkg.data;
}

/* 对外接口（页面只认这些名字） */
const Api = {
  /** 登录（三期通） */
  login(name, password) {
    return request('/api/login', { method: 'POST', data: { name, password } });
  },
  /** 注册（三期通） */
  register(name, password) {
    return request('/api/register', { method: 'POST', data: { name, password } });
  },
  /** 当前用户（三期通；未登录返回 null，游客态不受影响） */
  getUser() {
    return request('/api/user');
  },
  /** 是否已登录（有 token 即视为登录态，有效性由接口自行校验） */
  isLogin() {
    return !!getToken();
  },
  /** 我的排名（H3）：{ rank, score }；未登录端点走 401 → 抛错由页面兜底 */
  getRankMe() {
    return request('/api/rank/me');
  },
  /** 排行榜（二期通）。行形状：{ name, score }，按分数降序 */
  getRank() {
    return request('/api/rank');
  },
  /** 战绩（二期通）。行形状：{ win, opponent, time, moves } */
  getHistory() {
    return request('/api/history');
  },
  /** 对局结果上报（二期通）。形状：{ winner, time, moves } */
  submitResult(result) {
    return request('/api/result', { method: 'POST', data: result });
  },
  /** 人机对战（七期 J9）。开局：{sessionId, side:"black", botName}；玩家执黑先行 */
  botStart(difficulty) {
    return request('/api/game/bot/start', { method: 'POST', data: { difficulty } });
  },
  /** 落子并取 AI 应答。{accepted, botR, botC, status, winnerColor, moves, reason} */
  botMove(sessionId, r, c) {
    return request('/api/game/bot/move', { method: 'POST', data: { sessionId, r, c } });
  },
  /** 局面快照（断线恢复）。{sessionId, difficulty, botName, status, winnerColor, moves:[{r,c,color}]} */
  botState(sessionId) {
    return request('/api/game/' + sessionId);
  },
  /** 中止未完成的 bot 对局（退出对局页时调用；已结束不报错） */
  botStop(sessionId) {
    return request('/api/game/bot/stop/' + sessionId, { method: 'POST' });
  },
  /** 八期起：真实玩家在线匹配（HTTP 轮询）。加入/回到当前局：
   *  {status:'waiting'|'matched', gameId, myColor, opponentName} */
  onlineQueueJoin() {
    return request('/api/online/queue/join', { method: 'POST' });
  },
  /** 匹配状态轮询（等待者用以得知成局），形状同上（idle=已不在池） */
  onlineQueueStatus() {
    return request('/api/online/queue/status');
  },
  /** 取消排队（已成局不受影响；房主的等待房间一并解散） */
  onlineQueueCancel() {
    return request('/api/online/queue/cancel', { method: 'POST' });
  },
  /** 九期：房间组队——创建房间（房主执黑）。{status:'created', roomCode} */
  onlineRoomCreate() {
    return request('/api/online/room/create', { method: 'POST' });
  },
  /** 房主侧房间状态轮询：created=等待中（带 roomCode）/ matched=对手已加入
   *  （gameId/myColor/opponentName 与匹配流程同形）/ closed=房间已解散过期 */
  onlineRoomStatus() {
    return request('/api/online/room/status');
  },
  /** 凭房间号加入（即与房主成局，房主黑加入者白）；形状同上 */
  onlineRoomJoin(code) {
    return request('/api/online/room/join', { method: 'POST', data: { code } });
  },
  /** 在线对局快照（轮询统一形状）：{gameId, myColor, status, turnColor,
   *  moves:[{r,c,color}], winnerColor, endReason, myResult, myScoreDelta,
   *  blackName, whiteName, drawPending, startAtMs} */
  onlineState(gameId) {
    return request('/api/online/game/' + gameId);
  },
  /** 在线落子（服务端权威，返回最新快照） */
  onlineMove(gameId, r, c) {
    return request('/api/online/game/move', { method: 'POST', data: { gameId, r, c } });
  },
  /** 在线认输（返回终局快照） */
  onlineResign(gameId) {
    return request('/api/online/game/resign', { method: 'POST', data: { gameId } });
  },
  /** 在线求和（双方各按一次即平局；返回最新快照） */
  onlineDraw(gameId) {
    return request('/api/online/game/draw', { method: 'POST', data: { gameId } });
  },
  /** 拒绝对方的求和请求（清掉双方标记） */
  onlineDrawReject(gameId) {
    return request('/api/online/game/draw/reject', { method: 'POST', data: { gameId } });
  },
   /** 商城（M5.1）。商品形状：{ id, cat, name, price, colors, [glyph], [img] }
    *  - cat：'board' | 'avatar'
    *  - price：金币展示价，0 = 默认款；购买与换肤五期点亮
    *  - colors：键名即 CSS 自定义属性名，换肤 = 逐键 setProperty 注入——
    *      board → --board / --board-line；
    *      avatar → --avatar-bg / --avatar-fg（这两个变量五期才接入首页头像）
    *  - glyph：仅 avatar；预览图与头像上的字符（● ○ 元 …）。
    *      M5.9 起为回落路径：商品无 img 时才用 glyph 渲染
    *  - img：M5.9 可选，商品预览图相对路径（如 'assets/avatars/avatar01.png'）。
    *      文件名与 id 无关，图片缺失时商城显示占位图
    *  边界说明：colors 的色值是"商品内容数据"，不属于 UI 主题色，
    *  不受"色值只出现在 style.css :root"的约束
    */
  getShop() {
    return request('/api/shop');
  },
  /** 残局挑战关卡（M6.1 / M6.8）。返回 {easy:[×100], hard:[×100], hell:[×100]}
   *  关卡形状：{ id, mode, name, flavor, hint, preset, steps }
   *  数据由 tools/gen-puzzles.js 生成（puzzles-data.js，300 关已过内置裁判），
   *  H4 起后端 /api/puzzles 已上线，签名不变 */
  getPuzzles() {
    return request('/api/puzzles');
  },
  /** 残局进度上云（H4.3）：{puzzleId} → {cleared:[…]}；须登录 */
  postPuzzleProgress(puzzleId) {
    return request('/api/puzzle/progress', { method: 'POST', data: { puzzleId } });
  },
  /** 购买（H5）：{coins, owned:true, skins:{board,avatar}}；失败 toast e.message */
  buyItem(itemId) {
    return request('/api/shop/buy', { method: 'POST', data: { itemId } });
  },
  /** 应用皮肤（H5）：返回最新 skins 两键 */
  applySkin(itemId) {
    return request('/api/user/skin', { method: 'POST', data: { itemId } });
  },
  /** 读本页皮肤缓存某类（'board'|'avatar'），无则 null */
  cachedSkin(cat) {
    return loadSkinCache()[cat] || null;
  },
  /** 登录态刷新皮肤缓存：getUser 取 ids → getShop 色值 → 写缓存并注入，
   *  返回 user 对象（登录 null）；首页昵称/积分注入复用这次调用 */
  refreshSkins() {
    if (!Api.isLogin()) return Promise.resolve(null);
    return Api.getUser().then((u) => {
      if (!u || !u.skins) return u;
      return Api.getShop().then((items) => {
        const byId = {};
        items.forEach((it) => { byId[it.id] = it; });
        const c = loadSkinCache();
        delete c.stone; // 历史缓存里可能有棋子皮肤键，一并清掉
        ['board', 'avatar'].forEach((cat) => {
          const id = u.skins[cat];
          const it = id && byId[id];
          if (!it) { delete c[cat]; return; }
          if (it.img) c[cat] = { id: it.id, img: it.img };
          else if (it.colors) c[cat] = { id: it.id, colors: it.colors };
        });
        saveSkinCache(c);
        injectSkins(c);
        return u;
      }).catch(() => u);
    });
  },

  /* ---------- 公屏聊天（H7） ---------- */

  /** 发言（须登录；服务端做屏蔽词过滤与 1s 频控），返回本条消息 VO */
  chatSend(content) {
    return request('/api/chat/send', { method: 'POST', data: { content } });
  },
  /** 增量拉取：after=已渲染的最大 id（0=刚进房不回放历史，返回空） */
  chatRecent(after) {
    return request('/api/chat/recent?after=' + (after || 0));
  },

  /* ---------- 每日签到（含补签） ---------- */

  /** 签到面板。形状：{ checkedToday, cycleDay, monthDates:['2026-10-28'…],
   *  makeupDates:[…], rewards:[{coins,diamonds}×7], coins, diamonds, granted } */
  checkinPanel() {
    return request('/api/checkin');
  },
  /** 今日签到（返回最新面板 + granted 本次奖励） */
  checkinDo() {
    return request('/api/checkin/do', { method: 'POST' });
  },
  /** 补签（500 金币一次；date 形如 '2026-10-27'，只能补本月今天之前） */
  checkinMakeup(date) {
    return request('/api/checkin/makeup', { method: 'POST', data: { date } });
  },
};

/* ---------- mock（一期占位；二期随 USE_MOCK 一起删） ---------- */

/** 模拟 200ms 网络延迟，让空态 / loading 表现与真实接口一致 */
function mockRequest(path) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(MOCK[path] !== undefined ? MOCK[path] : null), 200);
  });
}

const MOCK = {
  '/api/rank': [],    // 空数组 → rank.html 显示空态（M3.10）
  '/api/history': [], // 空数组 → history.html 显示空态（M3.11）

  /* 商城商品（M5.1；棋子皮肤已移除，棋盘/头像）。默认款的 colors 与
     style.css :root 现值严格一致——应用默认皮肤时视觉与今天完全相同。
     带 img 的商品（M5.9）：预览直接显示图片，文件名与 id 无关 */
  '/api/shop': [
    /* —— 棋盘 —— */
    { id: 'board-default', cat: 'board', name: '原木', price: 0,
      colors: { '--board': '#E8C286', '--board-line': '#8B6B43' } },
    { id: 'board-walnut', cat: 'board', name: '胡桃木', price: 600,
      colors: { '--board': '#C89A5B', '--board-line': '#6B4A2A' } },
    { id: 'board-beech', cat: 'board', name: '浅榉', price: 400,
      colors: { '--board': '#F0D9A8', '--board-line': '#A8814F' } },
    { id: 'board-obsidian', cat: 'board', name: '曜石', price: 800,
      colors: { '--board': '#3A3F44', '--board-line': '#8A9299' } },
    { id: 'board-bamboo', cat: 'board', name: '竹青', price: 500,
      colors: { '--board': '#C9D2A5', '--board-line': '#6F7A4D' } },
    { id: 'board-lacquer', cat: 'board', name: '朱漆', price: 800,
      colors: { '--board': '#A8362B', '--board-line': '#5E1F18' } },
    /* —— 头像（M5.9：glyph 字符款整体换成 PNG 款；glyph 渲染保留作无 img 回落）—— */
    { id: 'avatar-buns', cat: 'avatar', name: '双丸子', price: 0,
      img: 'assets/avatars/avatar01.png' },
    { id: 'avatar-beard', cat: 'avatar', name: '络腮胡', price: 200,
      img: 'assets/avatars/avatar02.png' },
    { id: 'avatar-crop', cat: 'avatar', name: '短发郎', price: 200,
      img: 'assets/avatars/avatar03.png' },
    { id: 'avatar-braids', cat: 'avatar', name: '双辫丫丫', price: 300,
      img: 'assets/avatars/avatar04.png' },
    { id: 'avatar-pony', cat: 'avatar', name: '马尾琴琴', price: 300,
      img: 'assets/avatars/avatar05.png' },
    { id: 'avatar-bald', cat: 'avatar', name: '光头师父', price: 400,
      img: 'assets/avatars/avatar06.png' },
    { id: 'avatar-bob', cat: 'avatar', name: '波波阿姐', price: 400,
      img: 'assets/avatars/avatar07.png' },
  ],

  /* 残局挑战关卡（M6.8）：数据在 js/puzzles-data.js（生成器产出，300 关）。
      typeof 守卫：index.html 等不引数据文件的页面加载 api.js 时不报错 */
  '/api/puzzles': (typeof PUZZLE_DATA !== 'undefined' && PUZZLE_DATA) || [],

  /* 公屏聊天（H7）mock：recent 空态（前端回落本地欢迎语），send 走本地回音 */
  '/api/chat/recent': [],
  '/api/chat/send': null,
};

/* 皮肤缓存同步注入（H5）：api.js 先于 board.js 加载，
   保证对局页首帧棋盘/棋子即使用在用皮肤 */
(function () {
  try {
    injectSkins(loadSkinCache());
  } catch (e) { /* 忽略 */ }
})();
