package cn.edu.szpu.gomoku.controller;

import cn.edu.szpu.gomoku.common.ApiResult;
import cn.edu.szpu.gomoku.security.Login;
import cn.edu.szpu.gomoku.service.PuzzleService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class PuzzleProgressController {

    private final PuzzleService puzzleService;

    @GetMapping("/puzzle/progress")
    public ApiResult<Map<String, List<String>>> progress(HttpServletRequest request) {
        return ApiResult.ok(Map.of("cleared",
                puzzleService.cleared((Long) request.getAttribute("userId"))));
    }

    @Login
    @PostMapping("/puzzle/progress")
    public ApiResult<Map<String, List<String>>> clear(
            @RequestBody @Valid ClearReq req,
            HttpServletRequest request) {
        List<String> cleared = puzzleService.clearPuzzle(
                (Long) request.getAttribute("userId"), req.puzzleId);
        return ApiResult.ok(Map.of("cleared", cleared));
    }

    public static class ClearReq {
        @NotBlank(message = "缺少关卡 id")
        public String puzzleId;
    }
}
