package cn.edu.szpu.gomoku.service;

import cn.edu.szpu.gomoku.common.BizException;
import cn.edu.szpu.gomoku.dto.OnlineQueueResp;
import cn.edu.szpu.gomoku.dto.OnlineRoomResp;
import cn.edu.szpu.gomoku.dto.OnlineSnapshotResp;
import cn.edu.szpu.gomoku.dto.SessionSnapshotResp;
import cn.edu.szpu.gomoku.dto.SubmitResultReq;
import cn.edu.szpu.gomoku.entity.GameRecord;
import cn.edu.szpu.gomoku.entity.GameSession;
import cn.edu.szpu.gomoku.entity.User;
import cn.edu.szpu.gomoku.game.Referee;
import cn.edu.szpu.gomoku.mapper.GameRecordMapper;
import cn.edu.szpu.gomoku.mapper.GameSessionMapper;
import cn.edu.szpu.gomoku.mapper.UserMapper;
import cn.edu.szpu.gomoku.websocket.OnlinePushService;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.SneakyThrows;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;

/**
 * 九期：真实玩家在线匹配对战（HTTP 轮询版）。
 *
 *  - 匹配池只驻内存（先到先得配对；重启清空，等待者重新排即可）；
 *  - 对局沿用 bot 的权威会话思路：活跃对局缓存内存、每步落库，
 *    行仍在 game_session(mode='online')，重启后按落子序列重建可续局；
 *  - 落子必须轮到自己的颜色，终局（五连 / 下满 / 认输 / 双方求和）服务端
 *    统一结算：双方各写一条 game_record(mode=online) 并按 胜+20/平+5/负-10
 *    调整积分（胜方另加 20 金币）——与本地模式 GameService 的口径一致。
 */
@Service
@RequiredArgsConstructor
public class OnlineGameService {

    private final GameSessionMapper sessionMapper;
    private final GameRecordMapper recordMapper;
    private final UserMapper userMapper;
    private final ObjectMapper objectMapper;
    private final OnlinePushService pushService;
    private final ChatService chatService;

    private static final long TURN_MS = 60_000L; // 每回合限时 60s

    /** 对手离席"可视"阈值：超过后快照带 opponentAbsentMs（前端开始提示） */
    private static final long ABSENT_WARN_MS = 4_000L;

    /** 对手离席判负阈值：超过该时长没有任何接口交互 → 判离席方负（away）。
     *  修复"一方退了，另一方无提示且对局继续"的问题；重新拉起页面的短暂
     *  间隔远小于该阈值，不影响 resume 续局。 */
    private static final long ABANDON_MS = 30_000L;

    /** 排队成员 ping 过期阈值：超时不与之配对（防"幽灵匹配"） */
    private static final long QUEUE_STALE_MS = 15_000L;

    /** finished 会话在缓存里的保留时长（过期后移除，内存不无限膨胀） */
    private static final long CACHE_KEEP_MS = 10 * 60_000L;

    /** 匹配等待池（有序：先来者执黑） */
    private final List<Long> queue = new ArrayList<>();

    /** 匹配池成员最近一次 ping（join/poll 刷新）：用于剔除已关页面的幽灵等待者 */
    private final Map<Long, Long> queuePing = new ConcurrentHashMap<>();

    /** 活跃/近期对局缓存：sessionId -> 会话状态 */
    private final Map<Long, Session> cache = new ConcurrentHashMap<>();

    /* ---------- 房间组队（邀请制，与匹配池并行的成局通道） ----------
       房间只驻内存：6 位数字房间号 -> 房主 id；房主点"创建房间"生成，
       对手凭号加入即成局（房主执黑、加入者执白），随后完全复用在线对局
       链路（轮询 / 落子 / 结算不区分来源）。房主取消等待 = 解散房间；
       房间 10 分钟无人加入自动过期（房主轮询时顺带清理）。 */

    /** 房间号最长有效期：过期后 joinRoom 报"房间已过期" */
    private static final long ROOM_TTL_MS = 10 * 60_000L;

    /** 房间表：roomCode -> Room（只含等待中的房间；成局/解散即移除） */
    private final Map<String, Room> rooms = new ConcurrentHashMap<>();

    private static class Room {
        String code;
        Long ownerId;
        long createdAt = System.currentTimeMillis();
    }


    private static class Session {
        Long id;
        Long blackId;
        Long whiteId;
        List<SubmitResultReq.Move> moves = new ArrayList<>();
        int[][] grid = new int[Referee.SIZE][Referee.SIZE];
        String status = "playing";
        Integer turnColor = 1;
        Integer winnerColor;
        String endReason;
        boolean drawBlack;
        boolean drawWhite;
        /** 悔棋申请：null=无；1=黑方申请；2=白方申请（对方应答后清空） */
        Integer undoBy;
        LocalDateTime createdAt = LocalDateTime.now();
        /** 当前回合截止时刻（回合开始 = 上一手落子时刻 + TURN_MS） */
        long lastMoveAt = System.currentTimeMillis();
        /** 双方"连续托管回数"：手动落子即清零（仅状态栏显示） */
        int autoBlack;
        int autoWhite;
        /** 离席标记：本局出现过回合超时被托管即锁定（回来局末照样 -20） */
        boolean awayBlack;
        boolean awayWhite;
        /** 双方最近一次交互时刻（任意接口调用即续命）：用于"一方离开/掉线"检测 */
        long lastSeenBlack = System.currentTimeMillis();
        long lastSeenWhite = System.currentTimeMillis();
        /** 终局时刻（缓存过期清理用） */
        long finishedAt;
    }

