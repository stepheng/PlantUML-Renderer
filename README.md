# PlantUML Renderer

A VSCode extension that renders `.puml` and `.iuml` files into a live preview panel using a local PlantUML JAR. No server, no network — just a persistent JVM pipe process.

## Features

- **Live preview** — updates 500ms after each keystroke
- **Pan and zoom** — scroll to zoom, drag to pan, double-click to reset
- **Search** — find text in the diagram, navigate matches, highlights update as you type
- **Export** — save the current diagram as SVG or PNG to the same directory as the source file

## Requirements

- Java (path configurable, defaults to `/usr/bin/java`)
- [PlantUML JAR](https://plantuml.com/download)
- [Graphviz](https://graphviz.org/download/) `dot` executable (for diagrams that require it)

## Setup

1. Download `plantuml.jar` from [plantuml.com/download](https://plantuml.com/download)
2. Open VSCode Settings and search for **PlantUML Renderer**
3. Set `plantumlRenderer.jarPath` to the absolute path of your `plantuml.jar`
4. Optionally adjust `plantumlRenderer.javaPath` and `plantumlRenderer.dotPath`

## Usage

Open a `.puml` or `.iuml` file and run **PlantUML: Open Preview** from the command palette (`Cmd+Shift+P`). The preview opens to the right and updates as you edit.

### Pan and zoom

| Action | Result |
|---|---|
| Scroll | Zoom in/out centred on cursor |
| Drag | Pan |
| Double-click | Reset to fit-width |

### Search

| Action | Result |
|---|---|
| `Cmd+F` / `Ctrl+F` or `⌕` in toolbar | Open search |
| Type | Highlight all matches (blue), active match (red) |
| `↓` / `Enter` | Next match |
| `↑` / `Shift+Enter` | Previous match |
| `Escape` or `✕` | Close search |

Matches are sorted top-to-bottom, left-to-right. The counter shows individual occurrences — a line with two matches counts as two.

### Export

Click **Export SVG** or **Export PNG** in the floating toolbar. Files are saved to the same directory as the source file with the same base name.

## Settings

| Setting | Default | Description |
|---|---|---|
| `plantumlRenderer.jarPath` | _(required)_ | Absolute path to `plantuml.jar` |
| `plantumlRenderer.javaPath` | `/usr/bin/java` | Path to the Java executable |
| `plantumlRenderer.dotPath` | `/opt/homebrew/bin/dot` | Path to the Graphviz `dot` executable |

## Building from source

```bash
npm install
node esbuild.config.mjs          # development build
node esbuild.config.mjs production  # production build
npx vsce package --no-dependencies  # package as .vsix
```
