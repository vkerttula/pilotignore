#!/usr/bin/env node

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// ESM equivalents for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function init() {
  const args = process.argv.slice(2);

  if (args[0] !== "init") {
    console.log("Usage: npx pilotignore init");
    process.exit(1);
  }

  const targetDir = process.cwd();
  const githubHooksDir = path.join(targetDir, ".github", "hooks");
  const templatesDir = path.join(__dirname, "..", "templates");

  try {
    // 1. Create the directory structure
    await fs.mkdir(githubHooksDir, { recursive: true });
    console.log("✅ Ensured directory: .github/hooks");

    // 2. Copy the configuration file
    await fs.copyFile(
      path.join(templatesDir, "pilotignore.json"),
      path.join(githubHooksDir, "pilotignore.json"),
    );
    console.log("✅ Copied: .github/hooks/pilotignore.json");

    // 3. Copy the actual firewall script
    await fs.copyFile(
      path.join(templatesDir, "pilotignore.js"),
      path.join(githubHooksDir, "pilotignore.js"),
    );
    console.log("✅ Copied: .github/hooks/pilotignore.js");

    // 4. Create .pilotignore only if it doesn't exist
    const targetPilotignore = path.join(targetDir, ".pilotignore");
    try {
      await fs.access(targetPilotignore);
      console.log("ℹ️  .pilotignore already exists, skipping creation.");
    } catch {
      await fs.copyFile(
        path.join(templatesDir, "default.pilotignore"),
        targetPilotignore,
      );
    }

    // 5. Add .copilot/ to .gitignore if not already ignored
    const targetGitignore = path.join(targetDir, ".gitignore");
    try {
      let gitignoreContent = "";
      try {
        gitignoreContent = await fs.readFile(targetGitignore, "utf8");
      } catch {
        // .gitignore doesn't exist yet, we will create it
      }

      if (!gitignoreContent.includes(".copilot")) {
        const separator = gitignoreContent && !gitignoreContent.endsWith("\n") ? "\n" : "";
        await fs.writeFile(
          targetGitignore,
          gitignoreContent + separator + "\n# pilotignore logs\n.copilot/\n",
          "utf8"
        );
        console.log("✅ Added .copilot/ to .gitignore");
      } else {
        console.log("ℹ️  .copilot/ already in .gitignore, skipping.");
      }
    } catch (err) {
      console.log("ℹ️  Could not update .gitignore: " + err.message);
    }

    console.log("\n🚀 pilotignore initialization complete!");
    console.log(
      "Add your sensitive files to the .pilotignore file at the root of your project.",
    );
  } catch (error) {
    console.error("❌ Installation error:", error.message);
    process.exit(1);
  }
}

init();
