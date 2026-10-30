/* 工具函数（旧 game.js 顶部平移） */
import { toast } from '../stores/ui';

/** ms → "mm:ss"（计时与结算共用同一格式） */
export function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

/** 复制文本到剪贴板（房间号分享）：优先剪贴板 API，降级选中文本域 */
export function copyText(text) {
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
