# Release guide

Releases for `TangBean/Sidebar-Callouts` use a tag that exactly matches the plugin version, without a leading `v`. The tag workflow creates a draft containing `main.js`, `manifest.json`, and `styles.css`.

Use Node.js 24 and npm. The commands below use PowerShell; use `npm.cmd` if execution policy blocks `npm.ps1`. Run `gh` in your authenticated user session. Run commands one at a time and stop on any error.

## Prepare the version

Work on `main` and review the working tree for unrelated changes. For a new patch release, update `minAppVersion` in `manifest.json` first if needed, then run:

```powershell
npm version patch --no-git-tag-version
```

Use `minor` or `major` when appropriate. For the first release of an already prepared version, keep that version instead of incrementing it again.

Verify that these files agree:

- `package.json`: `version`.
- `package-lock.json`: the top-level `version` and `packages[""].version`.
- `manifest.json`: `version`, with the stable ID `sidebar-callouts` and the required `minAppVersion`.
- `versions.json`: an entry mapping the release version to `manifest.json`'s `minAppVersion`.

The npm `version` hook updates the manifest and adds a missing versions entry. It also stages `manifest.json` and `versions.json`; review those staged changes. If an entry already exists in `versions.json`, verify its minimum app version manually.

## Build and commit

```powershell
npm ci
npm run build
npm run lint
git status --short --branch
git diff
git diff --cached
```

For a manual smoke test in Obsidian, follow the installation instructions in [README.md](README.md) and check opening the sidebar, switching notes, and jumping to a callout. Record whether this check was performed.

Stage reviewed source, documentation, workflow, and version files by explicit path. Do not use `git add .`, and do not stage `main.js`, `node_modules/`, or other generated files. For the version files:

```powershell
git add -- package.json package-lock.json manifest.json versions.json
git diff --cached
$version = (Get-Content -Raw manifest.json | ConvertFrom-Json).version
git commit -m "chore(release): prepare $version"
```

Confirm that the working tree is clean and that the version has no existing tag or release.

## Push the commit and tag

```powershell
$releaseCommit = git rev-parse HEAD
git push origin main
git tag -a $version -m $version
git push origin "refs/tags/$version"
```

Push only `main` and this release tag; do not use `--tags`.

## Verify the draft and publish

Wait for the run triggered by this tag in [Release Obsidian plugin](https://github.com/TangBean/Sidebar-Callouts/actions/workflows/release.yml) to finish successfully. The workflow checks version consistency, installs locked dependencies, builds, lints, and creates the draft. Do not publish while the workflow is running.

Verify that the remote annotated tag resolves to `$releaseCommit`:

```powershell
git ls-remote origin "refs/tags/$version^{}"
gh release view $version --repo TangBean/Sidebar-Callouts --json tagName,isDraft,isPrerelease,url
gh release view $version --repo TangBean/Sidebar-Callouts --json assets --jq '.assets[].name'
```

Confirm the tag matches `$version`, the release is a draft and is not a prerelease, and its assets are exactly `main.js`, `manifest.json`, and `styles.css`. Add and review release notes in the draft.

Compare all three uploaded files against files built from the exact tagged commit with `npm ci` and Node.js 24. Use LF source line endings, matching the Linux workflow; Windows checkout line-ending conversion can otherwise change file hashes. Keep the local build at that commit while running:

```powershell
$releaseDir = Join-Path ([System.IO.Path]::GetTempPath()) "sidebar-callouts-$version-$([guid]::NewGuid().ToString('N'))"
gh release download $version --repo TangBean/Sidebar-Callouts --dir $releaseDir --pattern main.js --pattern manifest.json --pattern styles.css

foreach ($asset in 'main.js', 'manifest.json', 'styles.css') {
    $expected = (Get-FileHash -LiteralPath $asset -Algorithm SHA256 -ErrorAction Stop).Hash
    $actual = (Get-FileHash -LiteralPath (Join-Path $releaseDir $asset) -Algorithm SHA256 -ErrorAction Stop).Hash
    if ($expected -ne $actual) { throw "SHA256 mismatch: $asset" }
    Write-Output "$asset SHA256: $actual"
}
```

Publish only after the commit, notes, asset names, and all three hashes are verified:

```powershell
gh release edit $version --repo TangBean/Sidebar-Callouts --draft=false --latest
gh release view $version --repo TangBean/Sidebar-Callouts --json tagName,isDraft,isPrerelease,url
```

Confirm the release is public and marked **Latest** on the [releases page](https://github.com/TangBean/Sidebar-Callouts/releases). This process does not include submitting the fork to the Obsidian community catalog.
