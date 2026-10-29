# 🔍 Code Review Report

## Summary

| Metric | Value |
|--------|-------|
| **Overall Score** | 65/100 |
| **Files Reviewed** | 1 |
| **Critical Issues** | 0 |
| **High Priority Tests** | 5 |
| **Refactoring Opportunities** | 5 |

## 🎯 Top Recommendations

1. 🚨 **testing**: Add tests for 3 critical-priority untested path(s): createUser (lines 44-69), isValidEmail (lines 25-28), sanitizeInput (lines 33-39)
   - Files: fixtures/clean-code.ts

2. ⚠️ **security**: 2 high-severity security issues, e.g. HTML entity encoding is incomplete and context-dependent. This sanitization only protects against basic XSS in HTML context but fails in attribute, JavaScript, or URL contexts. Additionally, it doesn't handle forward slashes which can break out of some contexts.
   - Files: fixtures/clean-code.ts

3. ⚠️ **testing**: Add tests for 2 high-priority untested path(s): createUser invalid email branch (lines 50-52), createUser email case normalization (line 60)
   - Files: fixtures/clean-code.ts

4. 📝 **security**: 2 medium-severity security issues, e.g. Email validation regex is overly simplistic and allows many invalid email formats. It will accept malformed addresses like 'test@domain' or 'test@@domain.com'.
   - Files: fixtures/clean-code.ts

5. 📝 **bug-risk**: Email is not sanitized but name is. This inconsistency suggests either over-sanitizing (if storing in database) or under-sanitizing (if email should also be sanitized). HTML entity encoding is typically done at output time, not storage time. Fix: Store raw validated data and sanitize at output time based on context. Remove HTML entity encoding from storage: `name: input.name.trim()` and apply context-appropriate encoding when rendering in HTML, JSON, etc.
   - Files: fixtures/clean-code.ts

## 📁 File Details

### 📄 `fixtures/clean-code.ts`

**Quality Score:** 65/100 | **Coverage:** ~0%

#### Issues (7)
  - Line 26: `medium` Email validation regex is overly simplistic and allows many invalid email formats. It will accept malformed addresses like 'test@domain' or 'test@@domain.com'.
  - Line 33: `high` HTML entity encoding is incomplete and context-dependent. This sanitization only protects against basic XSS in HTML context but fails in attribute, JavaScript, or URL contexts. Additionally, it doesn't handle forward slashes which can break out of some contexts.
  - Line 75: `high` Math.random() is not cryptographically secure and should never be used for generating security-sensitive identifiers like user IDs. It's predictable and can lead to ID collision attacks or enumeration.

  *...and 4 more*

#### Test Gaps (8)
  - `createUser (lines 44-69)` (critical priority)
  - `isValidEmail (lines 25-28)` (critical priority)

  *...and 6 more*

#### Refactoring Opportunities (5)
  - **pattern-improvement**: Extract validation logic into a separate validation layer. The createUser function mixes validation, sanitization, object creation, and persistence concerns, violating single responsibility principle. Use a validation result pattern with discriminated unions for better error handling.
  - **modernize**: Replace manual HTML escaping with a Map-based approach for better performance and maintainability. The current chained replace calls are inefficient as they scan the string multiple times.

  *...and 3 more*

---

*Generated at 2026-10-29T19:31:28.460Z • Duration: 146711ms*
