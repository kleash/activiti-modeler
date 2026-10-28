package io.github.kleash.activiti.rest.core.security;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.Set;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.authentication.AnonymousAuthenticationToken;

import io.github.kleash.activiti.rest.core.RestCoreProperties;

/** Decides whether a principal reaches an {@link Access} level, from the configured role mapping. */
public final class AccessPolicy {

    private final RestCoreProperties properties;

    public AccessPolicy(RestCoreProperties properties) {
        this.properties = properties;
    }

    /** The authorities that grant {@code level}: those of the level itself and of every higher one. */
    public Set<String> authoritiesFor(Access level) {
        Set<String> allowed = new LinkedHashSet<>();
        RestCoreProperties.Roles roles = properties.getRoles();
        switch (level) {
            case READ -> {
                allowed.addAll(roles.getRead());
                allowed.addAll(roles.getOperate());
                allowed.addAll(roles.getAdmin());
            }
            case OPERATE -> {
                allowed.addAll(roles.getOperate());
                allowed.addAll(roles.getAdmin());
            }
            case ADMIN -> allowed.addAll(roles.getAdmin());
        }
        return allowed;
    }

    /** @return whether {@code authentication} is a real (non-anonymous, authenticated) principal */
    public static boolean isAuthenticated(Authentication authentication) {
        return authentication != null && authentication.isAuthenticated() && !(authentication instanceof AnonymousAuthenticationToken);
    }

    /** @return whether the principal holds an authority that grants {@code level} */
    public boolean grants(Authentication authentication, Access level) {
        if (!isAuthenticated(authentication)) {
            return false;
        }
        Set<String> allowed = authoritiesFor(level);
        Collection<? extends GrantedAuthority> held = authentication.getAuthorities();
        for (GrantedAuthority authority : held) {
            if (allowed.contains(authority.getAuthority())) {
                return true;
            }
        }
        return false;
    }
}
