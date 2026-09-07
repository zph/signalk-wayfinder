# Sail Wayfinder

A SignalK plugin that calculates optimal sailing routes using GRIB2 weather forecasts and the isochrone method. Meteorolical data from GRIB2 files. Polar diagrams in ORC/OpenCPN semicolon-delimited CSV format. Land avoidance via GSHHG. Result stored in SignalK `resources/routes` for use in other applications. Leaflet-based UI.

## Code Quality Principles

Follow YAGNI, SOLID, DRY, and KISS. Only make changes directly requested or clearly necessary. Keep solutions simple and focused.

Do not add features, refactor, or make improvements beyond what was asked. Do not add error handling or validation for scenarios that cannot happen. Trust internal code and framework guarantees. Only validate at system boundaries (user input, external APIs, file I/O).

Write self-documenting code. Comments explain "why", not "what". No echo comments. Keep functions small and single-responsibility. Prefer composition over inheritance. No magic numbers — use named constants. Documentation describes current state, not history.

Every source file must begin with a single-line comment describing what the file is — its role in the system, not a restatement of its name. Example: `// Isochrone routing algorithm: expands a time frontier from start toward destination, pruning by land and T_bound.` This comment must be present in new files and added to existing files when they are modified.

## Type Safety

All code is TypeScript. Use strict type checking; avoid `any`. Validate external inputs at system boundaries. Prefer immutable data where practical.

## Performance

The plugin is intended to run on a Raspberry Pi 3–5, often on battery. The isochrone inner loop (per-point × per-heading × per-time-step) is the hot path — keep it allocation-free. Rules:

- Guard `debug()` arguments — wrap with `debug.enabled &&` to avoid eager evaluation.
- Build objects in their final shape on hot paths (consistent key order for V8 hidden classes).
- Minimize allocations in the isochrone loop: hoist constants to module scope, prefer `for...of` over `.forEach`.
- Use `structuredClone`, not `JSON.parse(JSON.stringify(...))`, for deep cloning.
- Prefer `Set` over `Array.includes` for repeated membership checks.

## Testing

All new code requires tests. Test behaviour, not implementation. Unit tests for business logic (polar interpolation, geo math, isochrone pruning); integration tests for GRIB loading and route output.

## Git Commit Conventions

Format: `<type>(<scope>): <subject>` — type = feat|fix|docs|refactor|test|chore|perf. Subject: 50 chars max, imperative mood, no period. One logical change per commit. Rebase and clean up history before PR; amend fixes into the relevant commit rather than adding "fix typo" commits.

## Feature Branch Rule

Every new feature or bug fix is developed on its own branch. Exceptions: (a) if the planning discussion explicitly concludes that two or more items must be implemented together (shared logic, mutual dependency, or atomic correctness requirement), they may share a branch — that decision must be stated in the plan before any code is written. (b) Docs-only changes may be committed directly to "main". 

Branch naming: `feature/<REQ-N>-short-description` or `fix/<BUG-N>-short-description`.

A new branch must always be created from the latest `main` **after** the previous sprint's PR has been merged. Never continue committing on an old branch after its PR is merged — once merged, all future work must start from a new branch off main. The correct sequence is:

```
git checkout main && git pull
git checkout -b <new-branch>
```

Do this as the first action of every new sprint or feature, before writing any code.

## Definition of Done

The Definition of Done is in **`DoD.md`** at the repo root. Before declaring a task complete, the agent must:
1. Read `DoD.md`
2. Print the checklist
3. Verify each item
4. Not report "done" until every item passes

The DoD covers: build, lint, format, tests, documentation, commit workflow (Phase 1/Phase 2), PR/merge approval gates, and issue closure. All workflow rules (Commit Rule, Three-Table Rule, Issue Closure Rule, PR/Merge Rule, User Documentation Rule) are defined in `DoD.md`.

## Build and Deploy Rule

Before performing any build, deploy, install, or test operation, read `DEVELOPMENT.md` at the repo root and follow its instructions exactly. Do not reconstruct the build procedure from memory or prior steps — the procedure has specific flag requirements (e.g. which steps use `--ignore-scripts` and which do not) that are easy to get wrong and have caused repeated deployment failures.

## Specification Rule

All requirements and design decisions must be recorded in `SPEC.md` at the repo root before any code is written. If it is not in SPEC.md, it is not decided.

## Session Start Rule

At the start of every session, read and apply all rules in:
- `~/.claude/CLAUDE.md` (global rules)
- `~/src/weather-routing/CLAUDE.md` (project rules)
- All memory files listed in `~/.claude/projects/-home-kw-src-weather-routing/memory/MEMORY.md`

## Nautical Safety Rule

This plugin produces routes that sailors may follow at sea. Any silent fallback, soft failure, or substitution that causes the route to be calculated with different inputs than the user specified is a safety hazard — the sailor will act on a route they believe reflects their intended parameters.

Never implement silent fallbacks for mismatched or out-of-range inputs. If the user's input cannot be honoured exactly (wrong date, outside GRIB coverage, start on land, etc.), return a hard error that requires the user to correct the input. Do not substitute nearest available values, clamp silently, or proceed with a warning that can be missed. Fail loudly, fail early, fail clearly.

See also: **No Assumptions Rule** — assumptions about equivalent inputs (e.g. using nearest available data as a proxy for requested data) are both an assumption violation and a safety violation.

