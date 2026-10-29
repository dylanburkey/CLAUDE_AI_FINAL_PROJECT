# 🔍 Code Review Report

## Summary

| Metric | Value |
|--------|-------|
| **Overall Score** | 0/100 |
| **Files Reviewed** | 1 |
| **Critical Issues** | 3 |
| **High Priority Tests** | 7 |
| **Refactoring Opportunities** | 5 |

## 🎯 Top Recommendations

1. 🚨 **security**: 3 critical-severity security issues, e.g. SQL injection vulnerability in searchTodos function. User-supplied keyword is directly interpolated into SQL query using template literal without parameterization.
   - Files: src/todo.ts

2. 🚨 **testing**: Add tests for 3 critical-priority untested path(s): searchTodos (lines 119-124), searchTodosByStatus (lines 130-135), getTodosByUser (lines 141-146)
   - Files: src/todo.ts

3. ⚠️ **bug-risk**: Type safety issue: searchTodosByStatus accepts string parameter but should accept boolean or validate string input. Currently allows arbitrary SQL values to be injected. Fix: Change signature to accept boolean: export async function searchTodosByStatus(completed: boolean): Promise<Todo[]> { const query = 'SELECT * FROM todos WHERE completed = $1'; return await db.query(query, [completed]) as Todo[]; }
   - Files: src/todo.ts

4. ⚠️ **testing**: Add tests for 4 high-priority untested path(s): createTodo (lines 51-74), getTodoById (lines 88-97), updateTodoStatus (lines 102-105)
   - Files: src/todo.ts

5. 📝 **best-practice**: 5 medium-severity best-practice issues, e.g. Type assertion 'as Todo[]' trusts database query result without runtime validation. If database schema changes or returns unexpected data, type safety is lost.
   - Files: src/todo.ts

## 📁 File Details

### 📄 `src/todo.ts`

**Quality Score:** 0/100 | **Coverage:** ~15%

#### Issues (12)
  - Line 121: `critical` SQL injection vulnerability in searchTodos function. User-supplied keyword is directly interpolated into SQL query using template literal without parameterization.
  - Line 132: `critical` SQL injection vulnerability in searchTodosByStatus function. User input is concatenated directly into SQL query without validation or parameterization.
  - Line 143: `critical` SQL injection vulnerability in getTodosByUser function. userId is directly interpolated into SQL query with template literal, allowing arbitrary SQL execution.

  *...and 9 more*

#### Test Gaps (8)
  - `searchTodos (lines 119-124)` (critical priority)
  - `searchTodosByStatus (lines 130-135)` (critical priority)

  *...and 6 more*

#### Refactoring Opportunities (5)
  - **pattern-improvement**: Replace SQL string interpolation with parameterized queries to prevent SQL injection attacks. This vulnerability allows attackers to execute arbitrary SQL commands.
  - **pattern-improvement**: Fix SQL injection vulnerability, correct the parameter type from string to boolean to match the Todo interface, and use parameterized queries.

  *...and 3 more*

---

*Generated at 2026-10-29T19:31:44.730Z • Duration: 162982ms*
