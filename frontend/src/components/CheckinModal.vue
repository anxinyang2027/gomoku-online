<script setup>
/* 每日签到弹窗（旧 showCheckinModal）：7 天奖励条 + 本月日历 + 补签 */
import { computed, onMounted, ref } from 'vue';
import { Api } from '../lib/api';
import { toast, useUiStore } from '../stores/ui';

const ui = useUiStore();

const emit = defineEmits(['close', 'change']);

const panel = ref(null);
const grantedLine = ref('');

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

function rewardText(r) {
  if (!r) return '';
  if (r.diamonds > 0) return r.diamonds + ' 钻石';
  return (r.coins || 0) + ' 金币';
}

function localDateStr(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

const calendar = computed(() => {
  if (!panel.value) return { cells: [] };
  const today = new Date();
  const todayStr = localDateStr(today);
  const signed = new Set((panel.value.monthDates || []).map(String));
  const makeup = new Set((panel.value.makeupDates || []).map(String));

  const cells = WEEK_LABELS.map((w) => ({ kind: 'head', label: w }));
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7; // 周一=0
  for (let i = 0; i < lead; i++) cells.push({ kind: 'blank' });
  const days = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  for (let d = 1; d <= days; d++) {
    const ds = localDateStr(new Date(today.getFullYear(), today.getMonth(), d));
    let kind = 'day';
    let mark = '';
    if (signed.has(ds)) { kind = 'signed'; mark = '✓'; }
    else if (ds === todayStr) kind = 'today';
    else if (makeup.has(ds)) kind = 'makeup';
    else if (ds > todayStr) kind = 'future';
    cells.push({ kind, date: ds, label: String(d), mark });
  }
  return { cells };
});

const rewardPos = computed(() =>
  panel.value ? Math.min(panel.value.cycleDay || 1, 7) : 1);

const canCheckin = computed(() =>
  panel.value && !panel.value.checkedToday);

onMounted(async () => {
  try {
    panel.value = await Api.checkinPanel();
  } catch (e) {
    toast(e.message || '签到面板加载失败');
    emit('close');
  }
});

function doAction(kind, date) {
  const req = kind === 'do' ? Api.checkinDo() : Api.checkinMakeup(date);
  req.then((p) => {
    const g = p.granted || {};
    grantedLine.value = (kind === 'do' ? '签到成功！' : '补签成功！') + ' 本次获得 ' + rewardText(g);
    toast(grantedLine.value);
    emit('change', p);
    panel.value = p;
  }).catch((e) => toast(e.message || '操作失败'));
}

/* 补签确认（小弹窗走 ui store，与主面板并存） */
function askMakeup(ds) {
  ui.openModal({
    title: '补签',
    body: '花 500 金币补签 ' + ds + ' ？<br>补签同样发放当天的周期奖励。',
    buttons: [
      { text: '取消' },
      { text: '补签', type: 'primary', onClick: () => doAction('makeup', ds) },
    ],
  });
}
</script>

<template>
  <div class="modal-mask">
    <div class="modal-card" role="dialog" aria-modal="true">
      <button type="button" class="modal-x" aria-label="关闭" @click="emit('close')">
        <img src="/assets/sysytem/close.png" alt="">
      </button>
      <h2 class="modal-card__title">每日签到</h2>
      <div v-if="panel" class="modal-card__body">
        <div class="ck">
          <div class="ck-chips">
            <div
              v-for="(r, i) in (panel.rewards || [])"
              :key="i"
              class="ck-chip"
              :class="{ 'ck-chip--now': i + 1 === rewardPos, 'ck-chip--done': i + 1 < rewardPos }"
            >
              <span class="ck-chip__day">第{{ i + 1 }}天</span>
              <span class="ck-chip__reward">{{ rewardText(r) }}</span>
            </div>
          </div>
          <div v-if="grantedLine" class="ck-granted">{{ grantedLine }}</div>
          <div class="ck-bal">
            金币 <b>{{ panel.coins != null ? panel.coins : '—' }}</b>
            · 钻石 <b>{{ panel.diamonds != null ? panel.diamonds : '—' }}</b>
          </div>
          <div class="ck-cal">
            <template v-for="(cell, i) in calendar.cells" :key="i">
              <span v-if="cell.kind === 'head'" class="ck-cell ck-cell--head">{{ cell.label }}</span>
              <span v-else-if="cell.kind === 'blank'" class="ck-cell ck-cell--blank"></span>
              <button
                v-else
                type="button"
                class="ck-cell"
                :class="'ck-cell--' + cell.kind"
                @click="cell.kind === 'makeup' && askMakeup(cell.date)"
              >{{ cell.label }}{{ cell.mark }}</button>
            </template>
          </div>
          <div class="ck-tip">漏签的日期可花 500 金币补签（点亮灰勾日）</div>
        </div>
      </div>
      <div v-if="panel" class="modal-card__btns">
        <button type="button" class="btn" @click="emit('close')">关闭</button>
        <button
          v-if="canCheckin"
          type="button"
          class="btn btn--primary"
          @click="doAction('do')"
        >签到领奖</button>
        <button v-else type="button" class="btn btn--disabled" disabled>今天已签到</button>
      </div>
    </div>
  </div>
</template>
