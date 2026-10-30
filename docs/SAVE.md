# 五子棋前端 · 项目存档

> 更新：2026-10-15 · 进度 57/70（81%）· 权威清单见 test2.txt（勾选状态即真相）

## 这是什么

五子棋 Web 前端（`gomoku-web/`）：原生 HTML/CSS/JS，无框架无构建，**双击 index.html 即可运行**。移动端优先（480px 居中），深色棋馆风，15×15 Canvas 棋盘。规划为多期推进：一期本地双人 → 二期接后端 → 三期用户系统 → 四期在线对战 → 五期商城点亮。

## 已完成

**M0 骨架（8/8）**：5 页统一模板、CSS 令牌色板（色值只出现在 :root 一处）、480px 布局、`showModal` 弹窗（点遮罩不关）/ `toast` / `renderNav` 底部导航（各页 `<nav data-nav="xx">` 自动渲染）。

**M1 棋盘 board.js（14/15）**：Canvas 15×15，HiDPI 适配（setTransform，dpr 可强制 1/2/3 验收），木色底/网格/星位，坐标双向换算（吸附点击），渐变棋子，落子缩放动画（150ms），最后一手红点，hover 预览（仅鼠标），五连高亮+红线闪烁，lock()/unlock()。

**M2 对局 game.js（14/15）**：落子主链路、checkWin（仅从最后一手查 4 向，二期挪后端只动它）、平局、结算弹窗、Date.now() 差值计时、悔棋/求和/认输/退出确认、Web Audio 合成落子音（开关存 localStorage `gomoku.sound`）。

**M3 页面（11/11）**：首页（用户条游客态 + 模式卡片"敬请期待"置灰）、对局页、登录（非空校验+"三期开放"）、排行榜/战绩（空态+mock）。api.js：`USE_MOCK=true`，接口名定死 login/register/getUser/getRank/getHistory/submitResult/getShop。

**M4 部分（3/6）**：复盘模式（上下步回放）、交互细节（锁滚动等）、代码清理。

**M5 商城（7/8，2026-10-15 新增）**：底部第 4 个 tab = 商城（顶替"设置"，入口收进首页 ⚙）。shop.html 三分区 14 商品（棋盘6/棋子4/头像4），纯 CSS/SVG 预览图（无图片文件），价格按钮 toast"敬请期待"，卡片带 `data-skin-id` 钩子。**皮肤=一组 CSS 变量，五期 setProperty 注入即换肤，board.js 零改动**。

## 待办（13 项，全是人工验收 + 小活）

- **7 项浏览器/真机走查**：M1.15 棋盘目检、M2.15 对局全链路、M3.12 五页闭环、M4.2 响应式（360–PC）、M4.4 再来一局洁净、M4.6 真机玩一局、M5.8 商城验收
- M4.2 / M4.4 两项小活
- 平局验收捷径：临时 `new Board(canvas, {size: 3})`，9 手必满即触发平局结算

## 关键约定（改动前必读）

1. 色值只出现在 style.css `:root`（商品 colors 除外——那是数据）
2. board.js 不懂规则；game.js 只走 board 对外接口；页面只调 Api 不碰 fetch
3. 15 不硬编码第二遍（读 `board.size`）
4. 弹窗点遮罩不关闭，关闭权只在按钮
5. JS 改完跑 `node --check` 验证

## 环境

- VS Code 调试：launch.json 已配 Chrome（路径显式指定）+ Edge 备用，F5 可起；不调试就直接双击 HTML
- localStorage keys：`gomoku.sound`（音效开关）
