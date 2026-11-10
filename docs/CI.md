# Continuous Integration and Build Artifacts

**Status:** M05 pipeline baseline  
**Runner:** GitHub Actions, Ubuntu, Node.js 22

## Checks on pushes and pull requests to main

1. Install dependencies.
2. Run ESLint on the TypeScript source tree.
3. Run Vitest unit tests.
4. Run TypeScript project typecheck.
5. Run the Vite production build.
6. Upload the `dist/` folder as a commit-specific workflow artifact for 14 days.

The workflow is also manually dispatchable. It uses read-only repository permissions and cancels superseded runs on the same ref.

## Delivery boundary

The uploaded artifact is the continuous-delivery output for this milestone. It is not a production deployment. A public deployment is intentionally held for M35, after the studio's real workflows, privacy, model distribution, and production readiness have been validated. No fake production deployment is configured.

## Dependency reproducibility

The audited repository did not contain a lockfile. Until the generated lockfile is committed, CI uses `npm install`; this provides a verified build for each run but does not pin the complete transitive dependency graph across dates. A committed npm lockfile and an `npm ci` pipeline are a remaining hardening item and must be completed before a production release.

## Current test coverage

- Rational-time normalization, sample-derived time, frame-derived time, addition, comparison, and invalid input.
- Project schema-version gate behavior.
- Existing GridSplit boundary helper invariants and featureless-image fallback geometry.

Browser interaction, crop accuracy against the outstanding 196-image sample, ZIP byte inspection, audio engine, and rendering remain future test work; the current test suite does not claim those workflows are validated.
