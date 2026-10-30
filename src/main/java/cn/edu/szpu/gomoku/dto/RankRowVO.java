package cn.edu.szpu.gomoku.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class RankRowVO {
    private Long id;
    private String name;
    private Integer score;
    private Integer rank;
    /** 头像商品图片路径（shop_item.img，如 assets/avatars/avatar01.png）；无则为 null */
    private String avatarImg;
}
