cmake_minimum_required(VERSION 3.22)
project(ssstitch_engine VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)
FetchContent_Declare(
  JUCE
  GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
  GIT_TAG        8.0.4
  GIT_SHALLOW    TRUE
)
FetchContent_MakeAvailable(JUCE)

juce_add_console_app(ssstitch_engine
  PRODUCT_NAME "ssstitch-engine"
)

target_sources(ssstitch_engine PRIVATE
  Source/Main.cpp
  Source/PluginScanner.cpp
  Source/PluginScannerTests.cpp
  Source/SchedulePlayback.cpp
  Source/SchedulePlaybackTests.cpp
  Source/FadeGain.cpp
  Source/FadeGainTests.cpp
  Source/EngineProject.cpp
  Source/EngineProjectTests.cpp
)

target_compile_definitions(ssstitch_engine PRIVATE
  JUCE_USE_CURL=0
  JUCE_WEB_BROWSER=0
  JUCE_PLUGINHOST_VST3=1
  JUCE_PLUGINHOST_AU=1
)

target_link_libraries(ssstitch_engine PRIVATE
  juce::juce_core
  juce::juce_recommended_config_flags
  juce::juce_audio_processors
  juce::juce_audio_basics
  juce::juce_audio_utils
)