    /* ---------- 匹配 ---------- */

    /** 加入匹配池 / 续上已在进行的局（幂等：重复调用返回当前状态） */
    public OnlineQueueResp join(Long userId) {
        requireLogin(userId);
        synchronized (this) {
            evictExpiredFinishes();
            Session active = activeOf(userId);
            if (active != null) {
                leaveQueue(userId);
                dissolveMyRoom(userId, active);
                return matched(userId, active);
            }
            if (queue.contains(userId)) {
                queuePing.put(userId, System.currentTimeMillis());
                return waitingResp();
            }
            pruneQueue(); // 先清掉幽灵/超时等待者，避免与人已离线的成员配对
            // 队首若已成局（如房主先被房间组队配走），把它从队列清掉再继续找
            while (!queue.isEmpty() && activeOf(queue.get(0)) != null) {
                leaveQueue(queue.get(0));
            }
            if (!queue.isEmpty()) {
                Long partner = queue.remove(0); // 先来者执黑，后到者执白
                leaveQueue(partner);
                Session s = createGame(partner, userId);
                return matched(userId, s);
            }
            queue.add(userId);
            queuePing.put(userId, System.currentTimeMillis());
            return waitingResp();
        }
    }

    /** 匹配状态轮询（等待者用来得知成局；也顺带续命自己的在队列中的席位） */
    public OnlineQueueResp poll(Long userId) {
        requireLogin(userId);
        synchronized (this) {
            queuePing.put(userId, System.currentTimeMillis());
            Session active = activeOf(userId);
            if (active != null) {
                leaveQueue(userId);
                return matched(userId, active);
            }
            pruneQueue();
            return new OnlineQueueResp(
                    queue.contains(userId) ? "waiting" : "idle", null, null, null, null);
        }
    }

    /** 取消排队（已成局的对局不受影响）；房主的房间一并解散 */
    public boolean cancel(Long userId) {
        requireLogin(userId);
        synchronized (this) {
            boolean inQueue = queue.contains(userId);
            boolean hadRoom = dissolveMyRoom(userId, null);
            leaveQueue(userId);
            return inQueue || hadRoom;
        }
    }

    /** 出队 = 从队列和 ping 表同时移除（两表保持同步是判断幽灵的前提） */
    private void leaveQueue(Long userId) {
        queue.remove(userId);
        queuePing.remove(userId);
    }

    /** 剔除幽灵等待者：超过 QUEUE_STALE_MS 没有 join/poll 的人视为已关页面，出队 */
    private void pruneQueue() {
        long now = System.currentTimeMillis();
        queue.removeIf(id -> now - queuePing.getOrDefault(id, 0L) > QUEUE_STALE_MS);
    }

    /** 活跃局查找 + 到场续命（所有"用户可见"的入口都应经由它刷新 lastSeen） */
    private Session activeOf(Long userId) {
        Session s = findActiveByUser(userId);
        if (s != null) touch(s, userId);
        return s;
    }

    /** 到场续命：该玩家刚与服务器交互过，离席计时从现在算 */
    private void touch(Session s, Long userId) {
        long now = System.currentTimeMillis();
        if (userId.equals(s.blackId)) s.lastSeenBlack = now;
        else if (userId.equals(s.whiteId)) s.lastSeenWhite = now;
    }

    /** finished 会话超过保留时长后逐出缓存（库里仍有全量，可按需 rebuild） */
    private void evictExpiredFinishes() {
        long limit = System.currentTimeMillis() - CACHE_KEEP_MS;
        cache.values().removeIf(s -> s.finishedAt > 0 && s.finishedAt < limit);
    }

    /* ---------- 房间组队（凭房间号邀请） ---------- */

    /** 创建房间：房主执黑等待对手凭房间号加入（已有活跃局则直接带回） */
    public OnlineRoomResp createRoom(Long userId) {
        requireLogin(userId);
        synchronized (this) {
            Session active = activeOf(userId);
            if (active != null) {
                leaveQueue(userId);
                return roomMatched(userId, active);
            }
            // 重复点"创建房间"（含刷新后重进）幂等返回同一间房
            for (Room r : rooms.values()) {
                if (r.ownerId.equals(userId)) return created(r.code);
            }
            String code = generateCode();
            Room room = new Room();
            room.code = code;
            room.ownerId = userId;
            rooms.put(code, room);
            return created(code);
        }
    }

