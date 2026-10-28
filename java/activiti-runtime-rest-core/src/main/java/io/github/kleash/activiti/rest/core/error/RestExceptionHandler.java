package io.github.kleash.activiti.rest.core.error;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.activiti.api.runtime.shared.NotFoundException;
import org.activiti.api.runtime.shared.UnprocessableEntityException;
import org.activiti.core.common.spring.security.policies.ActivitiForbiddenException;
import org.activiti.engine.ActivitiException;
import org.activiti.engine.ActivitiIllegalArgumentException;
import org.activiti.engine.ActivitiObjectNotFoundException;
import org.activiti.engine.ActivitiOptimisticLockingException;
import org.activiti.engine.ActivitiTaskAlreadyClaimedException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.TypeMismatchException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.ServletWebRequest;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

/**
 * The error model of the REST API: every failure of a {@link RuntimeRestController} is an {@code application/problem+json}
 * document (RFC 9457) with {@code status}, {@code title}, {@code detail}, {@code instance} and, whenever an exception
 * is behind it, {@code engineException}: the class name of the exception that was thrown (for engine failures the
 * Activiti or Spring class), so that clients can tell "task not found" from "task already claimed" without parsing text.
 *
 * <p>Mapping: not found 404; illegal arguments and unreadable requests 400; authorisation failures 403; rule violations of
 * the runtimes ({@code IllegalStateException}, claimed already, optimistic locking) 409; other engine failures 422; the
 * rest 500 (the message only, never a stack trace). Modules add their own exception types with {@link ProblemMapping} beans.
 */
@RestControllerAdvice(annotations = RuntimeRestController.class)
@Order(Ordered.HIGHEST_PRECEDENCE + 100)
public class RestExceptionHandler extends ResponseEntityExceptionHandler {

    private static final Logger LOG = LoggerFactory.getLogger(RestExceptionHandler.class);

    private final List<ProblemMapping> mappings;

    public RestExceptionHandler(List<ProblemMapping> mappings) {
        this.mappings = mappings;
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Object> handleAny(Exception failure, WebRequest request) {
        HttpStatus status = null;
        Map<String, Object> extensions = new LinkedHashMap<>();
        for (ProblemMapping mapping : mappings) {
            var mapped = mapping.statusOf(failure);
            if (mapped.isPresent()) {
                status = mapped.get();
                extensions.putAll(mapping.extensionsOf(failure));
                break;
            }
        }
        if (status == null) {
            status = statusOf(failure);
        }
        if (status.is5xxServerError()) {
            LOG.error("Request failed: {} {}", request.getDescription(false), failure.toString(), failure);
        }
        return problem(failure, status, extensions, request);
    }

    @Override
    protected ResponseEntity<Object> handleExceptionInternal(Exception failure, Object body, HttpHeaders headers, HttpStatusCode statusCode,
                                                             WebRequest request) {
        // the standard MVC exceptions (405, 415, 400 for a malformed request ...) get the same document shape
        ProblemDetail detail = body instanceof ProblemDetail p ? p : ProblemDetail.forStatus(statusCode);
        return problemResponse(failure, HttpStatus.valueOf(statusCode.value()), detail.getTitle(), failureDetail(failure, detail.getDetail()),
                Map.of(), headers, request);
    }

    static HttpStatus statusOf(Throwable failure) {
        if (failure instanceof ActivitiObjectNotFoundException || failure instanceof NotFoundException) {
            return HttpStatus.NOT_FOUND;
        }
        if (failure instanceof ActivitiForbiddenException || failure instanceof AccessDeniedException) {
            return HttpStatus.FORBIDDEN;
        }
        if (failure instanceof UnprocessableEntityException) {
            return HttpStatus.UNPROCESSABLE_ENTITY;
        }
        if (failure instanceof IllegalStateException && isVariableValidation(failure.getMessage())) {
            return HttpStatus.BAD_REQUEST;
        }
        if (failure instanceof ActivitiTaskAlreadyClaimedException || failure instanceof ActivitiOptimisticLockingException
                || failure instanceof IllegalStateException) {
            return HttpStatus.CONFLICT;
        }
        if (failure instanceof ActivitiIllegalArgumentException || failure instanceof IllegalArgumentException
                || failure instanceof HttpMessageNotReadableException || failure instanceof TypeMismatchException
                || failure instanceof MissingServletRequestParameterException) {
            return HttpStatus.BAD_REQUEST;
        }
        if (failure instanceof ActivitiException) {
            return HttpStatus.UNPROCESSABLE_ENTITY;
        }
        return HttpStatus.INTERNAL_SERVER_ERROR;
    }

    /** The runtimes report an invalid variable name, type or value as an {@code IllegalStateException}; that is a bad request, not a conflict. */
    private static boolean isVariableValidation(String message) {
        return message != null && (message.startsWith("Variable has not a valid name") || message.startsWith("Variables have not valid names")
                || message.startsWith("Variables fail type validation") || message.startsWith("Expressions in variable values")
                || message.contains("Variable has not a valid name") || message.contains("Variables fail type validation"));
    }

    private ResponseEntity<Object> problem(Exception failure, HttpStatus status, Map<String, Object> extensions, WebRequest request) {
        return problemResponse(failure, status, titleOf(status), failureDetail(failure, null), extensions, new HttpHeaders(), request);
    }

    private ResponseEntity<Object> problemResponse(Exception failure, HttpStatus status, String title, String detail, Map<String, Object> extensions,
                                                   HttpHeaders headers, WebRequest request) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("type", "about:blank");
        body.put("title", title != null ? title : titleOf(status));
        body.put("status", status.value());
        body.put("detail", detail);
        if (request instanceof ServletWebRequest servlet) {
            body.put("instance", servlet.getRequest().getRequestURI());
        }
        body.put("engineException", failure.getClass().getName());
        Throwable root = rootCause(failure);
        if (root != failure) {
            body.put("rootCause", root.getClass().getName() + ": " + root.getMessage());
        }
        body.putAll(extensions);
        HttpHeaders out = new HttpHeaders();
        out.putAll(headers);
        out.setContentType(MediaType.APPLICATION_PROBLEM_JSON);
        return new ResponseEntity<>(body, out, status);
    }

    /** The message of the failure, with the message of its root cause when that says more ("Job 12 failed" is not enough). */
    private static String failureDetail(Throwable failure, String fallback) {
        String message = failure.getMessage();
        if (message == null || message.isBlank()) {
            return fallback != null ? fallback : failure.getClass().getSimpleName();
        }
        Throwable root = rootCause(failure);
        if (root != failure && root.getMessage() != null && !root.getMessage().isBlank() && !message.contains(root.getMessage())) {
            return message + ": " + root.getMessage();
        }
        return message;
    }

    private static String titleOf(HttpStatus status) {
        return switch (status) {
            case NOT_FOUND -> "Not found";
            case FORBIDDEN -> "Forbidden";
            case BAD_REQUEST -> "Bad request";
            case CONFLICT -> "Conflict";
            case UNPROCESSABLE_ENTITY -> "Unprocessable";
            default -> status.is5xxServerError() ? "Internal error" : status.getReasonPhrase();
        };
    }

    private static Throwable rootCause(Throwable failure) {
        List<Throwable> seen = new ArrayList<>();
        Throwable current = failure;
        while (current.getCause() != null && current.getCause() != current && !seen.contains(current.getCause())) {
            seen.add(current);
            current = current.getCause();
        }
        return current;
    }
}
