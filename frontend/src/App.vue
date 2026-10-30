<script setup>
/* App 外壳：路由出口 + 全局弹窗/toast 宿主（旧版挂在 body 的那批节点） */
import { onMounted } from 'vue';
import { useUserStore } from './stores/user';
import ModalHost from './components/ModalHost.vue';
import ToastHost from './components/ToastHost.vue';
import TabBar from './components/TabBar.vue';
import { injectSkinsOnBoot } from './lib/boot';

onMounted(() => {
  injectSkinsOnBoot();
  useUserStore().refresh(); // 顶栏昵称/积分/金币 + 皮肤注入
});
</script>

<template>
  <router-view />
  <TabBar />
  <ModalHost />
  <ToastHost />
</template>