    /** 房主侧轮询：等待中回 created + 房间号；对手已加入回 matched */
    public OnlineRoomResp pollRoom(Long userId) {
        requireLogin(userId);
        synchronized (this) {
            Session active = activeOf(userId);
            if (active != null) {
                rooms.values().removeIf(r -> r.ownerId.equals(userId));
                return roomMatched(userId, active);
            }
            for (Room r : rooms.values()) {
                if (!r.ownerId.equals(userId)) continue;
                if (System.currentTimeMillis() - r.createdAt > ROOM_TTL_MS) {
                    rooms.remove(r.code); // 10 分钟无人加入：过期解散
                    return expired();
                }
                return created(r.code);
            }
            return expired(); // 房间不在了（被取消/过期/服务重启）
        }
    }

    /** 凭房间号加入：即与房主成局（房主黑、加入者白）；幂等可重复调 */
    public OnlineRoomResp joinRoom(Long userId, String code) {
        requireLogin(userId);
        synchronized (this) {
            Session active = activeOf(userId);
            if (active != null) { // 已在对局中（含本房已成局）直接带回
                leaveQueue(userId);
                return roomMatched(userId, active);
            }
            Room room = code == null ? null : rooms.get(code.trim());
            if (room == null) {
                throw new BizException(4102, "房间不存在或已关闭");
            }
            if (room.ownerId.equals(userId)) {
                return created(room.code); // 房主自己输了自己的号：视为等待中
            }
            if (System.currentTimeMillis() - room.createdAt > ROOM_TTL_MS) {
                rooms.remove(room.code);
                throw new BizException(4102, "房间不存在或已关闭");
            }
            // 房主已在别局（可能先被匹配池配走）：房间失效
            if (findActiveByUser(room.ownerId) != null) {
                rooms.remove(room.code);
                throw new BizException(4102, "房间不存在或已关闭");
            }
            rooms.remove(room.code);
            leaveQueue(userId); // 加房者优先于排队匹配
            Session s = createGame(room.ownerId, userId); // 房主执黑
            // 房主若还挂在匹配队列里（建房后又去排队），必须一并出队，
            // 否则接下来仍可能被配进第二局（一个玩家同时打两局的漏洞）
            leaveQueue(room.ownerId);
            return roomMatched(userId, s);
        }
    }

    /** 生成不与现存房间冲突的 6 位数字房间号 */
    private String generateCode() {
        for (int i = 0; i < 64; i++) {
            String code = String.format("%06d", ThreadLocalRandom.current().nextInt(1_000_000));
            if (!rooms.containsKey(code)) return code;
        }
        throw new BizException(500, "房间创建繁忙，请稍后再试");
    }

    /** 解散我名下的等待房间（成局/取消排队/退出时调用）；返回是否有房被解散 */
    private boolean dissolveMyRoom(Long userId, Session exceptActive) {
        boolean[] removed = {false};
        rooms.values().removeIf(r -> {
            if (!r.ownerId.equals(userId)) return false;
            removed[0] = true;
            return true;
        });
        return removed[0];
    }

    private OnlineRoomResp created(String code) {
        OnlineRoomResp resp = new OnlineRoomResp();
        resp.setStatus("created");
        resp.setRoomCode(code);
        return resp;
    }

    private OnlineRoomResp expired() {
        OnlineRoomResp resp = new OnlineRoomResp();
        resp.setStatus("closed");
        return resp;
    }

    /** 成局应答（与匹配流程的 matched 同形，多回填一个房间号便于前端展示） */
    private OnlineRoomResp roomMatched(Long me, Session s) {
        OnlineRoomResp resp = new OnlineRoomResp();
        resp.setStatus("matched");
        resp.setGameId(s.id);
        resp.setMyColor(me.equals(s.blackId) ? 1 : 2);
        resp.setOpponentName(userName(me.equals(s.blackId) ? s.whiteId : s.blackId));
        resp.setResumed(!s.moves.isEmpty()); // 有子 = 回到进行中的局（前端文案据此切换）
        return resp;
    }

    /* ---------- 对局（轮询 / 落子 / 认输 / 求和） ---------- */

    public OnlineSnapshotResp snapshot(Long userId, Long gameId) {
        requireLogin(userId);
        synchronized (this) {
            Session s = load(gameId, userId);
            autoTick(s, colorOf(s, userId));
            return buildSnapshot(s, userId);
        }
    }

