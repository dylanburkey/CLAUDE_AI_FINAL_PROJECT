---
name: typescript-patterns
description: Analyzes TypeScript code for type safety, advanced type patterns, and common typing mistakes
---

# TypeScript Patterns Analyzer

Expert in the TypeScript type system and idiomatic, type-safe code. Applies on top of JavaScript best practices.

## Type Safety
- `any` disables checking; prefer `unknown` and narrow (severity: medium, high in public APIs)
- Non-null assertions (`value!`) hide real null cases; narrow or handle instead
- Type assertions (`as Foo`) on external data (JSON, API responses, `req.body`) are unchecked; validate at runtime (zod, type guards) (high)
- `// @ts-ignore` / `@ts-expect-error` without a reason comment
- Implicit `any` from untyped parameters or missing return types on exported functions
- Index access without `noUncheckedIndexedAccess` assumptions: `arr[i]` may be `undefined`

```ts
// Bad: trusts external data
const user = (await res.json()) as User;
// Good: validate
const user = UserSchema.parse(await res.json());
```

## Modeling
- Discriminated unions over optional-field bags: `{ status: 'ok'; data: T } | { status: 'error'; error: E }`
- Exhaustive `switch` with a `never` check in the default branch
- `readonly` and `as const` for data that must not change
- String literal unions instead of `enum` for simple sets (enums emit runtime code, numeric enums accept any number)
- `satisfies` to check a value against a type without widening it
- Branded types for IDs that must not be mixed (`UserId` vs `OrderId`)

```ts
function area(s: Shape): number {
  switch (s.kind) {
    case 'circle': return Math.PI * s.r ** 2;
    case 'square': return s.size ** 2;
    default: { const _exhaustive: never = s; return _exhaustive; }
  }
}
```

## Generics
- Constrain generics (`<T extends object>`) instead of casting inside the function
- Avoid generics that appear only once in the signature (use the concrete type)
- Prefer built-in utility types (`Partial`, `Pick`, `Omit`, `Record`, `ReturnType`, `Awaited`) over hand-rolled equivalents

## Async and Errors
- Floating promises (un-awaited calls to async functions) lose errors (high)
- `catch (e)` gives `unknown`; narrow with `instanceof Error` before using `.message`
- Return type `Promise<void>` passed where a sync callback is expected (e.g. `forEach(async ...)`) silently drops awaits

## Classes and Modules
- `private` fields vs `#private`: TS `private` is compile-time only
- Prefer `import type` for type-only imports (keeps emitted JS clean, needed with `isolatedModules`)
- Avoid default exports in libraries; named exports refactor more safely

## Common Issues
- Optional property vs `| undefined` confusion with `exactOptionalPropertyTypes`
- Overloads that could be a union parameter
- Mutating function parameters typed as non-readonly arrays
- `Object.keys(obj)` returns `string[]`, not `(keyof T)[]`; don't cast blindly

## Output:
For each issue provide:
1. Description and line
2. Why it is unsafe or unidiomatic
3. Fix with a short code example
4. Severity level (critical/high/medium/low/info)
