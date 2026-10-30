# KITTY 主题落地 · UI 图片资源清单

皮肤 CSS（`static/css/style.css` 尾部「KITTY 皮肤覆盖层」）以本地路径引用以下贴图。
**图片缺失时自动用奶油底色兜底，不会出现破图**——先把 UI 跑起来，再按清单逐步补图即可。
现有图片目录 `static/assets/`（avatars/、stones/ 商城商品图）继续沿用，不在本清单内。

## 放置位置

统一放入 `src/main/resources/static/assets/ui/`（目录可自行新建），
同时复制一份到 `target/classes/static/assets/ui/`（或跑 `mvn process-resources` 同步）。

## 清单

| # | 文件名 | 用途 | 建议尺寸 | 必要性 | 缺图兜底 |
|---|--------|------|----------|--------|----------|
| 1 | `bg.jpg` | 全站铺底奶油场景图（body cover 满屏， Kitt 场景/壁纸） | ≥1600×1000 JPG | 推荐 | 奶油圆点底纹 |
| 2 | `topbar.jpg` | 顶栏横条纹理（米白布纹/格子，水平重复的横幅） | 750×120 JPG | 可选 | 浅奶油纯色 |
| 3 | `img-panel.jpeg` | 弹窗卡片头部横幅纹理（米黄纹理贴图） | 640×200 JPG | 可选 | 浅奶油纯色 |
| 4 | `sticker-bow.png` | 首页用户条右上角蝴蝶结贴纸 | 96×96 透明 PNG | 可选 | 不显示（CSS 已埋好挂点） |
| 5 | `empty.png` | 空态页提示小猫贴图 | 240×240 透明 PNG | 可选 | 不显示（需配套追加 `.empty::after` 一段 CSS） |
| 6 | `icon-nav-home/rank/history/shop.png` | 底部导航图标贴图版（如不用现有内联 SVG 线条风） | 96×96 透明 PNG ×4 | 可选 | 内联 SVG（现用） |
| 7 | `avatar-default.png` | 登录/游客默认头像（替换内联人形 SVG） | 512×512 透明 PNG | 可选 | 内联 SVG（现用） |
| 8 | `btn-gear.png` | 设置齿轮贴图版 | 128×128 透明 PNG | 可选 | 内联 SVG（现用） |
| 9 | `btn-arrow-left.png` | 退出按钮左侧箭头贴图版 | 128×128 透明 PNG | 可选 | 内联 SVG（现用） |

> 说明：1–3 为换装的主件（背景/顶栏/弹窗头部）；4–9 为可选增强位。
> 卡片右下角爪印、选中格打勾等小装饰已用**内联 data-URI SVG** 内置，不占清单、肯定能显示。

## emoji 替换情况（本次已完成）

| 原符号 | 位置 | 处理 |
|--------|------|------|
| `●` `○` | 对局状态/结算标题（game.js、game.html） | 删除，改纯文字 |
| `←` | 顶栏退出按钮（game.html） | 改内联 SVG 箭头 |
| `✓` | 残局选关已通关格（puzzle.js） | 删除，由 `.pz-grid__cell--cleared` 样式弱化表达 |
| `⚙` | 首页设置按钮 | 本就为内联 SVG，仅注释残留 |

## 取图建议

- 可用 css.txt 里 KITTY 主题自带图床图（i.mji.rip）下载后更名放入；也可自找奶油色系贴图。
- 尺寸别过大：`bg.jpg` 控制在 500KB 内，其余装饰类越小越好（手机加载）。
