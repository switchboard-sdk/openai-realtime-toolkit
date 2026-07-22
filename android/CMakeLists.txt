# Android native build for the OpenAIRealtimeToolkit C++ TurboModule.
#
# This file is pulled into the consuming app's native build by RN autolinking
# (react-native.config.js → android.cxxModuleCMakeListsPath). It compiles the
# shared C++ (../cpp) and links it against the codegen-generated spec and the
# Switchboard SDK + extensions (resolved via Prefab from the AAR dependencies).
cmake_minimum_required(VERSION 3.13)
project(OpenAIRealtimeToolkit)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(OPENAIREALTIMETOOLKIT_CPP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../cpp")

# Module name must match react-native.config.js `cxxModuleCMakeListsModuleName`.
add_library(react-native-openairealtimetoolkit SHARED
    "${OPENAIREALTIMETOOLKIT_CPP_DIR}/NativeOpenAIRealtimeToolkit.cpp"
)

target_include_directories(react-native-openairealtimetoolkit PUBLIC "${OPENAIREALTIMETOOLKIT_CPP_DIR}")

# Switchboard SDK + extensions via Prefab. The AAR Prefab package names are
# SwitchboardSDK / SwitchboardSileroVAD / SwitchboardOnnx / SwitchboardOpenAI /
# SwitchboardSmartTurn.
find_package(SwitchboardSDK REQUIRED CONFIG)
find_package(SwitchboardSileroVAD REQUIRED CONFIG)
find_package(SwitchboardOnnx REQUIRED CONFIG)
find_package(SwitchboardOpenAI REQUIRED CONFIG)
find_package(SwitchboardSmartTurn REQUIRED CONFIG)

target_link_libraries(react-native-openairealtimetoolkit
    # Codegen-generated spec (RNOpenAIRealtimeToolkitSpecJSI.h) — provides jsi/TurboModule.
    react_codegen_RNOpenAIRealtimeToolkitSpec
    SwitchboardSDK::SwitchboardSDK
    SwitchboardSileroVAD::SwitchboardSileroVAD
    SwitchboardOnnx::SwitchboardOnnx
    SwitchboardOpenAI::SwitchboardOpenAI
    SwitchboardSmartTurn::SwitchboardSmartTurn
)
