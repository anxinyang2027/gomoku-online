/* ==================================================
   弹窗体系粘合层：把命令式弹窗（旧 common.js 的 show* 函数）
   适配到 Vue 组件树。

   实现方式：authVisible / accountVisible / checkinVisible /
   settingsVisible 是模块级响应式开关，HomeView 顶层的
   <AuthModal> 等组件按开关渲染。openAuthModal 仍以回调风格
   对外（旧代码形状不变）。
   ================================================== */
import { ref } from 'vue';
import { useUserStore } from '../stores/user';
import { toast } from '../stores/ui';

export const authVisible = ref(false);
export const accountVisible = ref(false);
export const checkinVisible = ref(false);
export const settingsVisible = ref(false);

let authCallback = null;
let accountLogoutCallback = null;

/**
 * 打开登录/注册弹窗（旧 showAuthModal(onLogin)）。
 * @param {Function} [onLogin] 登录成功回调（参数：登录应答）
 */
export function openAuthModal(onLogin) {
  authCallback = onLogin || null;
  authVisible.value = true;
}

export function onAuthSuccess(r) {
  const cb = authCallback;
  authCallback = null;
  if (typeof cb === 'function') cb(r);
}

/** 打开账号弹窗（旧 showAccountModal(user, onLogout)） */
export function openAccountModal(onLogout) {
  accountLogoutCallback = onLogout || null;
  accountVisible.value = true;
}

export function onLogoutConfirmed() {
  const cb = accountLogoutCallback;
  accountLogoutCallback = null;
  if (typeof cb === 'function') cb();
}
