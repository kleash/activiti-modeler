# syntax=docker/dockerfile:1
# The Activiti Modeler as a container (ADR 0008, feature K5).
#
#   docker build -t activiti-modeler .
#   docker run --rm -p 127.0.0.1:8080:8080 -v activiti-modeler-data:/data activiti-modeler
#
# Open http://localhost:8080 and sign in as "modeler" with the password printed in the container's output, or set your own with
# -e MODELER_PASSWORD=... . Publish the port on 127.0.0.1 as above: the server inside listens on all addresses (it must, or the published port
# could not reach it) and runs models, which is remote code execution by design (docs/adr/0007). Projects live in the volume /data.
# Hardening to add to the docker run line: --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges (the image has no shell and runs as
# user 65532; a folder you mount on /data must be writable by that user id).
#
# The image is built in three stages: the jar (a JDK builds it, with the web app inside), a trimmed Java runtime (jdeps and jlink, the same
# scripts/build-runtime.sh as the desktop bundles, run on the Alpine/musl build of the newest Temurin 25 that docker/jdk-alpine.env pins), and a
# final image FROM scratch that holds exactly: the musl C library (the only native library the Java runtime needs), the runtime, the jar, the health
# check and the licence files. No shell, no package manager (no apk), no coreutils, no OpenSSL, no glibc, no zlib: there is almost nothing in it
# that could carry an operating-system vulnerability. The package database of the one OS package (musl) is kept, so that scanners see what is there.
# The Alpine base and the build JDK image are pinned by digest (the digest of the multi-architecture index); Dependabot's docker ecosystem opens the
# pull requests that move them. The Temurin build is pinned by version and SHA-256 in docker/jdk-alpine.env (scripts/update-jdk-alpine.sh moves it).
# Without a shell there is nothing for the HEALTHCHECK to run but Java: docker/Healthcheck.java.
#

# Stage 1, the jar: a JDK builds it with the web app inside. The Maven wrapper downloads Maven and the frontend plugin downloads Node, so the stage
# needs nothing else. It runs on the build machine's own CPU even for a multi-platform build (the jar and the health check class are the same
# everywhere).
FROM --platform=$BUILDPLATFORM eclipse-temurin:25-jdk@sha256:f5b4ef3a13414837e75a0d124b28e7263690df23a780749880407768a6d42618 AS build
WORKDIR /src
# The Maven repository is a build cache (not part of any layer), so a rebuild does not download the libraries again.
COPY . .
# VERSION: the release version (a tag without the "v"); without it the jar keeps the version of the poms.
ARG VERSION=
RUN --mount=type=cache,target=/root/.m2 \
    if [ -n "$VERSION" ]; then ./java/mvnw -B -q -f java/pom.xml versions:set -DnewVersion="$VERSION" -DgenerateBackupPoms=false; fi \
 && ./java/mvnw -B -f java/pom.xml -Pbundle-modeler -pl activiti-modeler-server -am package -DskipTests \
 && cp "$(ls java/activiti-modeler-server/target/activiti-modeler-server-*-exec.jar | head -1)" /activiti-modeler.jar \
 && mkdir /healthcheck && javac --release 21 -d /healthcheck docker/Healthcheck.java

# Stage 2, the runtime: jdeps finds the Java modules the jar uses and jlink links only those. It runs on the TARGET platform (the runtime is native
# code, and this JDK is an Alpine build that needs musl, so the stage is Alpine), once per platform of a multi-platform build. The runtime is a
# trimmed copy of the pinned Temurin JDK, so the version in docker/jdk-alpine.env decides its security level. The tools of this stage (bash, wget,
# the JDK) are not in the final image: only /rootfs is copied.
FROM alpine:3.24.3@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a AS runtime
ARG TARGETARCH
# build-runtime.sh is a bash script, and jlink strips the native libraries with objcopy (binutils); the Alpine base has wget (with TLS) and sha256sum.
RUN apk add --no-cache bash binutils
COPY docker/jdk-alpine.env /build/jdk-alpine.env
# The JDK: from the Adoptium API (os=alpine-linux), only if its SHA-256 is the pinned one.
RUN set -eu; . /build/jdk-alpine.env; \
    case "$TARGETARCH" in \
      amd64) arch=x64; sha="$TEMURIN_SHA256_X64" ;; \
      arm64) arch=aarch64; sha="$TEMURIN_SHA256_AARCH64" ;; \
      *) echo "unsupported TARGETARCH '$TARGETARCH' (amd64 and arm64 only; build with BuildKit)" >&2; exit 1 ;; \
    esac; \
    wget -q -O /tmp/jdk.tar.gz "https://api.adoptium.net/v3/binary/version/jdk-$(echo "$TEMURIN_VERSION" | sed 's/+/%2B/')/alpine-linux/$arch/jdk/hotspot/normal/eclipse"; \
    echo "$sha  /tmp/jdk.tar.gz" | sha256sum -c -; \
    mkdir /opt/jdk; tar -xzf /tmp/jdk.tar.gz -C /opt/jdk --strip-components=1; rm /tmp/jdk.tar.gz; \
    /opt/jdk/bin/java -version
