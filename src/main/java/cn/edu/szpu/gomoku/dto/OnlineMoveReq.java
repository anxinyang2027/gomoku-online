package cn.edu.szpu.gomoku.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

/**
 * 九期：在线对局落子请求（sessionId 由路径省略，gameId 显式传）。
 */
@Data
public class OnlineMoveReq {

    @NotNull(message = "缺少 gameId")
    private Long gameId;

    @NotNull(message = "缺少落子坐标")
    @Min(value = 0, message = "坐标越界")
    @Max(value = 14, message = "坐标越界")
    private Integer r;

    @NotNull(message = "缺少落子坐标")
    @Min(value = 0, message = "坐标越界")
    @Max(value = 14, message = "坐标越界")
    private Integer c;
}
