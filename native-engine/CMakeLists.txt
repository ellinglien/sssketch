cmake_minimum_required(VERSION 3.22)
project(sssketch_engine VERSION 0.1.0 LANGUAGES C CXX)

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

# Was juce_add_console_app -- switched to juce_add_gui_app so this process
# gets full NSApplication/window-server integration on macOS, needed to host
# a real plugin editor window (see PluginChain::openEditorWindow). This is
# spawned silently by Electron as a background helper, never launched by the
# user directly -- LSUIElement=1 (via PLIST_TO_MERGE below) keeps it out of
# the Dock and Cmd+Tab switcher unless/until it actually opens an editor
# window. BUNDLE_ID is set explicitly since the default (derived from
# COMPANY_NAME, which this project never sets) would otherwise fall back to
# something generic.
juce_add_gui_app(sssketch_engine
  PRODUCT_NAME "sssketch-engine"
  BUNDLE_ID "com.ellinglien.sssketch-engine"
  PLIST_TO_MERGE "<key>LSUIElement</key><true/>"
)

# PRIVATE so this only applies to our own Source/*.cpp -- not JUCE's own
# (much larger, third-party) codebase, which would otherwise drown this out.
target_compile_options(sssketch_engine PRIVATE -Wall -Wextra)

target_sources(sssketch_engine PRIVATE
  Source/Main.cpp
  Source/PluginArchitecture.cpp
  Source/PluginScanning.cpp
  Source/SharedRingBuffer.cpp
  Source/SharedRingBufferTests.cpp
  Source/SharedAudioChannel.cpp
  Source/SharedAudioChannelTests.cpp
  Source/BridgeClient.cpp
  Source/PluginChain.cpp
  Source/PluginChainTests.cpp
  Source/ChannelChainRegistry.cpp
  Source/ChannelChainRegistryTests.cpp
  Source/SchedulePlayback.cpp
  Source/SchedulePlaybackTests.cpp
  Source/FadeGain.cpp
  Source/FadeGainTests.cpp
  Source/MuteRegionGain.h
  Source/MuteRegionGain.cpp
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
  Source/LoopRecorder.cpp
  Source/LoopRecorderTests.cpp
  Source/LiveParamOverrides.cpp
  Source/LiveParamOverridesTests.cpp
)

target_compile_definitions(sssketch_engine PRIVATE
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

target_link_libraries(sssketch_engine PRIVATE
  juce::juce_core
  juce::juce_recommended_config_flags
  juce::juce_audio_processors
  juce::juce_audio_basics
  juce::juce_audio_utils
)
