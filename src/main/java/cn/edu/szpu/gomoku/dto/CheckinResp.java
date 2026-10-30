package cn.edu.szpu.gomoku.dto;

import lombok.Data;

import java.time.LocalDate;
import java.util.List;

/** 签到面板数据：今天签没签、本月日历（哪些天已签/可补）、7 天周期进度、余额 */
@Data
public class CheckinResp {
    /** 今天是否已签到 */
    private Boolean checkedToday;
    /** 今天在 7 天周期中的位置（1–7） */
    private Integer cycleDay;
    /** 本月已签到的日期（含补签），前端日历点亮用 */
    private List<LocalDate> monthDates;
    /** 今天往前数、可补签的未签日期（早于今天、本月内、未签的） */
    private List<LocalDate> makeupDates;
    /** 奖励表（下标 0 = 第 1 天）：coins/diamonds */
    private List<CheckinReward> rewards;
    private Integer coins;
    private Integer diamonds;
    /** 今日签到领到的奖励（签到/补签接口返回时才有值；面板查询为 null） */
    private CheckinReward granted;

    @Data
    public static class CheckinReward {
        private Integer coins;
        private Integer diamonds;

        public static CheckinReward of(Integer coins, Integer diamonds) {
            CheckinReward r = new CheckinReward();
            r.coins = coins;
            r.diamonds = diamonds;
            return r;
        }
    }
}
