package io.github.kleash.activiti.rest.core.security;

import java.io.IOException;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Bridges the Spring Security principal to Activiti's thread-local identity: for the duration of a request
 * {@code org.activiti.engine.impl.identity.Authentication.setAuthenticatedUserId} holds the principal's name (so that
 * {@code activiti:initiator}, task claim history and similar work), and it is cleared afterwards, whatever happens.
 * It never reads the identity from the request body or a header: the acting user is always the principal.
 */
public final class AuthenticationBridgeFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        org.activiti.engine.impl.identity.Authentication.setAuthenticatedUserId(
                AccessPolicy.isAuthenticated(authentication) ? authentication.getName() : null);
        try {
            chain.doFilter(request, response);
        } finally {
            org.activiti.engine.impl.identity.Authentication.setAuthenticatedUserId(null);
        }
    }
}
