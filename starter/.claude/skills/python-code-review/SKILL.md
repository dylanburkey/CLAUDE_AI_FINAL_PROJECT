---
name: python-code-review
description: Reviews Python code for idiomatic patterns, common pitfalls, type hints, and performance
---

# Python Code Review

Expert in modern Python (3.10+) idioms and pitfalls.

## Common Pitfalls
- Mutable default arguments (`def f(items=[])`) are shared across calls (high)
- Bare `except:` or `except Exception: pass` swallows errors, including KeyboardInterrupt for bare except
- `is` for value comparison (`x is 'abc'`, `x is 1`); use `==` (only `is None`)
- Late-binding closures in loops (`lambda: i`)
- Modifying a list while iterating over it
- Shadowing builtins (`list`, `id`, `type`, `input`)

```python
# Bad
def add(item, items=[]):
    items.append(item)
    return items
# Good
def add(item, items=None):
    items = [] if items is None else items
    items.append(item)
    return items
```

## Idioms
- Context managers (`with open(...)`) for files, locks, connections
- `enumerate`, `zip`, comprehensions instead of manual index loops
- f-strings over `%` and `.format`
- `pathlib.Path` over `os.path` string juggling
- `dataclasses` / `NamedTuple` / `pydantic` over raw dicts for structured data
- EAFP (`try`/`except KeyError`) where it reads better than pre-checks; `dict.get` with default
- `any()` / `all()` over flag loops

## Type Hints
- Public functions should have parameter and return annotations
- `X | None` over `Optional[X]` (3.10+); built-in generics `list[int]` over `typing.List`
- Avoid `Any`; use `Protocol` for duck typing, `TypedDict` for dict shapes

## Performance
- String concatenation in loops; use `''.join`
- Membership tests on lists in hot loops; use `set`
- Repeated work inside loops that can be hoisted
- Loading whole files when streaming would do; generators for large data
- N+1 queries in ORM code (use `select_related` / `prefetch_related` / joins)

## Async
- Blocking calls (`time.sleep`, `requests`) inside `async def`
- Coroutines created but never awaited
- `asyncio.gather` for independent awaits

## Security (Python-specific)
- `pickle`, `marshal`, `yaml.load` without `SafeLoader` on untrusted input
- `subprocess` with `shell=True` and interpolated input
- `eval` / `exec`
- SQL via f-strings instead of parameters

## Output:
For each issue provide:
1. Description and line
2. Why it is problematic
3. Fix with a short code example
4. Severity level (critical/high/medium/low/info)
