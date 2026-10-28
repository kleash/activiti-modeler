package io.github.kleash.activiti.rest.dev;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpStatus;

import io.github.kleash.activiti.rest.dev.workspace.WorkspaceException;
import io.github.kleash.activiti.rest.dev.workspace.WorkspaceProperties;
import io.github.kleash.activiti.rest.dev.workspace.WorkspaceService;

/** The path checks of the workspace, without a web layer in front of them. */
class WorkspaceServiceTest {

    @TempDir Path temp;
    Path root;
    WorkspaceProperties properties;
    WorkspaceService workspace;

    @BeforeEach
    void setUp() throws IOException {
        root = Files.createDirectories(temp.resolve("workspace"));
        properties = new WorkspaceProperties();
        properties.setDir(root);
        workspace = new WorkspaceService(properties);
    }

    private static WorkspaceException refused(Runnable action) {
        Throwable thrown = org.assertj.core.api.Assertions.catchThrowable(action::run);
        assertThat(thrown).isInstanceOf(WorkspaceException.class);
        return (WorkspaceException) thrown;
    }

    @Test
    void everyWayOfClimbingOutIsRefused() throws IOException {
        Files.writeString(temp.resolve("outside.json"), "{}");
        for (String path : new String[] {"../outside.json", "a/../../outside.json", "..", "a/..", "./x.json", "a/./x.json", "/../outside.json",
            "a\\..\\..\\outside.json", "..\\outside.json", "C:\\windows\\x.json", "c:x.json", "a//b.json", "a/b.json\0", "x.json:stream", ".hidden.json", "ok/.git/x.json"}) {
            assertThat(refused(() -> workspace.write(path, new byte[] {'{', '}'})).status()).as("write %s", path).isEqualTo(HttpStatus.BAD_REQUEST);
            assertThat(refused(() -> workspace.read(path)).status()).as("read %s", path).isEqualTo(HttpStatus.BAD_REQUEST);
            assertThat(refused(() -> workspace.delete(path, true)).status()).as("delete %s", path).isEqualTo(HttpStatus.BAD_REQUEST);
        }
        assertThat(Files.readString(temp.resolve("outside.json"))).isEqualTo("{}");
    }

    @Test
    void aSymbolicLinkCannotLeadOutOfTheWorkspace() throws IOException {
        Path outside = Files.createDirectories(temp.resolve("elsewhere"));
        Files.writeString(outside.resolve("secret.json"), "{\"secret\":1}");
        Files.createSymbolicLink(root.resolve("link"), outside);

        assertThat(refused(() -> workspace.read("link/secret.json")).status()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused(() -> workspace.write("link/new.json", new byte[] {'{', '}'})).status()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(outside.resolve("new.json")).doesNotExist();
        // a link to a file inside is fine; a link to a file outside is not
        Files.createSymbolicLink(root.resolve("secret-link.json"), outside.resolve("secret.json"));
        assertThat(refused(() -> workspace.read("secret-link.json")).status()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(workspace.list("", true).entries()).noneMatch(e -> e.path().contains("link"));
    }

    @Test
    void onlyConfiguredFileTypesAreAccepted() {
        assertThat(refused(() -> workspace.write("run.sh", new byte[] {'x'})).status()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(refused(() -> workspace.write("noextension", new byte[] {'x'})).status()).isEqualTo(HttpStatus.FORBIDDEN);
        workspace.write("a/order.bpmn20.xml", "<x/>".getBytes(StandardCharsets.UTF_8));
        workspace.write("a/ORDER.DMN", "<x/>".getBytes(StandardCharsets.UTF_8));
        workspace.write("a/model-expect.json", "{}".getBytes(StandardCharsets.UTF_8));
        workspace.write("a/harness.properties", "x=1".getBytes(StandardCharsets.UTF_8));
        assertThat(workspace.list("a", false).entries()).hasSize(4);

        properties.setAllowedSuffixes(java.util.List.of(".json"));
        assertThat(refused(() -> workspace.read("a/order.bpmn20.xml")).status()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    void theSizeLimitAppliesAndNothingIsLeftBehind() throws IOException {
        properties.setMaxFileSize(10);
        assertThat(refused(() -> workspace.write("big.json", new byte[11])).status()).isEqualTo(HttpStatus.PAYLOAD_TOO_LARGE);
        assertThat(root.resolve("big.json")).doesNotExist();
        workspace.write("small.json", new byte[10]);
        try (var files = Files.list(root)) {
            assertThat(files.map(p -> p.getFileName().toString())).containsExactly("small.json");
        }
    }

    @Test
    void withoutAFolderNothingIsServed() {
        WorkspaceService unconfigured = new WorkspaceService(new WorkspaceProperties());

        assertThat(unconfigured.configured()).isFalse();
        WorkspaceException e = refused(() -> unconfigured.list("", false));
        assertThat(e.status()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(e.getMessage()).contains("--workspace");
    }

    @Test
    void aMissingRootFolderIsCreatedOnFirstUse() {
        properties.setDir(temp.resolve("fresh/workspace"));
        workspace.write("x.json", new byte[] {'{', '}'});

        assertThat(temp.resolve("fresh/workspace/x.json")).exists();
    }

    @Test
    void deletingAFolderRemovesItsContentButNeverFollowsALink() throws IOException {
        Path outside = Files.createDirectories(temp.resolve("keep"));
        Files.writeString(outside.resolve("keep.json"), "{}");
        workspace.write("d/inner.json", new byte[] {'{', '}'});
        Files.createSymbolicLink(root.resolve("d/link"), outside);

        workspace.delete("d", true);

        assertThat(root.resolve("d")).doesNotExist();
        assertThat(outside.resolve("keep.json")).exists();
        assertThatThrownBy(() -> workspace.delete("d", true)).isInstanceOf(WorkspaceException.class);
    }
}
