/* ==================================================
   common.js · 公共组件
   showModal       通用弹窗（M0.5）
   toast           轻提示（M0.6）
   renderNav       底部导航（M0.7）
   showSettings    设置弹窗（M3.5；M5.6 导航撤掉"设置"tab 后仅首页 ⚙ 使用）
   showAuthModal   登录/注册弹窗（原 login.html 整页跳转改弹窗）
   showAccountModal 账号弹窗（登录后点头像：积分金币 + 退出登录）
   showCheckinModal 每日签到弹窗（7 天奖励周期 + 补签，须登录）
   均为全局函数：无构建工具，各页面直接调用
   ================================================== */
'use strict';

/**
 * 通用弹窗（M0.5）
 * 半透明遮罩 + 居中卡片；点遮罩不关闭——关闭权只在按钮，
 * 防止误触关掉结算框/确认框。
 *
 * @param {Object} opts
 * @param {string} opts.title          标题
 * @param {string} [opts.body]         内容（HTML 字符串，可省略）
 * @param {Array}  [opts.buttons]      按钮数组，元素：
 *   {string}   text      按钮文字
 *   {Function} [onClick] 点击回调（弹窗已关闭后执行）
 *   {string}   [type]    'primary' = 朱红主按钮，缺省为次级样式
 *   {boolean}  [block]   true = 独占一行整宽（结算弹窗"再来一局"的布局）
 *   {boolean}  [disabled] true = 置灰不可点（一期 [复盘] 按钮，M4.1 激活）
 *   不传 buttons 时默认渲染单个"知道了"
 * @returns {Function} close 手动关闭句柄（极少用到；按钮点击后已自动关闭）
 */
function showModal({ title = '', body = '', buttons } = {}) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';

  const card = document.createElement('div');
  card.className = 'modal-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');

  const titleEl = document.createElement('h2');
  titleEl.className = 'modal-card__title';
  titleEl.textContent = title;
  card.appendChild(titleEl);

  if (body) {
    const bodyEl = document.createElement('div');
    bodyEl.className = 'modal-card__body';
    bodyEl.innerHTML = body; // 内容为项目自备文案，非用户输入
    card.appendChild(bodyEl);
  }

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.body.classList.remove('modal-open'); // 解锁背景滚动
    mask.remove();
  };

  // 底部按钮：缺省单个"知道了"；buttons: [] = 无底栏按钮（表单弹窗，按钮都在 body 里）
  let list = [{ text: '知道了' }];
  if (buttons) list = buttons;
  let firstBtn = null;
  if (list.length) {
    const btnsEl = document.createElement('div');
    btnsEl.className = 'modal-card__btns';
    list.forEach((b) => {
      const btn = document.createElement('button');
      btn.type = 'button'; // 防止在表单里被当成提交按钮
      btn.className =
        'btn' +
        (b.type === 'primary' ? ' btn--primary' : '') +
        (b.block ? ' btn--block' : '');
      btn.textContent = b.text;
      if (b.disabled) btn.classList.add('btn--disabled');
      btn.addEventListener('click', () => {
        close();
        if (typeof b.onClick === 'function') b.onClick();
      });
      btnsEl.appendChild(btn);
    });
    card.appendChild(btnsEl);
    firstBtn = btnsEl.querySelector('button');
  }

  mask.appendChild(card);
  document.body.appendChild(mask);
  document.body.classList.add('modal-open'); // 锁背景滚动（M4.3 验收项）

  // 焦点移入首个按钮，键盘用户回车即可确认
  // （表单弹窗无底栏按钮，焦点由调用方自理）
  if (firstBtn) firstBtn.focus();

  // 表单弹窗要往卡片里接事件（如 showAuthModal），把节点挂出来
  close.card = card;
  close.mask = mask;

  return close;
}

/* toast 定时器句柄（单例状态） */
let toastTimer = null;

/**
 * toast 轻提示（M0.6）
 * 顶部滑入、2s 自动消失；复用同一 DOM 节点，
 * 连续调用只显示最新一条（替换文案、重置计时、重播入场动画）。
 *
 * @param {string} msg 提示文案
 */
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  // 正在展示时又来一条：先摘掉可见类 → 强制回流 → 再加回，
  // 这样入场滑入动画能重新播一遍，而不是只换文字
  el.classList.remove('toast--show');
  void el.offsetWidth;
  el.classList.add('toast--show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('toast--show'), 2000);
}

/* ---------- 底部导航（M0.7） ---------- */

/* 内联 SVG 图标（约定：图标尽量内联 SVG 少放文件）；stroke 用 currentColor，随文字变色 */
const NAV_ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M6 8v13h12V8"/></svg>',
  rank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8"/><path d="M12 14v7"/><path d="M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M7 6H4v1a3 3 0 0 0 3 3"/><path d="M17 6h3v1a3 3 0 0 1-3 3"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  shop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
};

