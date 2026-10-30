package cn.edu.szpu.gomoku.controller;

import cn.edu.szpu.gomoku.common.ApiResult;
import cn.edu.szpu.gomoku.dto.BuyResp;
import cn.edu.szpu.gomoku.dto.ShopItemVO;
import cn.edu.szpu.gomoku.entity.ShopItem;
import cn.edu.szpu.gomoku.mapper.ShopItemMapper;
import cn.edu.szpu.gomoku.security.Login;
import cn.edu.szpu.gomoku.service.UserService;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class ShopController {

    private final ShopItemMapper shopItemMapper;
    private final ObjectMapper objectMapper;
    private final UserService userService;

    @GetMapping("/shop")
    public ApiResult<List<ShopItemVO>> shop() {
        List<ShopItem> items = shopItemMapper.selectList(
                Wrappers.<ShopItem>lambdaQuery()
                        .orderByAsc(ShopItem::getPrice));
        List<ShopItemVO> list = items.stream().map(this::toVo).toList();
        return ApiResult.ok(list);
    }

    @Login
    @PostMapping("/shop/buy")
    public ApiResult<BuyResp> buy(@RequestBody Map<String, String> body, HttpServletRequest request) {
        return ApiResult.ok(userService.buy((Long) request.getAttribute("userId"), body.get("itemId")));
    }

    @Login
    @PostMapping("/user/skin")
    public ApiResult<java.util.Map<String, String>> skin(@RequestBody Map<String, String> body,
                                                         HttpServletRequest request) {
        return ApiResult.ok(userService.applySkin((Long) request.getAttribute("userId"), body.get("itemId")));
    }

    private ShopItemVO toVo(ShopItem it) {
        ShopItemVO vo = new ShopItemVO();
        vo.setId(it.getId());
        vo.setCat(it.getCat());
        vo.setName(it.getName());
        vo.setPrice(it.getPrice());
        vo.setCurrency(it.getCurrency() == null || it.getCurrency().isBlank()
                ? "coin" : it.getCurrency());
        if (it.getColors() != null) {
            try {
                vo.setColors(objectMapper.readValue(it.getColors(),
                        new TypeReference<java.util.Map<String, String>>() {
                        }));
            } catch (Exception ignored) {
            }
        }
        vo.setGlyph(it.getGlyph());
        vo.setImg(it.getImg());
        return vo;
    }
}