    public OnlineSnapshotResp move(Long userId, Long gameId, Integer r, Integer c) {
        requireLogin(userId);
        OnlineSnapshotResp resp;
        synchronized (this) {
            Session s = load(gameId, userId);
            autoTick(s, colorOf(s, userId));
            if (!"playing".equals(s.status)) {
                resp = buildSnapshot(s, userId); // 轮询间隙托管/离席判负已终局
                notifyBoth(s, resp, userId);
                return resp;
            }
            int myColor = colorOf(s, userId);
            if (!s.turnColor.equals(myColor)) {
                throw new BizException(4002, "还没轮到您落子");
            }
            if (s.grid[r][c] != 0) {
                throw new BizException(4002, "该位置已有棋子");
            }
            s.grid[r][c] = myColor;
            s.moves.add(new SubmitResultReq.Move(r, c, myColor));
            s.drawBlack = false;
            s.drawWhite = false;
            s.undoBy = null; // 落子即悔棋申请作废
            if (myColor == 1) s.autoBlack = 0; else s.autoWhite = 0; // 手动落子清托管连击
            s.lastMoveAt = System.currentTimeMillis();

            int judge = Referee.judge(s.moves);
            if (judge == 1 || judge == 2) {
                finish(s, judge, "five");
            } else if (s.moves.size() == Referee.SIZE * Referee.SIZE) {
                finish(s, null, "full");
            } else {
                s.turnColor = 3 - myColor;
            }
            persist(s);
            if ("finished".equals(s.status)) {
                settle(s);
            }
            resp = buildSnapshot(s, userId);
            notifyBoth(s, resp, userId);
            return resp;
        }
    }

    /** 认输：对方获胜 */
    public OnlineSnapshotResp resign(Long userId, Long gameId) {
        requireLogin(userId);
        OnlineSnapshotResp resp;
        synchronized (this) {
            Session s = load(gameId, userId);
            autoTick(s, colorOf(s, userId));
            if (!"playing".equals(s.status)) {
                resp = buildSnapshot(s, userId);
                notifyBoth(s, resp, userId);
                return resp;
            }
            finish(s, colorOf(s, userId) == 1 ? 2 : 1, "resign");
            // 认输是自觉行为：把"终局托管连击"状态抹掉，保证认输方正常 -10
            if (colorOf(s, userId) == 1) s.autoBlack = 0; else s.autoWhite = 0;
            persist(s);
            settle(s);
            resp = buildSnapshot(s, userId);
            notifyBoth(s, resp, userId);
            return resp;
        }
    }

    /** 求和：置位自己一票；双方都置位 → 平局结算 */
    public OnlineSnapshotResp draw(Long userId, Long gameId) {
        requireLogin(userId);
        OnlineSnapshotResp resp;
        synchronized (this) {
            Session s = load(gameId, userId);
            autoTick(s, colorOf(s, userId));
            if (!"playing".equals(s.status)) {
                resp = buildSnapshot(s, userId);
                notifyBoth(s, resp, userId);
                return resp;
            }
            if (colorOf(s, userId) == 1) s.drawBlack = true; else s.drawWhite = true;
            if (s.drawBlack && s.drawWhite) {
                finish(s, null, "draw");
            }
            persist(s);
            if ("finished".equals(s.status)) {
                settle(s);
            }
            resp = buildSnapshot(s, userId);
            notifyBoth(s, resp, userId);
            return resp;
        }
    }

    /** 拒绝求和：清掉双方请求 */
    public OnlineSnapshotResp rejectDraw(Long userId, Long gameId) {
        requireLogin(userId);
        OnlineSnapshotResp resp;
        synchronized (this) {
            Session s = load(gameId, userId);
            autoTick(s, colorOf(s, userId));
            if (!"playing".equals(s.status)) {
                resp = buildSnapshot(s, userId);
                notifyBoth(s, resp, userId);
                return resp;
            }
            s.drawBlack = false;
            s.drawWhite = false;
            persist(s);
            resp = buildSnapshot(s, userId);
            notifyBoth(s, resp, userId);
            return resp;
        }
    }

    /**
     * 悔棋申请：任何一方发起（不限于刚落子的一方），对方应答。
     * 同意 → 回退"一整个回合"（两手：对方+我方的最后一手），
     * 使发起方回到自己可落子的局面；拒绝 → 只清申请。
     */
    public OnlineSnapshotResp requestUndo(Long userId, Long gameId) {
        requireLogin(userId);
        OnlineSnapshotResp resp;
        synchronized (this) {
            Session s = load(gameId, userId);
            autoTick(s, colorOf(s, userId));
            int myColor = colorOf(s, userId);
            if (!"playing".equals(s.status)) {
                resp = buildSnapshot(s, userId);
                notifyBoth(s, resp, userId);
                return resp;
            }
            if (s.moves.isEmpty()) {
                throw new BizException(4002, "还没有落子，无可悔");
            }
            s.undoBy = myColor;
            persist(s);
            resp = buildSnapshot(s, userId);
            notifyBoth(s, resp, userId);
            return resp;
        }
    }

    /** 悔棋应答：agree=true 回退一整个回合，false 仅清申请 */
    public OnlineSnapshotResp answerUndo(Long userId, Long gameId, boolean agree) {
        requireLogin(userId);
        OnlineSnapshotResp resp;
        synchronized (this) {
            Session s = load(gameId, userId);
            autoTick(s, colorOf(s, userId));
            int myColor = colorOf(s, userId);
            if (!"playing".equals(s.status) || s.undoBy == null) {
                resp = buildSnapshot(s, userId);
                notifyBoth(s, resp, userId);
                return resp;
            }
            if (s.undoBy == myColor) {
                throw new BizException(4002, "自己发起的申请不能自己应答");
            }
            s.undoBy = null;
            if (agree) {
                undoRound(s); // 回退两手
            }
            persist(s);
            resp = buildSnapshot(s, userId);
            notifyBoth(s, resp, userId);
            return resp;
        }
    }