const NAV_ITEMS = [
  { key: 'home', label: '首页', href: 'index.html' },
  { key: 'rank', label: '排行榜', href: 'rank.html' },
  { key: 'history', label: '战绩', href: 'history.html' },
  { key: 'shop', label: '商城', href: 'shop.html' }, // M5.6：商城顶替"设置"位；设置入口收进首页 ⚙
];

/**
 * 底部导航（M0.7；M5.6 商城顶替"设置"位）
 * 生成 4 个 tab：首页 / 排行榜 / 战绩 / 商城，全部渲染成 <a> 跳页。
 * active：'home' | 'rank' | 'history' | 'shop' 高亮当前页；
 * 登录/对局页不传，无高亮。"设置"不再是 tab——入口收进首页左上 ⚙。
 *
 * 页面一般不用手动调用——在 <nav class="tab-bar" data-nav="…"> 上
 * 标注当前页即可，见文件底部的自动渲染。
 */
function renderNav(active) {
  const bar = document.querySelector('.tab-bar');
  if (!bar) return;
  bar.innerHTML = '';
  NAV_ITEMS.forEach((item) => {
    const isActive = item.key === active;
    const el = document.createElement('a');
    el.href = item.href;
    el.className = 'tab-bar__item' + (isActive ? ' tab-bar__item--active' : '');
    if (isActive) el.setAttribute('aria-current', 'page');
    el.innerHTML = NAV_ICONS[item.key] + '<span>' + item.label + '</span>';
    bar.appendChild(el);
  });
}

/**
 * 设置弹窗（M3.5）：一期仅"音效"一项。
 * 切换即时写 localStorage（key：gomoku.sound，'off' = 关，缺省开），
 * game.js 的 Sound 每次播放前现读——无需事件同步，后改的立即生效。
 */
function showSettings() {
  const KEY = 'gomoku.sound';
  const soundOn = localStorage.getItem(KEY) !== 'off';
  showModal({
    title: '设置',
    body:
      '<label class="settings-row"><span>音效</span>' +
      '<input type="checkbox" id="settings-sound"' + (soundOn ? ' checked' : '') + '></label>',
    buttons: [{ text: '完成', type: 'primary' }],
  });
  document.getElementById('settings-sound').addEventListener('change', function () {
    localStorage.setItem(KEY, this.checked ? 'on' : 'off');
  });
}

/* ---------- 登录/注册弹窗（原 login.html 整页跳转改为弹窗） ---------- */

/** 弹窗内所有 <input>（含动态切登录/注册后的新节点）统一焦点样式 */
function focusAuthInputs(mask) {
  mask.querySelectorAll('.auth-form__input').forEach((el) => {
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const ok = mask.querySelector('.auth-ok'); // 主按钮
      if (ok) ok.click();
    });
  });
}

/**
 * 登录/注册弹窗：登录/注册一键切换，成功后回调 onLogin(user)。
 * 与原 login.html 同一套逻辑（注册成功即登录拿 token），
 * 但不再整页跳转——弹窗关掉原地留在当前页，顶栏由回调刷新。
 * @param {Function} [onLogin] 登录成功回调（参数：UserVO）；缺省刷新当前页
 */
