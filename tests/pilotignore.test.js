import test from "node:test";
import assert from "node:assert";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const firewallScriptPath = path.resolve(__dirname, "../src/pilotignore.cjs");

// Helper function to run the firewall script
function runFirewall(cwd, payload, stdinText = null) {
  const scriptToRun = path.join(cwd, ".github", "hooks", "pilotignore.cjs");
  return new Promise((resolve, reject) => {
    const child = spawn("node", [scriptToRun], {
      cwd,
      env: { ...process.env }
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });

    child.on("error", reject);

    const input = stdinText !== null ? stdinText : JSON.stringify(payload);
    child.stdin.write(input);
    child.stdin.end();
  });
}

// Helper to create a temporary test project
async function createTempProject(rules = []) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pilotignore-test-"));
  const pilotignoreContent = rules.join("\n");
  await fs.writeFile(path.join(tempDir, ".pilotignore"), pilotignoreContent, "utf8");

  // Copy the firewall script to the temp dir to avoid ESM resolution issues during testing
  await fs.mkdir(path.join(tempDir, ".github", "hooks"), { recursive: true });
  await fs.copyFile(
    firewallScriptPath,
    path.join(tempDir, ".github", "hooks", "pilotignore.cjs")
  );

  return tempDir;
}

test("pilotignore firewall - allow normal files", async (t) => {
  const tempDir = await createTempProject(["secrets.json", ".env"]);
  try {
    const payload = {
      cwd: tempDir,
      tool_input: {
        path: path.join(tempDir, "src", "index.js")
      }
    };
    const { code, stdout } = await runFirewall(tempDir, payload);
    assert.strictEqual(code, 0);
    // Allow is silent so Copilot's own permission flow still applies
    assert.strictEqual(stdout.trim(), "", "allow must not emit a decision");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("pilotignore firewall - deny root-level blocked file", async (t) => {
  const tempDir = await createTempProject([".env"]);
  try {
    const payload = {
      cwd: tempDir,
      tool_input: {
        path: path.join(tempDir, ".env")
      }
    };
    const { code, stdout } = await runFirewall(tempDir, payload);
    assert.strictEqual(code, 2);
    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.hookSpecificOutput.permissionDecision, "deny");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("pilotignore firewall - deny root-level blocked file without path separator in input candidate", async (t) => {
  const tempDir = await createTempProject([".env"]);
  try {
    const payload = {
      cwd: tempDir,
      tool_input: {
        path: ".env"
      }
    };
    const { code, stdout } = await runFirewall(tempDir, payload);
    assert.strictEqual(code, 2);
    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.hookSpecificOutput.permissionDecision, "deny");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("pilotignore firewall - deny subdirectory file via folder rule", async (t) => {
  const tempDir = await createTempProject(["node_modules"]);
  try {
    const payload = {
      cwd: tempDir,
      tool_input: {
        path: path.join(tempDir, "node_modules", "lodash", "index.js")
      }
    };
    const { code, stdout } = await runFirewall(tempDir, payload);
    assert.strictEqual(code, 2);
    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.hookSpecificOutput.permissionDecision, "deny");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("pilotignore firewall - exit code 0 for VS Code IDE chat", async (t) => {
  const tempDir = await createTempProject([".env"]);
  try {
    const payload = {
      cwd: tempDir,
      client: "vscode",
      tool_input: {
        path: ".env"
      }
    };
    const { code, stdout } = await runFirewall(tempDir, payload);
    assert.strictEqual(code, 0);
    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.hookSpecificOutput.permissionDecision, "deny");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("pilotignore firewall - handle comments, empty lines, and whitespace in rules", async (t) => {
  const tempDir = await createTempProject([
    "# this is a comment",
    "",
    "  .env  ",
    "secrets.json  ",
    "# another comment"
  ]);
  try {
    const payload1 = {
      cwd: tempDir,
      tool_input: {
        path: ".env"
      }
    };
    const payload2 = {
      cwd: tempDir,
      tool_input: {
        path: "secrets.json"
      }
    };

    const { code: code1 } = await runFirewall(tempDir, payload1);
    const { code: code2 } = await runFirewall(tempDir, payload2);

    assert.strictEqual(code1, 2);
    assert.strictEqual(code2, 2);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("pilotignore firewall - case insensitive matching", async (t) => {
  const tempDir = await createTempProject([".env"]);
  try {
    const payload = {
      cwd: tempDir,
      tool_input: {
        path: ".ENV"
      }
    };
    const { code } = await runFirewall(tempDir, payload);
    assert.strictEqual(code, 2);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("pilotignore firewall - glob wildcard patterns", async (t) => {
  const tempDir = await createTempProject(["*.pem", "*.env*"]);
  try {
    const cases = [
      { path: "certs/dev.pem", expectDeny: true },
      { path: "prod.env", expectDeny: true },
      { path: ".env.local", expectDeny: true },
      { path: "src/index.js", expectDeny: false },
    ];
    for (const c of cases) {
      const { code } = await runFirewall(tempDir, {
        cwd: tempDir,
        tool_input: { path: c.path }
      });
      assert.strictEqual(
        c.expectDeny ? code === 2 : code === 0,
        true,
        `path ${c.path}: expected ${c.expectDeny ? "deny" : "allow"}, got exit ${code}`
      );
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("pilotignore firewall - anchored pattern only matches at root", async (t) => {
  const tempDir = await createTempProject(["/secrets.json"]);
  try {
    const { code: denyCode } = await runFirewall(tempDir, {
      cwd: tempDir,
      tool_input: { path: "secrets.json" }
    });
    assert.strictEqual(denyCode, 2);

    const { code: allowCode } = await runFirewall(tempDir, {
      cwd: tempDir,
      tool_input: { path: "nested/secrets.json" }
    });
    assert.strictEqual(allowCode, 0);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("pilotignore firewall - double star and negation rules", async (t) => {
  const tempDir = await createTempProject(["secrets/**", "!secrets/public.txt", "**/id_rsa"]);
  try {
    const cases = [
      { path: "secrets/api.key", expectDeny: true },
      { path: "secrets/deep/nested.key", expectDeny: true },
      { path: "secrets/public.txt", expectDeny: false },
      { path: "ssh/id_rsa", expectDeny: true },
      { path: "id_rsa", expectDeny: true },
      { path: "other/file.txt", expectDeny: false },
    ];
    for (const c of cases) {
      const { code } = await runFirewall(tempDir, {
        cwd: tempDir,
        tool_input: { path: c.path }
      });
      assert.strictEqual(
        c.expectDeny ? code === 2 : code === 0,
        true,
        `path ${c.path}: expected ${c.expectDeny ? "deny" : "allow"}, got exit ${code}`
      );
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("pilotignore firewall - directory-only rule blocks contents", async (t) => {
  const tempDir = await createTempProject(["private/"]);
  try {
    const { code } = await runFirewall(tempDir, {
      cwd: tempDir,
      tool_input: { path: "private/key.txt" }
    });
    assert.strictEqual(code, 2);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("pilotignore firewall - denies shell commands targeting blocked files", async (t) => {
  const tempDir = await createTempProject([".env", "secrets.json"]);
  try {
    const denyCommands = [
      "cat .env",
      'cat ".env"',
      "cat ./secrets.json",
      "head -n 5 .env && echo done",
      "base64 .env | pbcopy",
      "ENV_FILE=.env npm start",
    ];
    for (const command of denyCommands) {
      const { code } = await runFirewall(tempDir, {
        cwd: tempDir,
        tool_input: { command }
      });
      assert.strictEqual(code, 2, `command '${command}' was not denied`);
    }

    const allowCommands = [
      "npm run build",
      "git status",
      "ls -la src",
      "echo hello world",
    ];
    for (const command of allowCommands) {
      const { code } = await runFirewall(tempDir, {
        cwd: tempDir,
        tool_input: { command }
      });
      assert.strictEqual(code, 0, `command '${command}' was incorrectly denied`);
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("pilotignore firewall - denies path-like tokens in mixed arguments", async (t) => {
  const tempDir = await createTempProject([".env", "certs/key.pem"]);
  try {
    const { code: code1 } = await runFirewall(tempDir, {
      cwd: tempDir,
      arguments: ["cat", ".env"]
    });
    assert.strictEqual(code1, 2);

    const { code: code2 } = await runFirewall(tempDir, {
      cwd: tempDir,
      tool_input: { command: "cat certs/key.pem" }
    });
    assert.strictEqual(code2, 2);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("pilotignore firewall - question mark and character class patterns", async (t) => {
  const tempDir = await createTempProject(["?.env", "secret-[0-9].json"]);
  try {
    const cases = [
      { path: "a.env", expectDeny: true },
      { path: "x.env", expectDeny: true },
      { path: "secret-5.json", expectDeny: true },
      { path: "ab.env", expectDeny: false },
      { path: "secret-x.json", expectDeny: false },
    ];
    for (const c of cases) {
      const { code } = await runFirewall(tempDir, {
        cwd: tempDir,
        tool_input: { path: c.path }
      });
      assert.strictEqual(
        c.expectDeny ? code === 2 : code === 0,
        true,
        `path ${c.path}: expected ${c.expectDeny ? "deny" : "allow"}, got exit ${code}`
      );
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("pilotignore firewall - blocked files outside cwd are still denied", async (t) => {
  const tempDir = await createTempProject([".env", "id_rsa"]);
  try {
    // Parent-directory escape
    const { code: code1 } = await runFirewall(tempDir, {
      cwd: tempDir,
      tool_input: { path: "../outside/.env" }
    });
    assert.strictEqual(code1, 2);

    // Home-directory reference
    const { code: code2 } = await runFirewall(tempDir, {
      cwd: tempDir,
      tool_input: { command: "cat ~/.ssh/id_rsa" }
    });
    assert.strictEqual(code2, 2);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("pilotignore firewall - documented toolName/toolArgs payload shape", async (t) => {
  const tempDir = await createTempProject([".env", "secrets.json"]);
  try {
    // Shape per GitHub Copilot hooks reference: timestamp, cwd, toolName, toolArgs
    const { code: code1, stdout: stdout1 } = await runFirewall(tempDir, {
      timestamp: Date.now(),
      cwd: tempDir,
      toolName: "view",
      toolArgs: { path: ".env" }
    });
    assert.strictEqual(code1, 2);
    const parsed = JSON.parse(stdout1);
    assert.strictEqual(parsed.hookSpecificOutput.permissionDecision, "deny");
    assert.ok(
      parsed.hookSpecificOutput.permissionDecisionReason.includes(".env"),
      "deny reason should mention the matched rule or path"
    );
    // Flat Copilot CLI format: reason must also be top-level or the
    // agent reports "no reason provided"
    assert.strictEqual(parsed.permissionDecision, "deny");
    assert.ok(
      parsed.permissionDecisionReason.includes(".env"),
      "flat deny reason should mention the matched rule or path"
    );

    const { code: code2 } = await runFirewall(tempDir, {
      timestamp: Date.now(),
      cwd: tempDir,
      toolName: "bash",
      toolArgs: { command: "cat secrets.json" }
    });
    assert.strictEqual(code2, 2);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("pilotignore firewall - parses tool_input_as_string JSON", async (t) => {
  const tempDir = await createTempProject([".env"]);
  try {
    const { code } = await runFirewall(tempDir, {
      cwd: tempDir,
      tool_input_as_string: JSON.stringify({ path: ".env" })
    });
    assert.strictEqual(code, 2);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("pilotignore firewall - dir-only rule: directory blocked, same-named file allowed", async (t) => {
  const tempDir = await createTempProject(["private/", "targetfile/"]);
  try {
    await fs.mkdir(path.join(tempDir, "private"));
    await fs.writeFile(path.join(tempDir, "targetfile"), "x", "utf8");

    const { code: dirCode } = await runFirewall(tempDir, {
      cwd: tempDir,
      tool_input: { path: "private" }
    });
    assert.strictEqual(dirCode, 2, "existing directory matching dir/ rule should be denied");

    const { code: fileCode } = await runFirewall(tempDir, {
      cwd: tempDir,
      tool_input: { path: "targetfile" }
    });
    assert.strictEqual(fileCode, 0, "regular file should not match a dir/ rule");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("pilotignore firewall - fails closed on malformed or empty input", async (t) => {
  const tempDir = await createTempProject([".env"]);
  try {
    for (const stdinText of ["not json", ""]) {
      const { code, stdout } = await runFirewall(tempDir, null, stdinText);
      assert.strictEqual(code, 2, `input ${JSON.stringify(stdinText)} should be denied`);
      const parsed = JSON.parse(stdout);
      assert.strictEqual(parsed.permissionDecision, "deny");
      assert.ok(parsed.permissionDecisionReason.includes("fail-closed"));
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("pilotignore firewall - expands shell globs against the filesystem", async (t) => {
  const tempDir = await createTempProject(["shopping-list.txt"]);
  try {
    await fs.writeFile(path.join(tempDir, "shopping-list.txt"), "milk\n", "utf8");
    await fs.mkdir(path.join(tempDir, "src"));
    await fs.writeFile(path.join(tempDir, "src", "index.js"), "//\n", "utf8");

    for (const command of [
      "cat shop*",
      "cat shopping-list.tx?",
      "cat [s]hopping-list.txt",
      "cat ./*.txt",
    ]) {
      const { code } = await runFirewall(tempDir, {
        cwd: tempDir,
        toolName: "bash",
        toolArgs: { command }
      });
      assert.strictEqual(code, 2, `command '${command}' was not denied`);
    }

    for (const command of ["cat src/*.js", "ls *.md"]) {
      const { code } = await runFirewall(tempDir, {
        cwd: tempDir,
        toolName: "bash",
        toolArgs: { command }
      });
      assert.strictEqual(code, 0, `command '${command}' was incorrectly denied`);
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("pilotignore firewall - denies operations on directories containing blocked paths", async (t) => {
  const tempDir = await createTempProject([
    ".github/hooks/pilotignore.cjs",
    "shopping-list.txt",
  ]);
  try {
    await fs.mkdir(path.join(tempDir, "notes"));
    await fs.writeFile(path.join(tempDir, "notes", "shopping-list.txt"), "milk\n", "utf8");
    await fs.mkdir(path.join(tempDir, "src"));
    await fs.writeFile(path.join(tempDir, "src", "index.js"), "//\n", "utf8");

    for (const command of [
      "rm -rf .github",
      "rm -rf .github/hooks",
      "rm -rf .git*",
      "rm -rf notes",
    ]) {
      const { code, stdout } = await runFirewall(tempDir, {
        cwd: tempDir,
        toolName: "bash",
        toolArgs: { command }
      });
      assert.strictEqual(code, 2, `command '${command}' was not denied`);
      assert.ok(JSON.parse(stdout).permissionDecisionReason.includes("contains"));
    }

    // Unrelated directories and the project root itself stay usable
    for (const command of ["ls src", "ls .", "rm -rf src"]) {
      const { code } = await runFirewall(tempDir, {
        cwd: tempDir,
        toolName: "bash",
        toolArgs: { command }
      });
      assert.strictEqual(code, 0, `command '${command}' was incorrectly denied`);
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("pilotignore firewall - conservative deny for blocked names in command strings", async (t) => {
  const tempDir = await createTempProject([".env"]);
  try {
    // Documented trade-off: a command merely mentioning a blocked filename
    // (here inside a commit message) is denied rather than leaked.
    const { code } = await runFirewall(tempDir, {
      cwd: tempDir,
      tool_input: { command: 'git commit -m "fix .env handling"' }
    });
    assert.strictEqual(code, 2);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
