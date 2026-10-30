/* ==================================================
   api.js · 数据接口封装（自旧 static/js/api.js 平移）

   约定不变：
   - 页面一律通过本模块取数，不直接碰 fetch
   - 后端统一 { code, data } 包裹，在这里解开
   - 401 自动清 token；游客态不影响页面
   ================================================== */

const TOKEN_KEY = 'gomoku.token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch (e) {
    return null;
  }
}

export function setToken(token) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch (e) { /* 忽略 */ }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch (e) { /* 忽略 */ }
}

export function isLogin() {
  return !!getToken();
}

/* --------- 皮肤缓存：localStorage 同步注入，游戏页首帧即生效 --------- */

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
 * 统一请求封装：HTTP 非 2xx / 业务 code!=0 都抛 Error，
 * 页面永远只拿到业务数据或异常。
 */
async function request(path, { method = 'GET', data } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;

  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
    });
  } catch (e) {
    throw new Error('网络不可用，请稍后再试');
  }
  if (!res.ok) throw new Error('HTTP ' + res.status);

  const pkg = await res.json();
  if (pkg.code === 401) clearToken();
  if (pkg.code !== 0) throw new Error(pkg.msg || 'ERR ' + pkg.code);
  return pkg.data;
}

/* 对外接口（页面只认这些名字） */
export const Api = {
  /** 登录 / 注册（注册成功即登录） */
  login(name, password) {
    return request('/api/login', { method: 'POST', data: { name, password } });
  },
  register(name, password) {
    return request('/api/register', { method: 'POST', data: { name, password } });
  },
  /** 当前用户；未登录返回 null */
  getUser() {
    return request('/api/user');
  },
  isLogin,
  /** 我的排名：{ rank, score } */
  getRankMe() {
    return request('/api/rank/me');
  },
  /** 排行榜。行形状：{ name, score, avatarImg } 按分数降序 */
  getRank() {
    return request('/api/rank');
  },
  /** 战绩。行形状：{ win, opponent, time, moves } */
  getHistory() {
    return request('/api/history');
  },
  /** 对局结果上报（本地双人；服务端 Referee 重放校验） */
  submitResult(result) {
    return request('/api/result', { method: 'POST', data: result });
  },

  /* ---------- 人机对战 ---------- */
  botStart(difficulty) {
    return request('/api/game/bot/start', { method: 'POST', data: { difficulty } });
  },
  botMove(sessionId, r, c) {
    return request('/api/game/bot/move', { method: 'POST', data: { sessionId, r, c } });
  },
  botState(sessionId) {
    return request('/api/game/' + sessionId);
  },
  botUndo(sessionId) {
    return request('/api/game/bot/undo', { method: 'POST', data: { sessionId } });
  },
  botDraw(sessionId) {
    return request('/api/game/bot/draw', { method: 'POST', data: { sessionId } });
  },
  botStop(sessionId) {
    return request('/api/game/bot/stop/' + sessionId, { method: 'POST' });
  },

  /* ---------- 在线对战（HTTP 轮询，服务端权威） ---------- */
  onlineQueueJoin() {
    return request('/api/online/queue/join', { method: 'POST' });
  },
  onlineQueueStatus() {
    return request('/api/online/queue/status');
  },
  onlineQueueCancel() {
    return request('/api/online/queue/cancel', { method: 'POST' });
  },
  onlineRoomCreate() {
    return request('/api/online/room/create', { method: 'POST' });
  },
  onlineRoomStatus() {
    return request('/api/online/room/status');
  },
  onlineRoomJoin(code) {
    return request('/api/online/room/join', { method: 'POST', data: { code } });
  },
  onlineState(gameId) {
    return request('/api/online/game/' + gameId);
  },
  onlineMove(gameId, r, c) {
    return request('/api/online/game/move', { method: 'POST', data: { gameId, r, c } });
  },
  onlineResign(gameId) {
    return request('/api/online/game/resign', { method: 'POST', data: { gameId } });
  },
  onlineDraw(gameId) {
    return request('/api/online/game/draw', { method: 'POST', data: { gameId } });
  },
  onlineDrawReject(gameId) {
    return request('/api/online/game/draw/reject', { method: 'POST', data: { gameId } });
  },
  onlineUndo(gameId) {
    return request('/api/online/game/undo', { method: 'POST', data: { gameId } });
  },
  onlineUndoAnswer(gameId, agree) {
    return request('/api/online/game/undo/answer', { method: 'POST', data: { gameId, agree } });
  },

  /* ---------- 商城 / 皮肤 ---------- */
  getShop() {
    return request('/api/shop');
  },
  buyItem(itemId) {
    return request('/api/shop/buy', { method: 'POST', data: { itemId } });
  },
  applySkin(itemId) {
    return request('/api/user/skin', { method: 'POST', data: { itemId } });
  },
  cachedSkin(cat) {
    return loadSkinCache()[cat] || null;
  },
  /** 登录态刷新皮肤缓存：getUser → getShop 色值 → 写缓存并注入，返回 user */
  refreshSkins() {
    if (!isLogin()) return Promise.resolve(null);
    return Api.getUser().then((u) => {
      if (!u || !u.skins) return u;
      return Api.getShop().then((items) => {
        const byId = {};
        items.forEach((it) => { byId[it.id] = it; });
        const c = loadSkinCache();
        delete c.stone;
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

  /* ---------- 残局 ---------- */
  getPuzzles() {
    return request('/api/puzzles');
  },
  postPuzzleProgress(puzzleId) {
    return request('/api/puzzle/progress', { method: 'POST', data: { puzzleId } });
  },

  /* ---------- 聊天（公屏/对局频道） ---------- */
  chatSend(content, channel) {
    return request('/api/chat/send', {
      method: 'POST',
      data: channel ? { content, channel } : { content },
    });
  },
  chatRecent(after, channel) {
    let url = '/api/chat/recent?after=' + (after || 0);
    if (channel) url += '&channel=' + encodeURIComponent(channel);
    return request(url);
  },

  /* ---------- 每日签到 ---------- */
  checkinPanel() {
    return request('/api/checkin');
  },
  checkinDo() {
    return request('/api/checkin/do', { method: 'POST' });
  },
  checkinMakeup(date) {
    return request('/api/checkin/makeup', { method: 'POST', data: { date } });
  },
};

/* 皮肤缓存同步注入：main.js 引入本模块即生效，保证对局页首帧即用上皮肤 */
injectSkins(loadSkinCache());
