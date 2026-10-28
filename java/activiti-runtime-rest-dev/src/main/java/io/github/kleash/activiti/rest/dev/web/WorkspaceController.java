package io.github.kleash.activiti.rest.dev.web;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;

import io.github.kleash.activiti.rest.core.error.RuntimeRestController;
import io.github.kleash.activiti.rest.core.security.Access;
import io.github.kleash.activiti.rest.core.security.RequiresAccess;
import io.github.kleash.activiti.rest.dev.DevApi;
import io.github.kleash.activiti.rest.dev.dto.DevDtos;
import io.github.kleash.activiti.rest.dev.workspace.WorkspaceService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

/** Project files on disk, below the configured workspace folder. */
@RuntimeRestController
@RequestMapping(DevApi.MAPPING + "/workspace")
@RequiresAccess(Access.ADMIN)
@Tag(name = "Workspace", description = "Project files on disk (modeler.workspace.dir): list, read, write, delete")
public class WorkspaceController {

    private final WorkspaceService workspace;

    public WorkspaceController(WorkspaceService workspace) {
        this.workspace = workspace;
    }

    @GetMapping
    @Operation(operationId = "devWorkspaceRoot", summary = "The root of the workspace: JSON listing (recursive=true for the whole tree)")
    public DevDtos.WorkspaceListing root(@RequestParam(required = false, defaultValue = "false") boolean recursive) {
        return workspace.list("", recursive);
    }

    @GetMapping("/{*path}")
    @Operation(operationId = "devWorkspaceGet",
            summary = "A directory (JSON listing; recursive=true for the whole tree) or the content of a file")
    public ResponseEntity<?> get(@PathVariable String path, @RequestParam(required = false, defaultValue = "false") boolean recursive) {
        if (workspace.isDirectory(path)) {
            return ResponseEntity.ok(workspace.list(path, recursive));
        }
        return ResponseEntity.ok().contentType(WorkspaceService.mediaTypeOf(path)).body(workspace.read(path));
    }

    @PutMapping("/{*path}")
    @Operation(operationId = "devWorkspacePut", summary = "Create or replace a file with the request body (atomically); parent directories are created")
    public ResponseEntity<Void> put(@PathVariable String path, @RequestBody byte[] content) {
        boolean created = workspace.write(path, content);
        return ResponseEntity.status(created ? HttpStatus.CREATED : HttpStatus.NO_CONTENT).build();
    }

    @DeleteMapping("/{*path}")
    @Operation(operationId = "devWorkspaceDelete", summary = "Delete a file, or a directory (empty, or with recursive=true)")
    public ResponseEntity<Void> delete(@PathVariable String path, @RequestParam(required = false, defaultValue = "false") boolean recursive) {
        workspace.delete(path, recursive);
        return ResponseEntity.noContent().build();
    }
}
