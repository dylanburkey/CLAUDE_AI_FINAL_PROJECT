---
name: security-analysis
description: Security-focused code review covering OWASP Top 10 vulnerabilities, secure coding practices, and common security mistakes in any language
---

# Security Analysis

Expert in application security. Look for exploitable flaws first, then weak defenses. Only report issues that are reachable from the code shown; note assumptions.

## A01 Broken Access Control
- Endpoints or functions that act on an ID from the request without checking the caller owns it (IDOR)
- Authorization done only on the client / UI
- Path traversal: user input joined into file paths without normalization and containment check (`../`)

## A02 Cryptographic Failures
- Hardcoded secrets, API keys, passwords, tokens in source (critical)
- Weak hashes for passwords (MD5, SHA-1, unsalted SHA-256); use bcrypt/scrypt/argon2
- `Math.random()` / `random.random()` for tokens or IDs; use a CSPRNG
- Disabled TLS verification (`rejectUnauthorized: false`, `verify=False`)

## A03 Injection
- SQL built with string concatenation or template literals; use parameterized queries (critical)
- Shell commands with user input (`exec`, `child_process` with `shell: true`, `os.system`, `subprocess(..., shell=True)`)
- `eval`, `new Function`, `pickle.loads`, `yaml.load` (unsafe loader) on untrusted data
- XSS: `innerHTML`, `dangerouslySetInnerHTML`, unescaped template output with user data
- NoSQL injection: passing request objects directly into Mongo queries

```js
// Bad
db.query(`SELECT * FROM users WHERE id = ${req.params.id}`);
// Good
db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
```

## A04 Insecure Design
- Missing rate limiting on auth, password reset, OTP endpoints
- Trusting client-supplied prices, roles, or totals
- Race conditions on check-then-act for balances or inventory

## A05 Security Misconfiguration
- Permissive CORS (`origin: '*'` with credentials)
- Debug mode, stack traces, or verbose errors returned to clients
- Default credentials

## A06 Vulnerable Components
- Use of deprecated or known-dangerous APIs (`crypto.createCipher`, `request` library)

## A07 Authentication Failures
- Timing-unsafe comparisons of secrets (use `crypto.timingSafeEqual` / `hmac.compare_digest`)
- JWTs verified without algorithm pinning or accepted with `alg: none`
- Session tokens in URLs or localStorage for sensitive apps

## A08 Data Integrity
- Deserializing untrusted data into objects; prototype pollution via deep merge of user input (`__proto__`)

## A09 Logging Failures
- Logging passwords, tokens, full card numbers, or PII
- Swallowed errors in security-relevant paths

## A10 SSRF
- Server fetching user-supplied URLs without an allowlist (cloud metadata endpoints)

## Severity Guidelines
- critical: remotely exploitable injection, auth bypass, exposed secret
- high: exploitable with preconditions, weak crypto for credentials, SSRF
- medium: defense-in-depth gaps (missing rate limit, verbose errors)
- low: hardening suggestions

## Output:
For each issue provide:
1. Description and line
2. Attack scenario (how it is exploited)
3. Fix with a short code example
4. Severity level and category "security"
