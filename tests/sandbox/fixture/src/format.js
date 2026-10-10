export function formatList(names) {
  if (names.length === 0) return "No recipes yet.";
  return ["Recipes:", ...names.map((n) => `  • ${n}`)].join("\n");
}

export function formatRecipe(recipe) {
  const lines = [recipe.title, "=".repeat(recipe.title.length), ""];
  lines.push("Ingredients:");
  recipe.ingredients.forEach((i) => lines.push(`  - ${i}`));
  lines.push("", "Steps:");
  recipe.steps.forEach((s, idx) => lines.push(`  ${idx + 1}. ${s}`));
  return lines.join("\n");
}
