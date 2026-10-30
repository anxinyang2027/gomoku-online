<script setup>
/* 商城（旧 shop.html）：页签分组 + 购买/使用/使用中按钮态 */
import { computed, onMounted, ref } from 'vue';
import { Api } from '../lib/api';
import { toast } from '../stores/ui';
import { useUserStore } from '../stores/user';

const userStore = useUserStore();

const items = ref([]);
const owned = ref(new Set());
const skins = ref({});
const activeCat = ref('board');
const failed = ref(false);

const cats = [
  { key: 'board', label: '棋盘' },
  { key: 'avatar', label: '头像' },
];
const byCat = computed(() => {
  const map = { board: [], avatar: [] };
  items.value.forEach((it) => { if (map[it.cat]) map[it.cat].push(it); });
  return map;
});

onMounted(async () => {
  try {
    items.value = (await Api.getShop()) || [];
  } catch (e) {
    failed.value = true;
    toast('加载失败，请稍后再试');
    return;
  }
  if (Api.isLogin()) {
    try {
      const u = await Api.getUser();
      if (u) {
        owned.value = new Set(u.owned || []);
        skins.value = u.skins || {};
      }
    } catch (e) { /* 网络抖动保持游客态展示 */ }
  }
  Api.refreshSkins().catch(() => {});
});

/* 按钮态：inuse / use / buy / default（同旧 buttonState） */
function buttonState(item) {
  if (Api.isLogin()) {
    if (skins.value[item.cat] === item.id) return 'inuse';
    if (owned.value.has(item.id) || item.price === 0) return 'use';
  }
  return item.price > 0 ? 'buy' : 'default';
}

async function buyItem(item) {
  try {
    const r = await Api.buyItem(item.id);
    toast('购买成功，花费 ' + item.price + (isDiamond(item) ? ' 钻石' : ' 金币'));
    owned.value = new Set([...owned.value, item.id]);
    if (r.skins) skins.value = r.skins;
    await Api.refreshSkins();
    userStore.refresh(); // 顶栏金币/钻石余额同步
  } catch (err) {
    toast(err.message || '购买失败，请稍后再试');
  }
}

async function useItem(item) {
  try {
    skins.value = await Api.applySkin(item.id);
    await Api.refreshSkins();
    userStore.refresh(); // 顶栏头像/余额同步（换头像立即生效）
    toast('已应用「' + item.name + '」');
  } catch (err) {
    toast(err.message || '操作失败，请稍后再试');
  }
}

function onBuy(item) {
  if (Api.isLogin()) buyItem(item);
  else toast('请先登录');
}

/** 该商品是否钻石计价（后端缺省 coin） */
function isDiamond(item) {
  return item.currency === 'diamond';
}

/* 无 img 商品的 SVG 预览（同旧 previewBoard/previewAvatar） */
function boardSvg(item) {
  const b = item.colors['--board'];
  const l = item.colors['--board-line'];
  let s = '<rect width="64" height="64" fill="' + b + '"/>';
  for (let i = 0; i <= 6; i++) {
    const p = 8 + i * 8;
    s += '<line x1="8" y1="' + p + '" x2="56" y2="' + p + '" stroke="' + l + '" stroke-width="1"/>';
    s += '<line x1="' + p + '" y1="8" x2="' + p + '" y2="56" stroke="' + l + '" stroke-width="1"/>';
  }
  s += '<circle cx="24" cy="32" r="4.5" style="fill:var(--stone-black)"/>';
  s += '<circle cx="40" cy="24" r="4.5" style="fill:var(--stone-white);stroke:var(--stone-edge);stroke-width:0.8"/>';
  return s;
}

function avatarSvg(item) {
  const c = item.colors || {};
  return '<circle cx="32" cy="32" r="20" fill="' + (c['--avatar-bg'] || '#888') + '"/>' +
    '<text x="32" y="32" text-anchor="middle" dominant-baseline="central" font-size="20" fill="' + (c['--avatar-fg'] || '#fff') + '">' + (item.glyph || '?') + '</text>';
}

function previewSvg(item) {
  return item.cat === 'board' ? boardSvg(item) : avatarSvg(item);
}

/* 数据库存的 img 是 'assets/…'（无前导斜杠）。SPA 下相对路径会挂在
   当前路由下（/shop/assets/…）解析错误，统一补成根绝对路径 */
function imgUrl(p) {
  if (!p) return p;
  return p.startsWith('/') ? p : '/' + p;
}

/* img 加载失败 → 中性灰问号占位（同旧 buildPreview 的 onerror） */
const PLACEHOLDER = '<circle cx="32" cy="32" r="18" fill="none" stroke="var(--text-dim)" stroke-width="2"/>' +
  '<text x="32" y="32" text-anchor="middle" dominant-baseline="central" font-size="18" fill="var(--text-dim)">?</text>';
const imgBroken = ref(new Set());
function onImgErr(itemId) {
  imgBroken.value = new Set([...imgBroken.value, itemId]);
}
</script>

<template>
  <header class="top-bar">
    <h1 class="top-bar__title">商城</h1>
  </header>

  <main class="page">
    <div v-if="failed" class="empty"><p>加载失败</p><p class="empty__hint">请稍后再试</p></div>
    <div v-else-if="items && !items.length" class="empty"><p>暂无数据</p><p class="empty__hint">等待后端接入</p></div>
    <template v-else>
      <ul class="shop-tabs">
        <li
          v-for="c in cats"
          :key="c.key"
          class="shop-tabs__item"
          :class="{ 'is-active': activeCat === c.key }"
          @click="activeCat = c.key"
        >{{ c.label }}</li>
      </ul>

      <section v-for="c in cats" v-show="activeCat === c.key" :key="c.key" class="shop-section">
        <h2 class="shop-section__title">{{ c.label }}</h2>
        <div class="shop-grid">
          <div v-for="item in byCat[c.key]" :key="item.id" class="shop-card" :data-skin-id="item.id">
            <div class="shop-card__preview">
              <img
                v-if="item.img && !imgBroken.has(item.id)"
                class="shop-card__img"
                :src="imgUrl(item.img)"
                :alt="item.name + '预览图'"
                loading="lazy"
                @error="onImgErr(item.id)"
              >
              <svg v-else viewBox="0 0 64 64" style="display:block;width:100%;height:100%" v-html="item.img ? PLACEHOLDER : previewSvg(item)"></svg>
            </div>
            <div class="shop-card__name">{{ item.name }}</div>
            <button
              v-if="buttonState(item) === 'inuse'"
              type="button"
              class="shop-card__buy shop-card__buy--default"
              disabled
            >使用中</button>
            <button
              v-else-if="buttonState(item) === 'use'"
              type="button"
              class="shop-card__buy"
              @click="useItem(item)"
            >使用</button>
            <button
              v-else-if="buttonState(item) === 'buy'"
              type="button"
              class="shop-card__buy"
              :class="{ 'shop-card__buy--diamond': isDiamond(item) }"
              @click="onBuy(item)"
            >{{ item.price }} {{ isDiamond(item) ? '钻石' : '金币' }}</button>
            <button
              v-else
              type="button"
              class="shop-card__buy shop-card__buy--default"
              disabled
            >默认</button>
          </div>
        </div>
      </section>
    </template>
  </main>
</template>
