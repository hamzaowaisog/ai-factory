# AI Factory Import (Figma plugin)

Builds an approved AI Factory design in Figma from its `figma.json`. It works on every Figma plan, the free Starter plan included. It needs no Figma token, no API key and no paid seat, only edit rights on the file.

## Get figma.json

```
factory design export <run> --format figma
```

Or, in `factory ui`, open the run's Design tab, choose **Figma** in Export, and download `figma.json` from the export.

## Install (once)

1. Open the Figma desktop app (development plugins cannot be imported in the browser).
2. Go to Plugins > Development > Import plugin from manifest...
3. Pick `manifest.json` in this folder. You can also use the plugin zip from the Export panel ("Download the plugin (.zip)") after unzipping it.

## Run

1. Open a Figma design file you can edit.
2. Go to Plugins > Development > AI Factory Import.
3. Choose `figma.json`, then **Import**.

It adds:

- a page per app (`<app> - <line> vN`), with a frame per screen, state, width, mode and language, using auto layout where the layout is a plain row or column;
- variables from the design tokens, with Light and Dark modes. The free plan allows one mode per collection, so there the dark values get a second collection, `... - Dark`;
- a "Component sets" page with the controls of the Components page as component sets and variants;
- the approved picture in each frame as a hidden, locked "Approved picture (reference)" layer. Show it to compare.

Fonts that this Figma lacks are shown in Inter, and the summary names them. The plugin reads only the file you choose. It has no network access, and nothing is sent anywhere.

## Files

- `manifest.json`: the plugin's manifest (no network, dynamic page loading).
- `code.js`: the import. It is a plain script with no build step.
- `ui.html`: the file picker and the result.
