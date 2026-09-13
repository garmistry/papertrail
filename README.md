# Papertrail

Papertrail is a macOS Markdown editor with a live preview, clickable document outline, highlighted code blocks, light/dark themes, recent files, full-text search, virtual file categories that never move documents, and support for Markdown, text, and JSON files.

## Code structure

See [the architecture guide](docs/architecture.md) for process boundaries, module responsibilities, and extension points.

## Run it locally

```sh
npm install
npm start
```

## Sequence diagrams

Fence WebSequenceDiagrams source with `wsd` to render it in the preview. Expand **Edit diagram source** beneath the diagram to edit it without leaving the preview.

````markdown
```wsd
Client->Server: Request
Server-->Client: Response
```
````

Rendering uses websequencediagrams.com and requires a network connection.

## Make an installable macOS build

```sh
npm run package
```

This produces separate, smaller Apple-silicon (`arm64`) and Intel (`x64`) macOS installers in `dist/`. Choose the installer that matches the destination Mac, drag Papertrail to Applications, and use **Open** from Finder the first time because the local build is unsigned.

## Verify

```sh
npm test
npm run package
```
