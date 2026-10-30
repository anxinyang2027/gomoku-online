import { createRouter, createWebHistory } from 'vue-router';

/**
 * 路由表（对应旧多页 index/rank/history/shop/game.html）：
 * - /game 保留旧 game.html 的查询参数习惯（?mode=bot|online|puzzle&level=…）
 * - meta.tab 存在的页面渲染底部导航（对局页无导航，与旧版一致）
 */
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('./views/HomeView.vue'), meta: { tab: 'home' } },
    { path: '/rank', name: 'rank', component: () => import('./views/RankView.vue'), meta: { tab: 'rank' } },
    { path: '/history', name: 'history', component: () => import('./views/HistoryView.vue'), meta: { tab: 'history' } },
    { path: '/shop', name: 'shop', component: () => import('./views/ShopView.vue'), meta: { tab: 'shop' } },
    { path: '/game', name: 'game', component: () => import('./views/GameView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
