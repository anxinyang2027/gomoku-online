package cn.edu.szpu.gomoku.controller;

import cn.edu.szpu.gomoku.common.ApiResult;
import cn.edu.szpu.gomoku.dto.AuthReq;
import cn.edu.szpu.gomoku.dto.AuthResp;
import cn.edu.szpu.gomoku.service.UserService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class AuthController {

    private final UserService userService;

    @PostMapping("/register")
    public ApiResult<AuthResp> register(@Valid @RequestBody AuthReq req) {
        return ApiResult.ok(userService.register(req.getName(), req.getPassword()));
    }

    @PostMapping("/login")
    public ApiResult<AuthResp> login(@Valid @RequestBody AuthReq req) {
        return ApiResult.ok(userService.login(req.getName(), req.getPassword()));
    }
}
