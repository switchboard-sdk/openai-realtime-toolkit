const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * The OpenAIRealtimeToolkit library is symlinked in (../, via `file:..`), which lives
 * outside this project folder. Metro needs the repo root in `watchFolders` to
 * serve the library's source — and react / react-native must resolve from THIS
 * app's node_modules (the repo root has its own copies that would otherwise
 * collide in the Haste map).
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const root = path.resolve(__dirname, '..');

// Singletons that must resolve from the example, not the library root.
const shared = ['react', 'react-native'];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const config = {
  watchFolders: [root],
  resolver: {
    // Hide the library root's copies of the shared singletons from Metro.
    blockList: new RegExp(
      shared
        .map((m) => `^${escape(path.join(root, 'node_modules', m))}\\/.*$`)
        .join('|'),
    ),
    extraNodeModules: shared.reduce((acc, name) => {
      acc[name] = path.join(__dirname, 'node_modules', name);
      return acc;
    }, {}),
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
