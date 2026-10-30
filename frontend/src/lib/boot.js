/* 皮肤缓存同步注入：模块加载即注入一次（对局页首帧棋盘即用上皮肤）。
   皮肤色值写 CSS 变量 --board 等，board.js 画布从 getComputedStyle 读 */
import { Api } from './api';

export function injectSkinsOnBoot() {
  // api.js 模块加载时已注入缓存；这里留给将来启动期扩展，保持空实现开销为零
}
