package io.github.kleash.activiti.rest.core.security;

import java.io.IOException;

import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

import io.github.kleash.activiti.rest.core.error.ProblemWriter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Enforces {@link RequiresAccess}. It runs after the host's security filters, so the {@code SecurityContext} is filled in;
 * it adds no filter chain and no authentication mechanism of its own.
 */
public final class AccessInterceptor implements HandlerInterceptor {

    private final AccessPolicy policy;
    private final ProblemWriter problems;

    public AccessInterceptor(AccessPolicy policy, ProblemWriter problems) {
        this.policy = policy;
        this.problems = problems;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws IOException {
        if (!(handler instanceof HandlerMethod method)) {
            return true;
        }
        RequiresAccess required = AnnotatedElementUtils.findMergedAnnotation(method.getMethod(), RequiresAccess.class);
        if (required == null) {
            required = AnnotatedElementUtils.findMergedAnnotation(method.getBeanType(), RequiresAccess.class);
        }
        if (required == null) {
            return true;
        }
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (!AccessPolicy.isAuthenticated(authentication)) {
            problems.write(request, response, HttpStatus.UNAUTHORIZED, "Authentication required",
                    "This endpoint needs an authenticated user; the application's security configuration decides how to authenticate.", null);
            return false;
        }
        if (!policy.grants(authentication, required.value())) {
            problems.write(request, response, HttpStatus.FORBIDDEN, "Forbidden",
                    "The access level " + required.value() + " needs one of the authorities " + policy.authoritiesFor(required.value())
                            + " (activiti.rest.roles); the user '" + authentication.getName() + "' has " + authentication.getAuthorities() + ".",
                    null);
            return false;
        }
        return true;
    }
}
