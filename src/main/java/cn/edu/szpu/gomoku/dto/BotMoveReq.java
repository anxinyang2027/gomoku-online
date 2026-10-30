package cn.edu.szpu.gomoku.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class BotMoveReq {

    @NotNull(message = "缺少 sessionId")
    private Long sessionId;

    @NotNull(message = "缺少落子坐标")
    @Min(value = 0, message = "坐标越界")
    @Max(value = 14, message = "坐标越界")
    private Integer r;

    @NotNull(message = "缺少落子坐标")
    @Min(value = 0, message = "坐标越界")
    @Max(value = 14, message = "坐标越界")
    private Integer c;
}
