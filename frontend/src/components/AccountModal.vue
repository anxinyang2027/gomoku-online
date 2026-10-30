<script setup>
/* 账号弹窗（旧 showAccountModal）：昵称/积分/金币 + 退出登录 + 签到入口 */
import { useUserStore } from '../stores/user';
import { onLogoutConfirmed, checkinVisible } from '../lib/useAuth';
import { toast } from '../stores/ui';

const emit = defineEmits(['close']);
const userStore = useUserStore();
const u = userStore.user || {};

function logout() {
  userStore.logout();
  toast('已退出登录');
  emit('close');
  onLogoutConfirmed();
}
</script>

<template>
  <div class="modal-mask">
    <div class="modal-card" role="dialog" aria-modal="true">
      <button type="button" class="modal-x" aria-label="关闭" @click="emit('close')">
        <img src="/assets/sysytem/close.png" alt="">
      </button>
      <h2 class="modal-card__title">我的账号</h2>
      <div class="modal-card__body">
        <div class="account-modal">
          <div class="account-modal__name">{{ u.name || '玩家' }}</div>
          <div class="account-modal__row"><span>积分</span><b>{{ u.score != null ? u.score : '—' }}</b></div>
          <div class="account-modal__row"><span>金币</span><b>{{ u.coins != null ? u.coins : '—' }}</b></div>
          <button type="button" class="account-modal__checkin" @click="emit('close'); checkinVisible = true">
            📅 每日签到 / 补签
          </button>
        </div>
      </div>
      <div class="modal-card__btns">
        <button type="button" class="btn" @click="logout">退出登录</button>
        <button type="button" class="btn btn--primary" @click="emit('close')">继续游戏</button>
      </div>
    </div>
  </div>
</template>
