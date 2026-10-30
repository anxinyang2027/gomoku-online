package cn.edu.szpu.gomoku.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;

@Component
public class JwtUtil {

    @Value("${gomoku.jwt.secret}")
    private String secret;

    @Value("${gomoku.jwt.expire-hours}")
    private int expireHours;

    private SecretKey key;

    @PostConstruct
    public void init() {
        // K4a：密钥缺失/过短直接启动失败——防带空密钥或弱密钥上线
        if (secret == null || secret.getBytes(StandardCharsets.UTF_8).length < 32) {
            throw new IllegalStateException(
                    "JWT 密钥缺失或不足 32 字节：请设置环境变量 GOMOKU_JWT_SECRET（生产）"
                            + " 或以 dev profile 启动（开发）");
        }
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    }

    public String issue(Long userId) {
        long ms = expireHours * 3600_000L;
        return Jwts.builder()
                .subject(String.valueOf(userId))
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + ms))
                .signWith(key)
                .compact();
    }

    public Long parse(String token) {
        try {
            Claims c = Jwts.parser().verifyWith(key).build()
                    .parseSignedClaims(token).getPayload();
            return Long.valueOf(c.getSubject());
        } catch (Exception e) {
            return null;
        }
    }
}
