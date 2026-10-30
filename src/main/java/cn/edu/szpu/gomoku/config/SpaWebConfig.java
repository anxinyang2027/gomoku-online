package cn.edu.szpu.gomoku.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.resource.PathResourceResolver;

import java.io.IOException;
import java.util.List;

/**
 * SPA 历史路由兜底（Vue Router history 模式部署配套）：
 * /rank、/shop 等 SPA 路径刷新时服务器没有对应静态文件，
 * 未命中资源且非 /api 的请求统一回 index.html，由前端路由接管。
 * 命中真实静态文件（带哈希的 js/css、assets/…）时原样返回，不受影响。
 */
@Configuration
public class SpaWebConfig implements WebMvcConfigurer {

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/**")
                .addResourceLocations("classpath:/static/")
                .resourceChain(true)
                .addResolver(new PathResourceResolver() {
                    @Override
                    protected Resource getResource(String resourcePath, Resource location)
                            throws IOException {
                        Resource requested = location.createRelative(resourcePath);
                        // 静态文件存在 → 直接给；否则（排除 /api，它不进资源解析）回 index.html
                        if (requested.isReadable()) {
                            // 目录型请求（如 assets/）不给目录列表，回落首页
                            if (resourcePath.endsWith("/")) return new ClassPathResource("/static/index.html");
                            return requested;
                        }
                        return new ClassPathResource("/static/index.html");
                    }
                });
    }
}
