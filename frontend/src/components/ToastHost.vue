<script setup>
/* toast 宿主：单例节点，show 类切入场动画（同旧 toast 行为） */
import { useUiStore } from '../stores/ui';
const ui = useUiStore();
</script>

<template>
  <div class="toast" :class="{ 'toast--show': ui.toastShow }">{{ ui.toastMsg }}</div>
</template>
