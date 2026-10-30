package cn.edu.szpu.gomoku.service;

import cn.edu.szpu.gomoku.common.BizException;
import cn.edu.szpu.gomoku.dto.AuthResp;
import cn.edu.szpu.gomoku.dto.BuyResp;
import cn.edu.szpu.gomoku.dto.UserVO;
import cn.edu.szpu.gomoku.entity.ShopItem;
import cn.edu.szpu.gomoku.entity.User;
import cn.edu.szpu.gomoku.entity.UserItem;
import cn.edu.szpu.gomoku.mapper.ShopItemMapper;
import cn.edu.szpu.gomoku.mapper.UserItemMapper;
import cn.edu.szpu.gomoku.mapper.UserMapper;
import cn.edu.szpu.gomoku.security.JwtUtil;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class UserService {

    private final UserMapper userMapper;
    private final BCryptPasswordEncoder encoder;
    private final JwtUtil jwtUtil;
    private final ShopItemMapper shopItemMapper;
    private final UserItemMapper userItemMapper;

    public AuthResp register(String name, String password) {
        name = name.trim();
        Long dup = userMapper.selectCount(Wrappers.<User>lambdaQuery().eq(User::getName, name));
        if (dup > 0) {
            throw new BizException(1001, "用户名已存在");
        }
        User u = new User();
        u.setName(name);
        u.setPassword(encoder.encode(password));
        u.setScore(1000);
        u.setCoins(500);
        u.setBoardId("board-default");
        u.setAvatarId("avatar-buns"); // 初始头像：双丸子（免费默认款）
        userMapper.insert(u);
        return toAuthResp(u, null);
    }

    public AuthResp login(String name, String password) {
        User u = userMapper.selectOne(Wrappers.<User>lambdaQuery().eq(User::getName, name.trim()));
        if (u == null || !encoder.matches(password, u.getPassword())) {
            throw new BizException(4001, "用户名或密码错误");
        }
        u.setLastLogin(LocalDateTime.now());
        userMapper.updateById(u);
        return toAuthResp(u, jwtUtil.issue(u.getId()));
    }

    public UserVO me(Long userId) {
        if (userId == null) return null;
        User u = userMapper.selectById(userId);
        if (u == null) return null;
        UserVO vo = new UserVO();
        vo.setId(u.getId());
        vo.setName(u.getName());
        vo.setScore(u.getScore());
        vo.setCoins(u.getCoins());
        vo.setDiamonds(u.getDiamonds());
        vo.setSkins(skinsOf(u));
        vo.setOwned(ownedIds(u.getId()));
        return vo;
    }

    @Transactional
    public BuyResp buy(Long userId, String itemId) {
        User u = userMapper.selectById(userId);
        ShopItem item = shopItemMapper.selectById(itemId);
        if (item == null) {
            throw new BizException(1002, "商品不存在");
        }
        if (item.getPrice() == null || item.getPrice() == 0) {
            throw new BizException(2003, "默认款无需购买，可直接使用");
        }
        UserItem exists = userItemMapper.selectOne(Wrappers.<UserItem>lambdaQuery()
                .eq(UserItem::getUserId, userId)
                .eq(UserItem::getItemId, itemId));
        if (exists != null) {
            throw new BizException(2002, "已拥有该商品");
        }
        // 按商品计价货币扣费：diamond=钻石 / 其余=金币
        boolean diamond = "diamond".equals(item.getCurrency());
        if (diamond) {
            int has = u.getDiamonds() == null ? 0 : u.getDiamonds();
            if (has < item.getPrice()) {
                throw new BizException(2005, "钻石不足，签到第七天可得钻石");
            }
            u.setDiamonds(has - item.getPrice());
        } else {
            if (u.getCoins() < item.getPrice()) {
                throw new BizException(2001, "金币不足");
            }
            u.setCoins(u.getCoins() - item.getPrice());
        }
        userMapper.updateById(u);

        UserItem ui = new UserItem();
        ui.setUserId(userId);
        ui.setItemId(itemId);
        ui.setInUse(0);
        ui.setCreatedAt(LocalDateTime.now());
        userItemMapper.insert(ui);

        applySkin(userId, itemId);

        User fresh = userMapper.selectById(userId);
        BuyResp resp = new BuyResp();
        resp.setCoins(fresh.getCoins());
        resp.setDiamonds(fresh.getDiamonds());
        resp.setOwned(true);
        resp.setSkins(skinsOf(fresh));
        return resp;
    }

    public Map<String, String> applySkin(Long userId, String itemId) {
        User u = userMapper.selectById(userId);
        ShopItem item = shopItemMapper.selectById(itemId);
        if (item == null) {
            throw new BizException(1002, "商品不存在");
        }
        if (item.getPrice() != null && item.getPrice() > 0) {
            UserItem owned = userItemMapper.selectOne(Wrappers.<UserItem>lambdaQuery()
                    .eq(UserItem::getUserId, userId)
                    .eq(UserItem::getItemId, itemId));
            if (owned == null) {
                throw new BizException(2004, "请先购买该商品");
            }
        }
        switch (item.getCat()) {
            case "board" -> u.setBoardId(itemId);
            case "avatar" -> u.setAvatarId(itemId);
            default -> throw new BizException(1002, "商品不存在");
        }
        userMapper.updateById(u);

        if (item.getPrice() != null && item.getPrice() > 0) {
            userItemMapper.clearInUseForCat(userId, item.getCat());
            userItemMapper.markInUse(userId, itemId);
        }
        return skinsOf(u);
    }

    private Map<String, String> skinsOf(User u) {
        Map<String, String> map = new HashMap<>();
        map.put("board", u.getBoardId());
        map.put("avatar", u.getAvatarId());
        return map;
    }

    private List<String> ownedIds(Long userId) {
        return userItemMapper.selectList(Wrappers.<UserItem>lambdaQuery()
                        .eq(UserItem::getUserId, userId))
                .stream().map(UserItem::getItemId).collect(Collectors.toList());
    }

    private AuthResp toAuthResp(User u, String token) {
        AuthResp r = new AuthResp();
        r.setId(u.getId());
        r.setName(u.getName());
        r.setScore(u.getScore());
        r.setCoins(u.getCoins());
        r.setToken(token);
        return r;
    }
}
