package cn.edu.szpu.gomoku.dto;

import lombok.Data;

import java.util.List;

/**
 * 九期：在线对局快照（轮询的统一返回形状；终局结算信息也在里面）。
 */
@Data
public class OnlineSnapshotResp {

    private Long gameId;
    /** 我的执子色：1 黑 / 2 白 */
    private Integer myColor;
    /** playing / finished */
    private String status;
    /** 该谁落子：1 黑 / 2 白 */
    private Integer turnColor;
    /** 全量落子序列（客户端全量重绘，不做增量） */
    private List<SessionSnapshotResp.Stone> moves;
    /** 终局胜者：null 平局, 1 黑胜, 2 白胜；未结束为 null */
    private Integer winnerColor;
    /** five / full / resign / draw */
    private String endReason;
    /** 终局时我才有的"我的名次结果"：1 胜 / 0 平 / -1 负 */
    private Integer myResult;
    /** 终局时我才有的积分变化（胜 +20 / 平 +5 / 负 -10） */
    private Integer myScoreDelta;
    private String blackName;
    private String whiteName;
    /** 对面是否按了"求和"（等待我表态） */
    private Boolean drawPending;
    /** 对面是否发起"悔棋"（等待我表态） */
    private Boolean undoPending;
    /** 开局时间（客户端钟表校准用） */
    private Long startAtMs;
    /** 当前回合截止时刻（epoch ms；客户端显示倒计时。finished 时为 null） */
    private Long expireAtMs;
    /** 黑/白已累计被托管的回数（快照即全量，客户端 diff 播报；
     *  终局时 >0 的那一方 = 全程托管离开，积分 0） */
    private Integer autoBlack;
    private Integer autoWhite;
    /** 对手已离席毫秒数（playing 态、且超过 4s 未与服务器交互时才有值）。
     *  后端 30s 无交互即判离席方负（endReason=away），前端据此显示倒计时 */
    private Long opponentAbsentMs;
}
