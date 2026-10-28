package io.github.kleash.activiti.rest.core.dto;

import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * One page of a list. Every list endpoint takes {@code page} (0-based) and {@code size} and answers with this shape.
 *
 * @param items the items of the page
 * @param page  the page number, starting at 0
 * @param size  the requested page size
 * @param total how many items match in all
 */
@Schema(requiredProperties = {"items", "page", "size", "total"})
public record PageDto<T>(List<T> items, int page, int size, long total) {
}
