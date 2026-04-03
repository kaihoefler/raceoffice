---
globs: packages/domain/src/**/*.{ts,tsx}
regex: .*
description: Apply this for all new or changed domain package source and test
  files so shared domain logic remains easy to understand and maintain.
alwaysApply: true
---

When creating or modifying files under packages/domain, add clear, high-quality explanatory comments (module purpose, key domain rules, and non-obvious decisions) in the same style as existing domain files.