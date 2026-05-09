#pragma once

#include "PluginProcessor.h"

#include <cstdint>

#include <juce_gui_extra/juce_gui_extra.h>

class VoxanovaAudioProcessorEditor final : public juce::AudioProcessorEditor,
                                           private juce::Timer
{
public:
  explicit VoxanovaAudioProcessorEditor(VoxanovaAudioProcessor&);
  ~VoxanovaAudioProcessorEditor() override = default;

  void paint(juce::Graphics&) override;
  void resized() override;

private:
  void timerCallback() override;
  void drainQueuedParameterChanges();
  void applyQueuedParameterChanges(const juce::String& json);
  std::optional<juce::WebBrowserComponent::Resource> provideResource(const juce::String& path);
  void setParameterFromNativeEvent(const juce::var& payload);
  void setEditorSizeFromNativeEvent(const juce::var& payload);
  bool setParameterFromRequest(const juce::String& parameterId, float value);
  void setEditorSizeFromRequest(float requestedScale, int requestedWidth, int requestedHeight);

  VoxanovaAudioProcessor& audioProcessor;
  juce::WebBrowserComponent webView;
  bool parameterDrainPending = false;
  std::uint64_t lastMeterProcessCounter = 0;
  int staleMeterTicks = 0;
};
