const {
  withProjectBuildGradle,
  withAppBuildGradle,
  createRunOncePlugin,
} = require('@expo/config-plugins');

const pkg = require('../package.json');

const MAVEN_URL = 'https://s3.amazonaws.com/synervoz-android-maven-repository';

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

// Only the Android Gradle wiring that Expo can't do on its own. Permissions ship
// in the library's AndroidManifest (auto-merged); set the iOS microphone string
// with the built-in `ios.infoPlist.NSMicrophoneUsageDescription`.
const withOpenAIRealtimeToolkit = (config) => {
  config = withSwitchboardMavenRepo(config);
  config = withPrefab(config);
  return config;
};

module.exports = createRunOncePlugin(
  withOpenAIRealtimeToolkit,
  pkg.name,
  pkg.version
);
