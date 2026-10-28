package io.github.kleash.activiti.rest.dev.testapp;

import java.util.List;

import org.activiti.core.common.spring.identity.ExtendedInMemoryUserDetailsManager;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.web.SecurityFilterChain;

/** The host's security: HTTP Basic, anonymous requests reach the controllers. */
@Configuration
public class TestSecurity {

    @Bean
    public SecurityFilterChain hostSecurityChain(HttpSecurity http) throws Exception {
        return http.authorizeHttpRequests(auth -> auth.anyRequest().permitAll())
                .httpBasic(Customizer.withDefaults())
                .csrf(csrf -> csrf.disable())
                .build();
    }

    @Bean
    public ExtendedInMemoryUserDetailsManager userDetailsService() {
        ExtendedInMemoryUserDetailsManager users = new ExtendedInMemoryUserDetailsManager();
        users.createUser(user("admin", "ROLE_ACTIVITI_USER", "ROLE_ACTIVITI_ADMIN"));
        users.createUser(user("alice", "ROLE_ACTIVITI_USER", "GROUP_clerks"));
        return users;
    }

    private static org.springframework.security.core.userdetails.UserDetails user(String name, String... authorities) {
        return User.withUsername(name).password("{noop}" + name).authorities(List.of(authorities).stream().map(SimpleGrantedAuthority::new).toList()).build();
    }
}
