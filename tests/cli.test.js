import test from "node:test";
import assert from "node:assert";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliScriptPath = path.resolve(__dirname, "../bin/cli.js");

function runCli(cwd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [cliScriptPath, ...args], {
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
  });
}

test("cli init - sets up all files in clean directory", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pilotignore-cli-test-"));
  try {
    const { code, stdout, stderr } = await runCli(tempDir, ["init"]);
    assert.strictEqual(code, 0, `CLI failed with error: ${stderr}`);

    // Verify directories and files exist
    const hooksDir = path.join(tempDir, ".github", "hooks");
    const jsonPath = path.join(hooksDir, "pilotignore.json");
    const jsPath = path.join(hooksDir, "pilotignore.cjs");
    const pilotignorePath = path.join(tempDir, ".pilotignore");

    const jsonExists = await fs.access(jsonPath).then(() => true).catch(() => false);
    const jsExists = await fs.access(jsPath).then(() => true).catch(() => false);
    const pilotignoreExists = await fs.access(pilotignorePath).then(() => true).catch(() => false);

    assert.ok(jsonExists, "pilotignore.json was not created");
    assert.ok(jsExists, "pilotignore.cjs was not created");
    assert.ok(pilotignoreExists, ".pilotignore was not created");

    // Verify default .pilotignore contents
    const defaultContent = await fs.readFile(pilotignorePath, "utf8");
    assert.ok(defaultContent.includes(".pilotignore"), "default .pilotignore contents are missing");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("cli init - does not overwrite existing .pilotignore", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pilotignore-cli-test-"));
  try {
    const customContent = "# My custom rules\n/custom-block\n";
    const pilotignorePath = path.join(tempDir, ".pilotignore");
    await fs.writeFile(pilotignorePath, customContent, "utf8");

    const { code } = await runCli(tempDir, ["init"]);
    assert.strictEqual(code, 0);

    const resultingContent = await fs.readFile(pilotignorePath, "utf8");
    assert.strictEqual(resultingContent, customContent, ".pilotignore was overwritten");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("cli init - handles .gitignore updates correctly", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pilotignore-cli-test-"));
  try {
    const gitignorePath = path.join(tempDir, ".gitignore");

    // Case 1: .gitignore doesn't exist
    let { code } = await runCli(tempDir, ["init"]);
    assert.strictEqual(code, 0);
    let content = await fs.readFile(gitignorePath, "utf8");
    assert.ok(content.includes(".copilot/"), ".copilot/ was not added to new .gitignore");

    // Case 2: .gitignore exists but doesn't have .copilot/
    await fs.writeFile(gitignorePath, "node_modules/\ndist/\n", "utf8");
    code = (await runCli(tempDir, ["init"])).code;
    assert.strictEqual(code, 0);
    content = await fs.readFile(gitignorePath, "utf8");
    assert.ok(content.includes("node_modules/"), "existing gitignore content was lost");
    assert.ok(content.includes(".copilot/"), ".copilot/ was not appended to existing .gitignore");

    // Case 3: .gitignore already contains .copilot/
    const beforeContent = content;
    code = (await runCli(tempDir, ["init"])).code;
    assert.strictEqual(code, 0);
    content = await fs.readFile(gitignorePath, "utf8");
    assert.strictEqual(content, beforeContent, ".gitignore was modified even though .copilot/ was already present");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("cli verify - passes after init with a blocking rule", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pilotignore-cli-test-"));
  try {
    await runCli(tempDir, ["init"]);
    await fs.writeFile(
      path.join(tempDir, ".pilotignore"),
      ".env\nsecrets/**\n",
      "utf8"
    );

    const { code, stdout, stderr } = await runCli(tempDir, ["verify"]);
    assert.strictEqual(code, 0, `verify failed: ${stderr}\n${stdout}`);
    assert.ok(stdout.includes("denied"), "verify output should report a deny");
    assert.ok(stdout.includes("allowed"), "verify output should report an allow");
    assert.ok(stdout.includes("All checks passed"), "verify should report success");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("cli verify - fails on an uninitialized project", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pilotignore-cli-test-"));
  try {
    const { code, stdout } = await runCli(tempDir, ["verify"]);
    assert.strictEqual(code, 1);
    assert.ok(stdout.includes("FAILED"), "verify should report failure");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("cli - unknown command prints usage and exits non-zero", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pilotignore-cli-test-"));
  try {
    const { code, stdout } = await runCli(tempDir, ["bogus"]);
    assert.strictEqual(code, 1);
    assert.ok(stdout.includes("Usage"), "usage text should be printed");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
