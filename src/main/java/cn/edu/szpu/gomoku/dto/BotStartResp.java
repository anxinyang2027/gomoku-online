package cn.edu.szpu.gomoku.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class BotStartResp {
    private Long sessionId;
    private String side;
    private String botName;
}