## No Assumptions Rule

Do not assume things, and do not simplify things on your own. If a decision has not been made explicitly, ask. If a simplification would change behaviour or omit information, do not apply it without explicit instruction.

Before using any value, dataset, or boundary as a proxy for something else, ask: is this explicitly required, or am I assuming it's equivalent? This applies to algorithms, data filters, display choices, query boundaries, and any other design decision. In a nautical routing context, assuming two inputs are equivalent can be a safety hazard — see also: **Nautical Safety Rule**.

Examples of assumptions that caused real bugs in this project:
- Using the GRIB bbox as the land overlay query boundary (BUG-14) — violated REQ-17
- Stride sampling and size filtering on land polygons (BUG-12) — violated REQ-17
- Assuming the package was published to npm — caused wrong installation instructions in README
- Assuming that the grib data was incorrect (BUG-65)

## Bug During Implementation Rule

When a bug is discovered while testing an implementation that has not yet been confirmed working, do not immediately log it as a separate bug. Instead, ask: should this be logged as a separate bug, or should work continue on the current implementation? Log separately only if the user says so. If a bug anyways is logged separately, it shall be kept. 

## Bug Report Rule

Before acting on any user message, ask: does this describe behavior that differs from expectation? If yes, it is a bug report — regardless of phrasing. Examples that are bug reports: "X is empty", "Y shows wrong values", "Z doesn't appear", "it's not working", "the numbers are wrong". Conversational descriptions of problems are bug reports just as much as formal "bug:" prefixes.

When a bug is reported: write one entry to BUGS.md and stop. No code reads, no root cause analysis, no proposed fix, no troubleshooting of any kind. There are no exceptions — even if the code was just written, even if the cause seems obvious.

This rule is a focus/scope guardrail, not a format preference: investigating "why" is a rabbit hole that pulls effort off what the user is working on. Before writing any BUGS.md entry, re-read this rule and the worked example in `things-opencode-will-not-do-again.md`, then apply the self-check: the entry must be **symptom-only**. If you are writing "because", naming a function/class/file, or explaining a mechanism, stop and delete it — the entry records what was observed, nothing more. Investigation/root-cause notes are added to the entry only later, when explicitly authorised, and are documented as they happen.

## New Requirements Rule

When any new feature or requirement is requested — regardless of how it is phrased ("feature:", "new requirement:", "add this", "we need X", or any other wording) — add one entry to SPEC.md and stop. Do not analyse it, do not plan it, do not propose an implementation, do not ask clarifying questions about implementation. Implementation happens later, explicitly on request.

## Requirement Logging Rule

When logging a requirement to SPEC.md, preserve the user's exact wording verbatim, then add the agent's interpretation as a separate paragraph below it. Never rewrite or paraphrase the original. Both the original and the interpretation are kept in the logged entry.

Format:
> **Original:** «exact words the user said»
>
> **Interpretation:** «agent's understanding of what this means technically»

## Planning Rule

Before writing any code or changing a technical decision, present a plan and wait for explicit approval.

## New Tooling Rule

If implementing a verification, test, or validation task would require introducing automation tooling not already present in the project (e.g. Playwright, a new test framework, a new CI step), stop. Add the tooling as a new requirement to SPEC.md and wait for explicit approval before proceeding with installation or use.

## GitHub Issue Rule


When a new requirement is added to SPEC.md or a new bug is added to BUGS.md, create a corresponding GitHub issue with the same ID and text. When the text of an existing entry is updated in either file, update the corresponding GitHub issue with the same information at the time of the next commit.

Issue titles must follow the format `<ID>: <slogan>` (e.g. `REQ-23: Coast avoidance toggle`, `BUG-10: Start on land gives misleading error`). Each entry in SPEC.md and BUGS.md must include a link to its GitHub issue.

Do not include a `Status:` line in GitHub issue bodies. The issue's open/closed state carries the status — open means unresolved, closed means done or fixed.
Issues must be labelled: 'bug' for bugs, 'enhancement' for new features.

Before creating a new GitHub issue for a requirement or bug, search existing issues for one covering the same topic. Retrieve all open issues from github before creating a new github issue, and check if the issue already exist. If it exists, update it as necessary including its headline and link it to the documentation in the repo. 

If two identical issues are present in github, this applies to the newest issue: it becomes the duplicate: add a **comment** to it saying `Duplicate of #N` (never replace its body), close it, and point SPEC.md/BUGS.md to the new issue with the proper `<ID>: <slogan>` title.

## Task Boundary Rule

Deliver exactly what was asked, including any required follow-ups (e.g. creating a GitHub issue for a new SPEC.md entry), then stop. Do not resume prior work, do not take initiative on next steps, do not continue mid-task workflows. Wait for the next explicit instruction.

## Test-Result Triage Rule

Before coding any test-result fix, classify it: **(1) in-scope defect** of the feature currently being built → fix it; **(2) anything else** — a different subsystem, new or pre-existing behaviour, or a risky change to shared code → log to `BUGS.md`/`SPEC.md` + a GitHub issue and **ask before coding**. Fix the class-1 items; only log/ask the class-2 ones. Never replace a reported class-1 bug with a class-2 change. (Worked example: the 2026-06-20 scrubber incident in `things-opencode-will-not-do-again.md`.)
