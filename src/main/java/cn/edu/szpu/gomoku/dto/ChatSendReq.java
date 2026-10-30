package cn.edu.szpu.gomoku.dto;

import lombok.Data;

/** 聊天发言请求体（H7）。channel 缺省 lobby；game:&lt;id&gt; 为对局频道 */
@Data
public class ChatSendReq {
    private String content;
    private String channel;
}
