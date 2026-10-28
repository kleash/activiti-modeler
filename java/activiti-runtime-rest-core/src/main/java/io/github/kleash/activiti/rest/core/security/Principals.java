package io.github.kleash.activiti.rest.core.security;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

/** The authenticated principal of the current request. */
public final class Principals {

    private Principals() {
    }

    /** @return the name of the authenticated user, or {@code null} without one */
    public static String currentUser() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        return AccessPolicy.isAuthenticated(authentication) ? authentication.getName() : null;
    }

    /** @return the name of the authenticated user; never {@code null} */
    public static String requireUser() {
        String user = currentUser();
        if (user == null) {
            throw new IllegalStateException("There is no authenticated user");
        }
        return user;
    }
}
