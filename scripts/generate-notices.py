#!/usr/bin/env python3
"""Generates THIRD-PARTY-NOTICES.md from the dependencies that are really shipped (ADR 0008, feature K1).

  scripts/generate-notices.py            rewrite THIRD-PARTY-NOTICES.md
  scripts/generate-notices.py --check    fail when the file does not match the current dependencies (used by the release workflow)

Inputs, both read-only:
  * Java: the libraries inside the built executable jar (BOOT-INF/lib/*.jar of java/activiti-modeler-server/target/activiti-modeler-server-*-exec.jar,
    build it first: ./build.sh or scripts/build-server.sh). For each library the Maven coordinates and licence come from its
    META-INF/maven/**/pom.xml, its licence and NOTICE files from the jar itself. A library whose pom names no licence is listed in
    JAVA_LICENSE_OVERRIDES below, with the reason; the script fails when one is neither declared nor overridden.
  * npm: `npm ls --omit=dev --all --parseable` in modeler/ (the production dependencies of the web app, which Vite bundles), with the
    licence and NOTICE files of each package from node_modules/. Needs `npm ci` to have run.

The result lists every library with its licence, followed by each distinct licence text once (with the libraries that use it), the
NOTICE files of the Apache-licensed libraries, the bpmn.io licence with its watermark condition, and the bundled Temurin runtime.
Run with `python3 -I` semantics: nothing is imported from the current directory.
"""
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import zipfile
from collections import OrderedDict, defaultdict
from xml.etree import ElementTree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT = os.path.join(ROOT, "THIRD-PARTY-NOTICES.md")
OWN_GROUP = "io.github.kleash.activiti"
OWN_NPM_SCOPE = "@activiti-modeler/"

# Libraries whose pom (and parent pom) declares no licence. Key: group:artifact.
JAVA_LICENSE_OVERRIDES = {
    # added to the jar by the Spring Boot Maven plugin when it repackages (not a dependency, so it has no pom in the repository)
    "org.springframework.boot:spring-boot-jarmode-tools": "Apache-2.0",
}
JAVA_GROUP_OVERRIDES = {"spring-boot-jarmode-tools": "org.springframework.boot"}
NPM_LICENSE_OVERRIDES = {
    "component-props": "MIT",
}

SPDX_NAMES = {
    "The Apache Software License, Version 2.0": "Apache-2.0",
    "Apache License, Version 2.0": "Apache-2.0",
    "Apache License 2.0": "Apache-2.0",
    "Apache 2": "Apache-2.0",
    "Apache-2.0": "Apache-2.0",
    "The Apache License, Version 2.0": "Apache-2.0",
    "Eclipse Public License v2.0": "EPL-2.0",
    "Eclipse Public License - v 2.0": "EPL-2.0",
    "EPL-2.0": "EPL-2.0",
    "Eclipse Public License 1.0": "EPL-1.0",
    "Eclipse Public License - v 1.0": "EPL-1.0",
    "EPL-1.0": "EPL-1.0",
    "Eclipse Distribution License - v 1.0": "BSD-3-Clause (EDL 1.0)",
    "MIT License": "MIT",
    "The MIT License": "MIT",
    "MIT": "MIT",
    "BSD-3-Clause": "BSD-3-Clause",
    "The 3-Clause BSD License": "BSD-3-Clause",
    "BSD License 3": "BSD-3-Clause",
    "New BSD License": "BSD-3-Clause",
    "GNU Lesser General Public License": "LGPL-2.1",
    "GNU Lesser General Public License, version 2.1": "LGPL-2.1",
    "LGPL 2.1": "LGPL-2.1",
    "MPL 2.0": "MPL-2.0",
    "Mozilla Public License 2.0": "MPL-2.0",
    "MPL 2.0, and EPL 1.0": "MPL-2.0 OR EPL-1.0",
    "CDDL + GPLv2 with classpath exception": "CDDL-1.1 OR GPL-2.0 with Classpath Exception",
    "GPL2 w/ CPE": "GPL-2.0 with Classpath Exception",
    "GNU General Public License, version 2 (GPL2), with the classpath exception": "GPL-2.0 with Classpath Exception",
    "EPL 2.0": "EPL-2.0",
    "Eclipse Public License v. 2.0": "EPL-2.0",
    "Eclipse Distribution License v. 1.0": "BSD-3-Clause (EDL 1.0)",
    "GPL-2.0-with-classpath-exception": "GPL-2.0 with Classpath Exception",
    "GNU General Public License, version 2 with the GNU Classpath Exception": "GPL-2.0 with Classpath Exception",
    "LGPL-2.1-only": "LGPL-2.1",
    "EPL 1.0": "EPL-1.0",
    "Apache 2.0": "Apache-2.0",
    "Apache License Version 2.0": "Apache-2.0",
    "BSD": "BSD-3-Clause",
    "EDL 1.0": "BSD-3-Clause (EDL 1.0)",
    "GNU General Public License v2.0 w/Classpath exception": "GPL-2.0 with Classpath Exception",
    "MPL-2.0 / EPL 1.0": "MPL-2.0 OR EPL-1.0",
    "Public Domain": "Public Domain",
    "CC0": "CC0-1.0",
}

