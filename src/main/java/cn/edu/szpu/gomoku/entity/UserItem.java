package cn.edu.szpu.gomoku.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("user_item")
public class UserItem {
    private Long userId;
    private String itemId;
    private Integer inUse;
    private LocalDateTime createdAt;
}
