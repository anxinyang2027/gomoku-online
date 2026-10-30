package cn.edu.szpu.gomoku.config;

import cn.edu.szpu.gomoku.entity.User;
import cn.edu.szpu.gomoku.mapper.UserMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.CommandLineRunner;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class SeedData implements CommandLineRunner {

    private final UserMapper userMapper;
    private final BCryptPasswordEncoder encoder;

    @Override
    public void run(String... args) {
        if (userMapper.selectCount(null) > 0) return;
        String pwd = encoder.encode("123456");
        String[][] rows = {
                {"张三", "2500"}, {"李四", "2380"}, {"王五", "2100"},
                {"demo", "1200"}, {"alice", "800"},
        };
        for (String[] r : rows) {
            User u = new User();
            u.setName(r[0]);
            u.setPassword(pwd);
            u.setScore(Integer.valueOf(r[1]));
            userMapper.insert(u);
        }
    }
}
