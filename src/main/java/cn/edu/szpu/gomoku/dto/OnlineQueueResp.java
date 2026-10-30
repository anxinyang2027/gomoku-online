package cn.edu.szpu.gomoku.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 九期：匹配状态。waiting = 在池中等待；matched = 已成局（带房间信息）。
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class OnlineQueueResp {

    private String status;
    private Long gameId;
    private Integer myColor;
    private String opponentName;
    /** matched 时才有意义：true = 回到仍在进行中的局（前端展示"回到对局"文案）；
     *  false/缺失 = 刚匹配成的新局 */
    private Boolean resumed;
}
