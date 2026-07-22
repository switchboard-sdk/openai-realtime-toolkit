// React Native autolinking configuration.
//
// OpenAIRealtimeToolkit is a pure C++ TurboModule. On Android it is registered via RN's C++
// autolinking: the app's native build compiles android/CMakeLists.txt (target
// `react-native-openairealtimetoolkit`) and its generated autolinking provider constructs
// `facebook::react::NativeOpenAIRealtimeToolkit` from cpp/NativeOpenAIRealtimeToolkit.h. On iOS the
// module is provided through the podspec + codegenConfig.ios.modulesProvider.
module.exports = {
  dependency: {
    platforms: {
      android: {
        // Paths here are resolved by RN autolinking relative to the android/
        // source dir, so this is 'CMakeLists.txt' (which lives in android/), not
        // 'android/CMakeLists.txt' — the latter resolves to android/android/… .
        cxxModuleCMakeListsModuleName: 'react-native-openairealtimetoolkit',
        cxxModuleCMakeListsPath: 'CMakeLists.txt',
        cxxModuleHeaderName: 'NativeOpenAIRealtimeToolkit',
      },
      ios: {
        podspecPath: __dirname + '/OpenAIRealtimeToolkit.podspec',
      },
    },
  },
};
