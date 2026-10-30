package cn.edu.szpu.gomoku.controller;

import cn.edu.szpu.gomoku.common.ApiResult;
import cn.edu.szpu.gomoku.dto.CheckinResp;
import cn.edu.szpu.gomoku.security.Login;
import cn.edu.szpu.gomoku.service.CheckinService;
import jakarta.servlet.http.HttpServletRequest;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class CheckinController {

    private final CheckinService checkinService;

    /** 签到面板（今天签没签 / 本月日历 / 可补签日 / 奖励表 / 余额） */
    @Login
    @GetMapping("/checkin")
    public ApiResult<CheckinResp> panel(HttpServletRequest request) {
        return ApiResult.ok(checkinService.panel((Long) request.getAttribute("userId")));
    }

    /** 今日签到 */
    @Login
    @PostMapping("/checkin/do")
    public ApiResult<CheckinResp> checkin(HttpServletRequest request) {
        return ApiResult.ok(checkinService.checkin((Long) request.getAttribute("userId")));
    }

    /** 补签（500 金币一次，补本月内的漏签日） */
    @Login
    @PostMapping("/checkin/makeup")
    public ApiResult<CheckinResp> makeup(@RequestBody MakeupReq body, HttpServletRequest request) {
        LocalDate date = null;
        if (body != null && body.getDate() != null && !body.getDate().isBlank()) {
            date = LocalDate.parse(body.getDate()); // 形如 2026-10-29
        }
        return ApiResult.ok(checkinService.makeup((Long) request.getAttribute("userId"), date));
    }

    @Data
    public static class MakeupReq {
        private String date;
    }
}
