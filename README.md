# PlantUML Renderer

A VSCode extension that renders `.puml` and `.iuml` files into a live preview panel using a local PlantUML JAR or native binary. No server, no network — just a persistent PlantUML pipe process.

## Features

- **Live preview** — re-renders on every keystroke; while the source is mid-edit and broken, the last good diagram stays up and the error only appears if it persists for a second. Opens as a tab alongside an existing preview (e.g. Markdown's) instead of splitting off a new editor group
- **Syntax highlighting** — diagram tags, keywords, element types, arrows, preprocessor directives, procedures, variables, builtin functions, stereotypes, colours and skinparams; comment toggling and folding of `@start`/`@end`, `!if` and `!procedure` blocks
- **Autocomplete** — `!` directives, `@start`/`@end` tags, `%` builtin functions, `skinparam` names, `#` colours, `$` procedures (with parameter placeholders) and variables from the file and its includes, plus keywords, element types and declared names
- **Pan and zoom** — scroll to zoom, drag to pan, double-click to reset
- **Search** — find text in the diagram, navigate matches, highlights update as you type
- **Export** — save the current diagram as SVG or PNG to the same directory as the source file

## Installation

1. Download `vscode-plantuml-renderer-0.3.0.vsix` from the [latest release](https://github.com/stepheng/PlantUML-Renderer/releases/latest)
2. Install it:
   ```bash
   code --install-extension vscode-plantuml-renderer-0.3.0.vsix
   ```
   Or via the VSCode UI: Extensions panel (`Cmd+Shift+X`) → `···` menu → **Install from VSIX…**
3. Reload the window (`Cmd+Shift+P` → **Developer: Reload Window**)

## Requirements

- Either a native PlantUML binary (no Java needed), or Java plus the [PlantUML JAR](https://plantuml.com/download)
- [Graphviz](https://graphviz.org/download/) `dot` executable (for diagrams that require it)

## Setup

### Native binary (no Java)

1. Download `native-plantuml-<platform>-<version>.zip` from the [PlantUML releases](https://github.com/plantuml/plantuml/releases/latest) and unzip it
2. On macOS, if the archive came from a browser, clear the quarantine flag: `xattr -d com.apple.quarantine plantuml`
3. Open VSCode Settings and search for **PlantUML Renderer**
4. Set `plantumlRenderer.nativePath` to the absolute path of the `plantuml` executable
5. Optionally adjust `plantumlRenderer.dotPath`

### JAR

1. Download `plantuml.jar` from [plantuml.com/download](https://plantuml.com/download)
2. Open VSCode Settings and search for **PlantUML Renderer**
3. Set `plantumlRenderer.jarPath` to the absolute path of your `plantuml.jar`
4. Optionally adjust `plantumlRenderer.javaPath` and `plantumlRenderer.dotPath`

## Usage

Open a `.puml` or `.iuml` file and run **PlantUML Renderer: Open Preview** from the command palette (`Cmd+Shift+P`). The preview opens to the right and updates as you edit.

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
| `plantumlRenderer.nativePath` | _(empty)_ | Absolute path to a native PlantUML executable; when set, `javaPath` and `jarPath` are ignored |
| `plantumlRenderer.jarPath` | _(required unless `nativePath` is set)_ | Absolute path to `plantuml.jar` |
| `plantumlRenderer.javaPath` | `/usr/bin/java` | Path to the Java executable |
| `plantumlRenderer.dotPath` | `/opt/homebrew/bin/dot` | Path to the Graphviz `dot` executable |
| `plantumlRenderer.layoutEngine` | `graphviz` | `graphviz`, or `smetana` for PlantUML's built-in layout: no Graphviz needed and faster redraws, but layouts can differ |
| `plantumlRenderer.includeRoots` | `[]` | Additional absolute directories allowed for local `!include` files |

Local includes are limited to the open workspace folder (or the diagram's
directory when no workspace is open) and any explicitly configured include
roots. Symlinks cannot escape those roots. PlantUML runs with its `SANDBOX`
profile, which blocks it from loading other files or URLs. Add a shared
include directory to `includeRoots` when needed.

## Building from source

```bash
npm install
node esbuild.config.mjs          # development build
node esbuild.config.mjs production  # production build
npx vsce package --no-dependencies  # package as .vsix
```
