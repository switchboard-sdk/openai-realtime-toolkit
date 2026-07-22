const reactNativeConfig = require('@react-native/eslint-config/flat')
const prettierConfig = require('eslint-config-prettier')

const sourceFiles = ['src/**/*.{js,jsx,ts,tsx}']

// ft-flow (Flow types plugin) is incompatible with ESLint 9 and not needed in a TypeScript project.
const filteredReactNativeConfig = reactNativeConfig.filter(
  (config) => !config.plugins?.['ft-flow'],
)

module.exports = [
  { ignores: ['dist/**', 'node_modules/**', 'example/**'] },
  ...filteredReactNativeConfig.map((config) => ({ ...config, files: sourceFiles })),
  prettierConfig,
]