    /** 回退一整个回合（两手）：从棋盘与序列同步移除，回合权交给被回退方的对手 */
    private void undoRound(Session s) {
        for (int i = 0; i < 2 && !s.moves.isEmpty(); i++) {
            SubmitResultReq.Move last = s.moves.remove(s.moves.size() - 1);
            s.grid[last.r()][last.c()] = 0;
        }
        if (!s.moves.isEmpty()) {
            s.turnColor = 3 - s.moves.get(s.moves.size() - 1).color();
        } else {
            s.turnColor = 1;
        }
        s.lastMoveAt = System.currentTimeMillis(); // 回合计时重置
        s.drawBlack = false;
        s.drawWhite = false;
    }

    /**
     * K1：状态变化后向该局全部 WS 订阅者广播快照。
     * 每个订阅者收到的是"以自己为视角"的快照（myColor/myResult/myScoreDelta/
     * drawPending 均视角相关），因此按订阅者身份各构建一份、定向投递；
     * resp 是操作者视角，可直接复用省一次构建。
     * 注意不能 broadcast 群发单一视角——对端会把别人的 myScoreDelta 当成
     * 自己的（认输方的 -10 会播给胜者），且首条快照置 gameOver 后，
     * 正确视角的后续快照会被客户端丢弃。
     * 广播在 synchronized 块外执行——推送慢不拖累对局锁（调用点已保证）。
     */
    private void notifyBoth(Session s, OnlineSnapshotResp operatorResp, Long operatorId) {
        if (pushService == null) return;
        Long opponentId = operatorId.equals(s.blackId) ? s.whiteId : s.blackId;
        try {
            pushService.broadcastTo(s.id, operatorId, wrap("snapshot", operatorResp));
            if (opponentId != null) {
                pushService.broadcastTo(s.id, opponentId,
                        wrap("snapshot", buildSnapshot(s, opponentId)));
            }
        } catch (Exception e) {
            // 推送失败不影响对局状态（客户端轮询兜底）
        }
    }

    private String wrap(String type, OnlineSnapshotResp data) {
        try {
            return objectMapper.writeValueAsString(
                    java.util.Map.of("type", type, "data", data));
        } catch (Exception e) {
            return null;
        }
    }

    /* ---------- 内部 ---------- */

    private void requireLogin(Long userId) {
        if (userId == null) throw new BizException(401, "请先登录");
    }

    private int colorOf(Session s, Long userId) {
        if (userId.equals(s.blackId)) return 1;
        if (userId.equals(s.whiteId)) return 2;
        throw new BizException(403, "这不是您的对局");
    }

    /** 我当前进行中的在线局 id（无则 null）——聊天频道鉴权用（H7） */
    public Long activeGameIdOf(Long userId) {
        Session s = activeOf(userId);
        return s == null ? null : s.id;
    }

    /** 找我自己仍在进行的在线局（缓存优先，库兜底，重启后可续） */
    private Session findActiveByUser(Long userId) {
        for (Session s : cache.values()) {
            if ("playing".equals(s.status)
                    && (userId.equals(s.blackId) || userId.equals(s.whiteId))) {
                return s;
            }
        }
        GameSession row = sessionMapper.selectOne(Wrappers.<GameSession>lambdaQuery()
                .eq(GameSession::getMode, "online")
                .eq(GameSession::getStatus, "playing")
                .and(w -> w.eq(GameSession::getBlackId, userId)
                        .or().eq(GameSession::getWhiteId, userId))
                .orderByDesc(GameSession::getUpdatedAt));
        return row == null ? null : rebuild(row);
    }

    private Session createGame(Long blackId, Long whiteId) {
        Session s = new Session();
        s.blackId = blackId;
        s.whiteId = whiteId;
        GameSession row = new GameSession();
        row.setMode("online");
        row.setOwnerId(blackId);
        row.setBlackId(blackId);
        row.setWhiteId(whiteId);
        row.setStatus("playing");
        row.setTurnColor(1);
        sessionMapper.insert(row);
        s.id = row.getId();
        cache.put(s.id, s);
        return s;
    }

