package cn.edu.szpu.gomoku.websocket;

import cn.edu.szpu.gomoku.security.JwtUtil;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.util.Map;

/**
 * K1：/ws/online 端点。
 *
 * 协议（JSON，D10 决策——WS 只做订阅与推送，写操作仍走 HTTP）：
 * - 连接：ws://host/ws/online?token=<jwt>（无效 token 立即关闭 1008）
 * - 客户端 → 服务端：
 *     {type:"sub", gameId}   订阅对局快照推送
 *     {type:"unsub"}         退订（切局/退出时）
 * - 服务端 → 客户端：
 *     {type:"snapshot", data:{…OnlineSnapshotResp}}   状态变化即推
 *     {type:"err", msg}                                协议错误提示
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class OnlineWebSocketHandler extends TextWebSocketHandler {

    private final OnlinePushService pushService;
    private final JwtUtil jwtUtil;
    private final ObjectMapper objectMapper;

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        String token = extractToken(session);
        Long userId = token == null ? null : jwtUtil.parse(token);
        if (userId == null) {
            session.close(CloseStatus.POLICY_VIOLATION); // 1008：鉴权失败
            return;
        }
        session.getAttributes().put("userId", userId);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        if (session.getAttributes().get("userId") == null) return; // 未鉴权连接已关
        JsonNode req;
        try {
            req = objectMapper.readTree(message.getPayload());
        } catch (Exception e) {
            send(session, err("消息格式错误"));
            return;
        }
        String type = req.path("type").asText("");
        if ("sub".equals(type)) {
            Long gameId = req.path("gameId").asLong(0);
            if (gameId <= 0) {
                send(session, err("缺少 gameId"));
                return;
            }
            // 换局：先从旧对局摘除
            Long old = pushService.gameIdOf(session);
            if (old != null && !old.equals(gameId)) {
                pushService.unsubscribe(session);
            }
            session.getAttributes().put("gameId", gameId);
            pushService.subscribe(gameId, session);
            send(session, ack(gameId));
        } else if ("unsub".equals(type)) {
            pushService.unsubscribe(session);
            session.getAttributes().remove("gameId");
        } else {
            send(session, err("未知消息类型"));
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        pushService.unsubscribe(session);
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable error) {
        pushService.unsubscribe(session);
    }

    /* ---------- 内部 ---------- */

    /** token 从查询参数取（浏览器 WS API 不能自定义 Header） */
    private String extractToken(WebSocketSession session) {
        String query = session.getUri() == null ? "" : session.getUri().getQuery();
        if (query == null || query.isBlank()) return null;
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0 && "token".equals(pair.substring(0, eq))) {
                return pair.substring(eq + 1);
            }
        }
        return null;
    }

    private void send(WebSocketSession session, String json) {
        try {
            synchronized (session) {
                session.sendMessage(new TextMessage(json));
            }
        } catch (Exception e) {
            log.debug("ws send failed: {}", e.getMessage());
        }
    }

    private String ack(Long gameId) {
        ObjectNode n = objectMapper.createObjectNode();
        n.put("type", "sub-ok");
        n.put("gameId", gameId);
        return n.toString();
    }

    private String err(String msg) {
        ObjectNode n = objectMapper.createObjectNode();
        n.put("type", "err");
        n.put("msg", msg);
        return n.toString();
    }
}
