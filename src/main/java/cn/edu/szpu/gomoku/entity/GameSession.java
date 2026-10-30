package cn.edu.szpu.gomoku.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("game_session")
public class GameSession {
    @TableId(type = IdType.AUTO)
    private Long id;
    private String mode;
    private Integer difficulty;
    private Long ownerId;
    private Long blackId;
    private Long whiteId;
    private String status;
    private Integer turnColor;
    private String movesJson;
    private Integer winnerColor;
    private Integer result;
    private String endReason;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
