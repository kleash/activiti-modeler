package io.github.kleash.activiti.rest.core.error;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Supplier;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;

import com.fasterxml.jackson.databind.ObjectMapper;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/** Writes the error document ({@code application/problem+json}) straight to a servlet response, for code that runs outside a controller. */
public final class ProblemWriter {

    private final Supplier<ObjectMapper> mapper;

    /**
     * @param mapper the application's object mapper; looked up when the first problem is written, because this writer is created
     *               while Spring MVC is being configured, which must not wait for the mapper
     */
    public ProblemWriter(Supplier<ObjectMapper> mapper) {
        this.mapper = mapper;
    }

    /**
     * @param status      the HTTP status
     * @param title       short title
     * @param detail      what went wrong
     * @param engineClass class name of the engine exception behind it, or {@code null}
     */
    public void write(HttpServletRequest request, HttpServletResponse response, HttpStatus status, String title, String detail, String engineClass)
            throws IOException {
        response.setStatus(status.value());
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        mapper.get().writeValue(response.getOutputStream(), body(request, status, title, detail, engineClass));
    }

    static Map<String, Object> body(HttpServletRequest request, HttpStatus status, String title, String detail, String engineClass) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("type", "about:blank");
        body.put("title", title);
        body.put("status", status.value());
        body.put("detail", detail);
        if (request != null) {
            body.put("instance", request.getRequestURI());
        }
        if (engineClass != null) {
            body.put("engineException", engineClass);
        }
        return body;
    }
}
