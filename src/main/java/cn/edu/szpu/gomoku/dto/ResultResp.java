package cn.edu.szpu.gomoku.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class ResultResp {
    private Integer scoreDelta;
    private Integer score;
}
