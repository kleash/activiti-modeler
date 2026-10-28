# Security statements

| File | What it is |
|---|---|
| [`vex.openvex.json`](vex.openvex.json) | The published statement of the vulnerabilities that are open in a release and why this project is not affected (two `spring-webmvc` advisories and the OGNL copy inside MyBatis), in [OpenVEX](https://openvex.dev/) (status `not_affected`; justifications `vulnerable_code_not_in_execute_path` and `vulnerable_code_cannot_be_controlled_by_adversary`). It is attached to every release as `activiti-modeler.openvex.json`, next to the CycloneDX SBOMs |
| [`/osv-scanner.toml`](../../osv-scanner.toml) | The machine-enforced copy: the OSV scan fails on every advisory that is not listed there. OSV-Scanner has no VEX input, so the two files are kept equal by `scripts/cve-scan-check.py` |

The human-readable version, with the evidence, is in [SECURITY.md](../../SECURITY.md#open-vulnerabilities-and-why-they-are-accepted).

## Rules for an exception

1. It is only for an advisory that has **no fixed version we can use** (no release, an enterprise-only release, or a major upgrade the supported Activiti lines cannot take). A fix that exists is applied, in `java/pom.xml` `dependencyManagement`.
2. `ignoreUntil` is mandatory and at most **90 days** away (**30** for an operating-system advisory). When the day passes the scan fails again. Renewing takes a reviewed pull request that says what changed.
3. `reason` starts with the OpenVEX justification (`vulnerable_code_not_in_execute_path`, `vulnerable_code_not_present`, `vulnerable_code_cannot_be_controlled_by_adversary`, `inline_mitigations_already_exist` or `component_not_present`) and gives the evidence: what the code does and does not use.
4. Every id in `osv-scanner.toml` has a statement in `vex.openvex.json` (the id or its alias as `vulnerability.name` or `aliases`), and every `not_affected` statement has an exception. `scripts/cve-scan-check.py config` checks this, the expiry, the reason, and rejects `PackageOverrides` (they would hide advisories that are published later).
5. An exception that matches nothing any more fails the scan: delete it, and its statement, as soon as the vulnerability is fixed.
6. `.github/workflows/dependency-review.yml` lists the same GHSA ids in `allow-ghsas`: keep the three in step.

## Running the checks

```bash
scripts/cve-scan.sh                       # SBOMs and OSV scan of everything shipped (Maven, both Activiti lines, the jar, npm)
scripts/cve-scan.sh --image <image>       # also a Docker image, for example the one scripts/smoke-docker.sh builds
python3 -I scripts/cve-scan-check.py config    # only the rules above (instant, offline)
```
