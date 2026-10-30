<script setup>
/* 设置弹窗（旧 showSettings）：音效开关，即时写 localStorage */
import { ref } from 'vue';

const emit = defineEmits(['close']);
const soundOn = ref(localStorage.getItem('gomoku.sound') !== 'off');

function onChange() {
  localStorage.setItem('gomoku.sound', soundOn.value ? 'on' : 'off');
}
</script>

<template>
  <div class="modal-mask">
    <div class="modal-card" role="dialog" aria-modal="true">
      <button type="button" class="modal-x" aria-label="关闭" @click="emit('close')">
        <img src="/assets/sysytem/close.png" alt="">
      </button>
      <h2 class="modal-card__title">设置</h2>
      <div class="modal-card__body">
        <label class="settings-row">
          <span>音效</span>
          <input v-model="soundOn" type="checkbox" @change="onChange">
        </label>
      </div>
      <div class="modal-card__btns">
        <button type="button" class="btn btn--primary" @click="emit('close')">完成</button>
      </div>
    </div>
  </div>
</template>
