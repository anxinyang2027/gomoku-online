CREATE DATABASE IF NOT EXISTS gomoku DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE gomoku;

CREATE TABLE IF NOT EXISTS user (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(20)  NOT NULL,
  password      VARCHAR(60)  NOT NULL,
  score         INT          NOT NULL DEFAULT 1000,
  coins         INT          NOT NULL DEFAULT 500,
  diamonds      INT          NOT NULL DEFAULT 0,
  board_id      VARCHAR(32)  NOT NULL DEFAULT 'board-default',
  avatar_id     VARCHAR(32)  NULL DEFAULT 'avatar-buns',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login    DATETIME     NULL,
  UNIQUE KEY uk_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户';

CREATE TABLE IF NOT EXISTS game_record (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT       NOT NULL,
  mode          VARCHAR(10)  NOT NULL,
  color         TINYINT      NOT NULL,
  result        TINYINT      NOT NULL,
  opponent      VARCHAR(20)  NOT NULL,
  opponent_id   BIGINT       NULL,
  moves         SMALLINT     NOT NULL,
  duration_sec  SMALLINT     NOT NULL,
  history       JSON         NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user_time (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='对局记录';

CREATE TABLE IF NOT EXISTS shop_item (
  id            VARCHAR(32)  PRIMARY KEY,
  cat           VARCHAR(8)   NOT NULL,
  name          VARCHAR(20)  NOT NULL,
  price         INT          NOT NULL DEFAULT 0,
  currency      VARCHAR(8)   NOT NULL DEFAULT 'coin',
  colors        JSON         NULL,
  glyph         VARCHAR(8)   NULL,
  img           VARCHAR(128) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商城商品';

CREATE TABLE IF NOT EXISTS user_item (
  user_id       BIGINT      NOT NULL,
  item_id       VARCHAR(32) NOT NULL,
  in_use        TINYINT     NOT NULL DEFAULT 0,
  created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户已购商品';

CREATE TABLE IF NOT EXISTS puzzle (
  id            VARCHAR(16) PRIMARY KEY,
  mode          VARCHAR(8)  NOT NULL,
  sort_no       SMALLINT    NOT NULL,
  name          VARCHAR(20) NOT NULL,
  flavor        VARCHAR(10) NOT NULL,
  hint          VARCHAR(60) NOT NULL,
  preset        JSON        NOT NULL,
  steps         JSON        NOT NULL,
  UNIQUE KEY uk_sort (mode, sort_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='残局关卡';

CREATE TABLE IF NOT EXISTS user_puzzle_progress (
  user_id       BIGINT   NOT NULL,
  puzzle_id     VARCHAR(16) NOT NULL,
  cleared_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, puzzle_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='残局通过记录';

CREATE TABLE IF NOT EXISTS game_session (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  mode          VARCHAR(16) NOT NULL,
  difficulty    TINYINT NULL,
  owner_id      BIGINT NOT NULL,
  black_id      BIGINT NULL,
  white_id      BIGINT NULL,
  status        VARCHAR(16) NOT NULL DEFAULT 'playing',
  turn_color    TINYINT NOT NULL DEFAULT 1,
  moves_json    JSON NULL,
  winner_color  TINYINT NULL,
  result        TINYINT NULL,
  end_reason    VARCHAR(16) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_mode_status (mode, status),
  KEY idx_user (owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='对局会话(bot/online 权威对局)';

-- 公屏聊天(H7)：纯内存环形缓冲(上限 200 条,重启即清),不入库不回放历史。
-- 消息 id 为毫秒级自增序列；屏蔽词/频控在 ChatService 内维护。

CREATE TABLE IF NOT EXISTS user_checkin (
  user_id      BIGINT   NOT NULL,
  check_date   DATE     NOT NULL,
  reward_coins   INT NOT NULL DEFAULT 0,
  reward_diamonds INT NOT NULL DEFAULT 0,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, check_date),
  KEY idx_user_date (user_id, check_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='每日签到记录(含补签)';
