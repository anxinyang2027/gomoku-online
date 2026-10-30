package cn.edu.szpu.gomoku.entity;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

@Data
@TableName("puzzle")
public class Puzzle {
    @TableId
    private String id;
    private String mode;
    private Integer sortNo;
    private String name;
    private String flavor;
    private String hint;
    private String preset;
    private String steps;
}
