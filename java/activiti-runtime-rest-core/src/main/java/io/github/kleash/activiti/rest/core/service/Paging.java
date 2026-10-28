package io.github.kleash.activiti.rest.core.service;

import io.github.kleash.activiti.rest.core.RestCoreProperties;

/** Page parameters of a list request, checked against the configured limits. */
public record Paging(int page, int size) {

    /** Resolves optional request parameters: the default size when none is given, a 400 when they are out of range. */
    public static Paging of(Integer page, Integer size, RestCoreProperties properties) {
        int p = page == null ? 0 : page;
        int s = size == null ? properties.getDefaultPageSize() : size;
        if (p < 0) {
            throw new IllegalArgumentException("page must be 0 or more, but is " + p);
        }
        if (s < 1 || s > properties.getMaxPageSize()) {
            throw new IllegalArgumentException("size must be between 1 and " + properties.getMaxPageSize() + " (activiti.rest.max-page-size), but is " + s);
        }
        return new Paging(p, s);
    }

    /** Index of the first item. */
    public int first() {
        return Math.multiplyExact(page, size);
    }
}
