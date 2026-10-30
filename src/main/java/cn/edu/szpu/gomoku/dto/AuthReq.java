package cn.edu.szpu.gomoku.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class AuthReq {
    @NotBlank(message = "请输入用户名")
    @Size(min = 1, max = 20, message = "用户名 1-20 字符")
    private String name;

    @NotBlank(message = "请输入密码")
    @Size(min = 6, max = 40, message = "密码 6-40 字符")
    private String password;
}
