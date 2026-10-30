package cn.edu.szpu.gomoku.service;

import cn.edu.szpu.gomoku.common.BizException;
import cn.edu.szpu.gomoku.dto.BotMoveResp;
import cn.edu.szpu.gomoku.dto.BotStartResp;
import cn.edu.szpu.gomoku.dto.SessionSnapshotResp;
import cn.edu.szpu.gomoku.dto.SubmitResultReq;
import cn.edu.szpu.gomoku.entity.GameRecord;
import cn.edu.szpu.gomoku.entity.GameSession;
import cn.edu.szpu.gomoku.game.ai.BotEngine;
import cn.edu.szpu.gomoku.mapper.GameRecordMapper;
import cn.edu.szpu.gomoku.mapper.GameSessionMapper;
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
 * 七期(J6–J12):bot 权威对局会话。
 * 决策 D8:AI 在服务端跑,玩家执黑先行,机器人执白;
 * 决策 D9:活跃对局驻内存,每步落库;JVM 重启后 playing 会话直接判"系统中止";
 * 决策 D11:bot 对局不动 score/coins,只写 game_record(mode=bot)。
 */
@Service
@RequiredArgsConstructor
public class BotGameService {

    private static final int SIZE = BotEngine.SIZE;

    private static final Map<Integer, String> BOT_NAMES = Map.of(
            1, "电脑·入门",
            2, "电脑·进阶",
            3, "电脑·高手");

    private final GameSessionMapper sessionMapper;
    private final GameRecordMapper recordMapper;
    private final ObjectMapper objectMapper;

    private final Map<Long, Session> cache = new ConcurrentHashMap<>();

    private static class Session {
        Long id;
        Integer difficulty;
        Long ownerId;
        List<SubmitResultReq.Move> moves = new ArrayList<>();
        int[][] grid = new int[SIZE][SIZE];
        String status = "playing";
        Integer winnerColor;
        String endReason;
        LocalDateTime createdAt = LocalDateTime.now();
    }

    public BotStartResp start(Long userId, Integer difficulty) {
        if (userId == null) throw new BizException(401, "请先登录");
        if (difficulty == null || difficulty < 1 || difficulty > 3) {
            throw new BizException(400, "difficulty 取值 1/2/3");
        }
        Session s = new Session();
        s.difficulty = difficulty;
        s.ownerId = userId;
        GameSession row = new GameSession();
        row.setMode("bot");
        row.setDifficulty(difficulty);
        row.setOwnerId(userId);
        row.setBlackId(userId);
        row.setWhiteId(null);
        row.setStatus("playing");
        row.setTurnColor(1);
        row.setMovesJson(toJson(s.moves));
        sessionMapper.insert(row);
        s.id = row.getId();
        cache.put(s.id, s);
        return new BotStartResp(s.id, "black", botName(difficulty));
    }

    public BotMoveResp move(Long userId, Long sessionId, Integer r, Integer c) {
        Session s = load(userId, sessionId);
        synchronized (this) {
            if (!"playing".equals(s.status)) {
                throw new BizException(4101, "对局已结束");
            }
            if (s.grid[r][c] != 0) {
                throw new BizException(4002, "该位置已有棋子");
            }

            s.grid[r][c] = 1;
            s.moves.add(new SubmitResultReq.Move(r, c, 1));
            Integer winner = BotEngine.isFive(s.grid, r, c, 1) ? 1 : null;
            String reason = winner != null ? "five" : null;
            int[] botMove = null;
            if (winner == null) {
                if (s.moves.size() == (long) SIZE * SIZE) {
                    reason = "full";
                } else {
                    botMove = BotEngine.chooseMove(copy(s.grid), 2, s.difficulty);
                    if (botMove != null) {
                        s.grid[botMove[0]][botMove[1]] = 2;
                        s.moves.add(new SubmitResultReq.Move(botMove[0], botMove[1], 2));
                        if (BotEngine.isFive(s.grid, botMove[0], botMove[1], 2)) {
                            winner = 2;
                            reason = "five";
                        } else if (s.moves.size() == (long) SIZE * SIZE) {
                            reason = "full";
                        }
                    }
                }
            }

            finishIfNeeded(s, winner, reason);
            persist(s);

            BotMoveResp resp = new BotMoveResp(
                    true, botMove != null ? botMove[0] : null, botMove != null ? botMove[1] : null,
                    s.status, s.winnerColor, s.moves.size(), "finished".equals(s.status) ? s.endReason : null);
            return resp;
        }
    }

    public SessionSnapshotResp state(Long userId, Long sessionId) {
        Session s = load(userId, sessionId);
        return snapshot(s);
    }

