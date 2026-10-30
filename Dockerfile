# ---------- 构建阶段：Maven 打包（含前端 dist，已在 static 内） ----------
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /app
COPY pom.xml .
# 先拉依赖（层缓存：源码变动不重新下载依赖）
RUN mvn dependency:go-offline -q
COPY src ./src
RUN mvn package -q -DskipTests

# ---------- 运行阶段：精简 JRE ----------
FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /app/target/gomolu-*.jar app.jar

# 时区对齐业务（签到/战绩按东八区记日）
ENV TZ=Asia/Shanghai
EXPOSE 8080

# JVM 容器感知内存限制；spring.profiles 默认 dev，部署时显式传 prod
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "app.jar", "--spring.profiles.active=${SPRING_PROFILES_ACTIVE:-prod}"]
