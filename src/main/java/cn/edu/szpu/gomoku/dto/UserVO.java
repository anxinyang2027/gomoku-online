package cn.edu.szpu.gomoku.dto;

import lombok.Data;

import java.util.List;
import java.util.Map;

@Data
public class UserVO {
    private Long id;
    private String name;
    private Integer score;
    private Integer coins;
    private Integer diamonds;
    private Map<String, String> skins;
    private List<String> owned;
}
