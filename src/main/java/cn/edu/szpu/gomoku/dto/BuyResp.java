package cn.edu.szpu.gomoku.dto;

import lombok.Data;

import java.util.Map;

@Data
public class BuyResp {
    private Integer coins;
    private Integer diamonds;
    private Boolean owned;
    private Map<String, String> skins;
}
