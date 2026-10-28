package io.github.kleash.activiti.harness;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class VerifyCliTest {

    @TempDir Path dir;

    private record Result(int status, String out, String err) {
    }

    private static Result cli(String... args) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ByteArrayOutputStream err = new ByteArrayOutputStream();
        int status = io.github.kleash.activiti.harness.VerifyCli.run(args, new PrintStream(out, true, StandardCharsets.UTF_8), new PrintStream(err, true, StandardCharsets.UTF_8));
        return new Result(status, out.toString(StandardCharsets.UTF_8), err.toString(StandardCharsets.UTF_8));
    }

    @Test
    void aGoodProjectPassesInBothDeployModesWithAReportLinePerCheck() {
        Result result = cli("verify", TestProjects.fixtureDir("mini").toString());

        assertThat(result.status()).isZero();
        assertThat(result.out())
                .contains("Project mini (directory, auto-deploy)")
                .contains("Project mini (directory, programmatic)")
                .contains("[ok]   application context starts and the project deploys")
                .contains("[ok]   mini.scenario.json: accepted")
                .contains("[ok]   path coverage: every flow node and sequence flow is visited")
                .contains("PASSED: 1 project(s), 2 deploy mode(s), 22 checks, 0 failed")
                .doesNotContain("[FAIL]");
    }

    @Test
    void theVerbIsOptionalAndTheModeCanBeChosen() {
        Result result = cli(TestProjects.fixtureDir("mini").toString(), "--mode", "programmatic");
        assertThat(result.status()).isZero();
        assertThat(result.out()).contains("(directory, programmatic)").doesNotContain("auto-deploy").contains("PASSED: 1 project(s), 1 deploy mode(s), 11 checks");
    }

    @Test
    void aFolderOfProjectsRunsEachOfThemAndCanBeFiltered() {
        Result result = cli(TestProjects.fixtureDir("").toString(), "--mode", "auto", "--project", "mini,async");
        assertThat(result.status()).isZero();
        assertThat(result.out()).contains("Project async (directory, auto-deploy)").contains("Project mini (directory, auto-deploy)")
                .doesNotContain("Project support");
        assertThat(result.out()).contains("note: expected validator warning (the async executor is off)");
    }

    @Test
    void aFailingCheckPrintsItsMessageAndExitsWithOne() throws Exception {
        Path copy = dir.resolve("broken");
        Files.createDirectories(copy);
        io.github.kleash.activiti.harness.TestProjects.copy("mini", copy);
        Path scenario = copy.resolve("scenarios/mini.scenario.json");
        Files.writeString(scenario, Files.readString(scenario).replace("\"endEvents\": [\"acceptedEnd\"]", "\"endEvents\": [\"rejectedEnd\"]"));

        Result result = cli(copy.toString(), "--mode", "auto");

        assertThat(result.status()).isEqualTo(1);
        assertThat(result.out())
                .contains("[FAIL] mini.scenario.json: accepted")
                .contains("endEvents: expected exactly [rejectedEnd] but the instance reached [acceptedEnd]")
                .contains("[ok]   mini.scenario.json: rejected")
                .contains("FAILED: 1 project(s), 1 deploy mode(s), 11 checks, 1 failed");
    }

    @Test
    void usageErrorsExitWithTwo() {
        assertThat(cli().status()).isEqualTo(2);
        assertThat(cli().err()).contains("usage: verify <dir>");
        assertThat(cli("a", "b").status()).isEqualTo(2);
        assertThat(cli(dir.toString(), "--mode", "sideways").err()).contains("Unknown --mode sideways");
        assertThat(cli(dir.toString()).err()).contains("has no processes/ folder");
        assertThat(cli(TestProjects.fixtureDir("mini").toString(), "--project", "zzz").err()).contains("No project matches --project zzz");
        assertThat(cli("--bogus").status()).isEqualTo(2);
        assertThat(cli("-h").status()).isZero();
    }
}
