package io.github.kleash.activiti.harness.n01;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * The hand-written engine oracle of the N01 negative corpus, {@code corpus/N01-negative/expected-engine.json}: for each model
 * of {@code models/} what Activiti 9.0.0 does with it. See the README of that folder for the format.
 *
 * <p>Parsing is strict (an unknown key is an error), so a typo in the oracle cannot silently switch an assertion off.
 */
final class N01Oracle {

    /** What the engine does with a model. */
    enum Outcome {
        /** The deployment is refused. */
        DEPLOY_ERROR,
        /** It deploys, and the validator reports warnings only. */
        DEPLOYS_WITH_WARNING,
        /** It deploys and runs, but a construct is silently dropped or replaced by something else. */
        DEPLOYS_AND_DEGRADES,
        /** It deploys, and an API call (a start, a completion, a signal, a message) throws. */
        RUNTIME_ERROR,
        /** It deploys, and the instance waits for something that nothing can deliver. */
        HANGS,
        /** It deploys and runs as written; the harm the lint reports does not show on this model. */
        DEPLOYS_OK
    }

    record Problem(String key, String activityId) {
    }

    /** What the deployment failure must look like. At least one of {@code problems}, {@code messageContains} is given. */
    @JsonInclude(JsonInclude.Include.NON_EMPTY)
    record DeployError(String exception, List<String> messageContains, List<Problem> problems) {
        DeployError {
            messageContains = messageContains == null ? List.of() : List.copyOf(messageContains);
            problems = problems == null ? List.of() : List.copyOf(problems);
        }
    }

    /** A literal text of the model that is replaced before the model is deployed (it must occur exactly once). */
    record Transform(String replace, @JsonProperty("with") String with) {
    }

    /** The quick fix of the modeler and the hand-written model it leads to. */
    record Fixed(String quickFix, String variant, String check, String details, List<String> context, List<String> helpers) {
        Fixed {
            context = context == null ? List.of() : List.copyOf(context);
            helpers = helpers == null ? List.of() : List.copyOf(helpers);
        }
    }

    /**
     * A model and its expected outcome. Used for the files of {@code models/} and for their variants: derived with
     * {@code transform}, or hand-written in {@code engine/variants}.
     */
    record Entry(
            Outcome outcome,
            String details,
            List<String> evidence,
            String check,
            String file,
            List<String> context,
            List<String> helpers,
            List<Transform> transform,
            DeployError deployError,
            Map<String, Entry> variants,
            Fixed fixed) {

        Entry {
            evidence = evidence == null ? List.of() : List.copyOf(evidence);
            context = context == null ? List.of() : List.copyOf(context);
            helpers = helpers == null ? List.of() : List.copyOf(helpers);
            transform = transform == null ? List.of() : List.copyOf(transform);
            variants = variants == null ? Map.of() : Map.copyOf(new LinkedHashMap<>(variants));
        }
    }

    private record Document(String description, Map<String, String> outcomes, Map<String, Entry> files) {
    }

    private final Map<String, Entry> files;
    private final Map<String, String> outcomes;

    private N01Oracle(Document document) {
        this.files = new LinkedHashMap<>(document.files());
        this.outcomes = document.outcomes() == null ? Map.of() : document.outcomes();
    }

    static N01Oracle load(Path file) {
        ObjectMapper mapper = new ObjectMapper().configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, true);
        try {
            return new N01Oracle(mapper.readValue(Files.readString(file), Document.class));
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot read the engine oracle " + file + ": " + e.getMessage(), e);
        }
    }

    Map<String, Entry> files() {
        return files;
    }

    /** The glossary of outcomes the oracle carries for its readers. */
    Set<String> documentedOutcomes() {
        return outcomes.keySet();
    }

    /** All check ids the oracle names, base entries, variants and fixed variants. */
    List<String> checkIds() {
        List<String> ids = new ArrayList<>();
        files.values().forEach(e -> collect(e, ids));
        return ids;
    }

    private static void collect(Entry entry, List<String> ids) {
        if (entry.check() != null) {
            ids.add(entry.check());
        }
        if (entry.fixed() != null && entry.fixed().check() != null) {
            ids.add(entry.fixed().check());
        }
        entry.variants().values().forEach(v -> collect(v, ids));
    }
}
