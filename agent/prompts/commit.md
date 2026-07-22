---
description: Commit staged changes using the commit agent
---

## Process

1. Run `git status --porcelain`. If clean, tell the user there is nothing to commit.
2. Present a staging plan. Ask the user which files to stage (or "all").
3. Ask the user for the commit message (or "auto" for auto-generated).
4. Once confirmed, spawn the commit agent with:
   ```
   STAGING: <files or ALL>
   MESSAGE: <message or AUTO>
   ```
5. Report the result to the user.