COPY scripts/build-runtime.sh /build/build-runtime.sh
COPY --from=build /activiti-modeler.jar /build/activiti-modeler.jar
RUN mkdir -p /rootfs/opt \
 && PATH="/opt/jdk/bin:$PATH" /build/build-runtime.sh --jar /build/activiti-modeler.jar --out /rootfs/opt/runtime
# The root of the final image. The Java runtime links against the C library only (musl; the JDK carries its own zlib, FreeType and CA certificates):
# the first command lists the shared libraries that every file of the runtime asks for and fails when one is neither in the runtime nor musl
# (libasound belongs to java.sound, which the server never loads). The package database keeps the musl entry (and only that) so that an image scan
# lists the package and its version; /etc/os-release, /etc/alpine-release, /etc/apk/arch and /etc/apk/repositories (four small text files that the
# scanner reads) name the Alpine release, the CPU and the repository for the same reason. Nothing here can run: there is no apk binary.
RUN set -eu; \
    cd /rootfs/opt/runtime; \
    for f in $(find . -type f \( -name '*.so' -o -path './bin/*' \)); do readelf -d "$f" 2>/dev/null | sed -n 's/.*Shared library: \[\(.*\)\]/\1/p'; done | sort -u >/tmp/needed; \
    cat /tmp/needed; \
    while read -r lib; do \
      case "$lib" in libc.musl-*.so.1|libasound.so.2) ;; *) [ -e "lib/$lib" ] || [ -e "lib/server/$lib" ] || { echo "the runtime needs $lib, which the final image would not have" >&2; exit 1; } ;; esac; \
    done </tmp/needed; \
    cd /; \
    mkdir -p /rootfs/lib/apk/db /rootfs/etc/apk /rootfs/tmp /rootfs/data /rootfs/home/nonroot; \
    cp -a /lib/ld-musl-*.so.1 /lib/libc.musl-*.so.1 /rootfs/lib/; \
    awk '/^$/ { if (keep) printf "%s\n", buf; buf=""; keep=0; next } { buf = buf $0 "\n"; if ($0 == "P:musl") keep=1 } END { if (keep) printf "%s", buf }' \
      /lib/apk/db/installed >/rootfs/lib/apk/db/installed; \
    grep -q '^P:musl$' /rootfs/lib/apk/db/installed; \
    cp /etc/apk/arch /etc/apk/repositories /rootfs/etc/apk/; cp /etc/alpine-release /rootfs/etc/alpine-release; cp -L /etc/os-release /rootfs/etc/os-release; \
    printf 'root:x:0:0:root:/root:/sbin/nologin\nnonroot:x:65532:65532:nonroot:/home/nonroot:/sbin/nologin\n' >/rootfs/etc/passwd; \
    printf 'root:x:0:\nnonroot:x:65532:\n' >/rootfs/etc/group; \
    chown 65532:65532 /rootfs/data /rootfs/home/nonroot; chmod 1777 /rootfs/tmp; \
    /rootfs/opt/runtime/bin/java -Xshare:auto -version

# Stage 3, what runs: nothing but the root assembled above, the jar, the health check and the licence files. User 65532 ("nonroot").
FROM scratch
LABEL org.opencontainers.image.title="Activiti Modeler" \
      org.opencontainers.image.description="Modeler for BPMN and DMN that runs on Activiti 9, with an embedded engine" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.source="https://github.com/kleash/activiti-modeler" \
      org.opencontainers.image.base.name="scratch (musl libc from docker.io/library/alpine:3.24.3)"
COPY --from=runtime /rootfs/ /
COPY --from=runtime --chown=65532:65532 /rootfs/data /data
COPY --from=runtime --chown=65532:65532 /rootfs/home/nonroot /home/nonroot
COPY --from=build /activiti-modeler.jar /app/activiti-modeler.jar
COPY --from=build /healthcheck /app/healthcheck
COPY LICENSE NOTICE THIRD-PARTY-NOTICES.md /app/
USER 65532:65532
WORKDIR /data
VOLUME /data
EXPOSE 8080
ENV JAVA_HOME=/opt/runtime
# No /etc/localtime in the image: say it. Set TZ (for example -e TZ=Europe/Berlin) to change the zone; the Java runtime carries its own zone data.
ENV TZ=UTC
# The profile "container" (application-container.properties): listen on 0.0.0.0:8080, workspace /data, no browser, random password.
ENV SPRING_PROFILES_ACTIVE=container
# No shell in this image: the check is a class that GETs /api/health with the image's own Java (docker/Healthcheck.java).
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD ["/opt/runtime/bin/java", "-Xshare:auto", "-XX:TieredStopAtLevel=1", "-XX:+UseSerialGC", "-Xmx32m", "-cp", "/app/healthcheck", "Healthcheck"]
ENTRYPOINT ["/opt/runtime/bin/java", "-jar", "/app/activiti-modeler.jar"]
