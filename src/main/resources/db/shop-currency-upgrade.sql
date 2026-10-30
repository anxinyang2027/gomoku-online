-- 商城货币升级（H8）：部分商品改为钻石购买
-- currency: 'coin'=金币（默认，兼容存量行）/ 'diamond'=钻石
ALTER TABLE shop_item
  ADD COLUMN currency VARCHAR(8) NOT NULL DEFAULT 'coin' AFTER price;

-- 以下商品转为钻石购买（稀有档：高价棋盘 + 高价头像）
UPDATE shop_item SET currency = 'diamond' WHERE id IN ('board-obsidian', 'board-lacquer', 'avatar-bald', 'avatar-bob');
