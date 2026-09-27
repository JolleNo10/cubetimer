# Mistakes

## 2026-09-27

- What happened: the handoff check ran `git rev-parse --abbrev-ref --symbolic-full-name @{upstream}` through PowerShell and failed before Git executed.
- Root cause: PowerShell parsed `@{upstream}` as a hashtable expression.
- Prevention: quote Git refspecs that begin with `@` in PowerShell, for example `git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}'`.
