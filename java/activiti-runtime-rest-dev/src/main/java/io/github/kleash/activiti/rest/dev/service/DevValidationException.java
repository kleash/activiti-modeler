package io.github.kleash.activiti.rest.dev.service;

import java.util.List;

import io.github.kleash.activiti.rest.dev.dto.DevDtos;

/** A project cannot be deployed or run: carries the findings, which the problem document returns as {@code problems}. */
public class DevValidationException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final transient List<DevDtos.Problem> problems;

    public DevValidationException(String message, List<DevDtos.Problem> problems) {
        super(message);
        this.problems = List.copyOf(problems);
    }

    public List<DevDtos.Problem> problems() {
        return problems;
    }
}
