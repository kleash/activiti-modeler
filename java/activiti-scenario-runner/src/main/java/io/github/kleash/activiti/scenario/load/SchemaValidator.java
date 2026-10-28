package io.github.kleash.activiti.scenario.load;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

import com.fasterxml.jackson.databind.JsonNode;
import com.networknt.schema.Error;
import com.networknt.schema.Schema;
import com.networknt.schema.SchemaRegistry;
import com.networknt.schema.SpecificationVersion;

/** Validates JSON documents against one of the JSON Schemas (2020-12) shipped on the classpath under {@code /schemas}. */
public final class SchemaValidator {

    /** {@code schemas/scenario.schema.json}. */
    public static final String SCENARIO = "/schemas/scenario.schema.json";
    /** {@code schemas/model-expect.schema.json}. */
    public static final String MODEL_EXPECT = "/schemas/model-expect.schema.json";
    /** {@code schemas/coverage-exemptions.schema.json}. */
    public static final String COVERAGE_EXEMPTIONS = "/schemas/coverage-exemptions.schema.json";

    private final Schema schema;
    private final String schemaResource;

    public SchemaValidator(String schemaResource) {
        this.schemaResource = schemaResource;
        try (InputStream in = SchemaValidator.class.getResourceAsStream(schemaResource)) {
            if (in == null) {
                throw new IllegalStateException("Schema resource " + schemaResource + " is missing from the classpath");
            }
            this.schema = SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12).getSchema(in);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read schema " + schemaResource, e);
        }
    }

    /** Returns the violations of {@code document}, empty when it is valid. Each starts with its JSON path. */
    public List<String> validate(JsonNode document) {
        List<String> problems = new ArrayList<>();
        for (Error error : schema.validate(document)) {
            // The library's message starts with the property ("required property 'x' not found"); the location tells where.
            problems.add(error.getInstanceLocation() + ": " + error.getMessage());
        }
        problems.sort(String::compareTo);
        return problems;
    }

    /** Throws {@link InvalidScenarioException} listing every violation. */
    public void requireValid(JsonNode document, String source) {
        List<String> problems = validate(document);
        if (!problems.isEmpty()) {
            throw new InvalidScenarioException(source + " (schema " + schemaResource.substring(schemaResource.lastIndexOf('/') + 1) + ")", problems);
        }
    }
}
