<script setup>
/* 弹窗宿主：渲染 ui store 的 modalStack。
   点遮罩不关闭——关闭权只在按钮与右上角 ✕（防误触关掉结算/确认框），行为同旧 showModal */
import { nextTick, ref, watch } from 'vue';
import { useUiStore } from '../stores/ui';

const ui = useUiStore();
const firstBtnRefs = new Map(); // id -> 按钮元素（焦点移入用）

function onBtn(m, b) {
  m.close();
  if (typeof b.onClick === 'function') b.onClick();
}

/* 右上角 ✕：所有弹窗必备的关闭钮（防误点无路可退）。
   有 xAction 的等待弹窗（匹配中/房间组队）先关再走取消收尾，
   其余弹窗 ✕ 等同普通关闭 */
function onX(m) {
  const finish = typeof m.xAction === 'function' ? m.xAction : null;
  m.close();
  if (finish) finish();
}

// 新弹窗打开后把焦点移入首个可点按钮（键盘回车确认）
watch(() => ui.modalStack.length, () => {
  nextTick(() => {
    const top = ui.modalStack[ui.modalStack.length - 1];
    if (!top) return;
    const el = firstBtnRefs.get(top.id);
    if (el) el.focus();
  });
});
</script>

<template>
  <div v-for="m in ui.modalStack" :key="m.id" class="modal-mask">
    <div class="modal-card" role="dialog" aria-modal="true">
      <button type="button" class="modal-x" aria-label="关闭" @click="onX(m)">
        <img src="/assets/sysytem/close.png" alt="">
      </button>
      <h2 v-if="m.title" class="modal-card__title">{{ m.title }}</h2>
      <!-- bodyComponent（VNode，如选关网格）优先；body 为项目自备文案，沿用 v-html 同旧版 -->
      <component v-if="m.bodyComponent" :is="m.bodyComponent" class="modal-card__body" />
      <div v-else-if="m.body" class="modal-card__body" v-html="m.body"></div>
      <div v-if="m.buttons && m.buttons.length" class="modal-card__btns">
        <button
          v-for="(b, i) in m.buttons"
          :key="i"
          type="button"
          class="btn"
          :class="{
            'btn--primary': b.type === 'primary',
            'btn--block': b.block,
            'btn--disabled': b.disabled,
          }"
          :disabled="b.disabled"
          :ref="(el) => { if (i === 0 && el) firstBtnRefs.set(m.id, el); }"
          @click="!b.disabled && onBtn(m, b)"
        >{{ b.text }}</button>
      </div>
    </div>
  </div>
</template>
