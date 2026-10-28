package io.github.kleash.activiti.rest.dev;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.ApplicationContext;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

import io.github.kleash.activiti.rest.dev.testapp.TestApplication;
import io.github.kleash.activiti.rest.dev.web.DevController;
import io.github.kleash.activiti.rest.dev.web.WorkspaceController;

/** The dev endpoints are opt-in: without {@code activiti.rest.dev.enabled=true} they do not exist - not even for an admin. */
@SpringBootTest(classes = TestApplication.class, properties = {"activiti.rest.dev.enabled=false", "spring.datasource.url=jdbc:h2:mem:rest-dev-off;DB_CLOSE_DELAY=-1"})
@AutoConfigureMockMvc
@ExtendWith(OutputCaptureExtension.class)
class DevDisabledTest {

    @Autowired MockMvc mvc;
    @Autowired ApplicationContext context;

    @Test
    void theEndpointsAreNotRegisteredAndEvenAnAdminGets404() throws Exception {
        assertThat(context.getBeansOfType(DevController.class)).isEmpty();
        assertThat(context.getBeansOfType(WorkspaceController.class)).isEmpty();
        assertThat(context.getBeanNamesForType(io.github.kleash.activiti.rest.dev.service.DevDeploymentService.class)).isEmpty();
        for (String path : new String[] {"/validate", "/deployments", "/scenarios/run", "/decisions/evaluate"}) {
            assertThat(mvc.perform(MockMvcRequestBuilders.post("/api/dev" + path).contentType("application/json").content("{}").with(httpBasic("admin", "admin")))
                    .andReturn().getResponse().getStatus()).as(path).isEqualTo(404);
        }
        assertThat(mvc.perform(MockMvcRequestBuilders.get("/api/dev/workspace").with(httpBasic("admin", "admin"))).andReturn().getResponse().getStatus()).isEqualTo(404);
        // the core API next to it is there
        assertThat(mvc.perform(MockMvcRequestBuilders.get("/api/engine").with(httpBasic("admin", "admin"))).andReturn().getResponse().getStatus()).isEqualTo(200);
    }

    @Test
    void noWarningIsLogged(CapturedOutput output) {
        assertThat(output.getAll()).doesNotContain("DEV ENDPOINTS ARE ON");
    }
}
