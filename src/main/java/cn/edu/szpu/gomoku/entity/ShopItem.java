package cn.edu.szpu.gomoku.entity;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

@Data
@TableName("shop_item")
public class ShopItem {
    @TableId
    private String id;
    private String cat;
    private String name;
    private Integer price;
    /** 计价货币：coin=金币（默认）/ diamond=钻石 */
    private String currency;
    private String colors;
    private String glyph;
    private String img;
}
