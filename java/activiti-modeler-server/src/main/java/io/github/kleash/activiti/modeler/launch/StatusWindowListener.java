package io.github.kleash.activiti.modeler.launch;

import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.boot.web.context.WebServerApplicationContext;
import org.springframework.context.ApplicationListener;
import org.springframework.core.env.Environment;

import io.github.kleash.activiti.modeler.ModelerServerProperties;

/** Tells the {@link StatusWindow} where the server came up. Registered by {@code main} only, so tests never get a window. */
public class StatusWindowListener implements ApplicationListener<ApplicationReadyEvent> {

    private final StatusWindow window;

    public StatusWindowListener(StatusWindow window) {
        this.window = window;
    }

    @Override
    public void onApplicationEvent(ApplicationReadyEvent event) {
        if (!(event.getApplicationContext() instanceof WebServerApplicationContext web)) {
            return;
        }
        Environment environment = event.getApplicationContext().getEnvironment();
        String url = ServerBanner.urlOf(environment, web.getWebServer().getPort());
        ModelerServerProperties.User modeler = event.getApplicationContext().getBean(ModelerServerProperties.class).getUsers().get("modeler");
        window.running(url, modeler == null ? null : "modeler", modeler == null ? null : modeler.getPassword(),
                environment.getProperty("modeler.workspace.dir"), environment.getProperty("logging.file.name"));
    }
}
