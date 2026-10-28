package io.github.kleash.activiti.scenario.run;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

import org.activiti.engine.impl.identity.Authentication;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.provisioning.UserDetailsManager;

/**
 * Identity handling of the runner (docs/adr/0005-scenario-format.md, "Identity"): scenario users live in the engine's
 * {@code UserDetailsManager} as {@code ROLE_ACTIVITI_USER} plus {@code GROUP_<g>} authorities, and every action runs
 * with the acting user in the {@code SecurityContext} <em>and</em> in the engine's {@code Authentication} thread-local
 * (so that {@code activiti:initiator} works); both are restored afterwards.
 */
final class Identity {

    /** User that acts when a scenario names none. Has the user role and no groups. */
    static final String RUNNER_USER = "scenario-runner";

    private final UserDetailsService users;
    private final Map<String, UserDetails> replaced = new HashMap<>();
    private final List<String> added = new ArrayList<>();

    Identity(UserDetailsService users) {
        this.users = users;
    }

    /** Creates the users of a scenario file (replacing same-named ones until {@link #removeFileUsers()}). */
    void defineFileUsers(Map<String, List<String>> definitions) {
        if (definitions.isEmpty()) {
            return;
        }
        UserDetailsManager manager = manager("The scenario file defines users, which needs a UserDetailsManager (such as ExtendedInMemoryUserDetailsManager)");
        definitions.forEach((name, groups) -> {
            UserDetails user = build(name, groups);
            if (manager.userExists(name)) {
                replaced.put(name, users.loadUserByUsername(name));
                manager.updateUser(user);
            } else {
                manager.createUser(user);
                added.add(name);
            }
        });
    }

    /** Removes the users {@link #defineFileUsers} created and restores the ones it replaced. */
    void removeFileUsers() {
        if (added.isEmpty() && replaced.isEmpty()) {
            return;
        }
        UserDetailsManager manager = manager("cannot restore users");
        added.forEach(manager::deleteUser);
        replaced.values().forEach(manager::updateUser);
        added.clear();
        replaced.clear();
    }

    /** Makes sure the built-in runner user exists. */
    void ensureRunnerUser() {
        if (users instanceof UserDetailsManager manager && !manager.userExists(RUNNER_USER)) {
            manager.createUser(build(RUNNER_USER, List.of()));
        }
    }

    /** Runs {@code action} as {@code user}; fails with a clear message when the user is unknown. */
    <T> T runAs(String user, Supplier<T> action) {
        UserDetails details;
        try {
            details = users.loadUserByUsername(user);
        } catch (UsernameNotFoundException e) {
            throw new IllegalStateException("User '" + user + "' is not defined; list it under \"users\" in the scenario file", e);
        }
        SecurityContext context = SecurityContextHolder.getContext();
        org.springframework.security.core.Authentication previous = context.getAuthentication();
        String previousId = Authentication.getAuthenticatedUserId();
        context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(details, null, details.getAuthorities()));
        Authentication.setAuthenticatedUserId(details.getUsername());
        try {
            return action.get();
        } finally {
            context.setAuthentication(previous);
            Authentication.setAuthenticatedUserId(previousId);
        }
    }

    void runAs(String user, Runnable action) {
        runAs(user, () -> {
            action.run();
            return null;
        });
    }

    /** Clears both identities; used after a scenario so that nothing leaks into the next one. */
    static void clear() {
        SecurityContextHolder.clearContext();
        Authentication.setAuthenticatedUserId(null);
    }

    private UserDetailsManager manager(String why) {
        if (users instanceof UserDetailsManager manager) {
            return manager;
        }
        throw new IllegalStateException(why + ", but the UserDetailsService bean is a " + users.getClass().getName());
    }

    private static UserDetails build(String name, List<String> groups) {
        List<GrantedAuthority> authorities = new ArrayList<>();
        authorities.add(new SimpleGrantedAuthority("ROLE_ACTIVITI_USER"));
        groups.forEach(g -> authorities.add(new SimpleGrantedAuthority("GROUP_" + g)));
        // The runner never authenticates by password: it puts the user into the security context itself. A random password
        // keeps the user from being logged into over HTTP while a scenario file has it defined in a running server.
        return User.withUsername(name).password("{noop}" + java.util.UUID.randomUUID()).authorities(authorities).build();
    }
}
