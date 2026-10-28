package io.github.kleash.activiti.rest.core.service;

import java.util.List;

import io.github.kleash.activiti.rest.core.dto.DefinitionDtos;
import io.github.kleash.activiti.rest.core.dto.EngineDtos;

/**
 * Knows about the DMN decisions of a deployment. The core module does not need a DMN engine: without the DMN connector on the
 * class path the catalog is empty and says so; with it, {@link DmnDecisionCatalog} reads the {@code .dmn} resources.
 */
public interface DecisionCatalog {

    /** @return the DMN support to report in {@code GET /engine} */
    EngineDtos.EngineDmn engine();

    /** @return whether DMN decisions can be listed at all */
    boolean available();

    /** @return the decisions of every {@code .dmn} resource of the deployment */
    List<DefinitionDtos.DecisionResource> decisionsOf(String deploymentId);

    /** The catalog used when the DMN connector is absent. */
    DecisionCatalog NONE = new DecisionCatalog() {
        @Override
        public EngineDtos.EngineDmn engine() {
            return new EngineDtos.EngineDmn(false, null);
        }

        @Override
        public boolean available() {
            return false;
        }

        @Override
        public List<DefinitionDtos.DecisionResource> decisionsOf(String deploymentId) {
            return List.of();
        }
    };
}
