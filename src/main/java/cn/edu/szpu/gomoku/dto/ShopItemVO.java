package cn.edu.szpu.gomoku.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.Data;

import java.util.Map;

@Data
@JsonInclude(JsonInclude.Include.NON_NULL)
public class ShopItemVO {
    private String id;
    private String cat;
    private String name;
    private Integer price;
    /** coin=金币 / diamond=钻石（缺省按 coin 处理） */
    private String currency;
    private Map<String, String> colors;
    private String glyph;
    private String img;
}