    /** 库 -> 内存会话（对应 bot 的 load 兜底分支；在线局不判中止，可续） */
    private Session rebuild(GameSession row) {
        Session s = new Session();
        s.id = row.getId();
        s.blackId = row.getBlackId();
        s.whiteId = row.getWhiteId();
        s.status = row.getStatus();
        s.turnColor = row.getTurnColor();
        s.winnerColor = row.getWinnerColor();
        s.endReason = row.getEndReason();
        s.createdAt = row.getCreatedAt() == null ? LocalDateTime.now() : row.getCreatedAt();
        s.lastMoveAt = row.getUpdatedAt() == null ? System.currentTimeMillis()
                : java.sql.Timestamp.valueOf(row.getUpdatedAt()).getTime();
        List<SubmitResultReq.Move> history = fromJson(row.getMovesJson());
        s.moves = history == null ? new ArrayList<>() : new ArrayList<>(history);
        for (SubmitResultReq.Move m : s.moves) {
            s.grid[m.r()][m.c()] = m.color();
        }
        cache.put(s.id, s);
        return s;
    }

    /** load：缓存优先；不在缓存时从库重建（校验我确是参战者）。
     *  校验通过即视为"到场"——刷新双方 lastSeen 供离席检测使用 */
    private Session load(Long gameId, Long userId) {
        Session s = cache.get(gameId);
        if (s != null) {
            colorOf(s, userId); // 参战校验
            touch(s, userId);
            return s;
        }
        GameSession row = sessionMapper.selectById(gameId);
        if (row == null || !"online".equals(row.getMode())) {
            throw new BizException(4100, "对局不存在");
        }
        s = rebuild(row);
        colorOf(s, userId);
        touch(s, userId);
        return s;
    }

    private void finish(Session s, Integer winner, String reason) {
        s.status = "finished";
        s.winnerColor = winner;
        s.endReason = reason;
        s.drawBlack = false;
        s.drawWhite = false;
        s.undoBy = null;
        s.finishedAt = System.currentTimeMillis();
    }

    /* ---------- 对手离席检测 / 回合超时与智能托管 ---------- */

    /**
     * 闸：任一接口进来先跑。
     * 1. 对手离席检测：对手超过 ABANDON_MS 没有任何接口交互（含刷新掉线），
     *    立即判离席方负（reason=away）并结算——修复"一方退了，另一方
     *    无提示且对局一直继续"的问题；对手短暂刷新（< ABANDON_MS）不受影响。
     * 2. 回合超时（lastMoveAt + 60s < now）由系统代下；代下一手后对手获得
     *    新的整整 60s（lastMoveAt 前移，循环自然止步）。
     * 托管一旦开启便持续到自然终局（五连 / 下满），不因回合数判负；
     * 记分法：终局时若该方仍处于托管连击中（auto* > 0，未曾手动接回），
     * 该方积分一律不动；正常参战者按标准口径（胜 +20 / 平 +5 / 负 -10）。
     */
    private void autoTick(Session s, int meColor) {
        if (!"playing".equals(s.status)) return;
        abandonCheck(s, meColor);
        if (!"playing".equals(s.status)) return; // 离席判负即时终局
        int guard = 0; // 防御上限（正常最多循环 1 次）
        while ("playing".equals(s.status) && guard++ < 4) {
            if (System.currentTimeMillis() < s.lastMoveAt + TURN_MS) return;
            int color = s.turnColor;
            int[] mv = findAutoMove(s.grid, color);
            if (mv == null) {
                finish(s, null, "full");
                persist(s);
                settle(s);
                return;
            }
            s.grid[mv[0]][mv[1]] = color;
            s.moves.add(new SubmitResultReq.Move(mv[0], mv[1], color));
            s.drawBlack = false;
            s.drawWhite = false;
            s.lastMoveAt = System.currentTimeMillis();
            if (color == 1) s.autoBlack++; else s.autoWhite++;
            int judge = Referee.judge(s.moves);
            if (judge == 1 || judge == 2) {
                finish(s, judge, "five");
                persist(s);
                settle(s);
                return;
            }
            if (s.moves.size() == Referee.SIZE * Referee.SIZE) {
                finish(s, null, "full");
                persist(s);
                settle(s);
                return;
            }
            s.turnColor = 3 - color;
            persist(s);
        }
    }

    /** 对手离席判负：对手（非当前请求方）超过 ABANDON_MS 无交互 → 当前请求方获胜 */
    private void abandonCheck(Session s, int meColor) {
        if (!"playing".equals(s.status)) return;
        long oppLast = meColor == 1 ? s.lastSeenWhite : s.lastSeenBlack;
        if (System.currentTimeMillis() - oppLast > ABANDON_MS) {
            finish(s, meColor, "away");
            persist(s);
            settle(s);
        }
    }

    /** 托管选点：能赢先赢，能堵就堵，否则邻子密度+中心偏好的权值最高点 */
    private int[] findAutoMove(int[][] grid, int color) {
        int n = Referee.SIZE;
        int[] mv = immediateWin(grid, color);
        if (mv == null) mv = immediateWin(grid, 3 - color);
        if (mv != null) return mv;
        int[] best = null;
        int bestScore = -1;
        for (int r = 0; r < n; r++) {
            for (int c = 0; c < n; c++) {
                if (grid[r][c] != 0) continue;
                int score = 0;
                for (int dr = -2; dr <= 2; dr++) {
                    for (int dc = -2; dc <= 2; dc++) {
                        if (dr == 0 && dc == 0) continue;
                        int rr = r + dr, cc = c + dc;
                        if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
                        if (grid[rr][cc] != 0) score++;
                    }
                }
                score = score * 2 + (n - (Math.abs(r - n / 2) + Math.abs(c - n / 2)));
                if (score > bestScore) {
                    bestScore = score;
                    best = new int[]{r, c};
                }
            }
        }
        return best;
    }

