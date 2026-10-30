package cn.edu.szpu.gomoku.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

/** 每日签到记录（含补签）：一人一天一条，复合主键 */
@Data
@TableName("user_checkin")
public class UserCheckin {
    private Long userId;
    private LocalDate checkDate;
    private Integer rewardCoins;
    private Integer rewardDiamonds;
    private LocalDateTime createdAt;
}
