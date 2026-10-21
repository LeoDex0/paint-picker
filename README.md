# Paint Picker

A helper for people who 3D-print miniatures and paint them. It picks a color from a photo, finds matching paints, builds a palette for the whole figure, lets you try it on the 3D model, and keeps a journal of your projects.

The interface is in Russian.

![Paint Picker](.github/preview.jpg)

## Download

[**PaintPicker-Setup.exe**](https://github.com/LeoDex0/paint-picker/releases/latest/download/PaintPicker-Setup.exe) — Windows installer, about 100 MB.

On first launch Windows will show "Windows protected your PC" because the file is not signed. Click "More info", then "Run anyway".

A version that runs without installing is on the [releases page](https://github.com/LeoDex0/paint-picker/releases/latest).

## Features

### Color picker

- Drag a photo into the window, paste it with Ctrl+V, or open a file. Click to pick a color, scroll to zoom, right-click and drag to move the photo.
- **Matches.** The closest paints with a match percentage, plus a paint for shadow and one for highlight, so you can paint with depth.
- **Paint ranges.** Vallejo (Game Color, Model Color, Game Air, Model Air), Citadel (Base and Layer), Army Painter (Warpaints and Warpaints Fanatic), AK 3rd Gen — about 1,460 paints in total. Turn ranges on and off with the "Набор" button above the list.
- **Equivalents.** Click any paint to see the most similar paints in the other ranges.
- **Recipe.** Finds a mix of two or three paints from the ones you marked as owned: how many parts of each and what color you get.
- **Palette.** "+ В палитру" adds the figure's colors to a project. Each color shows the base paint, shadow and highlight, and at the bottom there is a shopping list you can copy.

### 3D

Load the STL of your figure and paint it with colors from the palette: with a brush or a fill that stops at the edge of a surface. You can change the primer color, undo a stroke (Ctrl+Z) and save a snapshot to the journal. The model and the paint job are stored in the project.

### Journal

A project board by stage: queued, printed, primed, painted. Cards can be dragged between columns. Each project has photos, a palette and notes; any photo can be opened in the color picker.

## How accurate it is

- The color in a photo depends on the light and the camera. Shoot in daylight and pick a mid tone, not a highlight or a shadow.
- The percentage shows similarity to the paint's digital swatch. On the model the shade also depends on the primer and the number of layers.
- Recipes are approximate: they are calculated from swatch colors, there is no real pigment data. Mix a couple of drops as a test and adjust by eye.
- Metallics are marked and not used in recipes: shine can't be described by one color. Washes, contrast paints and primers are not in the database.
- The 3D preview shows the color layout, not the texture of the paint.

## Where data is stored

Everything stays on the user's computer, in the app profile: owned paints, projects, photos and 3D models. The app does not connect to the internet.

## Run from source

Requires Node.js 22 or newer.

```
npm install
npm start
```

## Build

```
npm run dist
```

The `dist` folder will contain `PaintPicker-Setup.exe` (installer) and `PaintPicker-Portable.exe` (runs without installing, but unpacks for about fifteen seconds on every launch).

## Data sources

- Paint colors — [miniature-paints](https://github.com/Arcturus5404/miniature-paints), MIT. The database is rebuilt with `node scripts/build-paints.js <folder_with_tables>`.
- Spectral tables for mixing — [spectral.js](https://github.com/rvanwijnen/spectral.js), MIT.
- 3D — [three.js](https://github.com/mrdoob/three.js) and [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh), MIT.

License texts are in `THIRD-PARTY.md`.
