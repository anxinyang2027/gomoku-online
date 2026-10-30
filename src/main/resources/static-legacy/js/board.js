/* ==================================================
   board.js · 棋盘渲染与交互（纯渲染，不含规则）

   分层契约（test2.txt M1）：
   - 本文件只管"画"和"点到了哪个交叉点"，不知道胜负/回合/规则
   - game.js 通过下面的对外接口驱动；二期判定挪到后端时本文件不动
   - 画布一切用色从 css/style.css 的自定义属性读取（_cssVar），
     兑现"改色一处生效"（M0.3 约定）

   数据格式（全项目统一）：
   - stones / cells：[{ r, c, color }]，r/c 为 0–14 格点下标，color：1=黑 2=白
   - stones 数组按落子顺序排列（draw 的 last 参数即数组下标）
   ================================================== */
'use strict';

class Board {
  /**
   * @param {HTMLCanvasElement} canvas 棋盘画布；边长取父容器宽度，
   *   父容器约定无 padding/边框（宽度即棋盘边长，M1.2）
   * @param {Object} [opts]
   * @param {number} [opts.size=15] 棋盘路数（每边格点数）
   * @param {number} [opts.dpr] 调试用：强制设备像素比（M1.3 验收时传 1/2/3 对比清晰度）
   */
  constructor(canvas, opts = {}) {
    /** @type {HTMLCanvasElement} */
    this.canvas = canvas;
    /** @type {CanvasRenderingContext2D} */
    this.ctx = canvas.getContext('2d');

    /** 棋盘路数（game.js 一律读 board.size，15 不写第二遍） */
    this.size = opts.size || 15;

    /** 调试用：强制 dpr；缺省跟随 window.devicePixelRatio（M1.3） */
    this._dprOverride = opts.dpr || null;

    /** 矩形开关（>1 = 横向矩形棋盘）：值为 1 时仍按正方形绘制；
     *  开启后高度以父容器实高为准、宽度由外层 fitArena 写定，
     *  棋盘不缩高、不缩格距，只在左右加宽出对称木边带 */
    this.aspect = opts.aspect && opts.aspect > 1 ? opts.aspect : 1;

    /* —— 尺寸与常量（M1.2 / M1.3 填充）—— */
    /** cssSize：CSS 像素边长；dpr：devicePixelRatio；margin：竖向留边；cellX/cellY：横/纵格距 */
    this.cssSize = 0;
    this.dpr = 1;
    this.margin = 0;
    /** 横向留边（比 margin 多出左右木边带；正方形棋盘时与 margin 相等） */
    this.marginX = 0;
    /** 格宽：cellX/cellY = 横向、纵向相邻交叉点中心距（正方形时相等，
     *  矩形棋盘左右加宽后格子本身也横向拉长——下棋区域真正变大） */
    this.cellX = 0;
    this.cellY = 0;

    /* —— 绘制状态缓存（resize 时自主重绘用，game.js 不感知）—— */
    this._stones = [];
    this._last = -1;
    /** 五连高亮格点与闪烁定时器（M1.13）；_winBlinkOn = 闪烁当前相位是否亮着 */
    this._winCells = null;
    this._winTimer = null;
    this._winBlinkOn = true;

    /** 落子动画状态（M1.9）：_animIndex = 正在动画的棋子下标，-1 = 无 */
    this._animIndex = -1;
    this._animScale = 1;
    this._animTimer = null;

    /* —— 交互状态 —— */
    /** 锁盘：点击与 hover 预览全部失效（M1.12） */
    this.locked = false;
    /** hover 预览棋子颜色：1 | 2 | null，null = 不预览（M1.11） */
    this.previewColor = null;
    /** 当前悬停的格点（或 null），M1.11 */
    this._hoverCell = null;

    /* —— 事件回调（单槽，后订阅覆盖先订阅；本项目只有 game.js 一个订阅者）—— */
    this._cellClickCb = null;
    this._hoverCb = null;

    this._handleResize();
    this._bindEvents();
    window.addEventListener('resize', () => this._handleResize());
  }

  /* ==================================================
     对外接口（game.js 只允许碰这些）
     ================================================== */

