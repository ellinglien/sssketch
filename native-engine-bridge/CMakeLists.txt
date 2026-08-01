cmake_minimum_required(VERSION 3.22)
project(sssketch_bridge VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# The one thing that actually makes this the "bridge": compiled x86_64-only,
# so macOS launches it under Rosetta 2 automatically -- no `arch -x86_64`
# wrapper, no special spawn handling. See
# docs/superpowers/specs/2026-08-01-x86-plugin-bridge-design.md.
set(CMAKE_OSX_ARCHITECTURES "x86_64")

include(FetchContent)
FetchContent_Declare(
  JUCE
  GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
  GIT_TAG        8.0.4
  GIT_SHALLOW    TRUE
)
FetchContent_MakeAvailable(JUCE)

# LSUIElement keeps this out of the Dock/Cmd+Tab -- same reasoning as
# native-engine/CMakeLists.txt's own main engine target: a background helper
# the main engine spawns, never launched by the user directly.
juce_add_gui_app(sssketch_bridge
  PRODUCT_NAME "sssketch-bridge"
  BUNDLE_ID "com.ellinglien.sssketch-bridge"
  PLIST_TO_MERGE "<key>LSUIElement</key><true/>"
)

target_sources(sssketch_bridge PRIVATE
  Source/Main.cpp
  Source/BridgeIpcServer.cpp
  ../native-engine/Source/SharedRingBuffer.cpp
  ../native-engine/Source/SharedAudioChannel.cpp
  ../native-engine/Source/PluginArchitecture.cpp
  ../native-engine/Source/PluginScanning.cpp
)

target_include_directories(sssketch_bridge PRIVATE ../native-engine/Source)

target_compile_definitions(sssketch_bridge PRIVATE
  JUCE_USE_CURL=0
  JUCE_WEB_BROWSER=0
  JUCE_PLUGINHOST_VST3=1
  JUCE_PLUGINHOST_AU=1
  JUCE_MODAL_LOOPS_PERMITTED=1
)

target_link_libraries(sssketch_bridge PRIVATE
  juce::juce_core
  juce::juce_recommended_config_flags
  juce::juce_audio_processors
  juce::juce_audio_basics
  juce::juce_audio_utils
  juce::juce_gui_basics
)
