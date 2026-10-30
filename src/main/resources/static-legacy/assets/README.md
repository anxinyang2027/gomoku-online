# 商品图片资源目录

两类商品 PNG 各一个文件夹。图片路径**存进商品数据的 `img` 字段**
（api.js MOCK `/api/shop`），文件名与商品 id 无关：

```
assets/
  avatars/   头像   → { id: 'avatar-buns', img: 'assets/avatars/avatar01.png' }
  boards/    棋盘   → （暂空，棋盘商品继续用 SVG 预览）
```

## 现存文件

| 类别 | 文件 | 对应商品 |
|------|------|----------|
| avatars | avatar01.png ~ avatar07.png（7 张） | avatar-buns / beard / crop / braids / pony / bald / bob |
| boards  | （空） | — |

## 图片要求

| 类别 | 建议尺寸 | 说明 |
|------|----------|------|
| avatars | 256×256 | 透明背景方图 |
| boards  | 512×512 以上 | 预留：半透明点缀装饰图，铺在原木底色上 |

## 约定

- 商品没配 `img` 字段 → 回落到 glyph 字符 / SVG 预览，不报错
- `img` 路径指向的文件缺失 → 商城显示中性灰占位图（不按 id 自动找图）
- 路径一律相对路径（同 css/、js/ 引用方式），兼容 file:// 直接打开
- 加新图 = 图放进对应文件夹 + api.js 商品条目加 `img` 字段，两步
