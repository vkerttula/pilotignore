# pilotignore Tests

This directory contains the integration and unit tests for `pilotignore`.

In alignment with the project's **zero dependency** philosophy, the test suite is built entirely using the native [Node.js Test Runner](https://nodejs.org/api/test.html) (`node:test`) and the native `node:assert` module.

## Running Tests

To run the entire test suite, simply execute:

```bash
npm run test
```

## Test Structure

- **`cli.test.js`**: Integration tests for the `pilotignore init` command. These tests verify that the CLI correctly scaffolds the `.github/hooks` directory, handles copying `.cjs` files, and accurately appends to `.gitignore` without overwriting existing configurations.
- **`pilotignore.test.js`**: Core functionality tests for the firewall itself. These tests spawn isolated processes of the `pilotignore.cjs` script and feed it simulated Copilot hook payloads via `stdin` to ensure the blocklist engine correctly denies or allows file reads based on varying `.pilotignore` rule configurations (including case insensitivity and folder matching).

## Adding New Tests

When adding new tests, remember that both test files create temporary directories using `os.tmpdir()` to isolate filesystem changes. Always ensure these temporary directories are cleaned up in a `finally` block to prevent lingering test artifacts.
