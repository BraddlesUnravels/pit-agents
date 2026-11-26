---
name: test-planning
description: Plan focused tests for a change before writing them. Use when a plan needs acceptance criteria or a test list.
---

# Test planning

1. List the behaviors the change adds or fixes. Ignore unchanged behavior.
2. For each behavior, write one test case: setup, action, expected result.
3. Add edge cases only where the change has a branch, a limit, or a failure path.
4. Prefer the project's existing test framework and helpers.
5. Mark each case as unit or integration, and say why.

Output a Markdown table: | Behavior | Case | Type | Expected |
