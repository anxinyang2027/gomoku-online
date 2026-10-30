<script setup>
/* 战绩（旧 history.html）：行形状 { win, opponent, time, moves } */
import { onMounted, ref } from 'vue';
import { Api } from '../lib/api';
import { toast } from '../stores/ui';

const list = ref(null); // null = 加载中；[] = 空态
const failed = ref(false);

onMounted(async () => {
  try {
    list.value = (await Api.getHistory()) || [];
  } catch (e) {
    failed.value = true;
    toast('加载失败，请稍后再试');
  }
});
</script>

<template>
  <header class="top-bar">
    <h1 class="top-bar__title">战绩</h1>
  </header>

  <main class="page">
    <div v-if="failed" class="empty"><p>加载失败</p><p class="empty__hint">请稍后再试</p></div>
    <div v-else-if="list && !list.length" class="empty"><p>暂无数据</p><p class="empty__hint">等待后端接入</p></div>
    <ul v-else-if="list" class="history-list">
      <li v-for="(g, i) in list" :key="i" class="history-row">
        <span class="history-row__tag" :class="g.win ? 'history-row__tag--win' : 'history-row__tag--lose'">
          {{ g.win ? '胜' : '负' }}
        </span>
        <span class="history-row__opp">对 {{ g.opponent }}</span>
        <span class="history-row__meta">{{ g.time }} · {{ g.moves }} 手</span>
      </li>
    </ul>
  </main>
</template>
