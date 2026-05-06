# OpenBox

The OpenBox extension for VS Code and Cursor.

## Install

Install the OpenBox CLI:

```sh
curl -fsSL https://raw.githubusercontent.com/OpenBox-AI/openbox-sdk/main/scripts/install | sh
```

Save an org API key for the active environment:

```sh
openbox auth set-api-key
```

Install the extension into VS Code, Cursor, or both:

```sh
openbox install extension
```

Restart VS Code or Cursor after install.

## Build from source

```sh
cd apps/extension
npm install
npm run build
npm run package
cursor --install-extension openbox-0.1.0.vsix
```

`code --install-extension openbox-0.1.0.vsix` works the same way for VS Code.