function showAuthModal(onLogin) {
  function open(mode, errMsg, prefillName, prefillPwd) {
    const isReg = mode === 'register';
    const close = showModal({
      title: isReg ? '注册' : '登录',
      body:
        '<button type="button" class="modal-x" aria-label="关闭">' +
          '<img src="assets/sysytem/close.png" alt="">' +
        '</button>' +
        '<div class="auth-form auth-form--modal">' +
          '<input class="auth-form__input" id="auth-name" type="text" placeholder="用户名"' +
            ' autocomplete="username" maxlength="20">' +
          '<input class="auth-form__input" id="auth-pwd" type="password" placeholder="密码"' +
            ' autocomplete="' + (isReg ? 'new-password' : 'current-password') + '" maxlength="40">' +
          (errMsg ? '<div class="auth-err"></div>' : '') +
          '<button class="btn btn--primary btn--block auth-ok" type="button" id="auth-submit">' +
            (isReg ? '注 册' : '登 录') + '</button>' +
          '<button type="button" class="auth-form__switch" id="auth-switch">' +
            (isReg ? '已有账号？登录' : '没有账号？注册') + '</button>' +
        '</div>',
      buttons: [], // 按钮都在 body 里，卡片不放底部按钮
    });

    const mask = close.mask; // showModal 挂出的遮罩节点（表单控件都挂在这棵树里）
    const card = close.card;
    const name = mask.querySelector('#auth-name');
    const pwd = mask.querySelector('#auth-pwd');
    const submit = mask.querySelector('#auth-submit');
    const switchBtn = mask.querySelector('#auth-switch');
    const errEl = mask.querySelector('.auth-err');

    // 右上角 ✕：不登录直接退出弹窗（游客也有拒绝的权利）
    card.querySelector('.modal-x').addEventListener('click', () => close());

    // 预填值走节点赋值，不拼 HTML 属性（值里的引号/尖括号不会破坏结构）
    if (prefillName) name.value = prefillName;
    if (prefillPwd) pwd.value = prefillPwd;
    if (errEl && errMsg) errEl.textContent = errMsg;
    const currentName = () => (name.value || '').trim();
    const currentPwd = () => pwd.value || '';

    // 切换/重开都是"关旧卡 → 开新卡"，用户名密码带回新卡不重敲
    const reopen = (nextMode, errMsg) => {
      close();
      open(nextMode, errMsg, currentName(), currentPwd());
    };

    name.focus();
    focusAuthInputs(mask);

    switchBtn.addEventListener('click', () => {
      reopen(isReg ? 'login' : 'register', ''); // 保留已填用户名
    });

    submit.addEventListener('click', async () => {
      if (!name.value.trim()) { toast('请输入用户名'); name.focus(); return; }
      if (!pwd.value) { toast('请输入密码'); pwd.focus(); return; }
      submit.disabled = true;
      try {
        let r;
        if (isReg) {
          await Api.register(name.value.trim(), pwd.value);
          r = await Api.login(name.value.trim(), pwd.value); // 注册成功即登录
        } else {
          r = await Api.login(name.value.trim(), pwd.value);
        }
        try { localStorage.setItem('gomoku.token', r.token); } catch (err) { /* 忽略 */ }
        toast(isReg ? '注册成功' : '登录成功');
        close();
        Api.refreshSkins().catch(() => {});
        if (typeof onLogin === 'function') onLogin(r);
        else setTimeout(() => { location.reload(); }, 400);
      } catch (err) {
        reopen(mode, err.message || '操作失败，请稍后再试');
      }
    });
  }

  open('login');
}

/**
 * 账号弹窗（登录后点顶栏头像）：昵称/积分/金币 + 退出登录。
 * @param {Object} user UserVO（{ name, score, coins }）
 * @param {Function} onLogout 退出登录回调（token 已清）
 */
function showAccountModal(user, onLogout) {
  const u = user || {};
  const close = showModal({
    title: '我的账号',
    body:
      '<div class="account-modal">' +
        '<div class="account-modal__name"></div>' +
        '<div class="account-modal__row"><span>积分</span><b class="account-modal__score"></b></div>' +
        '<div class="account-modal__row"><span>金币</span><b class="account-modal__coins"></b></div>' +
        '<button type="button" class="account-modal__checkin">📅 每日签到 / 补签</button>' +
      '</div>',
    buttons: [
      { text: '退出登录', onClick: () => {
        try { localStorage.removeItem('gomoku.token'); } catch (e) { /* 忽略 */ }
        toast('已退出登录');
        if (typeof onLogout === 'function') onLogout();
        else setTimeout(() => { location.reload(); }, 400);
      } },
      { text: '继续游戏', type: 'primary' },
    ],
  });
  // 昵称等服务端字段走 textContent，不拼 HTML（防注入）
  const card = close.card;
  card.querySelector('.account-modal__name').textContent = u.name || '玩家';
  card.querySelector('.account-modal__score').textContent = (u.score != null ? u.score : '—');
  card.querySelector('.account-modal__coins').textContent = (u.coins != null ? u.coins : '—');
  // 签到快捷入口：自动弹关掉后想再签/补签，从这里手动开
  const ck = card.querySelector('.account-modal__checkin');
  if (ck) ck.addEventListener('click', () => {
    if (typeof showCheckinModal === 'function') showCheckinModal();
  });
}

/* ---------- 每日签到弹窗（7 天奖励周期 + 本月日历 + 补签） ---------- */

/**
 * 签到弹窗：
 * - 顶部 7 天奖励条（第 1–6 天金币、第 7 天钻石），当前周期位置高亮
 * - 中部本月日历：已签亮勾、可补签日可点（500 金币/次）、未来置灰
 * - 今天未签：弹窗自动就是"点我签到"主按钮态；已签则显示明日再来
 * 接口错误（未登录等）直接 toast，弹窗不开。
 * @param {Function} [onChange] 签到/补签成功后回调（参数：最新面板数据）
 */
