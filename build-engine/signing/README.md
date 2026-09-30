# Signing Engine

Step 6 extracts APK signing from the GitHub Actions workflow into a reusable build-engine component.

## APK signing

```bash
node build-engine/signing/signing-manager.js apk <unsigned.apk> <signed.apk>
```

Required environment variables:

- `KEYSTORE_BASE64`
- `KEYSTORE_PASSWORD`
- `KEY_PASSWORD`
- `KEY_ALIAS`

Optional:

- `ANDROID_HOME` / `ANDROID_SDK_ROOT`
- `ANDROID_BUILD_TOOLS_VERSION`
- `ANDROID_BUILD_TOOLS_DIR`
- `SIGNING_TIMEOUT_MS`

The engine:

1. Validates signing configuration.
2. Decodes the base64 keystore into a temporary `0600` file.
3. Uses `zipalign`.
4. Uses `apksigner` with password files so passwords are not placed directly in command arguments.
5. Verifies the signed APK.
6. Prints SHA-256 and output metadata.
7. Removes the temporary keystore, password files and aligned intermediate APK.
8. Removes a partially-created output APK if signing fails.

Secrets are never intentionally logged by the engine.


## AAB signing

AAB output is signed with the Java `jarsigner` tool using the same keystore secrets. APK output uses `zipalign` + `apksigner`.

```bash
node build-engine/signing/signing-manager.js aab unsigned.aab signed.aab
```
