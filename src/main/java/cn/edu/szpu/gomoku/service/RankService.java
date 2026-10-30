package cn.edu.szpu.gomoku.service;

import cn.edu.szpu.gomoku.dto.MyRankVO;
import cn.edu.szpu.gomoku.dto.RankRowVO;
import cn.edu.szpu.gomoku.entity.ShopItem;
import cn.edu.szpu.gomoku.entity.User;
import cn.edu.szpu.gomoku.mapper.ShopItemMapper;
import cn.edu.szpu.gomoku.mapper.UserMapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class RankService {

    private final UserMapper userMapper;
    private final ShopItemMapper shopItemMapper;

    public List<RankRowVO> rank(int limit) {
        List<User> users = userMapper.selectList(
                Wrappers.<User>lambdaQuery()
                        .select(User::getId, User::getName, User::getScore, User::getAvatarId)
                        .orderByDesc(User::getScore)
                        .last("LIMIT " + Math.min(limit, 100)));
        // avatar_id -> 商品图片路径（一次查全，避免逐行查 shop_item）
        Map<String, String> imgOf = shopItemMapper.selectList(
                        Wrappers.<ShopItem>lambdaQuery().eq(ShopItem::getCat, "avatar"))
                .stream()
                .collect(Collectors.toMap(ShopItem::getId, it ->
                        it.getImg() == null ? "" : it.getImg()));
        List<RankRowVO> rows = new java.util.ArrayList<>(users.size());
        for (int i = 0; i < users.size(); i++) {
            User u = users.get(i);
            rows.add(new RankRowVO(u.getId(), u.getName(), u.getScore(), i + 1,
                    imgOf.get(u.getAvatarId())));
        }
        return rows;
    }

    public MyRankVO me(Long userId) {
        User u = userMapper.selectById(userId);
        if (u == null) {
            return null;
        }
        Long better = userMapper.selectCount(
                Wrappers.<User>lambdaQuery().gt(User::getScore, u.getScore()));
        return new MyRankVO(better.intValue() + 1, u.getScore());
    }
}