function showCheckinModal(onChange) {
  let closePanel = null; // 当前签到面板的 close 句柄（重绘前先关旧卡）

  Api.checkinPanel().then((p) => {
    render(p);
  }).catch((e) => toast(e.message || '签到面板加载失败'));

  const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

  function rewardText(r) {
    if (!r) return '';
    if (r.diamonds > 0) return r.diamonds + ' 钻石';
    return (r.coins || 0) + ' 金币';
  }

  /** 本地日期 → 'YYYY-MM-DD'（toISOString 是 UTC，东八区凌晨会差一天） */
  function localDateStr(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function render(p, grantedLine) {
    const today = new Date();
    const todayStr = localDateStr(today);
    const signed = new Set((p.monthDates || []).map(String));
    const makeup = new Set((p.makeupDates || []).map(String));
    // 重绘前先关旧签到弹窗（签到/补签成功后重开面板，避免两层叠窗）
    if (closePanel) closePanel();

    // 7 天奖励条：位置 = 本周期已走到的那天（签完今天后服务端会+1）
    const pos = Math.min(p.cycleDay || 1, 7);
    const chips = (p.rewards || []).map((r, i) => {
      const n = i + 1;
      const cls = 'ck-chip' + (n === pos ? ' ck-chip--now' : '') + (n < pos ? ' ck-chip--done' : '');
      return '<div class="' + cls + '"><span class="ck-chip__day">第' + n + '天</span>' +
        '<span class="ck-chip__reward">' + rewardText(r) + '</span></div>';
    }).join('');

    // 本月日历：周一起排（与奖励周期对齐）；1 号前的空位补齐
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7; // 周一=0
    const days = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    let cells = WEEK_LABELS.map((w) => '<span class="ck-cell ck-cell--head">' + w + '</span>').join('');
    for (let i = 0; i < lead; i++) cells += '<span class="ck-cell ck-cell--blank"></span>';
    for (let d = 1; d <= days; d++) {
      const ds = localDateStr(new Date(today.getFullYear(), today.getMonth(), d));
      let cls = 'ck-cell';
      let mark = '';
      if (signed.has(ds)) { cls += ' ck-cell--signed'; mark = '✓'; }
      else if (ds === todayStr) cls += ' ck-cell--today';
      else if (makeup.has(ds)) cls += ' ck-cell--makeup';
      else if (ds > todayStr) cls += ' ck-cell--future';
      cells += '<button type="button" class="' + cls + '" data-date="' + ds + '">' + d + mark + '</button>';
    }

    const canCheckin = !p.checkedToday;
    closePanel = showModal({
      title: '每日签到',
      body:
        '<div class="ck">' +
          '<div class="ck-chips">' + chips + '</div>' +
          (grantedLine ? '<div class="ck-granted">' + grantedLine + '</div>' : '') +
          '<div class="ck-bal">金币 <b>' + (p.coins != null ? p.coins : '—') + '</b>' +
            ' · 钻石 <b>' + (p.diamonds != null ? p.diamonds : '—') + '</b></div>' +
          '<div class="ck-cal">' + cells + '</div>' +
          '<div class="ck-tip">漏签的日期可花 500 金币补签（点亮灰勾日）</div>' +
        '</div>',
      buttons: [
        { text: '关闭' },
        canCheckin
          ? { text: '签到领奖', type: 'primary', onClick: () => doAction('do') }
          : { text: '今天已签到', disabled: true },
      ],
    });

    // 可补签日点击 → 确认弹窗 → 扣金币补签
    document.querySelectorAll('.ck-cell--makeup').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ds = btn.dataset.date;
        showModal({
          title: '补签',
          body: '花 500 金币补签 ' + ds + ' ？<br>补签同样发放当天的周期奖励。',
          buttons: [
            { text: '取消' },
            { text: '补签', type: 'primary', onClick: () => doAction('makeup', ds) },
          ],
        });
      });
    });
  }

  function doAction(kind, date) {
    const req = kind === 'do' ? Api.checkinDo() : Api.checkinMakeup(date);
    req.then((p) => {
      const g = p.granted || {};
      const line = (kind === 'do' ? '签到成功！' : '补签成功！') + ' 本次获得 ' + rewardText(g);
      toast(line.replace(/<[^>]+>/g, ''));
      if (typeof onChange === 'function') onChange(p);
      render(p, line);
    }).catch((e) => toast(e.message || '操作失败'));
  }
}

/* 自动渲染（M0.7）：页面只管在 nav 上标 data-nav，不必各自写调用代码 */
document.addEventListener('DOMContentLoaded', () => {
  const bar = document.querySelector('.tab-bar');
  if (bar) renderNav(bar.dataset.nav);
});
