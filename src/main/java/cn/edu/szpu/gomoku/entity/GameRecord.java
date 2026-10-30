package cn.edu.szpu.gomoku.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("game_record")
public class GameRecord {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long userId;
    private String mode;
    private Integer color;
    private Integer result;
    private String opponent;
    private Long opponentId;
    private Integer moves;
    private Integer durationSec;
    private String history;
    private LocalDateTime createdAt;
}
