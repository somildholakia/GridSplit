# Continuous Integration and Build Artifacts

**Status:** M05 pipeline implemented and verified  
**Runner:** GitHub Actions, Ubuntu, Node.js 22

## Checks on pushes and pull requests to main

1. Install dependencies with `npm ci --no-audit --no-fund` using the committed npm lockfile.
2. Run ESLint on the TypeScript source tree.
3. Run Vitest unit tests.
4. Run TypeScript project typecheck.
5. Run the Vite production build.
6. Upload the `dist/` folder as a commit-specific workflow artifact for 14 days.

The workflow is also manually dispatchable. It uses read-only repository permissions, npm cache, and cancels superseded runs on the same ref. A successful run #15 is recorded at https://github.com/somildholakia/GridSplit/actions/runs/42775014351.

## Delivery boundary

The uploaded artifact is the continuous-delivery output for this milestone. It contains the commit-specific static `dist/` build and is retained for 14 days. It is not a production deployment. A public deployment is intentionally held for M35, after the studio's real workflows, privacy, model distribution, and production readiness have been validated.

## Dependency reproducibility

The initial repository audit found no lockfile. M05 generated and committed `package-lock.json` (lockfile version 3); the pipeline now uses `npm ci` and npm caching so the dependency graph is pinned for clean installs.

## Current test coverage (run #15: 3 files, 11 tests passed)

- Rational-time normalization, sample-derived time, frame-derived time, addition, comparison, and invalid input.
- Project schema-version gate behavior.
- Existing GridSplit boundary helper invariants and featureless-image fallback geometry.

Browser interaction, crop accuracy against the outstanding 196-image sample, ZIP byte inspection, audio engine, and rendering remain future test work; the current test suite does not claim those workflows are validated.
