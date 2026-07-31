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
  Source/LoopSewing.cpp
  Source/LoopSewingTests.cpp
  Source/Metronome.cpp
  Source/MetronomeTests.cpp
  Source/LoopBoundaryFade.cpp
  Source/LoopBoundaryFadeTests.cpp
  Source/EngineProject.cpp
  Source/EngineProjectTests.cpp
  Source/StemBufferCache.cpp
  Source/StemBufferCacheTests.cpp
  Source/PlaybackEngine.cpp
  Source/PlaybackEngineTests.cpp
  Source/Transport.cpp
  Source/TransportTests.cpp
  Source/IpcServer.cpp
  Source/RenderExport.cpp
  Source/BakeStem.cpp
  Source/BakeStemTests.cpp
)

target_compile_definitions(ssstitch_engine PRIVATE
  JUCE_USE_CURL=0
  JUCE_WEB_BROWSER=0
  JUCE_PLUGINHOST_VST3=1
  JUCE_PLUGINHOST_AU=1
  # Enables MessageManager::runDispatchLoopUntil(). Needed by --serve's polling
  # loop in Main.cpp: MessageManager::runDispatchLoop() is backed by [NSApp run]
  # on macOS, which depends on a full Aqua/WindowServer session that a plain
  # console app spawned from a shell (e.g. a sandboxed CI/tool-execution
  # context) doesn't reliably have — it was observed returning immediately
  # instead of blocking. runDispatchLoopUntil() pumps the message loop for a
  # bounded time slice without relying on NSApplication's run-loop
  # integration, so it works the same headless or not.
  JUCE_MODAL_LOOPS_PERMITTED=1
)

target_link_libraries(ssstitch_engine PRIVATE
  juce::juce_core
  juce::juce_recommended_config_flags
  juce::juce_audio_processors
  juce::juce_audio_basics
  juce::juce_audio_utils
)
