package io.github.kleash.activiti.modeler.security;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import org.activiti.core.common.spring.identity.ExtendedInMemoryUserDetailsManager;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import io.github.kleash.activiti.modeler.ModelerServerProperties;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * The modeler server's own security, for development on one machine: HTTP Basic with the demo users from
 * {@code modeler.server.users}, stateless, no CSRF (the API is called with an Authorization header, never with a cookie), and CORS for
 * {@code vite dev}. The REST libraries add no security of their own; this chain is the server's decision
 * (docs/adr/0007-runtime-rest-split-and-security.md). The static modeler app and {@code /api/health} are public, the API and its
 * OpenAPI description need a user.
 */
@Configuration(proxyBeanMethods = false)
public class ModelerSecurityConfiguration {

    @Bean
    public SecurityFilterChain modelerSecurityFilterChain(HttpSecurity http, @Qualifier("modelerCorsConfigurationSource") CorsConfigurationSource cors,
                                                         Environment environment) throws Exception {
        String base = environment.getProperty("activiti.rest.base-path", "/api").replaceAll("/+$", "");
        return http
                .cors(c -> c.configurationSource(cors))
                .csrf(csrf -> csrf.disable())
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(base + "/health").permitAll()
                        .requestMatchers(base + "/**", "/v3/api-docs/**").authenticated()
                        .anyRequest().permitAll())
                .httpBasic(basic -> basic.authenticationEntryPoint(new ApiAuthenticationEntryPoint()))
                .exceptionHandling(Customizer.withDefaults())
                .build();
    }

    /** The demo users. Activiti reads the groups of a user from the {@code GROUP_} authorities of this store. */
    @Bean
    public ExtendedInMemoryUserDetailsManager userDetailsService(ModelerServerProperties properties) {
        PasswordEncoder encoder = PasswordEncoderFactories.createDelegatingPasswordEncoder();
        ExtendedInMemoryUserDetailsManager users = new ExtendedInMemoryUserDetailsManager();
        properties.getUsers().forEach((name, user) -> {
            String password = user.getPassword() == null ? "" : user.getPassword();
            users.createUser(User.withUsername(name)
                    .password(password.startsWith("{") ? password : "{noop}" + password)
                    .authorities(user.getAuthorities().stream().map(SimpleGrantedAuthority::new).toList())
                    .build());
        });
        if (properties.getUsers().isEmpty()) {
            throw new IllegalStateException("modeler.server.users defines no user, so nobody could sign in. Define at least one, e.g. "
                    + "modeler.server.users.modeler.password=... and modeler.server.users.modeler.authorities=ROLE_ACTIVITI_USER,ROLE_ACTIVITI_ADMIN");
        }
        return users;
    }

    @Bean(name = "modelerCorsConfigurationSource")
    public CorsConfigurationSource corsConfigurationSource(ModelerServerProperties properties, Environment environment) {
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        ModelerServerProperties.Cors cors = properties.getCors();
        if (cors.getAllowedOrigins().isEmpty()) {
            return source;
        }
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(cors.getAllowedOrigins());
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("Authorization", "Content-Type", "Accept", "X-Requested-With", "X-XSRF-TOKEN"));
        configuration.setExposedHeaders(List.of("Location", "WWW-Authenticate"));
        configuration.setAllowCredentials(cors.isAllowCredentials());
        configuration.setMaxAge(cors.getMaxAgeSeconds());
        String base = environment.getProperty("activiti.rest.base-path", "/api").replaceAll("/+$", "");
        source.registerCorsConfiguration(base + "/**", configuration);
        source.registerCorsConfiguration("/v3/api-docs/**", configuration);
        return source;
    }

    /**
     * 401 for an anonymous API call. A browser that fetches the API with a script must not get the browser's own sign-in dialog
     * ({@code WWW-Authenticate: Basic}); a person who opens an API address in a tab or a tool like curl does get the challenge.
     */
    static final class ApiAuthenticationEntryPoint implements AuthenticationEntryPoint {

        @Override
        public void commence(HttpServletRequest request, HttpServletResponse response, org.springframework.security.core.AuthenticationException failure)
                throws IOException {
            String accept = request.getHeader(HttpHeaders.ACCEPT);
            boolean script = "XMLHttpRequest".equalsIgnoreCase(request.getHeader("X-Requested-With"))
                    || (accept != null && accept.contains(MediaType.APPLICATION_JSON_VALUE) && !accept.contains(MediaType.TEXT_HTML_VALUE));
            if (!script) {
                response.setHeader(HttpHeaders.WWW_AUTHENTICATE, "Basic realm=\"Activiti modeler\"");
            }
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
            response.setCharacterEncoding(StandardCharsets.UTF_8.name());
            response.getWriter().write("{\"type\":\"about:blank\",\"title\":\"Authentication required\",\"status\":401,"
                    + "\"detail\":\"Sign in with HTTP Basic (the demo users are listed in docs/user-guide/modeler-server.md)\",\"instance\":\""
                    + request.getRequestURI().replace("\\", "").replace("\"", "") + "\"}");
        }
    }
}
