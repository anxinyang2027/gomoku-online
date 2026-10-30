package cn.edu.szpu.gomoku.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import lombok.Data;

import java.util.List;

@Data
public class SubmitResultReq {

    @Min(value = 0, message = "winner 取值 0/1/2")
    @Max(value = 2, message = "winner 取值 0/1/2")
    private Integer winner;

    @Min(value = 0, message = "手数不合法")
    @Max(value = 225, message = "手数不合法")
    private Integer moves;

    private Long timeMs;

    private Integer color;

    private String opponent;

    private String reason;

    private List<Move> history;

    public record Move(Integer r, Integer c, Integer color) {
    }
}
