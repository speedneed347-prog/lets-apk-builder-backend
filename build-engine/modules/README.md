# Build Engine — Native Modules

A module is a directory with a root `module.json`.

Example:

```text
my-camera-module/
├── module.json
├── deps.gradle
├── manifest.xml
├── MyCamera.kt
├── layout/
├── drawable/
├── values/
└── assets/
```

`module-manager.js` provides the new local module contract:

```bash
node build-engine/modules/module-manager.js validate ./my-module
node build-engine/modules/module-manager.js list ./my-module
node build-engine/modules/module-manager.js install ./my-module ./android-project
```

The existing remote `scripts/install-custom-modules.js` remains supported for backward compatibility. Future workflow changes can route remote modules through this contract after their ZIP is downloaded.
