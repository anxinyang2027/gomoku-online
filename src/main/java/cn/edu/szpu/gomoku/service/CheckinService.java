package cn.edu.szpu.gomoku.service;

import cn.edu.szpu.gomoku.common.BizException;
import cn.edu.szpu.gomoku.dto.CheckinResp;
import cn.edu.szpu.gomoku.entity.User;
import cn.edu.szpu.gomoku.entity.UserCheckin;
import cn.edu.szpu.gomoku.mapper.UserCheckinMapper;
import cn.edu.szpu.gomoku.mapper.UserMapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 每日签到（含补签）。
 *
 * 规则：
 * - 奖励按 7 天周期循环：第 1–6 天发金币（梯度递增），第 7 天发钻石；
 *   周期位置按"自然周内已签天数"推算——该周（周一起）已签 n 天，
 *   这次签就是第 n+1 天位置，满 7 后下一天重新从第 1 天开始。
 * - 当天已签：面板提示，不能重复领。
 * - 补签：只能补本月内、早于今天的漏签日，每次 500 金币；
 *   补签按"该日在其所属自然周里的顺序"发对应奖励。
 */
@Service
@RequiredArgsConstructor
public class CheckinService {

    /** 7 天周期奖励表（下标 0 = 第 1 天）。第 7 天是钻石大奖 */
    private static final int[][] REWARDS = {
            {20, 0}, {30, 0}, {40, 0}, {60, 0}, {80, 0}, {120, 0}, {0, 2},
    };

    /** 补签一次的固定花费（金币） */
    private static final int MAKEUP_COST = 500;

    private final UserMapper userMapper;
    private final UserCheckinMapper checkinMapper;
    private final ChatService chatService;

    /** 签到面板：今天签没签 / 本月日历 / 可补签日 / 奖励表 / 余额 */
    public CheckinResp panel(Long userId) {
        return fullPanel(mustUser(userId));
    }

    /** 今日签到：领周期奖励；重复签报错。公屏播【系统】提示 */
    @Transactional
    public CheckinResp checkin(Long userId) {
        User u = mustUser(userId);
        LocalDate today = LocalDate.now();
        if (signed(userId, today)) {
            throw new BizException(3001, "今天已经签到过了");
        }
        int day = cyclePosition(userId, today);
        grant(u, today, REWARDS[day - 1][0], REWARDS[day - 1][1]);
        chatService.system(u.getName() + " 已签到，获得 " + rewardText(day));
        return panelOf(u, day);
    }

    /** 补签：500 金币补本月内某个漏签日；按该日在其自然周中的位置发奖 */
    @Transactional
    public CheckinResp makeup(Long userId, LocalDate date) {
        User u = mustUser(userId);
        LocalDate today = LocalDate.now();
        if (date == null) {
            throw new BizException(3002, "请选择要补签的日期");
        }
        if (!date.isBefore(today) || date.getMonth() != today.getMonth() || date.getYear() != today.getYear()) {
            throw new BizException(3002, "只能补本月内、今天之前的漏签");
        }
        if (signed(userId, date)) {
            throw new BizException(3003, "该日期已签到，无需补签");
        }
        if (u.getCoins() < MAKEUP_COST) {
            throw new BizException(2001, "金币不足，补签需要 " + MAKEUP_COST + " 金币");
        }

        // 扣补签费 + 发当日奖励
        u.setCoins(u.getCoins() - MAKEUP_COST);
        int day = cyclePosition(userId, date);
        grant(u, date, REWARDS[day - 1][0], REWARDS[day - 1][1]);
        return panelOf(u, day);
    }

    /* ---------- 内部 ---------- */

    /** 该日是否已签（复合主键不能用 selectById，按双字段查） */
    private boolean signed(Long userId, LocalDate date) {
        return checkinMapper.selectOne(Wrappers.<UserCheckin>lambdaQuery()
                .eq(UserCheckin::getUserId, userId)
                .eq(UserCheckin::getCheckDate, date)) != null;
    }

