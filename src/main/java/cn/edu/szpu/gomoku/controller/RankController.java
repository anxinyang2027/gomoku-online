package cn.edu.szpu.gomoku.controller;

import cn.edu.szpu.gomoku.common.ApiResult;
import cn.edu.szpu.gomoku.dto.MyRankVO;
import cn.edu.szpu.gomoku.dto.RankRowVO;
import cn.edu.szpu.gomoku.security.Login;
import cn.edu.szpu.gomoku.service.RankService;
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
public class RankController {

    private final RankService rankService;

    @GetMapping("/rank")
    public ApiResult<List<RankRowVO>> rank(@RequestParam(defaultValue = "50") int limit) {
        return ApiResult.ok(rankService.rank(limit));
    }

    @Login
    @GetMapping("/rank/me")
    public ApiResult<MyRankVO> myRank(HttpServletRequest request) {
        return ApiResult.ok(rankService.me((Long) request.getAttribute("userId")));
    }
}
