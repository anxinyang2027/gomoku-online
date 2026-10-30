package cn.edu.szpu.gomoku.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

/**
 * 公屏聊天消息 VO（H7）。
 * system=true 为系统消息；time 已按服务器时区格式化成 HH:mm，前端直接展示。
 */
@Data
@AllArgsConstructor
public class ChatMsgVO {
    private Long id;
    private String name;
    private String content;
    private Boolean system;
    private String time;
}
