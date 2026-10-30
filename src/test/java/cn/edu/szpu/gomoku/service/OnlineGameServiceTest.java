package cn.edu.szpu.gomoku.service;

import cn.edu.szpu.gomoku.common.BizException;
import cn.edu.szpu.gomoku.dto.OnlineQueueResp;
import cn.edu.szpu.gomoku.dto.OnlineRoomResp;
import cn.edu.szpu.gomoku.dto.OnlineSnapshotResp;
import cn.edu.szpu.gomoku.dto.SubmitResultReq;
import cn.edu.szpu.gomoku.entity.GameSession;
import cn.edu.szpu.gomoku.entity.User;
import cn.edu.szpu.gomoku.mapper.GameRecordMapper;
import cn.edu.szpu.gomoku.mapper.GameSessionMapper;
import cn.edu.szpu.gomoku.mapper.UserMapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 在线对战核心规则（K3）：匹配配对、房间成局、落子校验、结算计分。
 * 全部 mock mapper，不起 Spring。
 */
@ExtendWith(MockitoExtension.class)
class OnlineGameServiceTest {

    @Mock private GameSessionMapper sessionMapper;
    @Mock private GameRecordMapper recordMapper;
    @Mock private UserMapper userMapper;

    private OnlineGameService svc;

    private final Map<Long, User> users = new HashMap<>();

    @BeforeEach
    void setUp() {
        svc = new OnlineGameService(sessionMapper, recordMapper, userMapper,
                new ObjectMapper(), new cn.edu.szpu.gomoku.websocket.OnlinePushService());
        // insert 会话时分配 id
        lenient().doAnswer(inv -> {
            GameSession s = inv.getArgument(0);
            s.setId(1L);
            return 1;
        }).when(sessionMapper).insert(any(GameSession.class));
        // 用户查表
        lenient().when(userMapper.selectById(anyLong())).thenAnswer(inv -> {
            Long id = inv.getArgument(0);
            if (!users.containsKey(id)) {
                User u = new User();
                u.setId(id);
                u.setName("user" + id);
                u.setScore(1000);
                u.setCoins(100);
                users.put(id, u);
            }
            return users.get(id);
        });
    }

    /** 两人先后入池 → 立即成局：先来者执黑 */
    @Test
    void twoPlayersMatchWithFirstAsBlack() {
        OnlineQueueResp r1 = svc.join(1L);
        assertEquals("waiting", r1.getStatus());
        OnlineQueueResp r2 = svc.join(2L);
        assertEquals("matched", r2.getStatus());
        assertEquals(2, r2.getMyColor()); // 后来者白
        assertEquals("user1", r2.getOpponentName());
        // 先来者轮询也能看到成局
        OnlineQueueResp r1b = svc.poll(1L);
        assertEquals("matched", r1b.getStatus());
        assertEquals(1, r1b.getMyColor());
    }

    /** 未登录直接入池 → 401 */
    @Test
    void joinRequiresLogin() {
        BizException e = assertThrows(BizException.class, () -> svc.join(null));
        assertEquals(401, e.getCode());
    }

    /** 房间：房主创建 → 对手凭号加入 → 房主黑/加入者白，房间即销毁 */
    @Test
    void roomHostBlackJoinerWhite() {
        OnlineRoomResp created = svc.createRoom(1L);
        assertEquals("created", created.getStatus());
        assertNotNull(created.getRoomCode());
        assertEquals(6, created.getRoomCode().length());

        OnlineRoomResp joined = svc.joinRoom(2L, created.getRoomCode());
        assertEquals("matched", joined.getStatus());
        assertEquals(2, joined.getMyColor()); // 加入者白

        // 房间已消费：第三个人用同号 → 房间不存在
        BizException e = assertThrows(BizException.class,
                () -> svc.joinRoom(3L, created.getRoomCode()));
        assertEquals(4102, e.getCode());
    }

    /** 错误房间号 → 4102 */
    @Test
    void joinNonexistentRoomRejected() {
        BizException e = assertThrows(BizException.class, () -> svc.joinRoom(2L, "000000"));
        assertEquals(4102, e.getCode());
    }

    /** 房主可重复点"创建房间"：幂等返回同一间房 */
    @Test
    void createRoomIdempotent() {
        OnlineRoomResp a = svc.createRoom(1L);
        OnlineRoomResp b = svc.createRoom(1L);
        assertEquals(a.getRoomCode(), b.getRoomCode());
    }

