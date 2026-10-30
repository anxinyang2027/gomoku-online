package cn.edu.szpu.gomoku.service;

import cn.edu.szpu.gomoku.common.BizException;
import cn.edu.szpu.gomoku.dto.CheckinResp;
import cn.edu.szpu.gomoku.entity.User;
import cn.edu.szpu.gomoku.entity.UserCheckin;
import cn.edu.szpu.gomoku.mapper.UserCheckinMapper;
import cn.edu.szpu.gomoku.mapper.UserMapper;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * 每日签到（K3）：周期位置推算、重复拒绝、补签窗口、余额校验。
 * mapper 全 mock——重点验证业务分支而不是 SQL。
 */
@ExtendWith(MockitoExtension.class)
class CheckinServiceTest {

    @Mock private UserMapper userMapper;
    @Mock private UserCheckinMapper checkinMapper;

    private CheckinService svc;

    private User user;
    private final List<UserCheckin> signedRows = new ArrayList<>();

    @BeforeEach
    void setUp() {
        svc = new CheckinService(userMapper, checkinMapper);
        user = new User();
        user.setId(1L);
        user.setName("tester");
        user.setScore(1000);
        user.setCoins(600);
        user.setDiamonds(0);
        when(userMapper.selectById(anyLong())).thenReturn(user);

        // 签到记录查询：selectOne 未签日期返回 null；selectList 回本月已签集合。
        // 签到后的面板重查（fullPanel）依赖 selectList 与 selectCount 两个查询
        lenient().when(checkinMapper.selectOne(any())).thenReturn(null);
        lenient().when(checkinMapper.selectList(any())).thenReturn(signedRows);
    }

    /** 新用户首签：第 1 天位置，发 20 金币 */
    @Test
    void firstCheckinGrantsDayOneReward() {
        when(checkinMapper.selectCount(any())).thenReturn(0L);
        // 签到落库后，面板重查要看到今天的记录（checkedToday=true）
        lenient().when(checkinMapper.selectList(any())).thenAnswer(inv -> {
            List<UserCheckin> after = new ArrayList<>(signedRows);
            UserCheckin today = new UserCheckin();
            today.setUserId(1L);
            today.setCheckDate(LocalDate.now());
            after.add(today);
            return after;
        });

        CheckinResp resp = svc.checkin(1L);
        assertEquals(20, resp.getGranted().getCoins());
        assertEquals(620, resp.getCoins());
        assertTrue(resp.getCheckedToday());
    }

    /** 周内已签 3 天 → 这次是第 4 天位置（60 金币档） */
    @Test
    void cyclePositionAdvancesWithinWeek() {
        when(checkinMapper.selectCount(any())).thenReturn(3L);

        CheckinResp resp = svc.checkin(1L);
        assertEquals(60, resp.getGranted().getCoins());
    }

    /** 周内已签 6 天 → 第 7 天钻石大奖档（REWARDS[6] = 0 金币 + 2 钻石） */
    @Test
    void seventhDayGrantsDiamonds() {
        when(checkinMapper.selectCount(any())).thenReturn(6L);

        CheckinResp resp = svc.checkin(1L);
        assertEquals(0, resp.getGranted().getCoins());
        assertEquals(2, resp.getGranted().getDiamonds());
        assertEquals(2, user.getDiamonds());
    }

    /** 补签未来日期 → 拒绝 */
    @Test
    void makeupFutureDateRejected() {
        BizException e = assertThrows(BizException.class,
                () -> svc.makeup(1L, LocalDate.now().plusDays(1)));
        assertEquals(3002, e.getCode());
    }

    /** 补签上月 → 拒绝（只能补本月） */
    @Test
    void makeupLastMonthRejected() {
        LocalDate lastMonth = LocalDate.now().minusMonths(1).withDayOfMonth(15);
        BizException e = assertThrows(BizException.class, () -> svc.makeup(1L, lastMonth));
        assertEquals(3002, e.getCode());
    }

    /** 金币不足 500 → 拒绝补签 */
    @Test
    void makeupInsufficientCoinsRejected() {
        user.setCoins(100);
        lenient().when(checkinMapper.selectOne(any())).thenReturn(null);
        BizException e = assertThrows(BizException.class,
                () -> svc.makeup(1L, LocalDate.now().minusDays(1)));
        assertEquals(2001, e.getCode());
    }

    /** 用户不存在 → 4004 */
    @Test
    void unknownUserRejected() {
        when(userMapper.selectById(anyLong())).thenReturn(null);
        BizException e = assertThrows(BizException.class, () -> svc.panel(99L));
        assertEquals(4004, e.getCode());
    }
}