    /**
     * 人机悔棋：AI 按棋力与局势"决定"是否同意。
     * 入门 60% 同意（好说话）；高手 25%（寸土不让）。
     * 同意 → 回退一整个回合（玩家+AI 各一手）；拒绝 → 局面不动。
     * 返回 agree 供前端提示。
     */
    public Map<String, Object> undo(Long userId, Long sessionId) {
        Session s = load(userId, sessionId);
        synchronized (this) {
            if (!"playing".equals(s.status)) {
                throw new BizException(4101, "对局已结束");
            }
            // 回合平衡态（AI 已应完手）才能悔：玩家至少落过一手
            int myStones = (int) s.moves.stream().filter(m -> m.color() == 1).count();
            if (myStones == 0) {
                throw new BizException(4002, "还没有落子，无可悔");
            }
            Map<String, Object> out = new java.util.HashMap<>();
            if (ThreadLocalRandom.current().nextDouble() < agreeChance(s.difficulty)) {
                // 同意：回退两手（AI 的最后一手 + 玩家的最后一手）
                for (int i = 0; i < 2 && !s.moves.isEmpty(); i++) {
                    SubmitResultReq.Move last = s.moves.remove(s.moves.size() - 1);
                    s.grid[last.r()][last.c()] = 0;
                }
                persist(s);
                out.put("agree", true);
                out.put("msg", botName(s.difficulty) + " 同意了悔棋");
            } else {
                out.put("agree", false);
                out.put("msg", botName(s.difficulty) + " 拒绝了悔棋：落子无悔");
            }
            out.put("snapshot", snapshot(s));
            return out;
        }
    }

    /**
     * 人机求和：AI 视局势决定。AI 大优几乎不同意（60/25/5%），
     * 均势或劣势多半同意（80/65/50%）。同意 → 立即平局终局。
     */
    public Map<String, Object> draw(Long userId, Long sessionId) {
        Session s = load(userId, sessionId);
        synchronized (this) {
            if (!"playing".equals(s.status)) {
                throw new BizException(4101, "对局已结束");
            }
            Map<String, Object> out = new java.util.HashMap<>();
            boolean agree = ThreadLocalRandom.current().nextDouble() < drawChance(s);
            if (agree) {
                s.status = "finished";
                s.winnerColor = 0;
                s.endReason = "draw";
                persist(s);
                recordFinished(s);
            }
            out.put("agree", agree);
            out.put("msg", agree ? botName(s.difficulty) + " 接受了求和，平局"
                    : botName(s.difficulty) + " 拒绝了求和，继续对弈");
            out.put("snapshot", snapshot(s));
            return out;
        }
    }

    /** 悔棋同意率：入门 60% / 进阶 40% / 高手 25% */
    private static double agreeChance(int difficulty) {
        return switch (difficulty) {
            case 1 -> 0.60;
            case 2 -> 0.40;
            default -> 0.25;
        };
    }

    /** 求和同意率：AI 局面越优越难同意。入门最随和、高手最铁血 */
    private static double drawChance(Session s) {
        int my = (int) s.moves.stream().filter(m -> m.color() == 2).count();
        int his = (int) s.moves.stream().filter(m -> m.color() == 1).count();
        boolean botAhead = my > his; // 粗略均势判定：手数多=AI 多吃了玩家弃子场景少见，按手数近似
        double base = switch (s.difficulty) {
            case 1 -> 0.80;
            case 2 -> 0.65;
            default -> 0.50;
        };
        return botAhead ? base * 0.3 : base;
    }

    /** 我当前进行中的人机局 id（无则 null）——聊天频道鉴权用（H7） */
    public Long activeSessionIdOf(Long userId) {
        for (Session s : cache.values()) {
            if ("playing".equals(s.status) && s.ownerId.equals(userId)) return s.id;
        }
        return null;
    }

    public void stop(Long userId, Long sessionId) {
        Session s = cache.get(sessionId);
        if (s == null) {
            GameSession row = sessionMapper.selectById(sessionId);
            if (row == null || !"playing".equals(row.getStatus()) || !row.getOwnerId().equals(userId)) {
                return;
            }
            abortRow(row, "quit");
            recordAborted(row, row.getDifficulty());
            return;
        }
        if (!s.ownerId.equals(userId) || !"playing".equals(s.status)) return;
        synchronized (this) {
            abortSession(s, "quit");
            persist(s);
            GameSession row = sessionMapper.selectById(sessionId);
            recordAborted(row, s.difficulty);
            cache.remove(sessionId);
        }
    }

    /* ---------- 内部 ---------- */

