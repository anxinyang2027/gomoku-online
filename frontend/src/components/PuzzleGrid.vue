<script setup>
/* 残局选关网格（旧 puzzle.js 里手拼 100 个 button 的 Vue 化）：
   闯关闸门——已通关自由重玩、首个未通关放行、其余锁死 */
defineProps({
  levels: { type: Array, required: true },
  cleared: { type: Array, default: () => [] },
  openIdx: { type: Number, default: -1 },
});
const emit = defineEmits(['pick']);
</script>

<template>
  <div class="pz-grid">
    <button
      v-for="(lv, i) in levels"
      :key="lv.id"
      type="button"
      class="pz-grid__cell"
      :class="{
        'pz-grid__cell--cleared': cleared.includes(lv.id),
        'pz-grid__cell--locked': !cleared.includes(lv.id) && i !== openIdx,
      }"
      :disabled="!cleared.includes(lv.id) && i !== openIdx"
      @click="emit('pick', i)"
    >
      <template v-if="!cleared.includes(lv.id) && i !== openIdx">
        <img src="/assets/sysytem/lock.png" alt="未解锁"><span>{{ i + 1 }}</span>
      </template>
      <template v-else>{{ i + 1 }}</template>
    </button>
  </div>
</template>
