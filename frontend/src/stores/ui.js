/* ==================================================
   ui store · 全局 UI 状态（替代旧 common.js 的 DOM 弹窗体系）

   - modalStack：弹窗栈。旧版 showModal 是命令式 DOM 追加，
     Vue 里改为栈驱动：<ModalHost> 按栈渲染，关一个少一个。
     栈项形状：{ id, title, body(html), buttons:[{text,type,block,disabled,onClick}],
                xAction, onClose }，与旧 showModal opts 一一对应
   - toast：单例提示（连续调用替换文案重置 2s 计时，行为同旧版）
   ================================================== */
import { defineStore } from 'pinia';

let seq = 0;

export const useUiStore = defineStore('ui', {
  state: () => ({
    modalStack: [],
    toastMsg: '',
    toastShow: false,
    _toastTimer: null,
    _toastSeq: 0,
  }),

  actions: {
    /**
     * 打开弹窗（对应旧 showModal）。
     * @param {Object} opts { title, body(html 或 VNode), bodyComponent(VNode),
     *                        buttons, xAction, onClose }
     *   buttons 元素：{ text, onClick(close 后执行), type:'primary',
     *                  block, disabled }；缺省单个"知道了"
     *   xAction：右上角 ✕ 的收尾动作（可选）——等待类弹窗（匹配/房间）
     *   点 ✕ 等同"取消匹配/解散房间"，由 ModalHost 先关弹窗再执行；
     *   不传则 ✕ 仅关闭弹窗（按钮语义不受影响）
     * @returns {Function} close 手动关闭句柄（幂等）
     */
    openModal(opts = {}) {
      const id = ++seq;
      let closed = false;
      const buttons = opts.buttons || [{ text: '知道了' }];
      this.modalStack.push({
        id,
        title: opts.title || '',
        body: opts.body || '',
        bodyComponent: opts.bodyComponent || null,
        buttons,
        xAction: typeof opts.xAction === 'function' ? opts.xAction : null,
        onClose: opts.onClose || null,
      });
      document.body.classList.add('modal-open');
      const close = () => {
        if (closed) return;
        closed = true;
        const i = this.modalStack.findIndex((m) => m.id === id);
        if (i >= 0) this.modalStack.splice(i, 1);
        if (!this.modalStack.length) document.body.classList.remove('modal-open');
        const cb = opts.onClose || null;
        if (typeof cb === 'function') cb();
      };
      // 把 close 挂到栈项上，ModalHost 点击按钮时取用（按钮回调统一走它）
      const item = this.modalStack[this.modalStack.length - 1];
      item.close = close;
      return close;
    },

    /** toast 轻提示：2s 自动消失；连续调用只显示最新一条 */
    showToast(msg) {
      this.toastMsg = String(msg == null ? '' : msg);
      this.toastShow = false;   // 先灭再亮：重播入场滑入动画
      this._toastSeq++;
      const mySeq = this._toastSeq;
      clearTimeout(this._toastTimer);
      this._toastTimer = null;
      /* 隐藏定时器必须在"亮起"的同时武装：后台标签页会挂起 rAF，
         若定时器在外面先跑完（rAF 恢复后才执行），toast 将永远不灭 */
      requestAnimationFrame(() => {
        if (mySeq !== this._toastSeq) return; // 已有更新的 toast 接管
        this.toastShow = true;
        this._toastTimer = setTimeout(() => { this.toastShow = false; }, 2000);
      });
    },
  },
});

/* 便捷别名：旧代码里 toast(msg) 全局函数的 Vue 等价物 */
export function toast(msg) {
  useUiStore().showToast(msg);
}