    /** 落签到记录并发奖；主键冲突（并发双击）按"已签到"报错 */
    private void grant(User u, LocalDate date, int coins, int diamonds) {
        UserCheckin c = new UserCheckin();
        c.setUserId(u.getId());
        c.setCheckDate(date);
        c.setRewardCoins(coins);
        c.setRewardDiamonds(diamonds);
        try {
            checkinMapper.insert(c);
        } catch (DuplicateKeyException e) {
            throw new BizException(3001, "该日期已签到过");
        }
        u.setCoins(u.getCoins() + coins);
        u.setDiamonds(u.getDiamonds() + diamonds);
        userMapper.updateById(u);
    }

    /** 该日期在其自然周（周一起）内的签到序号：已签 n 天 → 本次是 n+1 */
    private int cyclePosition(Long userId, LocalDate date) {
        LocalDate weekStart = date.minusDays(date.getDayOfWeek().getValue() - 1L); // 周一
        Long signedThisWeek = checkinMapper.selectCount(Wrappers.<UserCheckin>lambdaQuery()
                .eq(UserCheckin::getUserId, userId)
                .ge(UserCheckin::getCheckDate, weekStart)
                .le(UserCheckin::getCheckDate, date));
        return Math.min(signedThisWeek.intValue() + 1, 7);
    }

    /** 公屏广播文案：第 n 天奖励（"500 金币" / "2 钻石"） */
    private String rewardText(int day) {
        int coins = REWARDS[day - 1][0];
        int diamonds = REWARDS[day - 1][1];
        return diamonds > 0 ? diamonds + " 钻石" : coins + " 金币";
    }

    private List<LocalDate> monthSigned(Long userId, LocalDate today) {
        return checkinMapper.selectList(Wrappers.<UserCheckin>lambdaQuery()
                        .eq(UserCheckin::getUserId, userId)
                        .ge(UserCheckin::getCheckDate, today.withDayOfMonth(1))
                        .le(UserCheckin::getCheckDate, today))
                .stream().map(UserCheckin::getCheckDate).toList();
    }

    /** 签到/补签后的完整面板（含可补签日重算）+ 本次奖励 */
    private CheckinResp panelOf(User u, int grantedDay) {
        CheckinResp resp = fullPanel(u);
        resp.setGranted(CheckinResp.CheckinReward.of(
                REWARDS[grantedDay - 1][0], REWARDS[grantedDay - 1][1]));
        return resp;
    }

    /** 面板全集：日历 + 可补签日 + 周期位置 + 奖励表 + 余额 */
    private CheckinResp fullPanel(User u) {
        LocalDate today = LocalDate.now();
        Set<LocalDate> monthSigned = new HashSet<>(monthSigned(u.getId(), today));
        CheckinResp resp = base(u, monthSigned);
        List<LocalDate> makeup = new ArrayList<>();
        for (LocalDate d = today.withDayOfMonth(1); d.isBefore(today); d = d.plusDays(1)) {
            if (!monthSigned.contains(d)) makeup.add(d);
        }
        resp.setMakeupDates(makeup);
        return resp;
    }

    private CheckinResp base(User u, Set<LocalDate> monthSigned) {
        LocalDate today = LocalDate.now();
        CheckinResp resp = new CheckinResp();
        resp.setCheckedToday(monthSigned.contains(today));
        resp.setCycleDay(cyclePosition(u.getId(), today));
        resp.setMonthDates(new ArrayList<>(monthSigned));
        List<CheckinResp.CheckinReward> rewards = new ArrayList<>();
        for (int[] r : REWARDS) rewards.add(CheckinResp.CheckinReward.of(r[0], r[1]));
        resp.setRewards(rewards);
        resp.setCoins(u.getCoins());
        resp.setDiamonds(u.getDiamonds());
        return resp;
    }

    private User mustUser(Long userId) {
        User u = userMapper.selectById(userId);
        if (u == null) throw new BizException(4004, "用户不存在");
        return u;
    }
}
