package cn.edu.szpu.gomoku.service;

import cn.edu.szpu.gomoku.common.BizException;
import cn.edu.szpu.gomoku.dto.ChatMsgVO;
import cn.edu.szpu.gomoku.entity.ChatMessage;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 聊天服务（H7）——"在线棋牌室 + 对局私聊"双频道：
 * - 频道 key：lobby=公屏（所有人）；game:<id>=对局频道（仅局内成员可进）
 *   人机对局的频道里只有玩家自己（电脑不说话），等效"私聊草稿间"，
 *   不会漏到公屏；在线对局/房间组队双方同频道互通
 * - 纯内存环形缓冲，不入库：每频道上限 200 条（约几十 KB），重启即清，
 *   不产生任何持久化存储增长
 * - 不回放历史：recent(0)（刚进频道/退出重进/刷新）返回空，
 *   客户端只看"进入频道"之后别人发的消息；增量靠 after=lastId 轮询
 * - 消息 id 用毫秒级自增序列：重启后 id 仍大于所有旧客户端的 lastId，
 *   不会出现"旧 lastId 卡死新消息"的断流
 * - 屏蔽词：发言时集中过滤（星号等长替换）；字母词带词边界防误伤
 * - 频控：同一用户 1 秒 1 条（全局口径，不区分频道）
 */
@Service
@RequiredArgsConstructor
public class ChatService {

    /** 公屏频道 key */
    public static final String LOBBY = "lobby";

    /** 每频道环形缓冲上限：保住轮询间隔内(2.5s)的新消息即可，内存占用可忽略 */
    private static final int CAPACITY = 200;

    /** 频道数上限：超过即丢最不活跃的频道（防频道泄漏撑爆内存） */
    private static final int MAX_CHANNELS = 200;

    /** 消息序列：从启动时刻的毫秒值起自增，天然单调且跨重启可比 */
    private final AtomicLong seq = new AtomicLong(System.currentTimeMillis());

    /** 频道 -> 消息缓冲 */
    private final Map<String, Deque<ChatMessage>> channels = new ConcurrentHashMap<>();

    /** 频道最近活跃时刻（LRU 淘汰用） */
    private final Map<String, Long> channelActive = new ConcurrentHashMap<>();

    /** 同一用户上次发言时间戳（毫秒） */
    private final Map<Long, Long> lastSendAt = new ConcurrentHashMap<>();

    /** 屏蔽词表（一期内置；后续要做后台管理再挪库表） */
    private static final String[] BLOCKED_WORDS = {
            "傻逼", "煞笔", "屎笔", "死妈", "妈的", "他妈", "你妈", "我操", "操你",
            "草你", "卧槽", "我艹", "废物", "垃圾", "脑残", "白痴", "弱智", "智障",
            "滚蛋", "去死", "傻子", "蠢货", "贱人", "混蛋", "王八蛋", "妈卖批",
            "nmsl", "nm$l", "cnm", "sb", "tmd", "md",
    };

