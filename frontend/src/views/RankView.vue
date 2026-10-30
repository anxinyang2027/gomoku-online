<script setup>
/* 排行榜（旧 rank.html）：头像有 avatarImg 显示图片，缺省/加载失败回落首字圆圈 */
import { onMounted, ref } from 'vue';
import { Api } from '../lib/api';
import { toast } from '../stores/ui';

const list = ref([]);
const failed = ref(false);
const myRank = ref(null);

onMounted(async () => {
  try {
    list.value = (await Api.getRank()) || [];
  } catch (e) {
    failed.value = true;
    toast('加载失败，请稍后再试');
  }
  if (Api.isLogin()) {
    try { myRank.value = await Api.getRankMe(); } catch (e) { /* 未登录端点 401 → 兜底不显示 */ }
  }
});

/* 图片加载失败：整节点替换回首字（与旧 onerror 行为一致） */
function onImgErr(ev, name) {
  ev.target.outerHTML = name.charAt(0);
}
</script>

<template>
  <header class="top-bar">
    <h1 class="top-bar__title">排行榜</h1>
  </header>

  <main class="page">
    <div v-if="failed" class="empty"><p>加载失败</p><p class="empty__hint">请稍后再试</p></div>
    <div v-else-if="!list.length" class="empty"><p>暂无数据</p><p class="empty__hint">等待后端接入</p></div>
    <ul v-else class="rank-list">
      <li
        v-for="(u, i) in list"
        :key="u.id"
        class="rank-row"
        :class="{ 'rank-row--top': i < 3 }"
      >
        <span class="rank-row__no">{{ i + 1 }}</span>
        <span class="rank-row__avatar" aria-hidden="true">
          <img
            v-if="u.avatarImg"
            :src="u.avatarImg.startsWith('/') ? u.avatarImg : '/' + u.avatarImg"
            alt=""
            loading="lazy"
            @error="onImgErr($event, u.name)"
          >
          <template v-else>{{ u.name.charAt(0) }}</template>
        </span>
        <span class="rank-row__name">{{ u.name }}</span>
        <span class="rank-row__score">{{ u.score }} 分</span>
      </li>
    </ul>
    <div v-if="myRank" class="my-rank">我的排名：{{ myRank.rank }} · {{ myRank.score }} 分</div>
  </main>
</template>
