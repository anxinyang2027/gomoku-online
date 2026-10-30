package cn.edu.szpu.gomoku.service;

import cn.edu.szpu.gomoku.common.BizException;
import cn.edu.szpu.gomoku.dto.HistoryVO;
import cn.edu.szpu.gomoku.dto.ResultResp;
import cn.edu.szpu.gomoku.dto.SubmitResultReq;
import cn.edu.szpu.gomoku.entity.GameRecord;
import cn.edu.szpu.gomoku.entity.User;
import cn.edu.szpu.gomoku.game.Referee;
import cn.edu.szpu.gomoku.mapper.GameRecordMapper;
import cn.edu.szpu.gomoku.mapper.UserMapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.SneakyThrows;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.format.DateTimeFormatter;
import java.util.List;

@Service
@RequiredArgsConstructor
public class GameService {

    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

    private final GameRecordMapper recordMapper;
    private final UserMapper userMapper;
    private final ObjectMapper objectMapper;
    private final ChatService chatService;

    @Transactional
    public ResultResp submit(Long userId, SubmitResultReq req) {
        if (userId == null) {
            throw new BizException(401, "请先登录");
        }
        Integer winner = req.getWinner();
        if (winner == null) {
            throw new BizException(400, "缺少 winner");
        }
        int color = req.getColor() == null ? 1 : req.getColor();
        if (color != 1 && color != 2) {
            throw new BizException(400, "color 取值 1/2");
        }

        List<SubmitResultReq.Move> history = req.getHistory();
        String reason = req.getReason() == null ? "five" : req.getReason();
        if (history != null && !history.isEmpty()) {
            int r = Referee.judge(history);
            if (r == -2) {
                throw new BizException(4002, "落子序列不合法");
            }
            if ("five".equals(reason)) {
                // 五连终局：序列必须真的以该方五连收尾
                if (winner == 0 || r != winner) {
                    throw new BizException(4002, "对局校验失败");
                }
            } else {
                // 认输 / 求和：序列不该已分出胜负（judge 为 -1/0）
                if (r == 1 || r == 2) {
                    throw new BizException(4002, "对局校验失败");
                }
                if ("resign".equals(reason) && winner == 0) {
                    throw new BizException(4002, "认输必须有胜方");
                }
                if ("draw".equals(reason) && winner != 0) {
                    throw new BizException(4002, "对局校验失败");
                }
            }
        } else if ("five".equals(reason) && winner != 0) {
            throw new BizException(4002, "缺少落子序列，无法校验五连");
        }

        int result;
        if (winner == 0) {
            result = 0;
        } else if (winner == color) {
            result = 1;
        } else {
            result = -1;
        }
        int delta = result == 1 ? 20 : result == 0 ? 5 : -10;

        User u = userMapper.selectById(userId);
        int newScore = Math.max(0, u.getScore() + delta);
        u.setScore(newScore);
        if (result == 1) {
            u.setCoins(u.getCoins() + 20);
        }
        userMapper.updateById(u);

        GameRecord rec = new GameRecord();
        rec.setUserId(userId);
        rec.setMode("local");
        rec.setColor(color);
        rec.setResult(result);
        String opp = req.getOpponent() == null || req.getOpponent().isBlank()
                ? (color == 1 ? "白方" : "黑方")
                : req.getOpponent().trim();
        rec.setOpponent(opp.length() > 20 ? opp.substring(0, 20) : opp);
        rec.setMoves(history != null && !history.isEmpty() ? history.size()
                : (req.getMoves() == null ? 0 : req.getMoves()));
        rec.setDurationSec(seconds(req.getTimeMs()));
        rec.setHistory(toJson(history));
        recordMapper.insert(rec);

        // 公屏播报（H7+）：胜/平/负的积分变化，同屏对战人人可见
        String resultText = result == 1 ? "赢得对局" : result == 0 ? "战平" : "不敌对手";
        chatService.system(u.getName() + " " + resultText + "，积分 "
                + (delta >= 0 ? "+" : "") + delta);

        return new ResultResp(delta, newScore);
    }

    public List<HistoryVO> history(Long userId, int page, int size) {
        Page<GameRecord> p = recordMapper.selectPage(
                new Page<>(page, Math.min(size, 100)),
                com.baomidou.mybatisplus.core.toolkit.Wrappers.<GameRecord>lambdaQuery()
                        .eq(GameRecord::getUserId, userId)
                        .orderByDesc(GameRecord::getCreatedAt));
        return p.getRecords().stream().map(this::toVo).toList();
    }

    private HistoryVO toVo(GameRecord rec) {
        HistoryVO vo = new HistoryVO();
        vo.setWin(rec.getResult() == 1);
        vo.setOpponent(rec.getOpponent());
        int sec = rec.getDurationSec() == null ? 0 : rec.getDurationSec();
        vo.setTime("%02d:%02d".formatted(sec / 60, sec % 60));
        vo.setMoves(rec.getMoves());
        vo.setDate(rec.getCreatedAt() == null ? "" : rec.getCreatedAt().format(DATE_FMT));
        return vo;
    }

    private Integer seconds(Long timeMs) {
        if (timeMs == null || timeMs < 0) return 0;
        long s = timeMs / 1000;
        return (int) Math.min(s, 359999);
    }

    @SneakyThrows
    private String toJson(List<SubmitResultReq.Move> history) {
        if (history == null || history.isEmpty()) return null;
        return objectMapper.writeValueAsString(history);
    }
}
