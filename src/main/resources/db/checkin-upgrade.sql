USE gomoku;

-- 签到功能升级（手动执行一次）：
-- 1) user 表补钻石列（第 7 天签到奖励用；默认 0）
-- 2) 签到记录表（复合主键：一人一天一条；补签与正常签共用，靠 created_at 区分）
ALTER TABLE user
  ADD COLUMN diamonds INT NOT NULL DEFAULT 0 AFTER coins;

CREATE TABLE IF NOT EXISTS user_checkin (
  user_id      BIGINT   NOT NULL,
  check_date   DATE     NOT NULL,
  reward_coins   INT NOT NULL DEFAULT 0,
  reward_diamonds INT NOT NULL DEFAULT 0,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, check_date),
  KEY idx_user_date (user_id, check_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='每日签到记录(含补签)';