    private static final DateTimeFormatter HHMM =
            DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.of("Asia/Shanghai"));

    private static final int MAX_LEN = 120;
    private static final long COOLDOWN_MS = 1000;

    /* ---------- 频道存取 ---------- */

    private Deque<ChatMessage> bufferOf(String channel) {
        return channels.computeIfAbsent(channel, k -> new ConcurrentLinkedDeque<>());
    }

    private void touchChannel(String channel) {
        channelActive.put(channel, System.currentTimeMillis());
        // 频道数超限：丢最久不活跃的（公屏永不淘汰）
        if (channelActive.size() > MAX_CHANNELS) {
            String oldest = null;
            long oldestTs = Long.MAX_VALUE;
            for (Map.Entry<String, Long> e : channelActive.entrySet()) {
                if (e.getKey().equals(LOBBY)) continue;
                if (e.getValue() < oldestTs) { oldestTs = e.getValue(); oldest = e.getKey(); }
            }
            if (oldest != null) {
                channels.remove(oldest);
                channelActive.remove(oldest);
            }
        }
    }

    /**
     * 屏蔽词过滤：命中片段替换成等长 '*'。
     * 中文词直接子串比对；纯字母词要求词边界（前后非字母数字），
     * 避免把 USB / MD Player 这类正常词里的字母误伤。
     */
    public String filter(String text) {
        if (text == null || text.isEmpty()) return text;
        String result = text;
        for (String word : BLOCKED_WORDS) {
            result = maskAll(result, word);
        }
        return result;
    }

    private String maskAll(String text, String word) {
        String w = word.toLowerCase();
        String lower = text.toLowerCase();
        boolean latin = isLatin(w);
        int hit = latin ? findLatin(lower, w, 0) : lower.indexOf(w);
        if (hit < 0) return text;
        StringBuilder sb = new StringBuilder();
        int i = 0;
        while (hit >= 0) {
            sb.append(text, i, hit).append("*".repeat(w.length()));
            i = hit + w.length();
            hit = latin ? findLatin(lower, w, i) : lower.indexOf(w, i);
        }
        sb.append(text.substring(i));
        return sb.toString();
    }

    private static boolean isLatin(String w) {
        for (int i = 0; i < w.length(); i++) {
            char ch = w.charAt(i);
            boolean ok = (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '$';
            if (!ok) return false;
        }
        return true;
    }

    /** 词边界版 indexOf：命中前后都不是字母数字/$ 才算独立词 */
    private static int findLatin(String lower, String w, int from) {
        int hit = lower.indexOf(w, from);
        while (hit >= 0) {
            char before = hit > 0 ? lower.charAt(hit - 1) : ' ';
            int end = hit + w.length();
            char after = end < lower.length() ? lower.charAt(end) : ' ';
            boolean bOk = !Character.isLetterOrDigit(before) && before != '$';
            boolean aOk = !Character.isLetterOrDigit(after) && after != '$';
            if (bOk && aOk) return hit;
            hit = lower.indexOf(w, hit + 1);
        }
        return -1;
    }

    /**
     * 系统广播（H7+）：以"系统"身份把事件播到指定频道（通常公屏）。
     * 服务端事件（签到/对局结算等）调用；不走路由不走频控，
     * 每个在线客户端靠轮询自然收到。
     */
    public void system(String channel, String content) {
        if (content == null || content.isEmpty()) return;
        ChatMessage m = new ChatMessage();
        m.setId(seq.incrementAndGet());
        m.setUserId(null);
        m.setName("系统");
        m.setContent(content);
        m.setCreatedAt(LocalDateTime.now(ZoneId.of("Asia/Shanghai")));
        Deque<ChatMessage> buffer = bufferOf(channel);
        buffer.addLast(m);
        while (buffer.size() > CAPACITY) {
            buffer.pollFirst();
        }
        touchChannel(channel);
    }

    /** 公屏系统广播（最常用口径） */
    public void system(String content) {
        system(LOBBY, content);
    }

    /** 发言：登录后调用；过滤 + 频控 + 入对应频道，返回渲染用 VO */
    public ChatMsgVO send(String channel, Long userId, String name, String content) {
        if (content == null || content.trim().isEmpty()) {
            throw new BizException(6001, "发言内容不能为空");
        }
        String text = filter(content.trim());
        if (text.length() > MAX_LEN) text = text.substring(0, MAX_LEN);

        long now = System.currentTimeMillis();
        Long last = lastSendAt.get(userId);
        if (last != null && now - last < COOLDOWN_MS) {
            throw new BizException(6002, "发言太频繁，休息一下");
        }
        lastSendAt.put(userId, now);

        ChatMessage m = new ChatMessage();
        m.setId(seq.incrementAndGet());
        m.setUserId(userId);
        m.setName(name);
        m.setContent(text);
        m.setCreatedAt(LocalDateTime.now(ZoneId.of("Asia/Shanghai")));
        Deque<ChatMessage> buffer = bufferOf(channel);
        buffer.addLast(m);
        while (buffer.size() > CAPACITY) {
            buffer.pollFirst(); // 超上限丢最老：内存恒定
        }
        touchChannel(channel);
        return toVO(m);
    }

    /** 公屏发言（兼容旧口径） */
    public ChatMsgVO send(Long userId, String name, String content) {
        return send(LOBBY, userId, name, content);
    }

    /**
     * 增量拉取。after=0 = 刚进频道（含退出重进/刷新）：不回放历史，
     * 返回一条"入座"合成系统消息（id=当前序列点）——既提示"仅展示之后的发言"，
     * 又把客户端 lastId 推进到此刻，之后 after>0 的轮询才能收到新消息；
     * after>0 = 取该频道缓冲里 id 更新的消息。
     */
    public List<ChatMsgVO> recent(String channel, long after) {
        List<ChatMsgVO> out = new ArrayList<>();
        if (after <= 0) {
            long cur = seq.get();
            String text = LOBBY.equals(channel)
                    ? "你已入座公屏，仅展示此后的发言（历史不保存）"
                    : "对局频道仅你与对手可见，发言不会出现在公屏";
            ChatMsgVO marker = new ChatMsgVO(cur, null, text, true,
                    HHMM.format(LocalDateTime.now(ZoneId.of("Asia/Shanghai"))));
            out.add(marker);
            return out;
        }
        for (ChatMessage m : bufferOf(channel)) {
            if (m.getId() > after) out.add(toVO(m));
        }
        return out;
    }

    /** 公屏拉取（兼容旧口径） */
    public List<ChatMsgVO> recent(long after) {
        return recent(LOBBY, after);
    }

    private ChatMsgVO toVO(ChatMessage m) {
        boolean system = m.getUserId() == null;
        String time = m.getCreatedAt() == null ? "" : HHMM.format(m.getCreatedAt());
        return new ChatMsgVO(m.getId(), m.getName(), m.getContent(), system, time);
    }
}
