package io.github.kleash.activiti.dmn;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Objects;

/**
 * A DMN document handed to a {@link DmnEvaluator}: its resource name (for messages only) and its XML text.
 * Engines use {@link #contentHash()} as the key of their parsed-model caches, so two resources with the same
 * text share one parsed model whatever they are called.
 */
public final class DmnResource {

    private final String name;
    private final String xml;
    private final String contentHash;

    /**
     * Creates a resource.
     *
     * @param name the resource name, for example {@code processes/risk.dmn}; only used in messages
     * @param xml  the DMN XML
     */
    public DmnResource(String name, String xml) {
        this.name = Objects.requireNonNull(name, "name");
        this.xml = Objects.requireNonNull(xml, "xml");
        this.contentHash = sha256(xml);
    }

    /** @return the resource name */
    public String name() {
        return name;
    }

    /** @return the DMN XML */
    public String xml() {
        return xml;
    }

    /** @return the SHA-256 of the XML text, hex encoded */
    public String contentHash() {
        return contentHash;
    }

    @Override
    public String toString() {
        return "DmnResource[" + name + "]";
    }

    private static String sha256(String text) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required by the Java platform", e);
        }
    }
}
