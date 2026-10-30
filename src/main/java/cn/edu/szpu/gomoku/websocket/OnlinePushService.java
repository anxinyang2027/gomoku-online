package cn.edu.szpu.gomoku.websocket;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.io.IOException;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * K1：在线对局 WebSocket 推送中心。
 *
 * 职责单一：维护 gameId -> 订阅者(WebSocketSession) 的注册表，
 * 状态变化时向该局全部订阅者广播快照。不碰对局逻辑——
 * OnlineGameService 在落子/认输/求和/托管等任何状态变化后调用 broadcast。
 *
 * 发送失败（连接半死/对端已关）只摘连接不抛错：推送是尽力而为，
 * 客户端断线后自然降级回 HTTP 轮询兜底（D10 决策）。
 */
@Slf4j
@Component
public class OnlinePushService {

    /** gameId -> 活跃订阅连接（同一用户多标签页允许多条连接） */
    private final Map<Long, Set<WebSocketSession>> subscribers = new ConcurrentHashMap<>();

    public void subscribe(Long gameId, WebSocketSession session) {
        subscribers.computeIfAbsent(gameId, k -> ConcurrentHashMap.newKeySet()).add(session);
    }

    /** 连接关闭/出错时全局摘除（跨全部对局扫描，量级小无压力） */
    public void unsubscribe(WebSocketSession session) {
        subscribers.values().forEach(set -> set.remove(session));
    }

    /** 该会话当前订阅的对局（unsubscribe 逐对局清理用） */
    public Long gameIdOf(WebSocketSession session) {
        Object attr = session.getAttributes().get("gameId");
        return attr instanceof Long id ? id : null;
    }

    /** 向某局全部订阅者广播 JSON 消息（快照/事件）；失败连接静默摘除 */
    public void broadcast(Long gameId, String json) {
        Set<WebSocketSession> set = subscribers.get(gameId);
        if (set == null || set.isEmpty()) return;
        TextMessage msg = new TextMessage(json);
        for (WebSocketSession s : set) {
            if (!s.isOpen()) {
                set.remove(s);
                continue;
            }
            try {
                synchronized (s) { // Tomcat WS 会话非线程安全，串行化发送
                    s.sendMessage(msg);
                }
            } catch (IOException e) {
                set.remove(s);
                log.debug("push failed, subscriber dropped: {}", e.getMessage());
            }
        }
    }

    /** 定向广播：只发给该局订阅者中 userId 匹配的连接（视角化快照用） */
    public void broadcastTo(Long gameId, Long userId, String json) {
        Set<WebSocketSession> set = subscribers.get(gameId);
        if (set == null || set.isEmpty()) return;
        TextMessage msg = new TextMessage(json);
        for (WebSocketSession s : set) {
            if (!s.isOpen() || !userId.equals(s.getAttributes().get("userId"))) continue;
            try {
                synchronized (s) {
                    s.sendMessage(msg);
                }
            } catch (IOException e) {
                set.remove(s);
            }
        }
    }
}
