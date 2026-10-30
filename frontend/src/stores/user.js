/* ==================================================
   user store · 登录态与顶栏数据（替代旧各页 refreshTopbar/applyUser）

   - user：登录后 { name, score, coins, diamonds, skins, owned }；游客 null
   - refresh()：Api.refreshSkins 的包装（顺带换肤注入），各页复用
   - logout()：清 token + 回游客态
   ================================================== */
import { defineStore } from 'pinia';
import { Api, clearToken, getToken } from '../lib/api';

export const useUserStore = defineStore('user', {
  state: () => ({
    user: null,
    loaded: false, // 首次 refresh 完成后置位（顶栏避免闪"游客"）
    skinVersion: 0, // 皮肤缓存版本：refresh 后自增，驱动 avatarImg 重算
  }),

  getters: {
    isLogin: () => !!getToken(),
    avatarImg(state) {
      void state.skinVersion; // 建立响应式依赖（cachedSkin 读 localStorage，本身不响应）
      const av = Api.cachedSkin('avatar');
      return (av && av.img) || '/assets/avatars/avatar01.png';
    },
  },

  actions: {
    /** 拉当前用户（含皮肤缓存刷新）；退出/未登录回游客态 */
    async refresh() {
      if (!getToken()) {
        this.user = null;
        this.loaded = true;
        return null;
      }
      try {
        this.user = await Api.refreshSkins();
      } catch (e) {
        this.user = null; // token 失效等：401 已在 api 层清掉
      }
      this.skinVersion++; // 皮肤缓存可能已变（换头像/换棋盘），头像 getter 失效重算
      this.loaded = true;
      return this.user;
    },

    /** 退出登录：清 token 回游客态（金币钻石归零显示） */
    logout() {
      clearToken();
      this.user = null;
    },
  },
});
