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

# Ableton Link -- header-only, cross-app tempo/beat sync (see LinkSession.h).
# Consumed the lightweight way: only its own AbletonLinkConfig.cmake is
# included (defines the Ableton::Link IMPORTED INTERFACE target, pulling in
# its own asio-standalone submodule dependency too), NOT add_subdirectory()
# on the whole repo -- that would also build Link's own example apps/test
# suite (a separate Catch2-based harness this project has no use for), pure
# overhead we don't want. Pinned to the Link-4.0 tag (not a moving branch)
# for reproducible builds. GIT_SUBMODULES fetches exactly the one submodule
# ConfigureAsioStandalone.cmake actually needs (modules/asio-standalone,
# a header-only vendored copy of chriskohlhoff/asio -- NOT Boost.Asio),
# rather than recursing into every submodule the full repo declares.
FetchContent_Declare(
  ableton_link
  GIT_REPOSITORY https://github.com/Ableton/link.git
  GIT_TAG        Link-4.0
  GIT_SUBMODULES modules/asio-standalone
  GIT_SHALLOW    TRUE
)
# FetchContent_Populate (the declared-details form used here, not the
# deprecated single-call form) is CMake's only way to fetch a dependency's
# source WITHOUT also add_subdirectory()-ing it -- exactly what's wanted
# above. CMake >=3.30 warns this spelling is deprecated in favor of a
# newer EXCLUDE_FROM_ALL-based pattern that isn't available until CMake
# 3.28+; this project's own cmake_minimum_required is still 3.22 (see top
# of this file), so pin policy CMP0169 to OLD explicitly here rather than
# bump the whole project's minimum version just for this. Revisit once the
# minimum is raised past 3.28.
if(POLICY CMP0169)
  cmake_policy(SET CMP0169 OLD)
endif()
FetchContent_Populate(ableton_link)
include(${ableton_link_SOURCE_DIR}/AbletonLinkConfig.cmake)

# Was juce_add_console_app -- switched to juce_add_gui_app so this process
# gets full NSApplication/window-server integration on macOS, needed to host
# a real plugin editor window (see PluginChain::openEditorWindow). This is
# spawned silently by Electron as a background helper, never launched by the
# user directly -- LSUIElement=1 (via PLIST_TO_MERGE below) keeps it out of
# the Dock and Cmd+Tab switcher unless/until it actually opens an editor
# window. BUNDLE_ID is set explicitly since the default (derived from
# COMPANY_NAME, which this project never sets) would otherwise fall back to
# something generic.
#
# MICROPHONE_PERMISSION_ENABLED/_TEXT inject NSMicrophoneUsageDescription
# into THIS bundle's own Info.plist -- this .app is a separately signed
# bundle with its own CFBundleIdentifier (com.ellinglien.sssketch-engine,
# distinct from the main Electron app's), and it's this process, not the
# Electron one, that actually opens the CoreAudio input device (Transport.cpp).
# electron-builder.yml's own NSMicrophoneUsageDescription (extendInfo) only
# ever reaches the MAIN app's Info.plist -- macOS TCC treats this bundle as
# its own separate responsible process for hardware access, so without this
# key here too, the packaged/signed engine can never be authorized: found via
# real recording-produces-silence testing on a signed, notarized build (never
# reproduced in unsigned `npm run dev`, where this distinction doesn't
# apply) -- CoreAudio's HAL-level input API doesn't hard-fail when TCC denies
# it like AVFoundation capture does, it just silently hands back zeroed
# samples, which is exactly what a real recording test showed: arm/disarm
# succeeded with no error, but the captured file was silent throughout.
juce_add_gui_app(sssketch_engine
  PRODUCT_NAME "sssketch-engine"
  BUNDLE_ID "com.ellinglien.sssketch-engine"
  PLIST_TO_MERGE "<key>LSUIElement</key><true/>"
  MICROPHONE_PERMISSION_ENABLED TRUE
  MICROPHONE_PERMISSION_TEXT "sssketch needs microphone access to record audio into your project."
)

# PRIVATE so this only applies to our own Source/*.cpp -- not JUCE's own
# (much larger, third-party) codebase, which would otherwise drown this out.
target_compile_options(sssketch_engine PRIVATE -Wall -Wextra)

# zita-rev1, vendored verbatim from https://github.com/PelleJuul/zita-rev1
# (Fons Adriaensen's FDN reverb; GPL-3-or-later, same as this repo's own
# LICENSE) -- see Source/dsp/zita-rev1/VENDORED.md for provenance and for
# why reverb.h's own two dependencies (pareq.h/global.h) are vendored
# alongside the two files the design doc names. Compiled with -w so the
# project's own -Wall -Wextra (deliberately scoped to sssketch's code, see
# target_compile_options above) doesn't spray warnings about third-party
# code we refuse to modify -- the file-level option is appended after the
# target-level ones, so -w wins. Listed here, in its own set_source_files_
# properties call, rather than buried in the main target_sources list below.
set(SSSKETCH_VENDORED_SOURCES
  Source/dsp/zita-rev1/reverb.cpp
  Source/dsp/zita-rev1/pareq.cpp
)
set_source_files_properties(${SSSKETCH_VENDORED_SOURCES} PROPERTIES COMPILE_OPTIONS "-w")
target_sources(sssketch_engine PRIVATE ${SSSKETCH_VENDORED_SOURCES})

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
  Source/GatedLoopRecorder.cpp
  Source/GatedLoopRecorderTests.cpp
  Source/LinkSession.cpp
  Source/LinkSessionTests.cpp
  Source/LiveParamOverrides.cpp
  Source/LiveParamOverridesTests.cpp
  Source/AutomationCurve.cpp
  Source/AutomationCurveTests.cpp
  Source/ChannelFilter.cpp
  Source/ChannelFilterTests.cpp
  Source/ReverbBus.cpp
  Source/ReverbBusTests.cpp
  Source/NoiseRiser.cpp
  Source/NoiseRiserTests.cpp
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
  # Added for dsp::StateVariableTPTFilter, the per-channel filter behind the
  # built-in sound toolkit (ChannelFilter.h) -- part of JUCE itself, so this
  # is a link-line addition, not a new third-party dependency. See
  # docs/superpowers/specs/2026-09-22-builtin-sound-toolkit-design.md.
  juce::juce_dsp
  Ableton::Link
)
