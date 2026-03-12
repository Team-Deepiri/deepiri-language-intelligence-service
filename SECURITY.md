# Security Policy

## Supported Versions

Use this section to tell people about which versions of your project are
currently being supported with security updates.

| Version | Supported          |
| ------- | ------------------ |
| 5.1.x   | :white_check_mark: |
| 5.0.x   | :x:                |
| 4.0.x   | :white_check_mark: |
| < 4.0   | :x:                |

## Reporting a Vulnerability

### Advisory Reference
Dependabot Alerts #1-#7
Repository: deepiri-emotion-desktop
Package: multer (npm)
Affected Versions:
- >= 1.4.4-lts.1, < 2.0.0
- >= 1.4.4-lts.1, < 2.0.1
- >= 1.4.4-lts.1, < 2.0.2
- < 2.1.0
- < 2.1.1
Patched Versions:
- 2.0.0
- 2.0.1
- 2.0.2
- 2.1.0
- 2.1.1
Recommended Remediation Version: 2.1.1 or later

### Summary

Multiple Denial of Service (DoS) vulnerabilities exist in the `multer`
package affecting file upload request handling across several versions.

These issues include:

- memory leaks from unclosed streams
- maliciously crafted multipart upload requests causing unhandled exceptions
- empty string field names causing process crashes
- malformed requests causing unhandled exceptions
- dropped connections during file upload causing resource exhaustion
- incomplete cleanup causing resource exhaustion
- malformed requests triggering uncontrolled recursion and possible stack overflow

Taken together, these vulnerabilities show that older versions of Multer
contain multiple weaknesses in request parsing, stream lifecycle handling,
exception handling, cleanup behavior, and malformed input protection.

An attacker may exploit these conditions by sending specially crafted upload
requests or interrupting upload connections in ways that cause the application
to leak resources, exhaust memory, overflow the stack, or terminate the Node.js
process entirely.

Because all seven alerts are tied to the same package and Dependabot indicates
that upgrading to `2.1.1` resolves all of them, the appropriate remediation for
this repository is to move directly to the latest patched version instead of
applying intermediate fixes.

### Resolution

1. Upgrade `multer` to version **2.1.1 or later**.
2. Regenerate and commit updated lockfiles.
3. Review all file upload endpoints that rely on Multer.
4. Validate handling of malformed multipart requests, interrupted uploads,
   empty field names, and unexpected stream errors.
5. Confirm that upload failures properly close streams and release resources.
6. Run CI validation and regression testing on all upload-related flows before
   closing the alerts.

### Response Expectations

- Initial review within 3 business days.
- Patch deployment for supported versions within 7 business days.
- Responsible disclosure practices will be followed if public reporting is required.
