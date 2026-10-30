package cn.edu.szpu.gomoku.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

/**
 * 九期：凭房间号加入房间（组队邀请）。
 */
@Data
public class OnlineRoomJoinReq {

    /** 6 位数字房间号（服务端生成的房间号形状） */
    @NotBlank(message = "请输入房间号")
    @Pattern(regexp = "\\d{6}", message = "房间号为 6 位数字")
    private String code;
}
