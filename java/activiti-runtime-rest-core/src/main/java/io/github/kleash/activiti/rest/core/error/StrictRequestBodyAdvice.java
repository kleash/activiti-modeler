package io.github.kleash.activiti.rest.core.error;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.RecordComponent;
import java.lang.reflect.Type;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.TreeSet;
import java.util.function.Supplier;

import org.springframework.core.MethodParameter;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpInputMessage;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.RequestBodyAdviceAdapter;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.github.kleash.activiti.rest.core.dto.StrictBody;

/**
 * Refuses request bodies that carry fields their {@link StrictBody} type does not declare. The acting user is the authenticated
 * principal; a body that tries to name one ({@code "user": "bob"}) is an error, not something to ignore silently.
 */
@ControllerAdvice(annotations = RuntimeRestController.class)
public class StrictRequestBodyAdvice extends RequestBodyAdviceAdapter {

    private final Supplier<ObjectMapper> mapper;

    public StrictRequestBodyAdvice(Supplier<ObjectMapper> mapper) {
        this.mapper = mapper;
    }

    @Override
    public boolean supports(MethodParameter methodParameter, Type targetType, Class<? extends HttpMessageConverter<?>> converterType) {
        return targetType instanceof Class<?> type && type.isRecord() && type.isAnnotationPresent(StrictBody.class);
    }

    @Override
    public HttpInputMessage beforeBodyRead(HttpInputMessage inputMessage, MethodParameter parameter, Type targetType,
                                           Class<? extends HttpMessageConverter<?>> converterType) throws IOException {
        byte[] body;
        try (InputStream in = inputMessage.getBody()) {
            body = in.readAllBytes();
        }
        Set<String> declared = new LinkedHashSet<>();
        for (RecordComponent component : ((Class<?>) targetType).getRecordComponents()) {
            declared.add(component.getName());
        }
        JsonNode tree;
        try {
            tree = body.length == 0 ? null : mapper.get().readTree(body);
        } catch (IOException e) {
            tree = null; // malformed JSON: the normal conversion reports it
        }
        if (tree != null && tree.isObject()) {
            Set<String> unknown = new TreeSet<>();
            tree.fieldNames().forEachRemaining(name -> {
                if (!declared.contains(name)) {
                    unknown.add(name);
                }
            });
            if (!unknown.isEmpty()) {
                throw new HttpMessageNotReadableException("Unknown field(s) " + unknown + " in the request body; the fields are " + declared
                        + (unknown.contains("user") ? ". The acting user is always the authenticated principal, a body cannot name one" : ""), inputMessage);
            }
        }
        HttpHeaders headers = inputMessage.getHeaders();
        return new HttpInputMessage() {
            @Override
            public InputStream getBody() {
                return new ByteArrayInputStream(body);
            }

            @Override
            public HttpHeaders getHeaders() {
                return headers;
            }
        };
    }
}
