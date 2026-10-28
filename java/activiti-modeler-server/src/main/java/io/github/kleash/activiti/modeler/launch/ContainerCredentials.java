package io.github.kleash.activiti.modeler.launch;

import java.security.SecureRandom;
import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.Profiles;

import io.github.kleash.activiti.modeler.ModelerServerProperties;

/**
 * In the Docker image (profile {@code container}) the server listens on all addresses inside the container, so the demo passwords must
 * not stay. The password of every demo user becomes {@code MODELER_PASSWORD}, or a random one generated at start and printed by the
 * banner ({@link ServerBanner}). Registered in {@code META-INF/spring.factories}; does nothing without the profile.
 */
public class ContainerCredentials implements EnvironmentPostProcessor, Ordered {

    /** The profile of the Docker image. */
    public static final String PROFILE = "container";
    /** Property that holds a generated password, for the banner. */
    public static final String GENERATED_PROPERTY = "modeler.container.generated-password";
    private static final String SOURCE = "modelerContainerCredentials";
    private static final String ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        if (!environment.acceptsProfiles(Profiles.of(PROFILE))) {
            return;
        }
        String chosen = environment.getProperty("MODELER_PASSWORD");
        boolean generated = chosen == null || chosen.isEmpty();
        String password = generated ? generate() : chosen;
        Map<String, Object> properties = new LinkedHashMap<>();
        Map<String, ModelerServerProperties.User> users = Binder.get(environment)
                .bind("modeler.server", Bindable.of(ModelerServerProperties.class)).map(ModelerServerProperties::getUsers).orElse(Map.of());
        for (String name : users.keySet()) {
            // "{noop}" keeps a password that starts with "{" from being read as an encoder prefix
            properties.put("modeler.server.users." + name + ".password", "{noop}" + password);
        }
        if (generated) {
            properties.put(GENERATED_PROPERTY, password);
        }
        environment.getPropertySources().addFirst(new MapPropertySource(SOURCE, properties));
    }

    /** @return a random password of 20 characters (about 115 bits) without look-alike characters */
    static String generate() {
        SecureRandom random = new SecureRandom();
        StringBuilder password = new StringBuilder();
        for (int i = 0; i < 20; i++) {
            password.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
        }
        return password.toString();
    }

    @Override
    public int getOrder() {
        return Ordered.LOWEST_PRECEDENCE;
    }
}
