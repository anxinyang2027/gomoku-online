package cn.edu.szpu.gomoku.dto;

import lombok.Data;

@Data
public class HistoryVO {
    private Boolean win;
    private String opponent;
    private String time;
    private Integer moves;
    private String date;
}
