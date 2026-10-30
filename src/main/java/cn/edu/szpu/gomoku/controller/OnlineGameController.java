package cn.edu.szpu.gomoku.controller;

import cn.edu.szpu.gomoku.common.ApiResult;
import cn.edu.szpu.gomoku.dto.OnlineMoveReq;
import cn.edu.szpu.gomoku.dto.OnlineRoomJoinReq;
import cn.edu.szpu.gomoku.dto.OnlineRoomResp;
import cn.edu.szpu.gomoku.dto.OnlineSessionReq;
import cn.edu.szpu.gomoku.dto.OnlineSnapshotResp;
import cn.edu.szpu.gomoku.dto.OnlineQueueResp;
import cn.edu.szpu.gomoku.security.Login;
import cn.edu.szpu.gomoku.service.OnlineGameService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * 九期：真实玩家在线匹配对战（HTTP 轮询）。
 */
@RestController
@RequestMapping("/api/online")
@RequiredArgsConstructor
public class OnlineGameController {

    private final OnlineGameService onlineGameService;

    private Long userId(HttpServletRequest request) {
        return (Long) request.getAttribute("userId");
    }

    /** 加入匹配池/回到当前局 */
    @Login
    @PostMapping("/queue/join")
    public ApiResult<OnlineQueueResp> join(HttpServletRequest request) {
        return ApiResult.ok(onlineGameService.join(userId(request)));
    }

    /** 排队状态轮询 */
    @Login
    @GetMapping("/queue/status")
    public ApiResult<OnlineQueueResp> status(HttpServletRequest request) {
        return ApiResult.ok(onlineGameService.poll(userId(request)));
    }

    /** 取消排队 */
    @Login
    @PostMapping("/queue/cancel")
    public ApiResult<Boolean> cancel(HttpServletRequest request) {
        return ApiResult.ok(onlineGameService.cancel(userId(request)));
    }

    /* ---------- 房间组队（凭房间号邀请好友） ---------- */

    /** 创建房间（房主执黑，等待对手凭房间号加入） */
    @Login
    @PostMapping("/room/create")
    public ApiResult<OnlineRoomResp> createRoom(HttpServletRequest request) {
        return ApiResult.ok(onlineGameService.createRoom(userId(request)));
    }

    /** 房主侧房间状态轮询（等待中带房间号；对手加入即 matched） */
    @Login
    @GetMapping("/room/status")
    public ApiResult<OnlineRoomResp> roomStatus(HttpServletRequest request) {
        return ApiResult.ok(onlineGameService.pollRoom(userId(request)));
    }

    /** 凭房间号加入（即与房主成局） */
    @Login
    @PostMapping("/room/join")
    public ApiResult<OnlineRoomResp> joinRoom(@Valid @RequestBody OnlineRoomJoinReq req,
                                              HttpServletRequest request) {
        return ApiResult.ok(onlineGameService.joinRoom(userId(request), req.getCode()));
    }

    /** 对局快照（轮询） */
    @Login
    @GetMapping("/game/{gameId}")
    public ApiResult<OnlineSnapshotResp> snapshot(@PathVariable Long gameId, HttpServletRequest request) {
        return ApiResult.ok(onlineGameService.snapshot(userId(request), gameId));
    }

    /** 落子（服务端权威，谁轮到谁落） */
    @Login
    @PostMapping("/game/move")
    public ApiResult<OnlineSnapshotResp> move(@Valid @RequestBody OnlineMoveReq req, HttpServletRequest request) {
        return ApiResult.ok(onlineGameService.move(userId(request), req.getGameId(), req.getR(), req.getC()));
    }

    /** 认输 */
    @Login
    @PostMapping("/game/resign")
    public ApiResult<OnlineSnapshotResp> resign(@Valid @RequestBody OnlineSessionReq req, HttpServletRequest request) {
        return ApiResult.ok(onlineGameService.resign(userId(request), req.getGameId()));
    }

    /** 求和（双方有一次即平） */
    @Login
    @PostMapping("/game/draw")
    public ApiResult<OnlineSnapshotResp> draw(@Valid @RequestBody OnlineSessionReq req, HttpServletRequest request) {
        return ApiResult.ok(onlineGameService.draw(userId(request), req.getGameId()));
    }

    /** 拒绝求和 */
    @Login
    @PostMapping("/game/draw/reject")
    public ApiResult<OnlineSnapshotResp> rejectDraw(@Valid @RequestBody OnlineSessionReq req, HttpServletRequest request) {
        return ApiResult.ok(onlineGameService.rejectDraw(userId(request), req.getGameId()));
    }

    /** 悔棋申请（对方应答） */
    @Login
    @PostMapping("/game/undo")
    public ApiResult<OnlineSnapshotResp> requestUndo(@Valid @RequestBody OnlineSessionReq req, HttpServletRequest request) {
        return ApiResult.ok(onlineGameService.requestUndo(userId(request), req.getGameId()));
    }

    /** 悔棋应答：agree=true 回退一整个回合 */
    @Login
    @PostMapping("/game/undo/answer")
    public ApiResult<OnlineSnapshotResp> answerUndo(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        Long gameId = body.get("gameId") instanceof Number n ? n.longValue() : null;
        boolean agree = Boolean.TRUE.equals(body.get("agree"));
        return ApiResult.ok(onlineGameService.answerUndo(userId(request), gameId, agree));
    }
}