  /**
   * 全量重绘（M1.4–M1.10 实现）。
   * 语义 = 整体替换棋盘状态：清除五连高亮、停掉闪烁定时器；
   * 若 stones 比上次多一颗 → 新子播 150ms 落子动画（M1.9），
   * resize 引起的重绘不播动画。
   * @param {Array}  stones  全部棋子 [{r, c, color}]，按落子顺序
   * @param {number} [last]  最后一手在 stones 中的下标，-1 = 不标红点
   */
  draw(stones = [], last = -1) {
    // M1.9：恰好比上次多一颗 → 最后一手播落子动画；变少或持平（悔棋、
    // 重开、全量替换）不播，且掐掉进行中的动画。先比长度再存副本，
    // 因为调用方可能原地改同一个数组后反复传入
    const dropIn = stones.length === this._stones.length + 1;
    if (!dropIn && this._animTimer) {
      cancelAnimationFrame(this._animTimer);
      this._animTimer = null;
      this._animIndex = -1;
      this._animScale = 1;
    }
    this._stones = stones.slice();
    this._last = last;
    this._winCells = null;
    if (this._winTimer) {
      clearInterval(this._winTimer);
      this._winTimer = null;
    }
    this._redraw();
    if (dropIn) this._animateDrop(stones.length - 1);
  }

  /**
   * 五连胜利高亮（M1.13）：棋子描边强调 + 朱红连线贯穿首尾，
   * 闪烁 3 次后定格（内部 setInterval，自清）。
   * 在对局结束、最后一次 draw 之后调用。
   * @param {Array} cells 获胜连子 [{r, c, color}]
   */
  highlightWin(cells) {
    if (this._winTimer) clearInterval(this._winTimer);
    this._winCells = cells;
    // M1.13：亮灭交替 3 轮（1.5s）后定格在常亮；draw() 会停掉本定时器
    let tick = 0;
    this._winBlinkOn = true;
    this._winTimer = setInterval(() => {
      tick++;
      this._winBlinkOn = tick % 2 === 0;
      if (tick >= 6) {
        clearInterval(this._winTimer);
        this._winTimer = null;
        this._winBlinkOn = true; // 定格常亮
      }
      this._redraw();
    }, 250);
    this._redraw();
  }

  /** 锁盘（M1.12）：点击无效、无 hover 预览，等对方落子时用 */
  lock() {
    this.locked = true;
    // 锁盘即清 hover 预览（预览三条件之一是未锁盘）
    if (this._hoverCell) {
      this._hoverCell = null;
      if (this._hoverCb) this._hoverCb(null);
      this._redraw();
    }
  }

  /** 解锁 */
  unlock() {
    this.locked = false;
  }

  /**
   * 设置 hover 预览棋子颜色（M1.11），game.js 每次换手时调用
   * @param {number|null} color 1=黑 2=白，null = 不预览
   */
  setPreviewColor(color) {
    this.previewColor = color;
    // 悬停中换手：预览子立即跟着换色
    if (this._hoverCell) this._redraw();
  }

  /**
   * 订阅落子点击（M1.12 触发；pointerup，锁盘时不出）
   * @param {(cell: {r: number, c: number}) => void} cb
   */
  onCellClick(cb) {
    this._cellClickCb = cb;
  }

  /**
   * 订阅格点悬停（M1.11 触发，仅 pointerType === 'mouse'）
   * @param {(cell: {r: number, c: number} | null) => void} cb  null = 移出棋盘
   */
  onHover(cb) {
    this._hoverCb = cb;
  }

  /* ==================================================
     内部实现（槽位，按任务号填肉）
     ================================================== */

