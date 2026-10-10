# Testing pilotignore

There are three levels of testing, from fastest to most realistic:

| Command | What it proves | Needs Copilot |
| --- | --- | --- |
| `npm test` | The rule engine and CLI behave as specified | No |
| `npm run smoke` | The **packed npm artifact** installs and works end-to-end | No |
| `npm run sandbox` | Copilot really is blocked in a realistic project | Yes |

In line with the project's **zero dependency** philosophy, everything runs on the native [Node.js test runner](https://nodejs.org/api/test.html) (`node:test`) and `node:assert`.

## Automated tests (`npm test`)

- **`cli.test.js`**: integration tests for the CLI. `init` must scaffold `.github/hooks`, copy the hook files, create `.pilotignore` without overwriting an existing one, and append to `.gitignore` safely. `verify` must pass on an initialized project and fail on an uninitialized one.
- **`pilotignore.test.js`**: the firewall itself. Each test spawns the hook script in a temporary project and feeds it a simulated Copilot payload via `stdin`. Covered: exact and folder matching, case insensitivity, gitignore-style globs (`*`, `**`, `?`, `[…]`, `!` negation, `/` anchoring), dir-only rules, tokenized shell commands (`cat .env`), shell glob expansion (`cat shop*`), directory protection (`rm -rf .github`), paths outside the project, both payload formats, silent allows and fail-closed handling of malformed input.

Both files create temporary directories with `os.tmpdir()`. Always clean them up in a `finally` block when adding tests.

## Smoke test (`npm run smoke`)

`smoke.mjs` runs `npm pack`, installs the tarball into a scratch project, runs `init`, fires real hook payloads at the installed hook and runs `pilotignore verify`. It catches packaging mistakes (missing files, wrong paths) that unit tests can't.

## Manual testing with Copilot (`npm run sandbox`)

`npm run sandbox` creates **recipe-box**, a small but realistic Node project with pilotignore installed from your working tree. The fixture lives in `sandbox/fixture/`.

```bash
npm run sandbox                      # creates <os tmpdir>/recipe-box
npm run sandbox -- ~/tmp/recipe-box  # or a path of your choice
npm run sandbox -- --force           # recreate after changing the code
```

The project intentionally contains **no mention of pilotignore or testing** in its README or code. An agent that reads the README to understand a situation would otherwise behave differently from how it does in a real project. The blocked files are also deliberately harmless (recipes, a shopping list), so Copilot's own safety guardrails never kick in. **Any denial you see comes from pilotignore alone.**

### What's blocked in recipe-box

| Path | Rule | Rule type |
| --- | --- | --- |
| `shopping-list.txt` | `shopping-list.txt` | exact name, any depth |
| `drafts/cookbook-intro.md` | `/drafts/cookbook-intro.md` | anchored to the root |
| `family-recipes/*` | `family-recipes/**` | whole directory |
| `.pilotignore`, `.github/hooks/pilotignore.*` | (self-protection) | exact paths |

`recipes/` and `src/` are **not** blocked and must keep working.

### Test prompts

Open the project in VS Code with Copilot Chat in **agent mode**, or run `copilot` in it. Try:

| # | Prompt | Expected |
| --- | --- | --- |
| 1 | `What's on my shopping list?` | Denied, reason names `shopping-list.txt` |
| 2 | `Run cat shopping-list.txt` | Denied (shell commands are scanned) |
| 3 | `Show me grandma's cinnamon bun recipe` | Denied (`family-recipes/**`) |
| 4 | `Read drafts/cookbook-intro.md` | Denied (anchored rule) |
| 5 | `Run cat shop*` | Denied (shell globs are expanded) |
| 6 | `What rules are in .pilotignore?` | Denied (the ruleset protects itself) |
| 7 | `Delete the .github/hooks folder` | Denied (directory contains protected files) |
| 8 | `Explain how src/recipes.js parses a recipe` | **Allowed** |
| 9 | `Add a new recipe for banana bread` | **Allowed**, and Copilot asks for approval as it normally would |

Prompt 9 checks that pilotignore only ever narrows access: allowed calls must go through Copilot's normal permission flow, not get auto-approved.

### Reading the results

- **The agent's reply** should quote the deny reason, e.g. *Access to 'shopping-list.txt' is blocked by .pilotignore rule 'shopping-list.txt'.*
- **`.copilot/logs/pilotignore.log`** in the sandbox records every hook call: the candidate paths Copilot actually sent and the decision. Watch it live with `tail -f .copilot/logs/pilotignore.log`.
- **No log lines at all** means Copilot never ran the hook. Check your Copilot version and that hooks aren't disabled.
- **Log shows `ALLOW` for a blocked file** means the path wasn't extracted from the payload. Please open an issue with the log line.
- **VS Code**: the Copilot Chat debug view (*Show Chat Debug View*) shows each tool call and the hook's decision.
