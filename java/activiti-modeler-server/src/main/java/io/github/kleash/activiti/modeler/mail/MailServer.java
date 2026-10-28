package io.github.kleash.activiti.modeler.mail;

import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.icegreen.greenmail.util.GreenMail;

import jakarta.mail.Address;
import jakarta.mail.MessagingException;
import jakarta.mail.Multipart;
import jakarta.mail.Part;
import jakarta.mail.internet.MimeMessage;

/** The embedded SMTP server (GreenMail) that mail tasks send to, and a view of what it received. */
public class MailServer {

    private final GreenMail greenMail;

    public MailServer(GreenMail greenMail) {
        this.greenMail = greenMail;
    }

    /** @return the SMTP port */
    public int port() {
        return greenMail.getSmtp().getPort();
    }

    /** @return the host the server listens on */
    public String host() {
        return greenMail.getSmtp().getBindTo();
    }

    /** Every message received since the start (or the last purge), oldest first. */
    public List<Map<String, Object>> messages() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (MimeMessage message : greenMail.getReceivedMessages()) {
            try {
                out.add(describe(message));
            } catch (MessagingException | IOException e) {
                Map<String, Object> broken = new LinkedHashMap<>();
                broken.put("error", "Cannot read the message: " + e.getMessage());
                out.add(broken);
            }
        }
        return out;
    }

    /** Deletes every received message. */
    public void purge() {
        try {
            greenMail.purgeEmailFromAllMailboxes();
        } catch (com.icegreen.greenmail.store.FolderException e) {
            throw new IllegalStateException("Cannot purge the mailboxes", e);
        }
    }

    static Map<String, Object> describe(MimeMessage message) throws MessagingException, IOException {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("subject", message.getSubject());
        map.put("from", addresses(message.getFrom()));
        map.put("to", addresses(message.getRecipients(jakarta.mail.Message.RecipientType.TO)));
        map.put("cc", addresses(message.getRecipients(jakarta.mail.Message.RecipientType.CC)));
        map.put("sent", message.getSentDate() == null ? null : message.getSentDate().toInstant().toString());
        Map<String, Object> parts = new LinkedHashMap<>();
        List<String> attachments = new ArrayList<>();
        collect(message, parts, attachments);
        map.put("text", parts.get("text"));
        map.put("html", parts.get("html"));
        map.put("attachments", attachments);
        return map;
    }

    private static List<String> addresses(Address[] addresses) {
        List<String> out = new ArrayList<>();
        if (addresses != null) {
            for (Address address : addresses) {
                out.add(address.toString());
            }
        }
        return out;
    }

    private static void collect(Part part, Map<String, Object> parts, List<String> attachments) throws MessagingException, IOException {
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
}
