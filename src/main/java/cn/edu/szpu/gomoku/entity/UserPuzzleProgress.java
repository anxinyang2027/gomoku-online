package cn.edu.szpu.gomoku.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("user_puzzle_progress")
public class UserPuzzleProgress {
    private Long userId;
    private String puzzleId;
    private LocalDateTime clearedAt;
}
