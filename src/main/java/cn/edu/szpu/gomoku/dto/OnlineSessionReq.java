package cn.edu.szpu.gomoku.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Data;

/**
 * 九期：按 gameId 操作对局（认输 / 求和 / 拒绝求和）。
 */
@Data
public class OnlineSessionReq {

    @NotNull(message = "缺少 gameId")
    private Long gameId;
}
