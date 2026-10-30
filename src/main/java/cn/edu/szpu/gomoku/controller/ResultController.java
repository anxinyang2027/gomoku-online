package cn.edu.szpu.gomoku.controller;

import cn.edu.szpu.gomoku.common.ApiResult;
import cn.edu.szpu.gomoku.dto.ResultResp;
import cn.edu.szpu.gomoku.dto.SubmitResultReq;
import cn.edu.szpu.gomoku.service.GameService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class ResultController {

    private final GameService gameService;

    @PostMapping("/result")
    public ApiResult<ResultResp> submit(@Valid @RequestBody SubmitResultReq req, HttpServletRequest request) {
        return ApiResult.ok(gameService.submit((Long) request.getAttribute("userId"), req));
    }
}
