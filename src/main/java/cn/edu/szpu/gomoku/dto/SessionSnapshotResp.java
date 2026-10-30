package cn.edu.szpu.gomoku.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

import java.util.List;

@Data
@AllArgsConstructor
public class SessionSnapshotResp {
    private Long sessionId;
    private Integer difficulty;
    private String botName;
    private String status;
    private Integer winnerColor;
    private String reason;
    private List<Stone> moves;

    @Data
    @AllArgsConstructor
    public static class Stone {
        private Integer r;
        private Integer c;
        private Integer color;
    }
}