    /** 成局后：黑先落子合法，白方抢下被拒，同格重下被拒 */
    @Test
    void moveValidationTurnOrderAndOccupied() {
        svc.join(1L);
        svc.join(2L);
        Long gameId = svc.poll(1L).getGameId();

        // 白方(2)抢黑先手 → 4002
        BizException notYourTurn = assertThrows(BizException.class,
                () -> svc.move(2L, gameId, 7, 7));
        assertEquals(4002, notYourTurn.getCode());

        // 黑方正常落子
        OnlineSnapshotResp snap = svc.move(1L, gameId, 7, 7);
        assertEquals(2, snap.getTurnColor()); // 轮白

        // 同格重下 → 4002
        BizException occupied = assertThrows(BizException.class,
                () -> svc.move(2L, gameId, 7, 7));
        assertEquals(4002, occupied.getCode());

        // 路人碰别人的局 → 403
        User passerby = new User();
        passerby.setId(99L);
        users.put(99L, passerby);
        BizException notYours = assertThrows(BizException.class,
                () -> svc.snapshot(99L, gameId));
        assertEquals(403, notYours.getCode());
    }

    /** 黑连五获胜：双方各写一条战绩，积分 胜+20/负-10，胜方金币+20 */
    @Test
    void fiveInRowSettlesScores() {
        svc.join(1L);
        svc.join(2L);
        Long gameId = svc.poll(1L).getGameId();
        // 黑 (7,3..7)；白 (8,3..8)
        int[][] black = {{7, 3}, {7, 4}, {7, 5}, {7, 6}, {7, 7}};
        int[][] white = {{8, 3}, {8, 4}, {8, 5}, {8, 6}};
        OnlineSnapshotResp snap = null;
        for (int i = 0; i < 4; i++) {
            snap = svc.move(1L, gameId, black[i][0], black[i][1]);
            snap = svc.move(2L, gameId, white[i][0], white[i][1]);
        }
        snap = svc.move(1L, gameId, 7, 7);
        assertEquals("finished", snap.getStatus());
        assertEquals(1, snap.getWinnerColor());

        // 双方各一条 online 战绩
        verify(recordMapper, org.mockito.Mockito.times(2))
                .insert(any(cn.edu.szpu.gomoku.entity.GameRecord.class));
        // 积分：黑 1000+20=1020；白 1000-10=990；胜方金币 100+20=120
        assertEquals(1020, users.get(1L).getScore());
        assertEquals(990, users.get(2L).getScore());
        assertEquals(120, users.get(1L).getCoins());
        assertEquals(100, users.get(2L).getCoins());
    }

    /** 认输：认输方判负，对方获胜结算 */
    @Test
    void resignSettles() {
        svc.join(1L);
        svc.join(2L);
        Long gameId = svc.poll(1L).getGameId();
        OnlineSnapshotResp snap = svc.resign(2L, gameId);
        assertEquals("finished", snap.getStatus());
        assertEquals(1, snap.getWinnerColor()); // 黑不战而胜
        assertEquals(1020, users.get(1L).getScore());
        assertEquals(990, users.get(2L).getScore());
    }

    /** 双方求和 → 平局：双方各 +5 */
    @Test
    void mutualDrawSettles() {
        svc.join(1L);
        svc.join(2L);
        Long gameId = svc.poll(1L).getGameId();
        svc.draw(1L, gameId);
        OnlineSnapshotResp snap = svc.draw(2L, gameId);
        assertEquals("finished", snap.getStatus());
        assertEquals(1005, users.get(1L).getScore());
        assertEquals(1005, users.get(2L).getScore());
    }

    /** 一方求和另一方拒绝 → 不终局，标记清空 */
    @Test
    void drawRejectKeepsPlaying() {
        svc.join(1L);
        svc.join(2L);
        Long gameId = svc.poll(1L).getGameId();
        svc.draw(1L, gameId);
        OnlineSnapshotResp snap = svc.rejectDraw(2L, gameId);
        assertEquals("playing", snap.getStatus());
        // 黑再落子不受影响
        snap = svc.move(1L, gameId, 7, 7);
        assertEquals("playing", snap.getStatus());
    }

    /** 取消排队：出池后再来新人不会与幽灵配对 */
    @Test
    void cancelRemovesFromQueue() {
        svc.join(1L);
        assertTrue(svc.cancel(1L));
        OnlineQueueResp r2 = svc.join(2L);
        assertEquals("waiting", r2.getStatus()); // 池里没人了，2 变等待者
    }
}
