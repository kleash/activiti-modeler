package io.github.kleash.activiti.harness;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.github.kleash.activiti.harness.project.RepoLayout;

/**
 * Doc consistency: {@code docs/FEATURE_MATRIX.md} and {@code docs/verification-index.md} are written by hand, and the matrix's rule
 * is that a row is {@code supported} only with a named assertion. This test cannot judge whether an assertion is good enough, but it
 * fails when the two documents disagree about a row or a status, when a {@code supported} row names no proof at all, when a
 * {@code partly supported} row does not say what is missing, and when the index cites a scenario file, a scenario title or a
 * {@code model-expect.json} process that does not exist (the usual result of renaming a scenario).
 */
class DocsConsistencyTest {

    private static final Path ROOT = RepoLayout.root();
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Pattern ID = Pattern.compile("[A-Z]{1,2}\\d+[a-z]?");
    private static final List<String> STATUSES = List.of("supported", "partly supported", "not supported");
    /** {@code C05/timer-starts "title…"}: project, scenario file (without the extension), optional quoted title start. */
    private static final Pattern SCENARIO_CITATION =
            Pattern.compile("\\b(C\\d\\d(?:-kie)?)/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?![\\w*-])(?: ×\\d+)?(?: \"([^\"]+)\")?");
    /** {@code ME C05 timerStarts.startCron}: project and process key. */
    private static final Pattern MODEL_EXPECT_CITATION = Pattern.compile("\\bME (C\\d\\d(?:-kie)?) ([A-Za-z][A-Za-z0-9]*)(?![\\w*])");

    // ---- status ---------------------------------------------------------------------------------------------------------

    @Test
    void everyStatusRowOfTheMatrixHasAnIndexRowWithTheSameStatus() throws IOException {
        Map<String, String> matrix = statusRows(ROOT.resolve("docs/FEATURE_MATRIX.md"), -1);
        Map<String, String> index = statusRows(ROOT.resolve("docs/verification-index.md"), 2);
        assertThat(matrix).as("status rows read from FEATURE_MATRIX.md").hasSizeGreaterThan(100);

        List<String> problems = new ArrayList<>();
        matrix.forEach((id, status) -> {
            String indexed = index.get(id);
            if (indexed == null) {
                problems.add(id + ": no row in verification-index.md");
            } else if (!status.equals(indexed)) {
                problems.add(id + ": the matrix says '" + status + "' but the index says '" + indexed + "'");
            }
        });
        index.keySet().stream().filter(id -> !matrix.containsKey(id))
                .forEach(id -> problems.add(id + ": a row of verification-index.md that FEATURE_MATRIX.md does not have"));
        assertThat(problems).isEmpty();
    }

    /** The proof columns of an index row are the ones between the status and the last column (what is missing, or notes). */
    @Test
    void everySupportedRowNamesAProofAndEveryPartlySupportedRowSaysWhatIsMissing() throws IOException {
        Map<String, String> matrix = statusRows(ROOT.resolve("docs/FEATURE_MATRIX.md"), -1);
        List<String> problems = new ArrayList<>();
        for (List<String> cells : tableRows(ROOT.resolve("docs/verification-index.md"))) {
            String id = cells.get(0);
            if (cells.size() < 5 || !matrix.containsKey(id)) {
                continue;
            }
            boolean proof = cells.subList(3, cells.size() - 1).stream().anyMatch(c -> !empty(c));
            if ("supported".equals(matrix.get(id)) && !proof) {
                problems.add(id + ": 'supported' but none of the proof columns names an assertion");
            }
            if ("partly supported".equals(matrix.get(id)) && empty(cells.get(cells.size() - 1))) {
                problems.add(id + ": 'partly supported' but the last column does not say what is missing");
            }
        }
        assertThat(problems).isEmpty();
    }

    // ---- citations ------------------------------------------------------------------------------------------------------

