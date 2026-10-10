import { listRecipes, loadRecipe } from "./recipes.js";
import { formatRecipe, formatList } from "./format.js";

const name = process.argv[2];

if (!name) {
  console.log(formatList(await listRecipes()));
} else {
  const recipe = await loadRecipe(name);
  if (!recipe) {
    console.error(`No recipe called "${name}".`);
    process.exit(1);
  }
  console.log(formatRecipe(recipe));
}
