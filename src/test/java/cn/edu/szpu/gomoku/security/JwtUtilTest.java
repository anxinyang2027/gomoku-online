package cn.edu.szpu.gomoku.security;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * JWT 签发/校验回路（K3）：token 是全部登录态的根，解析漏洞=越权。
 */
class JwtUtilTest {

    private JwtUtil jwt;

    @BeforeEach
    void setUp() throws Exception {
        jwt = new JwtUtil();
        set(jwt, "secret", "test-secret-0123456789abcdef0123456789abcdef");
        set(jwt, "expireHours", 24);
        jwt.init();
    }

    private static void set(Object target, String field, Object value) throws Exception {
        Field f = target.getClass().getDeclaredField(field);
        f.setAccessible(true);
        f.set(target, value);
    }

    @Test
    void issueThenParseRoundTrip() {
        String token = jwt.issue(42L);
        assertNotNull(token);
        assertEquals(42L, jwt.parse(token));
    }

    @Test
    void tamperedSignatureRejected() {
        String token = jwt.issue(7L);
        String tampered = token.substring(0, token.length() - 2) + "xy";
        assertNull(jwt.parse(tampered));
    }

    @Test
    void foreignSecretTokenRejected() throws Exception {
        String token = jwt.issue(7L);
        JwtUtil other = new JwtUtil();
        set(other, "secret", "another-secret-0123456789abcdef0123456789");
        set(other, "expireHours", 24);
        other.init();
        assertNull(other.parse(token));
    }

    @Test
    void garbageTokenRejected() {
        assertNull(jwt.parse("not-a-jwt"));
        assertNull(jwt.parse(""));
        assertNull(jwt.parse(null));
    }

    @Test
    void expiredTokenRejected() throws Exception {
        JwtUtil shortLived = new JwtUtil();
        set(shortLived, "secret", "test-secret-0123456789abcdef0123456789abcdef");
        set(shortLived, "expireHours", 0); // 立即过期
        shortLived.init();
        String token = shortLived.issue(1L);
        assertNotEquals(token, jwt.issue(1L)); // 不同实例不同签发时间
        assertNull(shortLived.parse(token));
    }

    @Test
    void differentUsersDistinctTokens() {
        String t1 = jwt.issue(1L);
        String t2 = jwt.issue(2L);
        assertEquals(1L, jwt.parse(t1));
        assertEquals(2L, jwt.parse(t2));
    }
}
