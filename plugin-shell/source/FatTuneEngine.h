#pragma once

#include <juce_audio_basics/juce_audio_basics.h>

class FatTuneEngine final
{
public:
  struct Settings
  {
    bool enabled = false;
    float amount = 0.0f;
    int key = 0;
    int scale = 0;
    int customMask = 0;
    int voiceType = 1;
  };

  struct Result
  {
    float left = 0.0f;
    float right = 0.0f;
  };

  struct Meters
  {
    float frequency = 0.0f;
    float cents = 0.0f;
    float confidence = 0.0f;
    float targetMidi = 0.0f;
  };

  static float retuneMillisecondsForAmount(float amount);

  void prepare(double sampleRate, int samplesPerBlock);
  void reset();
  Result processSample(float left, float right, const Settings& settings, bool forcePitchTracking);

  int getLatencySamples() const { return 0; }
  float getDetectedFrequency() const { return 0.0f; }
  float getDetectedClarity() const { return 0.0f; }
  Meters getMeters() const { return {}; }
};
