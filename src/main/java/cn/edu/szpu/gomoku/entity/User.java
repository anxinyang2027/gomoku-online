package cn.edu.szpu.gomoku.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("user")
public class User {
    @TableId(type = IdType.AUTO)
    private Long id;
    private String name;
    private String password;
    private Integer score;
    private Integer coins;
    private Integer diamonds;
    private String boardId;
    private String avatarId;
    private LocalDateTime createdAt;
    private LocalDateTime lastLogin;
}
