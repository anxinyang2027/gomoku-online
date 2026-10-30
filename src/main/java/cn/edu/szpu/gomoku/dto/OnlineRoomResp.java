package cn.edu.szpu.gomoku.dto;

import lombok.Data;

/**
 * 九期：房间组队响应。
 * status：created = 房间已建（房主等待中，房主执黑）；
 *         matched = 对手已加入（形状与匹配流程的 OnlineQueueResp 对齐）。
 */
@Data
public class OnlineRoomResp {

    private String status;

    /** 6 位数字房间号（发给房主分享；对手加入后仍回填，弹窗展示用） */
    private String roomCode;

    /** 以下三键仅在 matched 时有值（与 OnlineQueueResp 同形） */
    private Long gameId;
    private Integer myColor;
    private String opponentName;

    /** matched 时才有意义：true = 回到仍在进行中的局；false = 刚成的新局 */
    private Boolean resumed;
}
