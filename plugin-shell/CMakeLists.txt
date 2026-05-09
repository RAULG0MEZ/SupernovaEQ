cmake_minimum_required(VERSION 3.21)
project(SupernovaEQ VERSION 0.1.0)

if(NOT DEFINED JUCE_DIR)
  message(FATAL_ERROR "Set JUCE_DIR to your local JUCE checkout before configuring this target.")
endif()

add_subdirectory(${JUCE_DIR} JUCE)

juce_add_plugin(SupernovaEQ
  COMPANY_NAME "Supernova"
  BUNDLE_ID com.supernova.eq
  IS_SYNTH FALSE
  NEEDS_MIDI_INPUT FALSE
  NEEDS_MIDI_OUTPUT FALSE
  IS_MIDI_EFFECT FALSE
  EDITOR_WANTS_KEYBOARD_FOCUS FALSE
  COPY_PLUGIN_AFTER_BUILD TRUE
  PLUGIN_MANUFACTURER_CODE SNvA
  PLUGIN_CODE SEq1
  # VST3 and AU are the production targets. Legacy VST2 requires Steinberg's
  # discontinued VST2 SDK/license and is intentionally not enabled by default.
  FORMATS AU VST3 Standalone
  PRODUCT_NAME "Supernova EQ"
)

file(GLOB_RECURSE SUPERNOVA_EQ_WEB_ASSETS
  CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_LIST_DIR}/../dist/*"
)

juce_add_binary_data(SupernovaEQWebAssets
  SOURCES
    ${SUPERNOVA_EQ_WEB_ASSETS}
)

target_sources(SupernovaEQ
  PRIVATE
    source/FatTuneEngine.cpp
    source/FatTuneEngine.h
    source/PluginEditor.cpp
    source/PluginEditor.h
    source/PluginProcessor.cpp
    source/PluginProcessor.h
)

target_compile_features(SupernovaEQ PRIVATE cxx_std_20)

target_compile_definitions(SupernovaEQ
  PUBLIC
    JUCE_VST3_CAN_REPLACE_VST2=0
)

target_link_libraries(SupernovaEQ
  PRIVATE
    juce::juce_audio_utils
    juce::juce_dsp
    juce::juce_gui_basics
    juce::juce_gui_extra
    SupernovaEQWebAssets
  PUBLIC
    juce::juce_recommended_config_flags
    juce::juce_recommended_lto_flags
    juce::juce_recommended_warning_flags
)