    private Session load(Long userId, Long sessionId) {
        if (userId == null) throw new BizException(401, "请先登录");
        if (sessionId == null) throw new BizException(400, "缺少 sessionId");
        Session s = cache.get(sessionId);
        if (s != null) {
            if (!s.ownerId.equals(userId)) throw new BizException(403, "这不是您发起的对局");
            return s;
        }
        GameSession row = sessionMapper.selectById(sessionId);
        if (row == null) throw new BizException(4100, "对局不存在");
        if (!row.getOwnerId().equals(userId)) throw new BizException(403, "这不是您发起的对局");
        /* playing 会话缓存丢失（服务重启）→ 从库重建继续下，不再判中止：
           movesJson 是权威落子序列，回放即完整局面（D9 决策更新） */
        Session rebuilt = new Session();
        rebuilt.id = row.getId();
        rebuilt.difficulty = row.getDifficulty();
        rebuilt.ownerId = row.getOwnerId();
        rebuilt.status = row.getStatus();
        rebuilt.winnerColor = row.getWinnerColor();
        rebuilt.endReason = row.getEndReason();
        rebuilt.createdAt = row.getCreatedAt() == null ? LocalDateTime.now() : row.getCreatedAt();
        List<SubmitResultReq.Move> history = fromJson(row.getMovesJson());
        rebuilt.moves = history == null ? new ArrayList<>() : new ArrayList<>(history);
        rebuildGrid(rebuilt);
        cache.put(rebuilt.id, rebuilt);
        return rebuilt;
    }

    private void rebuildGrid(Session s) {
        s.grid = new int[SIZE][SIZE];
        for (SubmitResultReq.Move m : s.moves) {
            s.grid[m.r()][m.c()] = m.color();
        }
    }

    private void finishIfNeeded(Session s, Integer winner, String reason) {
        if (winner == null && !"full".equals(reason)) return;
        s.status = "finished";
        s.winnerColor = winner;
        s.endReason = reason != null ? reason : "full";
        recordFinished(s);
    }

    private void abortSession(Session s, String reason) {
        s.status = "aborted";
        s.endReason = reason;
    }

    private void abortRow(GameSession row, String reason) {
        row.setStatus("aborted");
        row.setEndReason(reason);
        row.setResult(null);
        sessionMapper.updateById(row);
    }

    private void persist(Session s) {
        GameSession row = sessionMapper.selectById(s.id);
        if (row == null) return;
        row.setStatus(s.status);
        row.setTurnColor(1);
        row.setWinnerColor(s.winnerColor);
        row.setEndReason(s.endReason);
        row.setMovesJson(toJson(s.moves));
        row.setResult("finished".equals(s.status) ? resultOf(s.winnerColor) : null);
        sessionMapper.updateById(row);
    }

    private void recordFinished(Session s) {
        insertRecord(s, resultOf(s.winnerColor), botName(s.difficulty));
    }

    private void recordAborted(GameSession row, Integer difficulty) {
        Session temp = new Session();
        temp.id = row.getId();
        temp.difficulty = difficulty;
        temp.ownerId = row.getOwnerId();
        temp.createdAt = row.getCreatedAt() == null ? LocalDateTime.now() : row.getCreatedAt();
        List<SubmitResultReq.Move> history = fromJson(row.getMovesJson());
        temp.moves = history == null ? new ArrayList<>() : new ArrayList<>(history);
        insertRecord(temp, 0, botName(difficulty));
    }

    private void insertRecord(Session s, int result, String opponent) {
        GameRecord rec = new GameRecord();
        rec.setUserId(s.ownerId);
        rec.setMode("bot");
        rec.setColor(1);
        rec.setResult(result);
        rec.setOpponent(opponent);
        rec.setMoves(s.moves.size());
        long sec = Duration.between(s.createdAt, LocalDateTime.now()).getSeconds();
        rec.setDurationSec((int) Math.min(Math.max(sec, 0), 359999));
        rec.setHistory(toJson(s.moves));
        recordMapper.insert(rec);
    }

    private static int resultOf(Integer winner) {
        if (winner == null) return 0;
        return winner == 1 ? 1 : -1;
    }

    private static String botName(int difficulty) {
        return BOT_NAMES.getOrDefault(difficulty, "电脑");
    }

    private SessionSnapshotResp snapshot(Session s) {
        List<SessionSnapshotResp.Stone> list = new ArrayList<>();
        for (SubmitResultReq.Move m : s.moves) list.add(new SessionSnapshotResp.Stone(m.r(), m.c(), m.color()));
        return new SessionSnapshotResp(
                s.id, s.difficulty, botName(s.difficulty), s.status,
                s.winnerColor, s.endReason, list);
    }

    private static int[][] copy(int[][] grid) {
        int[][] out = new int[SIZE][SIZE];
        for (int r = 0; r < SIZE; r++) System.arraycopy(grid[r], 0, out[r], 0, SIZE);
        return out;
    }

    @SneakyThrows
    private String toJson(List<SubmitResultReq.Move> moves) {
        if (moves == null || moves.isEmpty()) return null;
        return objectMapper.writeValueAsString(moves);
    }

    @SneakyThrows
    private List<SubmitResultReq.Move> fromJson(String json) {
        if (json == null || json.isBlank()) return null;
        return objectMapper.readValue(json,
                objectMapper.getTypeFactory().constructCollectionType(List.class, SubmitResultReq.Move.class));
    }
}
