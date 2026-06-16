import test from "node:test";
import assert from "node:assert";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const firewallScriptPath = path.resolve(__dirname, "../templates/pilotignore.cjs");

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
    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.hookSpecificOutput.permissionDecision, "allow");
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
