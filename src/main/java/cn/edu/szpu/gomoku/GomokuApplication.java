package cn.edu.szpu.gomoku;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
@MapperScan("cn.edu.szpu.gomoku.mapper")
public class GomokuApplication {
    public static void main(String[] args) {
        SpringApplication.run(GomokuApplication.class, args);
    }
}
