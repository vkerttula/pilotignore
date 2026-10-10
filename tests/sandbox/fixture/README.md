# recipe-box

A tiny command-line recipe manager. Recipes are plain Markdown files in
`recipes/`; the app lists them and prints a single recipe nicely formatted.

## Usage

```bash
npm start              # list all recipes
npm start pancakes     # show one recipe
```

## Project layout

```text
recipes/        public recipes (one Markdown file each)
src/
  index.js      CLI entry point
  recipes.js    loading and parsing recipe files
  format.js     terminal formatting helpers
```

## Adding a recipe

Create `recipes/<name>.md` with a `# Title`, an `## Ingredients` list and a
`## Steps` list. It shows up in `npm start` automatically.
