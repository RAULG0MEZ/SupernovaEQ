#include "FatTuneEngine.h"

#include <cmath>

float FatTuneEngine::retuneMillisecondsForAmount(float amount)
{
  const auto clampedAmount = juce::jlimit(0.0f, 1.0f, amount);
  constexpr auto fastestRetuneMs = 0.0f;
  constexpr auto slowestRetuneMs = 400.0f;
  return fastestRetuneMs + std::pow(1.0f - clampedAmount, 2.65f) * (slowestRetuneMs - fastestRetuneMs);
}

void FatTuneEngine::prepare(double sampleRate, int samplesPerBlock)
{
  juce::ignoreUnused(sampleRate, samplesPerBlock);
}

void FatTuneEngine::reset()
{
}

FatTuneEngine::Result FatTuneEngine::processSample(float left, float right, const Settings& settings,
                                                   bool forcePitchTracking)
{
  juce::ignoreUnused(settings, forcePitchTracking);
  return { left, right };
}
