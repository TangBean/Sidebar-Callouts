# Sidebar Callouts

An [Obsidian](https://obsidian.md) plugin that lists callouts in the active Markdown note and lets you jump to them from the sidebar. Requires Obsidian 1.7.2 or later.

## Use

1. Open a Markdown note containing callouts.
2. Select the **Open Sidebar Callouts** ribbon icon, or run **Open Sidebar Callouts** from the command palette.
3. Select a callout in the sidebar to scroll to its source line. You can also focus an entry and press **Enter** or **Space**.
4. Right-click a callout and select **Delete** to remove it from the note, including its body and nested content. Adjacent callouts are preserved.

Deleting a callout reduces the surrounding blank lines to one blank line between the remaining text. At the start or end of the note, it removes the surrounding blank lines; deleting the only callout leaves an empty note. In editing mode, deletion uses the editor and can be undone normally. If the note changes after the sidebar entry was rendered, the list refreshes so you can select the callout again.

The list refreshes when you edit the note or switch notes. Each entry shows its title, type, and line number. Common callout types and aliases have matching icons; custom types use a generic icon.

If a callout has no title, the entry uses its first non-empty quoted content line, then its type name if there is no content. The `collapsed` and `expanded` labels reflect the `-` and `+` markers in the note, not the current fold state in Obsidian.

## Current limits

- Callouts must start with a single blockquote marker, such as `> [!note] Title`. Nested callouts are not listed.
- Callout-shaped lines inside fenced code blocks are ignored.
- Titles are displayed as plain text; Markdown formatting is not rendered in the sidebar.

The plugin runs locally and offline. It reads the active note and edits the selected note when you choose **Delete**. It makes no network requests and collects no telemetry.

## Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/TangBean/Sidebar-Callouts/releases/latest).
2. Create `<Vault>/.obsidian/plugins/sidebar-callouts/` and copy all three files directly into it.
3. Reload Obsidian, then enable **Sidebar Callouts** in **Settings → Community plugins**.

To update, replace the same three files with those from the new release and reload Obsidian.

## Development

Use Node.js 24 and npm, matching the release workflow.

```sh
npm ci
npm run build
npm test
npm run lint
```

Use `npm run dev` for a watch build. In Windows PowerShell, use `npm.cmd` if execution policy prevents running `npm.ps1`.

The production build writes `main.js` at the repository root. Copy it together with `manifest.json` and `styles.css` into the plugin folder above for local testing. Do not commit generated files such as `main.js` or `node_modules/`.

See [RELEASE.md](RELEASE.md) for the release process.
