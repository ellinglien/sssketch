cmake_minimum_required(VERSION 3.22)
project(ssstitch_engine VERSION 0.1.0 LANGUAGES CXX)

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
)

target_compile_definitions(ssstitch_engine PRIVATE
  JUCE_USE_CURL=0
  JUCE_WEB_BROWSER=0
)

target_link_libraries(ssstitch_engine PRIVATE
  juce::juce_core
  juce::juce_recommended_config_flags
)
