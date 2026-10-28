package io.github.kleash.activiti.rest.dev.workspace;

import java.io.IOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.stream.Stream;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;

import io.github.kleash.activiti.rest.dev.dto.DevDtos;

/**
 * The project files of the modeler on disk, below one configured root ({@code modeler.workspace.dir}).
 *
 * <p>Every request path is checked before it touches the file system: no {@code ..} or {@code .} segments, no backslashes, colons or
 * control characters, no hidden segments (a name starting with a dot), and the resolved path - with symbolic links resolved - must stay
 * inside the root. Only the file types of the project layout are served or written ({@code modeler.workspace.allowed-suffixes}), up to
 * {@code modeler.workspace.max-file-size}. Files are written atomically (a temporary file in the same folder, then a move).
 */
public class WorkspaceService {

    private final WorkspaceProperties properties;

    public WorkspaceService(WorkspaceProperties properties) {
        this.properties = properties;
    }

    /** @return whether a workspace folder is configured */
    public boolean configured() {
        return properties.getDir() != null;
    }

    // ---- read ----------------------------------------------------------------------------------------------------------------

    /** Whether a path names a directory (the root included). */
    public boolean isDirectory(String path) {
        return Files.isDirectory(resolve(path));
    }

    /** The entries of a directory: directories first, then files, each sorted by path. */
    public DevDtos.WorkspaceListing list(String path, boolean recursive) {
        Path directory = resolve(path);
        Path root = rootReal();
        if (!Files.isDirectory(directory)) {
            throw new WorkspaceException(HttpStatus.NOT_FOUND, "There is no directory '" + clean(path) + "' in the workspace");
        }
        List<DevDtos.WorkspaceEntry> entries = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(directory, recursive ? Integer.MAX_VALUE : 1)) {
            for (Path entry : (Iterable<Path>) walk.filter(p -> !p.equals(directory))::iterator) {
                String relative = relative(root, entry);
                if (hiddenSegment(relative) || escapes(entry, root)) {
                    continue;
                }
                BasicFileAttributes attributes = Files.readAttributes(entry, BasicFileAttributes.class);
                if (attributes.isDirectory()) {
                    entries.add(new DevDtos.WorkspaceEntry(relative, "directory", null, attributes.lastModifiedTime().toInstant()));
                } else if (attributes.isRegularFile() && allowedName(entry.getFileName().toString())) {
                    entries.add(new DevDtos.WorkspaceEntry(relative, "file", attributes.size(), attributes.lastModifiedTime().toInstant()));
                }
            }
        } catch (IOException e) {
            throw new IllegalStateException("Cannot list the workspace folder '" + clean(path) + "'", e);
        }
        entries.sort(Comparator.comparing((DevDtos.WorkspaceEntry e) -> !"directory".equals(e.type())).thenComparing(DevDtos.WorkspaceEntry::path));
        return new DevDtos.WorkspaceListing(clean(path), entries);
    }

    /** The content of a file. */
    public byte[] read(String path) {
        Path file = resolveFile(path);
        if (!Files.isRegularFile(file)) {
            throw new WorkspaceException(HttpStatus.NOT_FOUND, "There is no file '" + clean(path) + "' in the workspace");
        }
        try {
            if (Files.size(file) > properties.getMaxFileSize()) {
                throw new WorkspaceException(HttpStatus.PAYLOAD_TOO_LARGE, "The file '" + clean(path) + "' is larger than " + properties.getMaxFileSize() + " bytes");
            }
            return Files.readAllBytes(file);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read '" + clean(path) + "'", e);
        }
    }

    /** The media type a file is served with, from its name. */
    public static MediaType mediaTypeOf(String path) {
        String name = path.toLowerCase(Locale.ROOT);
        if (name.endsWith(".json")) {
            return MediaType.APPLICATION_JSON;
        }
        if (name.endsWith(".xml") || name.endsWith(".bpmn") || name.endsWith(".dmn")) {
            return MediaType.APPLICATION_XML;
        }
        if (name.endsWith(".svg")) {
            return MediaType.parseMediaType("image/svg+xml");
        }
        if (name.endsWith(".png")) {
            return MediaType.IMAGE_PNG;
        }
        return MediaType.TEXT_PLAIN;
    }

    // ---- write ---------------------------------------------------------------------------------------------------------------

    /** @return {@code true} when the file is new, {@code false} when it replaced one */
    public boolean write(String path, byte[] content) {
        if (content.length > properties.getMaxFileSize()) {
            throw new WorkspaceException(HttpStatus.PAYLOAD_TOO_LARGE, "The file is " + content.length + " bytes; the limit is " + properties.getMaxFileSize()
                    + " (modeler.workspace.max-file-size)");
        }
        Path file = resolveFile(path);
        if (Files.isDirectory(file)) {
            throw new WorkspaceException(HttpStatus.CONFLICT, "'" + clean(path) + "' is a directory");
        }
        boolean created = !Files.exists(file);
        try {
            Path parent = file.getParent();
            Files.createDirectories(parent);
            if (escapes(parent, rootReal())) {
                throw new WorkspaceException(HttpStatus.BAD_REQUEST, "The path '" + clean(path) + "' leaves the workspace");
            }
            Path temp = parent.resolve(".tmp-" + UUID.randomUUID());
            Files.write(temp, content);
            try {
                Files.move(temp, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            throw new IllegalStateException("Cannot write '" + clean(path) + "'", e);
        }
        return created;
    }

    /** Deletes a file, or a directory (only an empty one unless {@code recursive}). */
    public void delete(String path, boolean recursive) {
        if (clean(path).isEmpty()) {
            throw new WorkspaceException(HttpStatus.BAD_REQUEST, "The workspace root cannot be deleted");
        }
        Path target = resolve(path);
        if (!Files.exists(target, LinkOption.NOFOLLOW_LINKS)) {
            throw new WorkspaceException(HttpStatus.NOT_FOUND, "There is nothing at '" + clean(path) + "' in the workspace");
        }
        try {
            if (Files.isDirectory(target, LinkOption.NOFOLLOW_LINKS)) {
                try (Stream<Path> children = Files.list(target)) {
                    if (children.findAny().isPresent() && !recursive) {
                        throw new WorkspaceException(HttpStatus.CONFLICT, "The directory '" + clean(path) + "' is not empty; delete with recursive=true");
                    }
                }
                Files.walkFileTree(target, new SimpleFileVisitor<>() {
                    @Override
                    public FileVisitResult visitFile(Path file, BasicFileAttributes attributes) throws IOException {
                        Files.delete(file);
                        return FileVisitResult.CONTINUE;
                    }

                    @Override
                    public FileVisitResult postVisitDirectory(Path dir, IOException failure) throws IOException {
                        Files.delete(dir);
                        return FileVisitResult.CONTINUE;
                    }
                });
            } else {
                requireAllowed(path, target);
                Files.delete(target);
            }
        } catch (NoSuchFileException e) {
            throw new WorkspaceException(HttpStatus.NOT_FOUND, "There is nothing at '" + clean(path) + "' in the workspace");
        } catch (IOException e) {
            throw new IllegalStateException("Cannot delete '" + clean(path) + "'", e);
        }
    }

    // ---- path safety ------------------------------------------------------------------------------------------------------------

    private Path rootReal() {
        if (properties.getDir() == null) {
            throw new WorkspaceException(HttpStatus.NOT_FOUND, "No workspace is configured: start the server with --workspace=<folder> or set modeler.workspace.dir");
        }
        try {
            Path root = properties.getDir().toAbsolutePath().normalize();
            Files.createDirectories(root);
            return root.toRealPath();
        } catch (IOException e) {
            throw new IllegalStateException("The workspace folder " + properties.getDir() + " is not usable", e);
        }
    }

    /** The path inside the root that a request path names, after the safety checks; the path need not exist. */
    private Path resolve(String requested) {
        Path root = rootReal();
        String relative = clean(requested);
        for (String segment : relative.isEmpty() ? new String[0] : relative.split("/", -1)) {
            checkSegment(segment, requested);
        }
        Path resolved = root.resolve(relative).normalize();
        if (!resolved.startsWith(root)) {
            throw new WorkspaceException(HttpStatus.BAD_REQUEST, "The path '" + requested + "' leaves the workspace");
        }
        if (escapes(resolved, root)) {
            throw new WorkspaceException(HttpStatus.BAD_REQUEST, "The path '" + requested + "' leaves the workspace through a symbolic link");
        }
        return resolved;
    }

    private Path resolveFile(String requested) {
        Path file = resolve(requested);
        if (clean(requested).isEmpty()) {
            throw new WorkspaceException(HttpStatus.BAD_REQUEST, "A file path is required");
        }
        requireAllowed(requested, file);
        return file;
    }

    private void requireAllowed(String requested, Path file) {
        if (!allowedName(file.getFileName().toString())) {
            throw new WorkspaceException(HttpStatus.FORBIDDEN, "The workspace holds project files only; '" + file.getFileName() + "' does not end in one of "
                    + properties.getAllowedSuffixes() + " (modeler.workspace.allowed-suffixes)");
        }
    }

    private boolean allowedName(String name) {
        String lower = name.toLowerCase(Locale.ROOT);
        return properties.getAllowedSuffixes().stream().anyMatch(suffix -> lower.endsWith(suffix.toLowerCase(Locale.ROOT)));
    }

    private static void checkSegment(String segment, String requested) {
        if (segment.isEmpty()) {
            throw new WorkspaceException(HttpStatus.BAD_REQUEST, "The path '" + requested + "' has an empty segment");
        }
        if (segment.equals(".") || segment.equals("..")) {
            throw new WorkspaceException(HttpStatus.BAD_REQUEST, "The path '" + requested + "' contains '" + segment + "': paths are relative to the workspace root and do not climb");
        }
        if (segment.startsWith(".")) {
            throw new WorkspaceException(HttpStatus.BAD_REQUEST, "The path '" + requested + "' has a hidden segment '" + segment + "'");
        }
        if (segment.length() > 255) {
            throw new WorkspaceException(HttpStatus.BAD_REQUEST, "A segment of the path is longer than 255 characters");
        }
        for (int i = 0; i < segment.length(); i++) {
            char c = segment.charAt(i);
            if (c < 0x20 || c == 0x7f || c == '\\' || c == ':' || c == '*' || c == '?' || c == '"' || c == '<' || c == '>' || c == '|') {
                throw new WorkspaceException(HttpStatus.BAD_REQUEST, "The path '" + requested.replaceAll("\\p{Cntrl}", "?") + "' contains a character that is not allowed in a workspace path");
            }
        }
    }

    /** The request path without leading and trailing slashes. */
    private static String clean(String requested) {
        if (requested == null) {
            return "";
        }
        String path = requested;
        while (path.startsWith("/")) {
            path = path.substring(1);
        }
        while (path.endsWith("/")) {
            path = path.substring(0, path.length() - 1);
        }
        return path;
    }

    /** Whether the real location of {@code path} (or of its nearest existing ancestor) is outside {@code root}. */
    private static boolean escapes(Path path, Path root) {
        Path probe = path;
        while (probe != null && !Files.exists(probe, LinkOption.NOFOLLOW_LINKS)) {
            probe = probe.getParent();
        }
        if (probe == null) {
            return true;
        }
        try {
            return !probe.toRealPath().startsWith(root);
        } catch (IOException e) {
            return true;
        }
    }

    private static String relative(Path root, Path entry) {
        return root.relativize(entry).toString().replace('\\', '/');
    }

    private static boolean hiddenSegment(String relative) {
        for (String segment : relative.split("/")) {
            if (segment.startsWith(".")) {
                return true;
            }
        }
        return false;
    }
}
