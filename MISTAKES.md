# Mistakes

## 2026-09-29

- What happened: F2L setup and result notation could expose raw smart-cube faces even
  though the training cube was held in the white-bottom, green-front solver grip.
- Root cause: raw physical/virtual cube coordinates and user-facing F2L notation were
  allowed to share one representation at the controller/UI boundary.
- Prevention: keep trackers and patterns raw, and translate only F2L-facing notation
  through the shared training-grip helper; use that same grip for CubeView input/display.

## 2026-09-29

- What happened: the first 2D training-orientation assertion expected a solver-frame reframe to move white stickers to the displayed bottom face.
- Root cause: `reframe()` changes cube-coordinate interpretation for solving, while the visual net needs a physical whole-cube rotation so sticker colours move with the rendered cube.
- Prevention: distinguish solver-frame transformations from display rotations; use the existing rotation tokens with `KPattern.applyAlg()` for visual facelet output.

## 2026-09-29

- What happened: the first focused Vitest run was attempted inside the Windows sandbox and failed before tests loaded.
- Root cause: Vite's esbuild configuration needs to spawn a child process, which the sandbox rejected with `spawn EPERM`.
- Prevention: run Vite/Vitest/build commands in the approved host context on this Windows workspace when the sandbox reports a process-spawn restriction.

## 2026-09-29

- What happened: an initial Header patch did not apply.
- Root cause: the combined hunk depended on exact surrounding JSX/Unicode text that had already shifted.
- Prevention: inspect the current file and apply smaller marker-based hunks for large conditional JSX changes.

## 2026-09-29

- What happened: the next F2L pair used cubing.js `o` to make it darker, causing most stickers on the pair to become grey.
- Root cause: `o` was treated as another brightness level, but it is a mixed facelet stickering mode (`dim` primary + `ignored` non-primary).
- Prevention: when selecting serialized cubing.js stickering characters for visual intensity, verify their per-facelet semantics; use `D` when all original cubie colours must remain visible.

## 2026-09-29

- What happened: a combined presentation patch failed because one later CSS hunk no longer matched after earlier selector edits in the same patch.
- Root cause: the patch bundled dependent selector changes with stale context instead of applying the file-local transformations in smaller hunks.
- Prevention: apply related selector renames and responsive overrides in separate, verifiable patches.

## 2026-09-27

- What happened: the handoff check ran `git rev-parse --abbrev-ref --symbolic-full-name @{upstream}` through PowerShell and failed before Git executed.
- Root cause: PowerShell parsed `@{upstream}` as a hashtable expression.
- Prevention: quote Git refspecs that begin with `@` in PowerShell, for example `git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}'`.
