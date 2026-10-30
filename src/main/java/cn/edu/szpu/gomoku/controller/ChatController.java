package cn.edu.szpu.gomoku.controller;

import cn.edu.szpu.gomoku.common.ApiResult;
import cn.edu.szpu.gomoku.common.BizException;
import cn.edu.szpu.gomoku.dto.ChatMsgVO;
import cn.edu.szpu.gomoku.dto.ChatSendReq;
import cn.edu.szpu.gomoku.entity.User;
import cn.edu.szpu.gomoku.mapper.UserMapper;
import cn.edu.szpu.gomoku.security.Login;
import cn.edu.szpu.gomoku.service.BotGameService;
import cn.edu.szpu.gomoku.service.ChatService;
import cn.edu.szpu.gomoku.service.OnlineGameService;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 聊天（H7）：公屏 + 对局频道。
 * 发言须登录（@Login 拦截）；拉取公开（游客可看不可说）。
 * channel 缺省 lobby；game:&lt;id&gt; 仅局内成员可进（在线=黑白双方，人机=仅玩家）。
 */
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class ChatController {

    private final ChatService chatService;
    private final OnlineGameService onlineGameService;
    private final BotGameService botGameService;
    private final UserMapper userMapper;

    @Login
    @PostMapping("/chat/send")
    public ApiResult<ChatMsgVO> send(@RequestBody ChatSendReq req, HttpServletRequest request) {
        Long userId = (Long) request.getAttribute("userId");
        User u = userMapper.selectById(userId);
        if (u == null) {
            return ApiResult.fail(401, "登录已过期，请重新登录");
        }
        String channel = resolveChannel(req.getChannel(), userId);
        return ApiResult.ok(chatService.send(channel, userId, u.getName(), req.getContent()));
    }

    @GetMapping("/chat/recent")
    public ApiResult<List<ChatMsgVO>> recent(@RequestParam(defaultValue = "0") long after,
                                             @RequestParam(required = false) String channel,
                                             HttpServletRequest request) {
        // game: 频道拉取需登录态校验（游客只能看公屏）；未登录/越权一律落回公屏
        String ch = ChatService.LOBBY;
        if (channel != null && channel.startsWith("game:")) {
            Long userId = (Long) request.getAttribute("userId");
            if (userId == null) throw new BizException(401, "请先登录");
            ch = resolveChannel(channel, userId);
        }
        return ApiResult.ok(chatService.recent(ch, after));
    }

    /**
     * 频道解析 + 鉴权：lobby 放行；game:&lt;id&gt; 校验 id 是
     * 我进行中的在线局或人机局，否则一律落回公屏（防越权偷看他人对局聊天）。
     */
    private String resolveChannel(String channel, Long userId) {
        if (channel == null || channel.isEmpty() || ChatService.LOBBY.equals(channel)) {
            return ChatService.LOBBY;
        }
        if (channel.startsWith("game:")) {
            String idStr = channel.substring(5);
            long id;
            try {
                id = Long.parseLong(idStr);
            } catch (NumberFormatException e) {
                return ChatService.LOBBY;
            }
            Long online = onlineGameService.activeGameIdOf(userId);
            if (online != null && online == id) return channel;
            Long bot = botGameService.activeSessionIdOf(userId);
            if (bot != null && bot == id) return channel;
            // 非本人对局：不报错（前端切频道可能早于/晚于对局状态），落回公屏
            return ChatService.LOBBY;
        }
        return ChatService.LOBBY;
    }
}
