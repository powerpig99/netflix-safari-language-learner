# Project Working Rules

Use `root-cause-simplify` whenever behavior is flaky, timing-sensitive, lifecycle-sensitive, or over-engineered.

## Core Principle

- Identify the most reliable signal for the behavior.
- Use that signal directly.
- Do not add fallback paths to "increase reliability."
- Do not keep weaker signals in reserve "just in case."
- If the right signal is still unclear, expose the boundary and trace it. Do not mask it.

Fallbacks are not robustness. They are unresolved uncertainty disguised as architecture.

Code should be as simple as possible, but not simpler than the required behavior and causal clarity allow.
Simplicity is for understanding, not for hiding uncertainty.

## Required Questions Before Fixing Behavior

1. What is the single authoritative signal?
2. Who owns this behavior?
3. What attaches it?
4. What releases it?
5. Is there exactly one live path from signal to effect?
6. Are we adding any compensation for uncertainty?
7. If the signal is still unclear, have we logged it instead of branching?

## Repo Contract

For playback, control, and subtitle behavior, the source of truth is:

- [control-ownership-contract.md](/Users/jingliang/Documents/active_projects/netflix-safari-language-learner/docs/control-ownership-contract.md)

If code and contract diverge, update the contract first or stop and clarify the behavior before coding.
