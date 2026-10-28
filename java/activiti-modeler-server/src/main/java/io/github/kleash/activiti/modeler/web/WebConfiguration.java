package io.github.kleash.activiti.modeler.web;

import java.io.IOException;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.resource.PathResourceResolver;

/**
 * Serves the modeler app from {@code classpath:/static} (the Maven profile {@code bundle-modeler} puts the built app there). An
 * address that is no file and not an API address gets {@code index.html}, so that a page reload on a client-side route works.
 */
@Configuration(proxyBeanMethods = false)
public class WebConfiguration implements WebMvcConfigurer {

    /** Name of the response header that says "the modeler server answered"; the app looks for it on its own page before it asks for the API. */
    public static final String SERVER_HEADER = "X-Activiti-Modeler-Server";

    /**
     * Marks every response. The app that this server serves asks for its own page first and looks for this header: a failed request to
     * {@code /api/health} would be a console error in a page that is served by something else (the static e2e suite), a successful
     * request for the page itself is not.
     */
    @Bean
    public FilterRegistrationBean<jakarta.servlet.Filter> modelerServerHeader() {
        FilterRegistrationBean<jakarta.servlet.Filter> registration = new FilterRegistrationBean<>((request, response, chain) -> {
            if (response instanceof HttpServletResponse http) {
                http.setHeader(SERVER_HEADER, "1");
            }
            chain.doFilter(request, response);
        });
        registration.setOrder(Integer.MIN_VALUE);
        return registration;
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/**")
                .addResourceLocations("classpath:/static/")
                .resourceChain(true)
                .addResolver(new SpaFallbackResolver());
    }

    /** Files as they are; for a path without a file extension that is not under the API, the app's {@code index.html}. */
    static final class SpaFallbackResolver extends PathResourceResolver {

        @Override
        protected Resource getResource(String resourcePath, Resource location) throws IOException {
            Resource requested = location.createRelative(resourcePath);
            if (requested.exists() && requested.isReadable()) {
                return requested;
            }
            boolean navigation = !resourcePath.startsWith("api/") && !resourcePath.startsWith("v3/") && !resourcePath.contains(".");
            if (navigation) {
                Resource index = location.createRelative("index.html");
                return index.exists() && index.isReadable() ? index : null;
            }
            return null;
        }
    }
}