TEMURIN_SECTION = """## Bundled Java runtime: Eclipse Temurin

The desktop bundles (the `Activiti Modeler` app folders and zips) contain a Java runtime that `jlink` built from **Eclipse Temurin 25**
(OpenJDK, built by the Eclipse Adoptium project). The runtime is licensed under the **GNU General Public License, version 2, with the
Classpath Exception**, which allows redistribution together with applications under other licences; this project's code is not linked
into a GPL-licensed work. The runtime is not modified.

- The full licence texts and the third-party notices of the OpenJDK modules in the bundle are inside the bundle, in the `legal` folder of the
  runtime, exactly as the JDK ships them: `lib/runtime/legal/` (Linux), `runtime\\legal\\` (Windows) and
  `Activiti Modeler.app/Contents/runtime/Contents/Home/legal/` (macOS), each inside the app folder.
- The licence of the runtime: <https://openjdk.org/legal/gplv2+ce.html>. Eclipse Temurin: <https://adoptium.net/>.
- The corresponding source code of the runtime: <https://github.com/adoptium/jdk25u> (OpenJDK 25 updates repository, the tag of the Temurin
  build in use is printed by `java -version` in the bundle's `runtime/bin`).

The executable jar (`activiti-modeler.jar`) does not contain a runtime. The Docker image carries the same trimmed runtime (in `/opt/runtime`,
with its `legal` folder), linked from the **Alpine Linux (musl) build** of Eclipse Temurin 25 that `docker/jdk-alpine.env` pins by version and
SHA-256, and nothing else of an operating system but the **musl C library**:

- **musl libc** (`/lib/ld-musl-*.so.1`, from Alpine Linux; the package entry is kept in `/lib/apk/db/installed`), <https://musl.libc.org/>,
  licensed under the standard MIT licence: "Copyright (c) 2005-2020 Rich Felker, et al. Permission is hereby granted, free of charge, to any
  person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction,
  including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
  to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this
  permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY
  OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
  NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
  OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE." The
  full text, with the list of the other copyright holders of parts of musl, is at <https://git.musl-libc.org/cgit/musl/tree/COPYRIGHT>.

The image has no other operating-system package: no glibc, OpenSSL, zlib, CA certificates or tzdata (the Java runtime carries its own CA
certificates, zone data and zlib).
"""

COPYLEFT_SECTION = """## Source code of copyleft-licensed components

These libraries are used unmodified, as the jars published by their projects. Their source code is available from the projects:

- **H2 Database Engine** (MPL-2.0 or EPL-1.0): <https://github.com/h2database/h2database>
- **Logback** (EPL-2.0 or LGPL-2.1): <https://github.com/qos-ch/logback>. Replace the logback jars in the executable jar's `BOOT-INF/lib` to use another version, as LGPL-2.1 allows.
- **Jakarta EE APIs and Eclipse Angus mail** (EPL-2.0 or GPL-2.0 with Classpath Exception, some also EDL-1.0): <https://github.com/jakartaee> and <https://github.com/eclipse-ee4j/angus-mail>
- **Eclipse Temurin / OpenJDK** (GPL-2.0 with Classpath Exception): see the section above.

"""

