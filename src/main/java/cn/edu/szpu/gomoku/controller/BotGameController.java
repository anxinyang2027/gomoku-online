package cn.edu.szpu.gomoku.controller;

import cn.edu.szpu.gomoku.common.ApiResult;
import cn.edu.szpu.gomoku.dto.BotMoveReq;
import cn.edu.szpu.gomoku.dto.BotMoveResp;
import cn.edu.szpu.gomoku.dto.BotStartResp;
import cn.edu.szpu.gomoku.dto.SessionSnapshotResp;
import cn.edu.szpu.gomoku.security.Login;
import cn.edu.szpu.gomoku.service.BotGameService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 七期(J9):bot 权威对局接口。
 * start:开新局(玩家执黑先行);move:落子并等待 AI 应答;
 * state:局面快照(断线恢复);stop:中止未完成的局。
 */
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class BotGameController {

    private final BotGameService botGameService;

    @Login
    @PostMapping("/game/bot/start")
    public ApiResult<BotStartResp> start(@RequestBody Map<String, Integer> body, HttpServletRequest request) {
        Integer difficulty = body == null ? null : body.get("difficulty");
        return ApiResult.ok(botGameService.start((Long) request.getAttribute("userId"), difficulty));
    }

    @Login
    @PostMapping("/game/bot/move")
    public ApiResult<BotMoveResp> move(@Valid @RequestBody BotMoveReq req, HttpServletRequest request) {
        return ApiResult.ok(botGameService.move((Long) request.getAttribute("userId"), req.getSessionId(), req.getR(), req.getC()));
    }

    /** 人机悔棋：AI 按棋力概率决定是否同意 */
    @Login
    @PostMapping("/game/bot/undo")
    public ApiResult<Map<String, Object>> undo(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        Long sessionId = body.get("sessionId") instanceof Number n ? n.longValue() : null;
        return ApiResult.ok(botGameService.undo((Long) request.getAttribute("userId"), sessionId));
    }

    /** 人机求和：AI 视局势决定是否接受 */
    @Login
    @PostMapping("/game/bot/draw")
    public ApiResult<Map<String, Object>> draw(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        Long sessionId = body.get("sessionId") instanceof Number n ? n.longValue() : null;
        return ApiResult.ok(botGameService.draw((Long) request.getAttribute("userId"), sessionId));
    }

    @Login
    @GetMapping("/game/{sessionId}")
    public ApiResult<SessionSnapshotResp> state(@PathVariable Long sessionId, HttpServletRequest request) {
        return ApiResult.ok(botGameService.state((Long) request.getAttribute("userId"), sessionId));
    }

    @Login
    @PostMapping("/game/bot/stop/{sessionId}")
    public ApiResult<Void> stop(@PathVariable Long sessionId, HttpServletRequest request) {
        botGameService.stop((Long) request.getAttribute("userId"), sessionId);
        return ApiResult.ok();
    }
}
