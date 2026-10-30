package cn.edu.szpu.gomoku.security;

import cn.edu.szpu.gomoku.common.ApiResult;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

@Component
@RequiredArgsConstructor
public class AuthInterceptor implements HandlerInterceptor {

    private final JwtUtil jwtUtil;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws Exception {
        if (!(handler instanceof HandlerMethod hm)) {
            return true;
        }

        String auth = request.getHeader("Authorization");
        Long userId = null;
        if (auth != null && auth.startsWith("Bearer ")) {
            userId = jwtUtil.parse(auth.substring(7));
            if (userId == null) {
                reject(response, "登录已过期，请重新登录");
                return false;
            }
        }
        if (userId != null) {
            request.setAttribute("userId", userId);
        }
        if (requiresLogin(hm) && userId == null) {
            reject(response, "请先登录");
            return false;
        }
        return true;
    }

    private boolean requiresLogin(HandlerMethod hm) {
        return hm.hasMethodAnnotation(Login.class) || hm.getBeanType().isAnnotationPresent(Login.class);
    }

    private void reject(HttpServletResponse response, String msg) throws Exception {
        response.setStatus(200);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        response.getWriter().write(objectMapper.writeValueAsString(ApiResult.fail(401, msg)));
    }
}
