package cn.edu.szpu.gomoku.websocket;

import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * K1：注册 /ws/online 原生 WebSocket 端点。
 * 不上 STOMP（D10）：单"订阅对局+广播快照"场景，子协议是负资产。
 */
@Configuration
@EnableWebSocket
@RequiredArgsConstructor
public class WebSocketConfig implements WebSocketConfigurer {

    private final OnlineWebSocketHandler onlineWebSocketHandler;

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(onlineWebSocketHandler, "/ws/online")
                .setAllowedOriginPatterns("*"); // 与 HTTP CORS 口径一致（开发期 Vite 5173 跨源连接）
    }
}
