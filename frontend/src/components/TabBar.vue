<script setup>
/* 底部导航（旧 common.js renderNav）：router-link 替代 <a href>；
   仅 meta.tab 页面渲染（对局页无导航，同旧版） */
import { useRoute } from 'vue-router';

const route = useRoute();

/* 内联 SVG 图标：stroke 用 currentColor，随文字变色 */
const NAV_ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M6 8v13h12V8"/></svg>',
  rank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8"/><path d="M12 14v7"/><path d="M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M7 6H4v1a3 3 0 0 0 3 3"/><path d="M17 6h3v1a3 3 0 0 1-3 3"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  shop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
};

const NAV_ITEMS = [
  { key: 'home', label: '首页', to: '/' },
  { key: 'rank', label: '排行榜', to: '/rank' },
  { key: 'history', label: '战绩', to: '/history' },
  { key: 'shop', label: '商城', to: '/shop' },
];
</script>

<template>
  <nav v-if="route.meta.tab" class="tab-bar">
    <router-link
      v-for="item in NAV_ITEMS"
      :key="item.key"
      :to="item.to"
      class="tab-bar__item"
      :class="{ 'tab-bar__item--active': route.meta.tab === item.key }"
      :aria-current="route.meta.tab === item.key ? 'page' : undefined"
    >
      <span v-html="NAV_ICONS[item.key]"></span><span>{{ item.label }}</span>
    </router-link>
  </nav>
</template>
