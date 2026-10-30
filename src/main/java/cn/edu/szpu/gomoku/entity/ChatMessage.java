package cn.edu.szpu.gomoku.entity;

import lombok.Data;

import java.time.LocalDateTime;

/**
 * 公屏聊天消息（H7）——纯内存载体，不入库。
 * userId 为 null 即系统消息；id 用毫秒级自增序列（见 ChatService）。
 */
@Data
public class ChatMessage {
    private Long id;
    private Long userId;      // null = 系统消息
    private String name;      // 发言者名；系统消息固定"系统"
    private String content;
    private LocalDateTime createdAt;
}