    /** 试放一格即成五连（含本格）则返回该格 */
    private int[] immediateWin(int[][] grid, int color) {
        int n = Referee.SIZE;
        for (int r = 0; r < n; r++) {
            for (int c = 0; c < n; c++) {
                if (grid[r][c] != 0) continue;
                grid[r][c] = color;
                boolean win = countFiveAt(grid, r, c, color);
                grid[r][c] = 0;
                if (win) return new int[]{r, c};
            }
        }
        return null;
    }

    private boolean countFiveAt(int[][] grid, int r, int c, int color) {
        final int[][] dirs = {{0, 1}, {1, 0}, {1, 1}, {1, -1}};
        for (int[] d : dirs) {
            int n = 1;
            for (int i = 1; i < 5; i++) {
                int rr = r - d[0] * i, cc = c - d[1] * i;
                if (rr < 0 || rr >= Referee.SIZE || cc < 0 || cc >= Referee.SIZE
                        || grid[rr][cc] != color) break;
                n++;
            }
            for (int i = 1; i < 5; i++) {
                int rr = r + d[0] * i, cc = c + d[1] * i;
                if (rr < 0 || rr >= Referee.SIZE || cc < 0 || cc >= Referee.SIZE
                        || grid[rr][cc] != color) break;
                n++;
            }
            if (n >= 5) return true;
        }
        return false;
    }

    /** 终局落地：写双方 game_record(mode=online) + 调整双方积分/金币 */
    private void settle(Session s) {
        int blackResult = resultOf(s.winnerColor, 1);
        int whiteResult = resultOf(s.winnerColor, 2);
        String history = toJson(s.moves);
        long sec = Duration.between(s.createdAt, LocalDateTime.now()).getSeconds();
        int duration = (int) Math.min(Math.max(sec, 0), 359999);

        User black = userMapper.selectById(s.blackId);
        User white = userMapper.selectById(s.whiteId);
        String blackName = black == null ? "黑方" : nameOrNull(black.getName(), "黑方");
        String whiteName = white == null ? "白方" : nameOrNull(white.getName(), "白方");
        recordOne(s, s.blackId, 1, blackResult, whiteName, s.whiteId, history, duration);
        recordOne(s, s.whiteId, 2, whiteResult, blackName, s.blackId, history, duration);

        // 记分：终局时仍处于托管连击的一方积分不动（输/平/胜皆 0）；
        // 正常参战者按 胜 +20 / 平 +5 / 负 -10，胜方另加 20 金币
        applyScore(black, blackResult, s.autoBlack > 0);
        applyScore(white, whiteResult, s.autoWhite > 0);

        // 公屏播报（H7+）：在线对局终局，双方结果各播一条
        broadcastResult(black, blackName, blackResult, s.autoBlack > 0);
        broadcastResult(white, whiteName, whiteResult, s.autoWhite > 0);
    }

    /** 终局公屏播报：正常参战按胜负措辞；全程托管离开则提示离线判负 */
    private void broadcastResult(User u, String name, int result, boolean stillAuto) {
        if (u == null) return;
        if (stillAuto) {
            chatService.system(name + " 对局中离线，托管至终局，积分不变");
            return;
        }
        String resultText = result == 1 ? "赢得对局" : result == 0 ? "战平" : "不敌对手";
        int delta = result == 1 ? 20 : result == 0 ? 5 : -10;
        chatService.system(name + " " + resultText + "，积分 "
                + (delta >= 0 ? "+" : "") + delta);
    }

    private void recordOne(Session s, Long userId, int color, int result, String opponent,
                           Long opponentId, String history, int duration) {
        GameRecord rec = new GameRecord();
        rec.setUserId(userId);
        rec.setMode("online");
        rec.setColor(color);
        rec.setResult(result);
        String opp = opponent == null ? (color == 1 ? "白方" : "黑方")
                : (opponent.length() > 20 ? opponent.substring(0, 20) : opponent);
        rec.setOpponent(opp);
        rec.setOpponentId(opponentId);
        rec.setMoves(s.moves.size());
        rec.setDurationSec(duration);
        rec.setHistory(history);
        recordMapper.insert(rec);
    }

    /** 积分：stillAuto=终局时仍在托管连击 → 任何结果都 0；胜方正常时另 +20 金币 */
    private void applyScore(User u, int result, boolean stillAuto) {
        if (u == null) return;
        int delta;
        if (stillAuto) {
            delta = 0;
        } else {
            delta = result == 1 ? 20 : result == 0 ? 5 : -10;
        }
        u.setScore(Math.max(0, (u.getScore() == null ? 0 : u.getScore()) + delta));
        if (result == 1) {
            u.setCoins((u.getCoins() == null ? 0 : u.getCoins()) + 20);
        }
        userMapper.updateById(u);
    }

