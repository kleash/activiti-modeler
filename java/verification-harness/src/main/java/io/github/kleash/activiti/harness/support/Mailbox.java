package io.github.kleash.activiti.harness.support;

import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;

import com.icegreen.greenmail.store.FolderException;
import com.icegreen.greenmail.store.MailFolder;
import com.icegreen.greenmail.store.StoredMessage;
import com.icegreen.greenmail.user.GreenMailUser;
import com.icegreen.greenmail.util.GreenMail;

import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.Multipart;
import jakarta.mail.Part;
import jakarta.mail.internet.MimeMessage;

/**
 * Bean {@code mailbox} (only in projects whose {@code harness.properties} say {@code harness.greenmail=true}): reads what the
 * mail tasks delivered to the GreenMail server of the context.
 *
 * <p>{@code ${mailbox.inbox(address)}} returns the messages in the inbox of {@code address}, in delivery order, as a list of
 * maps: {@code subject}, {@code from}, {@code to} and {@code cc} (the header values, or {@code null}), {@code contentType}
 * (the base type of the message, for example {@code text/plain} or {@code multipart/alternative}), {@code text} and
 * {@code html} (the first plain and html part, trimmed, or {@code null}) and {@code attachments} (file names). A blind copy
 * shows up only in the inbox of the bcc address, without a {@code Bcc} header. Use it as
 * {@code activiti:expression="${mailbox.inbox(customerEmail)}"} with {@code activiti:resultVariableName}.
 */
public class Mailbox {

    private final GreenMail greenMail;

    public Mailbox(GreenMail greenMail) {
        this.greenMail = greenMail;
    }

    public ArrayList<LinkedHashMap<String, Object>> inbox(String address) {
        ArrayList<LinkedHashMap<String, Object>> out = new ArrayList<>();
        GreenMailUser user = greenMail.getUserManager().getUserByEmail(address);
        if (user == null) {
            return out;
        }
        try {
            MailFolder inbox = greenMail.getManagers().getImapHostManager().getInbox(user);
            for (StoredMessage stored : inbox.getMessages()) {
                out.add(describe(stored.getMimeMessage()));
            }
        } catch (FolderException | MessagingException | IOException e) {
            throw new IllegalStateException("Cannot read the inbox of " + address, e);
        }
        return out;
    }

    private static LinkedHashMap<String, Object> describe(MimeMessage message) throws MessagingException, IOException {
        LinkedHashMap<String, Object> map = new LinkedHashMap<>();
        map.put("subject", message.getSubject());
        map.put("from", message.getFrom() != null && message.getFrom().length > 0 ? message.getFrom()[0].toString() : null);
        map.put("to", message.getHeader("To", ", "));
        map.put("cc", message.getHeader("Cc", ", "));
        map.put("contentType", new jakarta.mail.internet.ContentType(message.getContentType()).getBaseType());
        LinkedHashMap<String, Object> parts = new LinkedHashMap<>();
        ArrayList<String> attachments = new ArrayList<>();
        collect(message, parts, attachments);
        map.put("text", parts.get("text"));
        map.put("html", parts.get("html"));
        map.put("attachments", attachments);
        return map;
    }

    private static void collect(Part part, LinkedHashMap<String, Object> parts, List<String> attachments) throws MessagingException, IOException {
        if (part.isMimeType("multipart/*")) {
            Multipart multipart = (Multipart) part.getContent();
            for (int i = 0; i < multipart.getCount(); i++) {
                collect(multipart.getBodyPart(i), parts, attachments);
            }
        } else if (Part.ATTACHMENT.equalsIgnoreCase(part.getDisposition()) || part.getFileName() != null) {
            attachments.add(part.getFileName());
        } else if (part.isMimeType("text/plain")) {
            parts.putIfAbsent("text", String.valueOf(part.getContent()).trim());
        } else if (part.isMimeType("text/html")) {
            parts.putIfAbsent("html", String.valueOf(part.getContent()).trim());
        }
    }

    /** Not used by models: the number of messages in the whole server (for diagnostics). */
    public int total() {
        Message[] all = greenMail.getReceivedMessages();
        return all.length;
    }
}