    @Test
    void everyScenarioTheIndexCitesExists() throws IOException {
        String index = Files.readString(ROOT.resolve("docs/verification-index.md"));
        Map<String, List<String>> titles = new TreeMap<>();
        List<String> problems = new ArrayList<>();
        int checked = 0;
        Matcher m = SCENARIO_CITATION.matcher(index);
        while (m.find()) {
            String project = m.group(1);
            String file = m.group(2);
            String key = project + "/" + file;
            if (!titles.containsKey(key)) {
                titles.put(key, scenarioTitles(project, file));
            }
            List<String> known = titles.get(key);
            if (known == null) {
                problems.add(key + ": no such scenario file in corpus/" + projectFolder(project) + "/scenarios");
                continue;
            }
            checked++;
            String quoted = m.group(3);
            if (quoted != null) {
                String text = quoted.replaceAll("^…|…$", "").trim();
                if (known.stream().noneMatch(t -> t.contains(text))) {
                    problems.add(key + ": no scenario title contains \"" + text + "\"");
                }
            }
        }
        assertThat(checked).as("scenario citations in verification-index.md").isGreaterThan(50);
        assertThat(problems).isEmpty();
    }

    @Test
    void everyModelExpectProcessTheIndexCitesExists() throws IOException {
        String index = Files.readString(ROOT.resolve("docs/verification-index.md"));
        List<String> problems = new ArrayList<>();
        int checked = 0;
        Matcher m = MODEL_EXPECT_CITATION.matcher(index);
        while (m.find()) {
            Path file = ROOT.resolve("corpus").resolve(projectFolder(m.group(1))).resolve("model-expect.json");
            checked++;
            if (!Files.isRegularFile(file)) {
                problems.add(m.group(0) + ": " + file + " does not exist");
            } else if (!JSON.readTree(file.toFile()).path("processes").has(m.group(2))) {
                problems.add(m.group(0) + ": no process '" + m.group(2) + "' in " + file.getFileName());
            }
        }
        assertThat(checked).as("model-expect citations in verification-index.md").isGreaterThan(30);
        assertThat(problems).isEmpty();
    }

    // ---- reading --------------------------------------------------------------------------------------------------------

    private static boolean empty(String cell) {
        return cell.matches("(?i)\\s*(none|n/a|-|—)?\\.?\\s*");
    }

    /** Rows whose first cell is a feature id and whose status cell (index {@code statusColumn}, -1 = the last) is a known status. */
    private static Map<String, String> statusRows(Path file, int statusColumn) throws IOException {
        Map<String, String> rows = new TreeMap<>();
        for (List<String> cells : tableRows(file)) {
            if (cells.size() < 3 || !ID.matcher(cells.get(0)).matches()) {
                continue;
            }
            String status = cells.get(statusColumn < 0 ? cells.size() - 1 : statusColumn).replace("*", "").trim();
            if (STATUSES.contains(status)) {
                rows.put(cells.get(0), status);
            }
        }
        return rows;
    }

    /** The cells of every markdown table row; a pipe escaped with a backslash stays in its cell. */
    private static List<List<String>> tableRows(Path file) throws IOException {
        List<List<String>> rows = new ArrayList<>();
        for (String line : Files.readAllLines(file)) {
            if (!line.startsWith("|")) {
                continue;
            }
            String body = line.strip();
            body = body.substring(1, body.endsWith("|") ? body.length() - 1 : body.length());
            List<String> cells = new ArrayList<>();
            for (String cell : body.split("(?<!\\\\)\\|", -1)) {
                cells.add(cell.strip());
            }
            rows.add(cells);
        }
        return rows;
    }

    private static String projectFolder(String project) throws IOException {
        if ("C17".equals(project)) {
            return "C17-dmn-drd";
        }
        if ("C17-kie".equals(project)) {
            return "C17-dmn-drd-kie";
        }
        try (Stream<Path> folders = Files.list(ROOT.resolve("corpus"))) {
            return folders.map(p -> p.getFileName().toString())
                    .filter(n -> n.startsWith(project + "-"))
                    .findFirst()
                    .orElseThrow(() -> new IllegalStateException("no corpus folder for " + project));
        }
    }

    /** The scenario names of {@code corpus/<project>/scenarios/<file>.scenario.json}, or {@code null} when the file is missing. */
    private static List<String> scenarioTitles(String project, String file) throws IOException {
        Path path = ROOT.resolve("corpus").resolve(projectFolder(project)).resolve("scenarios").resolve(file + ".scenario.json");
        if (!Files.isRegularFile(path)) {
            return null;
        }
        List<String> titles = new ArrayList<>();
        JsonNode document = JSON.readTree(path.toFile());
        for (String section : List.of("scenarios", "decisions")) {
            for (JsonNode s : document.path(section)) {
                titles.add(s.path("name").asText(s.path("decision").asText("")));
            }
        }
        return titles;
    }
}
