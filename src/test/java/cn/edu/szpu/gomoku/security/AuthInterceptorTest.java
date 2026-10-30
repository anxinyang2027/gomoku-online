package cn.edu.szpu.gomoku.security;

import cn.edu.szpu.gomoku.controller.RankController;
import cn.edu.szpu.gomoku.controller.ShopController;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.method.HandlerMethod;

import java.lang.reflect.Field;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 登录拦截器（K3）：@Login 注解语义与 token 注入是鉴权边界。
 */
@ExtendWith(MockitoExtension.class)
class AuthInterceptorTest {

    private AuthInterceptor interceptor;
    private JwtUtil jwt;

    @BeforeEach
    void setUp() throws Exception {
        jwt = new JwtUtil();
        Field secret = JwtUtil.class.getDeclaredField("secret");
        secret.setAccessible(true);
        secret.set(jwt, "test-secret-0123456789abcdef0123456789abcdef");
        Field hours = JwtUtil.class.getDeclaredField("expireHours");
        hours.setAccessible(true);
        hours.set(jwt, 24);
        jwt.init();
        interceptor = new AuthInterceptor(jwt);
    }

    /** 无 @Login 的接口（如 /api/rank）：游客放行 */
    @Test
    void publicEndpointAllowsAnonymous() throws Exception {
        HandlerMethod hm = handler("rank");
        MockHttpServletRequest req = new MockHttpServletRequest();
        MockHttpServletResponse resp = new MockHttpServletResponse();
        assertTrue(interceptor.preHandle(req, resp, hm));
        assertEquals(null, req.getAttribute("userId"));
    }

    /** @Login 接口无 token → 401 业务码拒绝 */
    @Test
    void loginRequiredRejectsMissingToken() throws Exception {
        HandlerMethod hm = handler("myRank");
        MockHttpServletRequest req = new MockHttpServletRequest();
        MockHttpServletResponse resp = new MockHttpServletResponse();
        assertFalse(interceptor.preHandle(req, resp, hm));
        assertTrue(resp.getContentAsString().contains("请先登录"));
    }

    /** 合法 token → 放行并注入 userId */
    @Test
    void validTokenInjectsUserId() throws Exception {
        HandlerMethod hm = handler("myRank");
        MockHttpServletRequest req = new MockHttpServletRequest();
        req.addHeader("Authorization", "Bearer " + jwt.issue(99L));
        MockHttpServletResponse resp = new MockHttpServletResponse();
        assertTrue(interceptor.preHandle(req, resp, hm));
        assertEquals(99L, req.getAttribute("userId"));
    }

    /** 伪造 token → 401 拒绝（带"过期"话术） */
    @Test
    void invalidTokenRejected() throws Exception {
        HandlerMethod hm = handler("myRank");
        MockHttpServletRequest req = new MockHttpServletRequest();
        req.addHeader("Authorization", "Bearer garbage.token.here");
        MockHttpServletResponse resp = new MockHttpServletResponse();
        assertFalse(interceptor.preHandle(req, resp, hm));
        assertTrue(resp.getContentAsString().contains("401"));
    }

    /** 非 Controller 目标（静态资源等）直接放行 */
    @Test
    void nonHandlerPassesThrough() throws Exception {
        assertTrue(interceptor.preHandle(
                new MockHttpServletRequest(), new MockHttpServletResponse(), new Object()));
    }

    /** 反射取真实 HandlerMethod（方法名对应各 Controller 的公开方法） */
    private HandlerMethod handler(String method) throws Exception {
        if ("rank".equals(method)) {
            return new HandlerMethod(new RankController(null), RankController.class.getMethod(method, int.class));
        }
        // myRank（@Login）：用 ShopController.buy 同样带 @Login，签名更稳定
        return new HandlerMethod(new ShopController(null, null, null),
                ShopController.class.getMethod("buy", java.util.Map.class, jakarta.servlet.http.HttpServletRequest.class));
    }
}
