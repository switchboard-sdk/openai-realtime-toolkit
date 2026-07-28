const {
  withProjectBuildGradle,
  withAppBuildGradle,
  createRunOncePlugin,
} = require('@expo/config-plugins');

const pkg = require('../package.json');

const MAVEN_URL = 'https://s3.amazonaws.com/synervoz-android-maven-repository';

// The Switchboard native libraries reference __cxa_init_primary_exception, which
// only NDK 29's libc++_shared.so exports. An app packages exactly one
// libc++_shared.so — its own NDK's — so on the RN/Expo template default (27.x)
// the app builds and installs but dies at launch with `dlopen failed: cannot
// locate symbol "__cxa_init_primary_exception" referenced by libSwitchboardSDK.so`.
const MIN_NDK_VERSION = '29.0.14206865';

// Declare the Switchboard Maven repo from the app's own root build.gradle so it
// is registered during root configuration — before :app resolves its classpath.
// The library's build.gradle also injects it, but under Expo autolinking that
// runs too late; this is the reliable path for prebuild.
function withSwitchboardMavenRepo(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') return cfg;
    if (cfg.modResults.contents.includes(MAVEN_URL)) return cfg;
    cfg.modResults.contents +=
      `\nallprojects { repositories { maven { url "${MAVEN_URL}" } } }\n`;
    return cfg;
  });
}

// Prefab must be enabled in the app module — that is where RN's C++ autolinking
// compiles our CMakeLists and find_package()s the Switchboard AARs. There is no
// first-party Expo knob for this, so the plugin sets it directly.
function withPrefab(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') return cfg;
    if (/buildFeatures\s*\{[^}]*prefab\s+true/.test(cfg.modResults.contents)) {
      return cfg;
    }
    cfg.modResults.contents += `\nandroid { buildFeatures { prefab true } }\n`;
    return cfg;
  });
}

// Raise the app's ndkVersion (see MIN_NDK_VERSION above for why). Expo has no
// first-party knob for this — expo-build-properties exposes min/compile/targetSdk,
// buildTools, cmake and kotlin versions, but not the NDK — so the plugin edits
// `buildscript { ext { ndkVersion = … } }` in the app's root build.gradle, where
// both the RN and Expo templates declare it. An app already on a newer major is
// left alone.
function withNdkVersion(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') return cfg;

    const declaration = /(ndkVersion\s*=\s*)(["'])([\d.]+)\2/;
    const match = cfg.modResults.contents.match(declaration);

    if (!match) {
      // Nothing to patch — the Expo SDK 57 template declares no ndkVersion. The block
      // has to be INSERTED BEFORE `apply plugin: "expo-root-project"`, not appended:
      // expo-root-project defaults ndkVersion to 27.1.12297006 via setIfNotExist, so we
      // only win by getting there first, and :app is configured *before* the root
      // build.gradle body finishes, so a trailing statement is read too late however it
      // is written (`ext { … }`, `ext.ndkVersion = …` and `rootProject.ext.set(…)` all
      // lose). It can't be prepended to the file either — Gradle wants buildscript {}
      // first — so anchor on the first plugin application.
      const block = `ext { ndkVersion = "${MIN_NDK_VERSION}" }\n\n`;
      const anchor = cfg.modResults.contents.indexOf('apply plugin:');
      if (anchor === -1) {
        // No anchor (non-standard template): append and let the [ExpoRootProject]
        // banner printed by every Android build reveal whether it took effect.
        cfg.modResults.contents += `\n${block}`;
        return cfg;
      }
      cfg.modResults.contents =
        cfg.modResults.contents.slice(0, anchor) +
        block +
        cfg.modResults.contents.slice(anchor);
      return cfg;
    }

    if (parseInt(match[3], 10) >= parseInt(MIN_NDK_VERSION, 10)) return cfg;

    cfg.modResults.contents = cfg.modResults.contents.replace(
      declaration,
      `$1$2${MIN_NDK_VERSION}$2`
    );
    return cfg;
  });
}

// Only the Android Gradle wiring that Expo can't do on its own. Permissions ship
// in the library's AndroidManifest (auto-merged); set the iOS microphone string
// with the built-in `ios.infoPlist.NSMicrophoneUsageDescription`.
const withOpenAIRealtimeToolkit = (config) => {
  config = withSwitchboardMavenRepo(config);
  config = withPrefab(config);
  config = withNdkVersion(config);
  return config;
};

module.exports = createRunOncePlugin(
  withOpenAIRealtimeToolkit,
  pkg.name,
  pkg.version
);
