package cn.edu.szpu.gomoku.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class BotMoveResp {
    private Boolean accepted;
    private Integer botR;
    private Integer botC;
    private String status;
    private Integer winnerColor;
    private Integer moves;
    private String reason;
}
