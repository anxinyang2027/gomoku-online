package cn.edu.szpu.gomoku.controller;

import cn.edu.szpu.gomoku.common.ApiResult;
import cn.edu.szpu.gomoku.dto.HistoryVO;
import cn.edu.szpu.gomoku.service.GameService;
import cn.edu.szpu.gomoku.security.Login;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class HistoryController {

    private final GameService gameService;

    @Login
    @GetMapping("/history")
    public ApiResult<List<HistoryVO>> history(HttpServletRequest request,
                                              @RequestParam(defaultValue = "1") int page,
                                              @RequestParam(defaultValue = "20") int size) {
        return ApiResult.ok(gameService.history((Long) request.getAttribute("userId"), page, size));
    }
}