  /** M1.2 / M1.3：画布尺寸——父容器宽度定边长，HiDPI 适配，
   *  重算 margin/cellX/cellY 常量并按缓存状态重绘；resize 时被反复调用 */
  _handleResize() {
    // M1.2：边长 = 父容器宽度（父容器约定无 padding，见类注释）
    const cssSize = Math.floor(this.canvas.parentElement.getBoundingClientRect().width);
    if (cssSize <= 0) return; // 父容器未布局（隐藏等），等下次 resize 再算

    // M1.3：HiDPI——物理像素 = CSS 像素 × dpr，此后一律按 CSS 像素坐标画。
    // setTransform 显式重置变换，不用 ctx.scale：scale 是叠加语义，
    // 不依赖"给 canvas.width 赋值会顺带重置矩阵"这种隐式行为
    const dpr = this._dprOverride || window.devicePixelRatio || 1;
    this.cssSize = cssSize;
    this.dpr = dpr;
    // 矩形棋盘：高度=父容器实高（剩余高，与正方形时一致，上下不变），
    // 宽度=父容器实宽（fitArena 已按列宽写定）；父容器没有实高（小屏非弹性
    // 布局）时退回正方形，避免尺寸联动出错
    let cssW = cssSize;
    let cssH = cssSize;
    const pr = this.canvas.parentElement.getBoundingClientRect();
    if (this.aspect > 1 && pr.height >= 240) {
      cssW = Math.floor(pr.width);
      cssH = Math.floor(pr.height);
    }
    // 中列被宽度上限压住、反而装不下正方形时，退回正方形，避免网格被裁
    if (cssW < cssH) cssH = cssW;
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // M1.2：竖向留边 = 一格(cellY)，格距由高度决定；
    // 横向格距 = 画布宽减去左右各一格(cellY)后平分——正方形时恰好等于
    // cellY（渲染与旧版一致）；矩形棋盘左右加宽后格子本身横向拉长，
    // 网格真正铺满宽度，"下棋的地方"随宽度变大
    this.cellY = cssH / (this.size + 1);
    this.margin = this.cellY;
    this.marginX = this.cellY;
    this.cellX = (cssW - this.cellY * 2) / (this.size - 1);

    this._redraw(); // 尺寸变化后位图已清空，按缓存状态重画
  }

