USE gomoku;

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
