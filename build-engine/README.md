# Build Engine

The build engine owns Android project generation, native module loading, and Gradle builds.

## Gradle targets

```bash
node build-engine/gradle-builder.js debug-apk
node build-engine/gradle-builder.js release-apk
node build-engine/gradle-builder.js release-aab
```

The builder uses `GRADLE_BIN` when supplied, otherwise `gradle` from PATH.

The GitHub Actions workflow uses the release APK target, preserving the existing APK pipeline.


## Unified release pipeline

Set `buildFormat` to `apk` or `aab` in the build config. The unified pipeline selects the matching Gradle task, signs the artifact, computes SHA-256, and writes a result record.

```bash
node build-engine/build-pipeline.js config.json android-project . build-result.json
```