  /** M1.11 / M1.12：Pointer Events 统一鼠标与触摸 */
  _bindEvents() {
    const canvas = this.canvas;

    // M1.12：触摸落子时页面不许跟着滚。由组件自己设置（而非依赖 CSS），
    // 保证 Board 拿到任何 canvas 都行为正确
    canvas.style.touchAction = 'none';

    // M1.12：pointerup 落子（比 pointerdown 抗误触）。
    // 触摸指针会被隐式捕获到 canvas，pointerup 可能发生在画布外——
    // 记下按下位置，抬起时位移超过半格 = 拖动/滚动意图，取消；
    // 真正滑出棋盘的由 _pxToCell 越界返回 null 兜底
    let down = null;
    canvas.addEventListener('pointerdown', (e) => {
      down = e.button === 0 ? { x: e.offsetX, y: e.offsetY } : null;
    });
    canvas.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.offsetX - down.x, e.offsetY - down.y);
      down = null;
      if (this.locked) return; // 锁盘不落子
      if (moved > Math.min(this.cellX, this.cellY) * 0.5) return; // 位移过大 = 非点击
      const pos = this._pxToCell(e.offsetX, e.offsetY);
      if (pos && this._cellClickCb) this._cellClickCb(pos);
    });
    canvas.addEventListener('pointercancel', () => {
      down = null; // 系统打断手势（来电、手掌误触等）
    });

    // M1.11：hover 预览，仅鼠标。画预览的条件：mouse + 空格点 + 未锁盘
    // + previewColor 非 null；任一不满足即视为"无预览格点"（传 null）
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      let cell = null;
      if (!this.locked && this.previewColor) {
        const pos = this._pxToCell(e.offsetX, e.offsetY);
        if (pos && !this._isOccupied(pos)) cell = pos;
      }
      const same = cell && this._hoverCell &&
        cell.r === this._hoverCell.r && cell.c === this._hoverCell.c;
      if (same) return; // 格点没变不重绘，move 事件不刷屏
      this._hoverCell = cell;
      if (this._hoverCb) this._hoverCb(cell);
      this._redraw();
    });

    // M1.11：移出画布清预览
    canvas.addEventListener('pointerleave', () => {
      if (!this._hoverCell) return;
      this._hoverCell = null;
      if (this._hoverCb) this._hoverCb(null);
      this._redraw();
    });
  }

  /** M1.11：格点是否已有棋子（hover 预览不画在占位上） */
  _isOccupied(cell) {
    return this._stones.some((s) => s.r === cell.r && s.c === cell.c);
  }

  /** M1.4–M1.10 / M1.13：真正往画布上画东西的唯一入口，
   *  draw / highlightWin 闪烁 / resize 都走这里，保证层叠顺序一致 */
  _redraw() {
    this._drawBase();     // M1.4：木色底 + 外框
    this._drawGrid();     // M1.5：网格线
    this._drawStars();    // M1.6：星位
    this._drawStones();   // M1.8：棋子（M1.9 落子动画也挂在这层）
    this._drawLastMark(); // M1.10：最后一手红点
    this._drawHover();    // M1.11：hover 预览
    this._drawWin();      // M1.13：五连高亮
  }

  /** M1.4：木色底 + 贴最外圈网格线的加粗外框 */
  _drawBase() {
    const { ctx, cssSize, margin, marginX, cellX, cellY, size } = this;
    ctx.fillStyle = this._cssVar('--board');
    ctx.fillRect(0, 0, cssSize, Math.round(margin * 2 + (size - 1) * cellY));
    // 2px 外框：坐标取整，线身正好落在整像素上
    ctx.strokeStyle = this._cssVar('--board-line');
    ctx.lineWidth = 2;
    const gridX = (size - 1) * cellX;
    const gridY = (size - 1) * cellY;
    ctx.strokeRect(Math.round(marginX), Math.round(margin),
      Math.round(gridX), Math.round(gridY));
  }

  /** M1.5：横竖各 size 条细线；1px 线用"取整 + 0.5"对齐像素边界，dpr=1 不发糊。
   *  矩形棋盘：横向线距/起止用 cellX/marginX，纵向用 cellY/margin */
  _drawGrid() {
    const { ctx, margin, marginX, cellX, cellY, size } = this;
    const startY = Math.round(margin) + 0.5;
    const endY = Math.round(margin + (size - 1) * cellY) + 0.5;
    const startX = Math.round(marginX) + 0.5;
    const endX = Math.round(marginX + (size - 1) * cellX) + 0.5;
    ctx.strokeStyle = this._cssVar('--board-line');
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < size; i++) {
      const pw = Math.round(marginX + i * cellX) + 0.5;
      const ph = Math.round(margin + i * cellY) + 0.5;
      ctx.moveTo(startX, ph);
      ctx.lineTo(endX, ph); // 横线
      ctx.moveTo(pw, startY);
      ctx.lineTo(pw, endY); // 竖线
    }
    ctx.stroke();
  }

  /** M1.6：星位（四角星 + 天元略大）；15 路即 (3,3)(3,11)(11,3)(11,11)(7,7) */
  _drawStars() {
    const { ctx } = this;
    const s = Math.floor((this.size - 1) / 4); // 15 路 → 3
    const e = this.size - 1 - s;               // 15 路 → 11
    const mid = (this.size - 1) / 2;           // 奇数路数才有天元
    const pts = [[s, s], [s, e], [e, s], [e, e]];
    if (Number.isInteger(mid)) pts.push([mid, mid]);
    ctx.fillStyle = this._cssVar('--board-line');
    pts.forEach(([r, c]) => {
      const { x, y } = this._cellToPx(r, c);
      const isTengen = r === mid && c === mid;
      ctx.beginPath();
      ctx.arc(x, y, this.cellY * (isTengen ? 0.15 : 0.11), 0, Math.PI * 2);
      ctx.fill();
    });
  }

  /** M1.8：全部棋子——黑子左上高光渐变 / 白子微灰渐变 + 深色细描边 */
  _drawStones() {
    const radius = Math.min(this.cellX, this.cellY) * 0.45; // 直径 ≈ 0.9 × 小格距，矩形下棋子不变形
    this._stones.forEach((s, i) => {
      const { x, y } = this._cellToPx(s.r, s.c);
      // M1.9：动画中的那颗按当前缩放画，其余原大
      const r = i === this._animIndex ? radius * this._animScale : radius;
      this._drawStone(x, y, r, s.color);
    });
  }

  /** M1.9：落子动画——新子 150ms 缩放 1.3 → 1.0（easeOutCubic），
   *  逐帧整体重绘；连点时掐掉旧动画、旧子立即归位 */
  _animateDrop(index) {
    if (this._animTimer) {
      cancelAnimationFrame(this._animTimer);
      this._animTimer = null;
      this._animIndex = -1;
      this._animScale = 1;
    }
    if (index < 0 || index >= this._stones.length) return;
    this._animIndex = index;
    const start = performance.now();
    const DUR = 150;
    const tick = (now) => {
      const t = Math.min((now - start) / DUR, 1);
      this._animScale = 1.3 - 0.3 * (1 - Math.pow(1 - t, 3)); // 1.3 → 1.0
      this._redraw();
      if (t < 1) {
        this._animTimer = requestAnimationFrame(tick);
      } else {
        this._animTimer = null;
        this._animIndex = -1;
        this._animScale = 1;
      }
    };
    this._animTimer = requestAnimationFrame(tick);
  }

  /** M1.8：画单颗棋子。径向渐变：黑子左上亮心，白子亮到微灰 + 细描边防隐形 */
  _drawStone(x, y, radius, color) {
    const { ctx } = this;
    // 渐变圆心偏左上，高光自然出现在左上方
    const grad = ctx.createRadialGradient(
      x - radius * 0.4, y - radius * 0.4, radius * 0.1,
      x, y, radius
    );
    if (color === 1) {
      grad.addColorStop(0, this._cssVar('--stone-black-hi'));
      grad.addColorStop(1, this._cssVar('--stone-black'));
    } else {
      grad.addColorStop(0, this._cssVar('--stone-white'));
      grad.addColorStop(1, this._cssVar('--stone-white-shade'));
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    if (color === 2) {
      // 白子在木色上不描边会"化"进背景
      ctx.strokeStyle = this._cssVar('--stone-edge');
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  /** M1.10：最后一手（this._stones[this._last]）叠朱红小点 */
  _drawLastMark() {
    if (this._last < 0 || this._last >= this._stones.length) return;
    const s = this._stones[this._last];
    const { x, y } = this._cellToPx(s.r, s.c);
    this.ctx.fillStyle = this._cssVar('--accent');
    this.ctx.beginPath();
    this.ctx.arc(x, y, this.cellY * 0.12, 0, Math.PI * 2);
    this.ctx.fill();
  }

  /** M1.11：hover 半透明预览子（this._hoverCell + this.previewColor）。
   *  落子后原格立即失效（已占），鼠标再动才换格 */
  _drawHover() {
    if (!this._hoverCell || !this.previewColor) return;
    if (this._isOccupied(this._hoverCell)) return;
    const { x, y } = this._cellToPx(this._hoverCell.r, this._hoverCell.c);
    this.ctx.save();
    this.ctx.globalAlpha = 0.4;
    this._drawStone(x, y, Math.min(this.cellX, this.cellY) * 0.45, this.previewColor);
    this.ctx.restore();
  }

  /** M1.13：五连棋子描边强调 + 朱红首尾贯穿线（this._winCells）；
   *  闪烁的灭相位整体不画，亮相位全画，定格时保持常亮 */
  _drawWin() {
    const cells = this._winCells;
    if (!cells || !cells.length || !this._winBlinkOn) return;
    const { ctx } = this;
    const mc = Math.min(this.cellX, this.cellY); // 矩形棋盘按小格距控制线宽/棋子圈
    ctx.lineCap = 'round';
    // 贯穿线：首尾两颗的中心连线（cells 按序排列，首尾即两端）
    const head = this._cellToPx(cells[0].r, cells[0].c);
    const tail = this._cellToPx(cells[cells.length - 1].r, cells[cells.length - 1].c);
    ctx.strokeStyle = this._cssVar('--accent');
    ctx.lineWidth = Math.max(2, mc * 0.12);
    ctx.beginPath();
    ctx.moveTo(head.x, head.y);
    ctx.lineTo(tail.x, tail.y);
    ctx.stroke();
    // 棋子描边强调
    ctx.strokeStyle = this._cssVar('--stone-win-edge');
    ctx.lineWidth = Math.max(2, mc * 0.08);
    cells.forEach(({ r, c }) => {
      const { x, y } = this._cellToPx(r, c);
      ctx.beginPath();
      ctx.arc(x, y, mc * 0.45, 0, Math.PI * 2);
      ctx.stroke();
    });
  }

  /** M1.7：像素 → 最近交叉点（四舍五入吸附，不做容差判断），越界返回 null。
   *  矩形棋盘横向用 marginX 定位，其余一致 */
  _pxToCell(x, y) {
    const c = Math.round((x - this.marginX) / this.cellX);
    const r = Math.round((y - this.margin) / this.cellY);
    if (r < 0 || c < 0 || r >= this.size || c >= this.size) return null;
    return { r, c };
  }

  /** M1.7：格点 → 交叉点像素中心。星位/棋子/连线/预览共用，不许各写一套 */
  _cellToPx(r, c) {
    return { x: this.marginX + c * this.cellX, y: this.margin + r * this.cellY };
  }

  /** 画布用色唯一来源：读 css/style.css 自定义属性，如 this._cssVar('--board') */
  _cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
}
