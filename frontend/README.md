# 五子棋前端（Vue 3 + Vite）

原 `src/main/resources/static` 多页前端全面迁移至本工程。

## 技术栈

- **Vue 3.5**（`<script setup>` 组合式 API）
- **Vite 5** 构建 / 开发服务器
- **Vue Router 4**（history 模式；旧 `index/rank/history/shop/game.html` → `/ /rank /history /shop /game`）
- **Pinia**（ui 弹窗栈 / user 登录态两个 store）
- 画布棋盘渲染器 `src/lib/board.js` 零改动沿用（纯 Canvas，无框架依赖）

## 目录

```
frontend/
  public/            # 素材（assets/ 头像·系统图 · ziti/ 字体）与 index.html
  src/
    assets/style.css # 全局样式（自旧 style.css 平移，类名不变 → 视觉零回归）
    lib/
      api.js         # 接口封装（旧 js/api.js；fetch + token + 401 清理）
      board.js       # 棋盘渲染器（旧 js/board.js，零改动）
      game.js        # 对局控制器（旧 js/game.js；DOM → reactive 状态）
      puzzle.js      # 残局控制器（旧 js/puzzle.js）
      format.js      # fmtTime / copyText 工具
      useAuth.js     # 命令式弹窗 ↔ Vue 组件树 的粘合层
    stores/
      ui.js          # 弹窗栈 + toast（替代旧 showModal/toast DOM 追加）
      user.js        # 登录态 / 顶栏数据 / 皮肤缓存
    components/      # ModalHost / TabBar / AuthModal / AccountModal / CheckinModal / PuzzleGrid…
    views/           # HomeView（竞技场）/ RankView / HistoryView / ShopView / GameView
```

## 开发

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173，/api 代理到 8080
```

后端（Spring Boot，8080）照常在 IDEA / `mvn spring-boot:run` 启动。

## 部署（单端口，交作业形态）

```bash
npm run build      # 产物在 dist/
# 把 dist/ 内容拷入 src/main/resources/static/（替换旧 html/js/css，保留 assets/ 与 ziti/）
mvn package && java -jar target/gomolu-*.jar
# 访问 http://localhost:8080
```

注意：Spring Boot 默认不转发 SPA 的 history 路由（`/rank` 刷新会 404），
部署时需保留一个转发：未命中静态资源且非 /api 的请求 forward 到 index.html
（见后端 `SpaWebConfig`，随本迁移一并添加）。

## 迁移对照

| 旧（static/）            | 新（frontend/src/）                     |
|--------------------------|-----------------------------------------|
| index.html + 内联脚本     | views/HomeView.vue                      |
| game.html + js/game.js   | views/GameView.vue + lib/game.js        |
| js/puzzle.js             | lib/puzzle.js + components/PuzzleGrid.vue |
| js/common.js             | lib/useAuth.js + components/*Modal.vue  |
| js/api.js                | lib/api.js                              |
| js/board.js              | lib/board.js（零改动）                  |
| css/style.css            | assets/style.css（类名不变）            |
