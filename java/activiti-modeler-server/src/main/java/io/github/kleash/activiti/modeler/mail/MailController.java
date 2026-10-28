package io.github.kleash.activiti.modeler.mail;

import java.util.List;
import java.util.Map;

import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;

import io.github.kleash.activiti.rest.core.error.RuntimeRestController;
import io.github.kleash.activiti.rest.core.security.Access;
import io.github.kleash.activiti.rest.core.security.RequiresAccess;
import io.github.kleash.activiti.rest.dev.DevApi;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

/** The messages the mail tasks of this server sent to its embedded SMTP server. Part of the dev API: admin access, dev endpoints on. */
@RuntimeRestController
@ConditionalOnExpression("${modeler.server.mail.enabled:true} and ${activiti.rest.dev.enabled:false}")
@RequestMapping(DevApi.MAPPING + "/mail")
@RequiresAccess(Access.ADMIN)
@Tag(name = "Dev", description = "Mail sent by mail tasks to the embedded SMTP server")
public class MailController {

    /**
     * @param host     SMTP host
     * @param port     SMTP port
     * @param messages the received messages, oldest first: from, to, cc, subject, text, html, attachments (file names), sent
     */
    public record Mailbox(String host, int port, List<Map<String, Object>> messages) {
    }

    private final MailServer mail;

    public MailController(MailServer mail) {
        this.mail = mail;
    }

    @GetMapping
    @Operation(operationId = "devMailList", summary = "Messages received by the embedded SMTP server")
    public Mailbox list() {
        return new Mailbox(mail.host(), mail.port(), mail.messages());
    }

    @DeleteMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(operationId = "devMailPurge", summary = "Delete every received message")
    public void purge() {
        mail.purge();
    }
}
