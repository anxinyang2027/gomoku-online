package cn.edu.szpu.gomoku.dto;

import lombok.Data;

@Data
public class AuthResp {
    private Long id;
    private String name;
    private Integer score;
    private Integer coins;
    private String token;
}
