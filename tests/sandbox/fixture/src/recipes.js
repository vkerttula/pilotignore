import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const recipesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "recipes",
);

export async function listRecipes() {
  const files = await fs.readdir(recipesDir);
  return files
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3))
    .sort();
}

export async function loadRecipe(name) {
  let text;
  try {
    text = await fs.readFile(path.join(recipesDir, `${name}.md`), "utf8");
  } catch {
    return null;
  }
  return parseRecipe(text);
}

export function parseRecipe(text) {
  const recipe = { title: "", ingredients: [], steps: [] };
  let section = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("# ")) recipe.title = line.slice(2).trim();
    else if (/^## ingredients/i.test(line)) section = "ingredients";
    else if (/^## steps/i.test(line)) section = "steps";
    else if (section && /^\s*(-|\d+\.)\s+/.test(line)) {
      recipe[section].push(line.replace(/^\s*(-|\d+\.)\s+/, "").trim());
    }
  }
  return recipe;
}
