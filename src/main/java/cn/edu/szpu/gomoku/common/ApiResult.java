package cn.edu.szpu.gomoku.common;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class ApiResult<T> {
    private int code;
    private String msg;
    private T data;

    public static <T> ApiResult<T> ok(T data) {
        return new ApiResult<>(0, "ok", data);
    }

    public static ApiResult<Void> ok() {
        return ok(null);
    }

    public static <T> ApiResult<T> fail(int code, String msg) {
        return new ApiResult<>(code, msg, null);
    }
}
