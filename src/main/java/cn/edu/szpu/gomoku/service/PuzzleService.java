package cn.edu.szpu.gomoku.service;

import cn.edu.szpu.gomoku.common.BizException;
import cn.edu.szpu.gomoku.entity.Puzzle;
import cn.edu.szpu.gomoku.entity.UserPuzzleProgress;
import cn.edu.szpu.gomoku.mapper.PuzzleMapper;
import cn.edu.szpu.gomoku.mapper.PuzzleProgressMapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
@RequiredArgsConstructor
public class PuzzleService {

    private static final List<String> MODES = List.of("easy", "hard", "hell");

    private final PuzzleMapper puzzleMapper;
    private final PuzzleProgressMapper progressMapper;
    private final ObjectMapper objectMapper;

    private volatile Map<String, List<JsonNode>> cache;

    public Map<String, List<JsonNode>> all() {
        Map<String, List<JsonNode>> local = cache;
        if (local == null) {
            synchronized (this) {
                if (cache == null) {
                    cache = load();
                }
                local = cache;
            }
        }
        return local;
    }

    private Map<String, List<JsonNode>> load() {
        Map<String, List<JsonNode>> out = new ConcurrentHashMap<>();
        for (String mode : MODES) {
            out.put(mode, new ArrayList<>());
        }
        List<Puzzle> rows = puzzleMapper.selectList(
                Wrappers.<Puzzle>lambdaQuery().orderByAsc(Puzzle::getSortNo));
        for (Puzzle row : rows) {
            List<JsonNode> bucket = out.get(row.getMode());
            if (bucket == null) continue;
            bucket.add(toNode(row));
        }
        return out;
    }

    private JsonNode toNode(Puzzle row) {
        com.fasterxml.jackson.databind.node.ObjectNode n = objectMapper.createObjectNode();
        n.put("id", row.getId());
        n.put("mode", row.getMode());
        n.put("name", row.getName());
        n.put("flavor", row.getFlavor());
        n.put("hint", row.getHint());
        try {
            n.set("preset", objectMapper.readTree(row.getPreset()));
            n.set("steps", objectMapper.readTree(row.getSteps()));
        } catch (Exception e) {
            throw new IllegalStateException("puzzle json broken: " + row.getId(), e);
        }
        return n;
    }

    public List<String> cleared(Long userId) {
        if (userId == null) return List.of();
        return progressMapper.selectList(
                        Wrappers.<UserPuzzleProgress>lambdaQuery()
                                .eq(UserPuzzleProgress::getUserId, userId)
                                .orderByAsc(UserPuzzleProgress::getClearedAt))
                .stream().map(UserPuzzleProgress::getPuzzleId).toList();
    }

    public List<String> clearPuzzle(Long userId, String puzzleId) {
        if (userId == null) {
            throw new BizException(401, "请先登录");
        }
        if (puzzleMapper.selectById(puzzleId) == null) {
            throw new BizException(1002, "关卡不存在");
        }
        Long dup = progressMapper.selectCount(Wrappers.<UserPuzzleProgress>lambdaQuery()
                .eq(UserPuzzleProgress::getUserId, userId)
                .eq(UserPuzzleProgress::getPuzzleId, puzzleId));
        if (dup == 0) {
            UserPuzzleProgress p = new UserPuzzleProgress();
            p.setUserId(userId);
            p.setPuzzleId(puzzleId);
            p.setClearedAt(LocalDateTime.now());
            progressMapper.insert(p);
        }
        return cleared(userId);
    }
}
