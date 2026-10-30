/* ==================================================
   gamesave.js · 刷新续局存档槽（localStorage）

   - 人机 / 本地双人 / 残局：对局进度本地自动存档，刷新即可回到该局
   - 在线/房间不落此槽：服务端为准，靠 join/room/create 的幂等接口找回
   - 各控制器在每手棋后写入，终局/认输/取消时清空
   ================================================== */

const KEYS = {
  bot: 'gomoku.save.bot',
  local: 'gomoku.save.local',
  puzzle: 'gomoku.save.puzzle',
};

/** 读存档槽；损坏/缺失返回 null */
export function loadSave(kind) {
  const key = KEYS[kind];
  if (!key) return null;
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v && typeof v === 'object' ? v : null;
  } catch (e) {
    return null;
  }
}

/** 写存档槽（自动盖上时间戳 ts，刷新后按最近活动选局恢复；写失败静默） */
export function saveTo(kind, data) {
  const key = KEYS[kind];
  if (!key || !data || typeof data !== 'object') return;
  try {
    localStorage.setItem(key,
      JSON.stringify(Object.assign({}, data, { ts: Date.now() })));
  } catch (e) { /* 满/隐私模式忽略 */ }
}

/** 清存档槽（终局 / 显式弃局时调用） */
export function clearSave(kind) {
  const key = KEYS[kind];
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch (e) { /* 忽略 */ }
}