    private int resultOf(Integer winnerColor, int color) {
        if (winnerColor == null) return 0;
        return winnerColor == color ? 1 : -1;
    }

    private void persist(Session s) {
        GameSession row = sessionMapper.selectById(s.id);
        if (row == null) return;
        row.setStatus(s.status);
        row.setTurnColor(s.turnColor);
        row.setWinnerColor(s.winnerColor);
        row.setEndReason(s.endReason);
        row.setMovesJson(toJson(s.moves));
        row.setResult("finished".equals(s.status) ? resultOf(s.winnerColor, 1) : null);
        row.setUpdatedAt(LocalDateTime.now());
        sessionMapper.updateById(row);
    }

    /** 排队等待应答（无对局信息，仅 status=waiting） */
    private OnlineQueueResp waitingResp() {
        OnlineQueueResp resp = new OnlineQueueResp();
        resp.setStatus("waiting");
        return resp;
    }

    private OnlineQueueResp matched(Long me, Session s) {
        Long opponent = me.equals(s.blackId) ? s.whiteId : s.blackId;
        OnlineQueueResp resp = new OnlineQueueResp();
        resp.setStatus("matched");
        resp.setGameId(s.id);
        resp.setMyColor(me.equals(s.blackId) ? 1 : 2);
        resp.setOpponentName(userName(opponent));
        resp.setResumed(!s.moves.isEmpty()); // 有子 = 回到进行中的局（前端文案据此切换）
        return resp;
    }

    private String userName(Long userId) {
        User u = userMapper.selectById(userId);
        return u == null ? "对手" : nameOrNull(u.getName(), "对手");
    }

    private OnlineSnapshotResp buildSnapshot(Session s, Long me) {
        OnlineSnapshotResp resp = new OnlineSnapshotResp();
        resp.setGameId(s.id);
        resp.setMyColor(colorOf(s, me));
        resp.setStatus(s.status);
        resp.setTurnColor(s.turnColor);
        resp.setMoves(s.moves.stream()
                .map(m -> new SessionSnapshotResp.Stone(m.r(), m.c(), m.color()))
                .toList());
        resp.setWinnerColor(s.winnerColor);
        resp.setEndReason(s.endReason);
        resp.setStartAtMs(s.createdAt == null ? System.currentTimeMillis()
                : java.sql.Timestamp.valueOf(s.createdAt).getTime());
        resp.setDrawPending(colorOf(s, me) == 1 ? s.drawWhite : s.drawBlack);
        // 悔棋申请：对面发起且等待我表态时为 true
        resp.setUndoPending(s.undoBy != null && s.undoBy != colorOf(s, me));
        // 回合倒计时与托管进度（客户端钟表据此渲染）
        resp.setExpireAtMs("playing".equals(s.status)
                ? Long.valueOf(s.lastMoveAt + TURN_MS) : null);
        resp.setAutoBlack(s.autoBlack);
        resp.setAutoWhite(s.autoWhite);
        // 对手离席提示：对手超过阈值（4s）无任何交互开始上报（30s 后端判负），
        // 平局时我也可能拿不到——只在 playing 态计算，finished 下置 null
        int myColor = resp.getMyColor(); // 已在前置 colorOf 校验，必为 1/2
        if ("playing".equals(s.status)) {
            long oppLast = myColor == 1 ? s.lastSeenWhite : s.lastSeenBlack;
            long absent = System.currentTimeMillis() - oppLast;
            if (absent > ABSENT_WARN_MS) resp.setOpponentAbsentMs(absent);
        }
        if ("finished".equals(s.status)) {
            resp.setMyResult(resultOf(s.winnerColor, myColor));
            boolean meAuto = myColor == 1 ? s.autoBlack > 0 : s.autoWhite > 0;
            resp.setMyScoreDelta(meAuto ? 0
                    : resp.getMyResult() == 1 ? 20
                    : resp.getMyResult() == 0 ? 5 : -10);
        }
        resp.setBlackName(userName(s.blackId));
        resp.setWhiteName(userName(s.whiteId));
        return resp;
    }

    private static String nameOrNull(String name, String fallback) {
        return name == null || name.isBlank() ? fallback : name;
    }

    /** null -> 序列化为 null 便于复用 bot 的 JSON 形状 */
    @SneakyThrows
    private String toJson(List<SubmitResultReq.Move> moves) {
        if (moves == null || moves.isEmpty()) return null;
        return objectMapper.writeValueAsString(moves);
    }

    @SneakyThrows
    private List<SubmitResultReq.Move> fromJson(String json) {
        if (json == null || json.isBlank()) return null;
        return objectMapper.readValue(json, objectMapper.getTypeFactory()
                .constructCollectionType(List.class, SubmitResultReq.Move.class));
    }
}