BPMN_IO_SECTION = """## bpmn.io: the watermark condition

The modeler is built on the **bpmn.io** libraries (`bpmn-js`, `dmn-js`, `diagram-js`, `@bpmn-io/properties-panel` and their relatives) from
Camunda Services GmbH. Their licence is the MIT licence **with one added condition**:

> The source code responsible for displaying the bpmn.io project watermark that links back to https://bpmn.io as part of rendered
> diagrams MUST NOT be removed or changed. When this software is being used in a website or application, the watermark must stay fully
> visible and not visually overlapped by other elements.

This project keeps the condition: the bpmn.io logo is shown in the lower right corner of every diagram, and an automated UI test
(`modeler/e2e`, "bpmn.io watermark") fails when it is missing, hidden or covered. Anyone who redistributes or modifies this application
must keep the watermark as well. The complete licence text of each bpmn.io package is reproduced below.
"""


def fail(message):
    print("generate-notices: " + message, file=sys.stderr)
    sys.exit(1)


def normalise(text):
    return re.sub(r"\s+", " ", text).strip().lower()


def digest(text):
    return hashlib.sha256(normalise(text).encode("utf-8")).hexdigest()


def read_text(data):
    for encoding in ("utf-8", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", "replace")


def spdx(name):
    name = name.strip()
    return SPDX_NAMES.get(name, name)


# ---------------------------------------------------------------------------------------------------------------------------------
# Java
# ---------------------------------------------------------------------------------------------------------------------------------

def find_jar():
    target = os.path.join(ROOT, "java", "activiti-modeler-server", "target")
    if not os.path.isdir(target):
        fail("no build found; run ./build.sh (or scripts/build-server.sh) first")
    jars = [f for f in os.listdir(target) if re.fullmatch(r"activiti-modeler-server-[^/]*-exec\.jar", f)]
    if not jars:
        fail("no activiti-modeler-server-*-exec.jar in " + target + "; run ./build.sh first")
    return os.path.join(target, sorted(jars)[0])


def pom_licenses(pom_xml):
    try:
        root = ElementTree.fromstring(pom_xml)
    except ElementTree.ParseError:
        return []
    namespace = re.match(r"\{.*\}", root.tag)
    prefix = namespace.group(0) if namespace else ""
    result = []
    for licence in root.findall("%slicenses/%slicense" % (prefix, prefix)):
        name = licence.findtext("%sname" % prefix) or licence.findtext("%surl" % prefix) or ""
        if name.strip():
            result.append(re.sub(r"\s+", " ", name))
    return result


def licence_like(path):
    base = path.rsplit("/", 1)[-1].lower()
    return re.match(r"(license|licence|copying|notice|apache-license)", base) is not None and not base.endswith((".class", ".java"))


def maven_repository():
    configured = os.environ.get("MAVEN_REPO_LOCAL")
    if configured:
        return configured
    settings = os.path.join(os.path.expanduser("~"), ".m2", "repository")
    return settings


def build_repository_index(repository):
    """(artifactId, version) -> [(groupId, jar size)] for every artifact in the local Maven repository the build filled."""
    index = defaultdict(list)
    for directory, _, files in os.walk(repository):
        for file in files:
            if file.endswith(".pom"):
                parts = os.path.relpath(directory, repository).split(os.sep)
                if len(parts) >= 3 and file == "%s-%s.pom" % (parts[-2], parts[-1]):
                    jar = os.path.join(directory, file[:-4] + ".jar")
                    index[(parts[-2], parts[-1])].append((".".join(parts[:-2]), os.path.getsize(jar) if os.path.exists(jar) else -1))
    return index


def licences_from_repository(repository, group, artifact, version, seen=None):
    """The licences a pom declares; a pom without any inherits those of its parent (Maven semantics)."""
    path = os.path.join(repository, *group.split("."), artifact, version, "%s-%s.pom" % (artifact, version))
    if not os.path.isfile(path):
        return []
    with open(path, "rb") as handle:
        data = handle.read()
    found = pom_licenses(data)
    if found:
        return found
    try:
        root = ElementTree.fromstring(data)
    except ElementTree.ParseError:
        return []
    namespace = re.match(r"\{.*\}", root.tag)
    prefix = namespace.group(0) if namespace else ""
    parent = root.find("%sparent" % prefix)
    if parent is None:
        return []
    ids = [parent.findtext("%s%s" % (prefix, tag)) for tag in ("groupId", "artifactId", "version")]
    if None in ids or (seen and tuple(ids) in seen):
        return []
    return licences_from_repository(repository, ids[0], ids[1], ids[2], (seen or set()) | {tuple(ids)})


def java_libraries(jar_path):
    repository = maven_repository()
    if not os.path.isdir(repository):
        fail("the local Maven repository %s does not exist; build first (./build.sh) or set MAVEN_REPO_LOCAL" % repository)
    index = build_repository_index(repository)
    libraries = []
    with zipfile.ZipFile(jar_path) as outer:
        names = sorted(n for n in outer.namelist() if n.startswith("BOOT-INF/lib/") and n.endswith(".jar"))
        for name in names:
            with zipfile.ZipFile(io.BytesIO(outer.read(name))) as inner:
                group = artifact = version = None
                licences = []
                for member in inner.namelist():
                    if member.startswith("META-INF/maven/") and member.endswith("/pom.properties"):
                        properties = dict(
                            line.split("=", 1) for line in read_text(inner.read(member)).splitlines() if "=" in line and not line.startswith("#"))
                        group, artifact, version = properties.get("groupId"), properties.get("artifactId"), properties.get("version")
                    elif member.startswith("META-INF/maven/") and member.endswith("/pom.xml") and not licences:
                        licences = pom_licenses(inner.read(member))
                if group is None:
                    file = name.rsplit("/", 1)[-1][:-4]
                    match = re.match(r"(.+?)-(\d[\w.\-]*)$", file)
                    artifact, version = (match.group(1), match.group(2)) if match else (file, "")
                    candidates = index.get((artifact, version), [])
                    size = outer.getinfo(name).file_size
                    exact = [g for g, s in candidates if s == size] or [g for g, s in candidates]
                    group = JAVA_GROUP_OVERRIDES.get(artifact) or (exact[0] if exact else "?")
                if group == OWN_GROUP:
                    continue
                texts = []
                for member in sorted(inner.namelist()):
                    if member.endswith("/"):
                        continue
                    top = member.split("/")
                    if (len(top) == 1 or (len(top) == 2 and top[0] == "META-INF")) and licence_like(member):
                        texts.append((member, read_text(inner.read(member))))
                if not licences and group != "?":
                    licences = licences_from_repository(repository, group, artifact, version)
                libraries.append({"group": group, "artifact": artifact, "version": version, "licences": [spdx(x) for x in licences], "files": texts})
    for library in libraries:
        key = "%s:%s" % (library["group"], library["artifact"])
        if not library["licences"]:
            if key in JAVA_LICENSE_OVERRIDES:
                library["licences"] = [JAVA_LICENSE_OVERRIDES[key]]
            else:
                library["licences"] = ["UNKNOWN"]
    unknown = [l for l in libraries if l["licences"] == ["UNKNOWN"]]
    if unknown:
        fail("no licence is declared for: " + ", ".join("%s:%s:%s" % (l["group"], l["artifact"], l["version"]) for l in unknown)
             + ". Look the licence up and add it to JAVA_LICENSE_OVERRIDES in scripts/generate-notices.py.")
    return sorted(libraries, key=lambda l: (l["group"], l["artifact"]))


# ---------------------------------------------------------------------------------------------------------------------------------
# npm
# ---------------------------------------------------------------------------------------------------------------------------------

def npm_packages():
    modeler = os.path.join(ROOT, "modeler")
    if not os.path.isdir(os.path.join(modeler, "node_modules")):
        fail("modeler/node_modules is missing; run `npm ci` in modeler/ first")
    shell = os.name == "nt"
    result = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--parseable"], cwd=modeler, capture_output=True, text=True, shell=shell)
    paths = sorted(set(line.strip() for line in result.stdout.splitlines() if line.strip()))
    if not paths:
        fail("`npm ls --omit=dev --all --parseable` printed nothing: " + result.stderr[:300])
    packages = {}
    for path in paths:
        manifest = os.path.join(path, "package.json")
        if not os.path.isfile(manifest):
            continue
        with open(manifest, encoding="utf-8") as handle:
            data = json.load(handle)
        name = data.get("name", "")
        if name.startswith(OWN_NPM_SCOPE) or name == "activiti-modeler-workspace" or data.get("private"):
            continue
        licence = data.get("license")
        if isinstance(licence, dict):
            licence = licence.get("type")
        if licence is None and data.get("licenses"):
            licence = " OR ".join(x.get("type", "?") if isinstance(x, dict) else str(x) for x in data["licenses"])
        licence = NPM_LICENSE_OVERRIDES.get(name, licence)
        if not licence:
            component = os.path.join(path, "component.json")  # old "component" packages keep the licence there
            if os.path.isfile(component):
                with open(component, encoding="utf-8") as handle:
                    licence = json.load(handle).get("license")
        if not licence:
            for candidate in sorted(os.listdir(path)):
                if re.match(r"(license|licence|copying)", candidate.lower()) and os.path.isfile(os.path.join(path, candidate)):
                    with open(os.path.join(path, candidate), "rb") as handle:
                        head = read_text(handle.read(400))
                    if re.search(r"\bMIT License\b|The MIT License", head):
                        licence = "MIT"
                    break
        if not licence:
            fail("package %s %s declares no licence; add it to NPM_LICENSE_OVERRIDES after checking its project page" % (name, data.get("version")))
        files = []
        wanted = [f for f in sorted(os.listdir(path)) if re.match(r"(license|licence|copying|notice|feel-free)", f.lower()) and os.path.isfile(os.path.join(path, f))]
        for f in wanted:
            with open(os.path.join(path, f), "rb") as handle:
                files.append((f, read_text(handle.read())))
        if str(licence).upper().startswith("SEE LICENSE IN") and any("watermark" in text.lower() for _, text in files):
            licence = "MIT with the bpmn.io watermark condition"
        author = data.get("author")
        if isinstance(author, dict):
            author = author.get("name")
        repository = data.get("repository")
        if isinstance(repository, dict):
            repository = repository.get("url")
        homepage = data.get("homepage") or (re.sub(r"^git\+|\.git$", "", repository) if isinstance(repository, str) else "")
        packages[(name, data.get("version", ""))] = {
            "name": name, "version": data.get("version", ""), "licence": str(licence), "files": files, "author": author or "", "homepage": homepage or "",
        }
    return [packages[k] for k in sorted(packages)]


# ---------------------------------------------------------------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------------------------------------------------------------

def fingerprint(java, npm):
    lines = sorted("java %s:%s:%s %s" % (l["group"], l["artifact"], l["version"], "/".join(l["licences"])) for l in java)
    lines += sorted("npm %s@%s %s" % (p["name"], p["version"], p["licence"]) for p in npm)
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


def render(java, npm, jar_name):
    # distinct texts, in order of first use
    texts = OrderedDict()  # digest -> {"title", "text", "used_by": []}

    def add(kind, owner, filename, text):
        if not normalise(text):
            return
        key = digest(text)
        entry = texts.setdefault(key, {"title": filename, "text": text.strip("\n"), "used_by": [], "kind": kind})
        if owner not in entry["used_by"]:
            entry["used_by"].append(owner)

    for library in java:
        owner = "%s:%s %s" % (library["group"], library["artifact"], library["version"])
        for filename, text in library["files"]:
            add("notice" if "notice" in filename.lower() else "licence", owner, filename.rsplit("/", 1)[-1], text)
    for package in npm:
        owner = "%s %s" % (package["name"], package["version"])
        if not package["files"] and package["licence"] == "MIT":
            holder = package["author"] or ("the authors of " + package["name"])
            generated = ("MIT License\n\nCopyright (c) %s\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this "
                         "software and associated documentation files (the \"Software\"), to deal in the Software without restriction, including "
                         "without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the "
                         "Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above "
                         "copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\n"
                         "THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE "
                         "WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR "
                         "COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR "
                         "OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE." % holder)
            add("licence", owner + " (the package ships no licence file; MIT text with the author from package.json)", "MIT (generated)", generated)
        for filename, text in package["files"]:
            add("notice" if "notice" in filename.lower() else "licence", owner, filename, text)

    out = []
    out.append("# Third-party notices\n")
    out.append("<!-- Generated by scripts/generate-notices.py from the libraries inside %s and the production npm dependencies of modeler/. Do not edit by hand. -->" % jar_name)
    out.append("<!-- fingerprint: %s -->\n" % fingerprint(java, npm))
    out.append("The Activiti Modeler is licensed under the [Apache License 2.0](LICENSE) (see also [NOTICE](NOTICE)). It bundles the third-party software "
               "listed here, each under its own licence. This file ships in every download: inside the executable jar under `META-INF/`, in the "
               "desktop bundles next to the app, and in the Docker image under `/app/`.\n")
    out.append("It is generated from the libraries that are really shipped: %d Java libraries (the contents of the executable jar) and %d npm packages "
               "(the production dependencies of the web app, which Vite bundles into it); the development tools are not shipped and not listed.\n" % (len(java), len(npm)))

    counts = defaultdict(int)
    for library in java:
        counts[" OR ".join(library["licences"])] += 1
    out.append("## Licence summary\n")
    out.append("| Licence | Java libraries | npm packages |\n|---|---|---|")
    npm_counts = defaultdict(int)
    for package in npm:
        npm_counts[package["licence"]] += 1
    for name in sorted(set(counts) | set(npm_counts)):
        out.append("| %s | %d | %d |" % (name, counts.get(name, 0), npm_counts.get(name, 0)))
    out.append("")

    out.append(BPMN_IO_SECTION)
    out.append(TEMURIN_SECTION)
    out.append(COPYLEFT_SECTION)

    out.append("## Java libraries\n")
    out.append("Embedded in the executable jar (`BOOT-INF/lib`). Group, artifact, version and licence as declared in each library's pom.\n")
    out.append("| Library | Version | Licence |\n|---|---|---|")
    for library in java:
        out.append("| `%s:%s` | %s | %s |" % (library["group"], library["artifact"], library["version"], " OR ".join(library["licences"])))
    out.append("")

    out.append("## npm packages (the web app)\n")
    out.append("Bundled into the web app by Vite. Licence as declared in each package's `package.json`.\n")
    out.append("| Package | Version | Licence | Home |\n|---|---|---|---|")
    for package in npm:
        home = package["homepage"]
        out.append("| `%s` | %s | %s | %s |" % (package["name"], package["version"], package["licence"].replace("|", "/"), home if home else ""))
    out.append("")

    out.append("## Licence texts\n")
    out.append("Each distinct licence text appears once, with the libraries that carry it.\n")
    number = 0
    for entry in texts.values():
        if entry["kind"] != "licence":
            continue
        number += 1
        out.append("### Licence text %d: %s\n" % (number, entry["title"]))
        out.append("Used by: " + ", ".join(entry["used_by"][:40]) + (" and %d more" % (len(entry["used_by"]) - 40) if len(entry["used_by"]) > 40 else "") + "\n")
        out.append("```text\n" + entry["text"] + "\n```\n")

    out.append("## NOTICE files of the libraries\n")
    out.append("Apache-2.0 requires reproducing the NOTICE file of a library that has one.\n")
    number = 0
    for entry in texts.values():
        if entry["kind"] != "notice":
            continue
        number += 1
        out.append("### Notice %d\n" % number)
        out.append("From: " + ", ".join(entry["used_by"][:40]) + (" and %d more" % (len(entry["used_by"]) - 40) if len(entry["used_by"]) > 40 else "") + "\n")
        out.append("```text\n" + entry["text"] + "\n```\n")
    return "\n".join(out).rstrip() + "\n"


def main():
    check = "--check" in sys.argv[1:]
    if any(a not in ("--check",) for a in sys.argv[1:]):
        print(__doc__)
        sys.exit(2)
    jar = find_jar()
    java = java_libraries(jar)
    npm = npm_packages()
    text = render(java, npm, os.path.basename(jar))
    if check:
        try:
            with open(OUTPUT, encoding="utf-8") as handle:
                existing = handle.read()
        except FileNotFoundError:
            fail("THIRD-PARTY-NOTICES.md does not exist; run scripts/generate-notices.py")
        match = re.search(r"fingerprint: ([0-9a-f]{64})", existing)
        if not match or match.group(1) != fingerprint(java, npm):
            fail("THIRD-PARTY-NOTICES.md is out of date (the dependencies changed); run scripts/generate-notices.py and commit the result")
        print("THIRD-PARTY-NOTICES.md is current (%d Java libraries, %d npm packages)" % (len(java), len(npm)))
        return
    with open(OUTPUT, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
    print("wrote %s (%d Java libraries, %d npm packages, %d KB)" % (OUTPUT, len(java), len(npm), len(text) // 1024))


if __name__ == "__main__":
    main()
