---
name: develop-with-tdd
description: Enforce test-driven development for this project. Use when implementing features, fixing bugs, refactoring behavior, or changing production code so Codex writes failing tests first, requires unit tests with 100% line coverage, and covers all acceptance criteria with integration tests using Testing Library and Cucumber.
---

# Develop With TDD

## Core Rule

Develop production changes test-first. Do not implement behavior before the failing test or scenario that proves the behavior exists, except for a short throwaway spike used only to understand an API. Remove or ignore spike code before the real implementation.

## Workflow

1. Extract the behavioral contract before editing code.
   - List explicit acceptance criteria from the user request, issue, story, or bug report.
   - If criteria are ambiguous, make conservative assumptions and state them.
   - For bug fixes, define the regression that must fail before the fix.

2. Write failing tests first.
   - Add or update unit tests for pure logic, state transitions, validation, formatters, hooks, and small components.
   - Add or update Cucumber feature scenarios for every acceptance criterion.
   - Bind each scenario to integration step definitions that exercise the app through Testing Library from the user's perspective.
   - Run the relevant tests and confirm the new tests fail for the expected reason before implementing.

3. Implement the smallest production change that passes the tests.
   - Prefer existing project patterns and helpers.
   - Keep test seams explicit and user-observable; avoid testing implementation details unless the behavior cannot be reached through public APIs.
   - Add mocks only at external boundaries such as network, auth, storage, native modules, timers, and platform APIs.

4. Refactor only after tests pass.
   - Keep tests green while improving structure.
   - Do not weaken assertions, delete scenarios, or reduce coverage to make a change pass.

5. Verify the full policy before finishing.
   - Run lint when code changed.
   - Run unit tests with line coverage and require 100% line coverage for all changed production files.
   - Run Cucumber integration tests and confirm every acceptance criterion has at least one passing scenario.
   - Report any command that could not be run and why.

## Unit Test Requirements

- Require 100% line coverage for changed production code. If the project has a stricter project-wide coverage gate, keep it.
- Use the repository's existing unit test runner unless the task requires adding a new one.
- Current project commands:
  - `npm test` runs the existing Node test suite.
  - `npm run test:coverage` runs the configured 100% line coverage check.
- When a changed file is outside the existing coverage include scope, update the coverage command or add an equivalent script so the changed file is measured.
- Cover success paths, failure paths, boundaries, empty states, invalid inputs, async resolution/rejection, and branch-driving data variations as needed to make line coverage meaningful.
- Keep tests deterministic. Control timers, randomness, dates, storage, network, and platform APIs.

## Acceptance Integration Requirements

- Cover every acceptance criterion with Cucumber scenarios.
- Use Gherkin feature files for behavior and Testing Library in step definitions for rendering, querying, interaction, and assertions.
- Prefer `@testing-library/react-native` for Expo/React Native screens and components. Use `@testing-library/react` only for web-only React surfaces.
- Use `@cucumber/cucumber` for feature execution unless the project already has a Cucumber-compatible runner.
- If Cucumber or Testing Library is missing, add the required dev dependencies and scripts as part of the implementation.
- Keep feature files readable by product stakeholders:
  - Use domain language, not component internals.
  - Write scenarios around user intent and observable outcomes.
  - Include negative and edge-case scenarios when the acceptance criteria imply them.
- Maintain a traceable mapping in the final response: each acceptance criterion to its integration scenario or feature file.

## Suggested Test Layout

- Unit tests: follow the existing `tests/*.test.ts` and domain-specific `tests/<area>*.test.ts` pattern unless the repo establishes a better local convention.
- Cucumber features: place feature files under `features/<area>.feature`.
- Step definitions and support code: place under `features/step-definitions/` and `features/support/`.
- Test utilities: place shared render helpers, providers, mock servers, and factories under `tests/utils/` or `features/support/`, whichever matches the calling test type.

## Completion Checklist

- Acceptance criteria are listed.
- Unit tests were written or updated before production code.
- Unit tests enforce 100% line coverage for changed production files.
- Cucumber integration scenarios cover every acceptance criterion.
- Testing Library is used for integration render/query/interactions.
- Relevant failing tests were observed before the implementation, or any exception is explained.
- Final verification commands were run and reported.
