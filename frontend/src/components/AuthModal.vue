<script setup>
/* 登录/注册弹窗（旧 common.js showAuthModal）：一键切换，成功后回调 onLogin */
import { ref } from 'vue';
import { Api, setToken } from '../lib/api';
import { useUiStore, toast } from '../stores/ui';

const emit = defineEmits(['login', 'close']);
const ui = useUiStore();

const mode = ref('login');        // login | register
const name = ref('');
const pwd = ref('');
const errMsg = ref('');
const busy = ref(false);

function switchMode() {
  mode.value = mode.value === 'login' ? 'register' : 'login';
  errMsg.value = '';
}

async function submit() {
  if (!name.value.trim()) { toast('请输入用户名'); return; }
  if (!pwd.value) { toast('请输入密码'); return; }
  busy.value = true;
  const isReg = mode.value === 'register';
  try {
    if (isReg) await Api.register(name.value.trim(), pwd.value);
    const r = await Api.login(name.value.trim(), pwd.value);
    setToken(r.token);
    toast(isReg ? '注册成功' : '登录成功');
    emit('login', r);
    emit('close');
  } catch (err) {
    errMsg.value = err.message || '操作失败，请稍后再试';
    busy.value = false;
  }
}
</script>

<template>
  <div class="modal-mask" @click.self="() => {}">
    <div class="modal-card" role="dialog" aria-modal="true">
      <button type="button" class="modal-x" aria-label="关闭" @click="emit('close')">
        <img src="/assets/sysytem/close.png" alt="">
      </button>
      <h2 class="modal-card__title">{{ mode === 'register' ? '注册' : '登录' }}</h2>
      <div class="modal-card__body">
        <div class="auth-form auth-form--modal">
          <input
            v-model="name"
            class="auth-form__input"
            type="text"
            placeholder="用户名"
            autocomplete="username"
            maxlength="20"
            @keydown.enter="submit"
          >
          <input
            v-model="pwd"
            class="auth-form__input"
            type="password"
            placeholder="密码"
            :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
            maxlength="40"
            @keydown.enter="submit"
          >
          <div v-if="errMsg" class="auth-err">{{ errMsg }}</div>
          <button class="btn btn--primary btn--block" type="button" :disabled="busy" @click="submit">
            {{ mode === 'register' ? '注 册' : '登 录' }}
          </button>
          <button type="button" class="auth-form__switch" @click="switchMode">
            {{ mode === 'register' ? '已有账号？登录' : '没有账号？注册' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
