#include "PluginProcessor.h"
#include "PluginEditor.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace
{
constexpr auto inputGainId = "inputGain";
constexpr auto outputGainId = "outputGain";
constexpr auto gateThresholdId = "gateThreshold";
constexpr auto stereoWidthId = "stereoWidth";
constexpr auto stereoLowBypassId = "stereoLowBypass";
constexpr auto saturationModeId = "saturationMode";
constexpr auto saturationAmountId = "saturationAmount";
constexpr auto tuneEnabledId = "tuneEnabled";
constexpr auto tuneAmountId = "tuneAmount";
constexpr auto tuneKeyId = "tuneKey";
constexpr auto tuneScaleId = "tuneScale";
constexpr auto tuneCustomNotesId = "tuneCustomNotes";
constexpr auto tuneVoiceTypeId = "tuneVoiceType";
constexpr auto peakEnabledId = "peakEnabled";
constexpr auto peakThresholdId = "peakThreshold";
constexpr auto glueEnabledId = "glueEnabled";
constexpr auto glueMultibandId = "glueMultiband";
constexpr auto glueThresholdId = "glueThreshold";
constexpr auto glueLowThresholdId = "glueLowThreshold";
constexpr auto glueLowMidThresholdId = "glueLowMidThreshold";
constexpr auto glueHighMidThresholdId = "glueHighMidThreshold";
constexpr auto glueAirThresholdId = "glueAirThreshold";
constexpr auto faceEnabledId = "faceEnabled";
constexpr auto faceThresholdId = "faceThreshold";
constexpr auto gateEnabledId = "gateEnabled";
constexpr auto deEsserEnabledId = "deEsserEnabled";
constexpr auto deEsserAmountId = "deEsserAmount";
constexpr auto deEsserLowId = "deEsserLow";
constexpr auto deEsserHighId = "deEsserHigh";
constexpr auto stereoEnabledId = "stereoEnabled";
constexpr auto reverbEnabledId = "reverbEnabled";
constexpr auto reverbMixId = "reverbMix";
constexpr auto reverbDecayId = "reverbDecay";
constexpr auto reverbSizeId = "reverbSize";
constexpr auto reverbPredelayId = "reverbPredelay";
constexpr auto reverbLowCutId = "reverbLowCut";
constexpr auto reverbHighCutId = "reverbHighCut";
constexpr auto reverbModeId = "reverbMode";
constexpr auto reverbSyncId = "reverbSync";
constexpr auto reverbNoteModeId = "reverbNoteMode";
constexpr auto reverbDecaySyncId = "reverbDecaySync";
constexpr auto reverbPredelaySyncId = "reverbPredelaySync";
constexpr auto reverbDecayDivisionId = "reverbDecayDivision";
constexpr auto reverbPredelayDivisionId = "reverbPredelayDivision";
constexpr auto delayEnabledId = "delayEnabled";
constexpr auto delayMixId = "delayMix";
constexpr auto delayFeedbackId = "delayFeedback";
constexpr auto delayLowCutId = "delayLowCut";
constexpr auto delayHighCutId = "delayHighCut";
constexpr auto delaySyncId = "delaySync";
constexpr auto delayDivisionId = "delayDivision";
constexpr auto delayNoteModeId = "delayNoteMode";
constexpr auto delayTimeMsId = "delayTimeMs";
constexpr auto delayModeId = "delayMode";
constexpr auto delayPostReverbId = "delayPostReverb";
constexpr auto delayStyleId = "delayStyle";
constexpr auto delayAuxBusId = "delayAuxBus";
constexpr auto reverbAuxBusId = "reverbAuxBus";
constexpr auto compressorMinDb = -60.0f;
constexpr auto compressorMaxDb = 0.0f;
constexpr auto eqDynamicDetectorCalibrationDb = 12.0f;
constexpr auto spectrumMinFrequency = 10.0f;
constexpr auto fullSpectrumType = 9;
constexpr auto fullSpectrumMinRatio = 1.015f;
[[maybe_unused]] constexpr std::array<const char*, 10> eqFilterTypeLabels {
  "Bell", "Surfer Bell", "Desser", "Low Cut", "High Cut", "Low Shelf", "High Shelf", "Notch", "Band Pass",
  "Full Spectrum"
};
std::array<float, 2> getSurferTrackingWindow(float anchorFrequency, float maxFrequency)
{
  const auto anchor = juce::jlimit(20.0f, maxFrequency, anchorFrequency);
  return {
    juce::jlimit(20.0f, maxFrequency, anchor * 0.5f),
    juce::jlimit(20.0f, maxFrequency, anchor * 1.5f)
  };
}
juce::String dbLabel(float value, int)
{
  return juce::String(value, 1) + " dB";
}

juce::String percentLabel(float value, int)
{
  return juce::String(value, 0) + "%";
}

juce::String saturationModeLabel(float value, int)
{
  constexpr std::array<const char*, 4> labels { "Off", "1073", "Tape", "Tube" };
  return labels[static_cast<size_t>(juce::jlimit(0, 3, juce::roundToInt(value)))];
}

float thresholdEngagement(float levelDb, float thresholdDb, float kneeDb)
{
  if (kneeDb <= 0.0f)
    return levelDb > thresholdDb ? 1.0f : 0.0f;

  const auto transition = juce::jlimit(0.0f, 1.0f, (levelDb - thresholdDb + kneeDb * 0.5f) / kneeDb);
  return transition * transition * (3.0f - 2.0f * transition);
}

} // namespace

VoxanovaAudioProcessor::VoxanovaAudioProcessor()
    : juce::AudioProcessor(BusesProperties()
                               .withInput("Input", juce::AudioChannelSet::stereo(), true)
                               .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      parameters(*this, nullptr, "PARAMETERS", createParameterLayout())
{
  inputGainParam = parameters.getRawParameterValue(inputGainId);
  outputGainParam = parameters.getRawParameterValue(outputGainId);
  gateParam = parameters.getRawParameterValue(gateThresholdId);
  stereoWidthParam = parameters.getRawParameterValue(stereoWidthId);
  stereoLowBypassParam = parameters.getRawParameterValue(stereoLowBypassId);
  saturationModeParam = parameters.getRawParameterValue(saturationModeId);
  saturationAmountParam = parameters.getRawParameterValue(saturationAmountId);
  tuneEnabledParam = parameters.getRawParameterValue(tuneEnabledId);
  tuneAmountParam = parameters.getRawParameterValue(tuneAmountId);
  tuneKeyParam = parameters.getRawParameterValue(tuneKeyId);
  tuneScaleParam = parameters.getRawParameterValue(tuneScaleId);
  tuneCustomNotesParam = parameters.getRawParameterValue(tuneCustomNotesId);
  tuneVoiceTypeParam = parameters.getRawParameterValue(tuneVoiceTypeId);
  peakEnabledParam = parameters.getRawParameterValue(peakEnabledId);
  peakThresholdParam = parameters.getRawParameterValue(peakThresholdId);
  glueEnabledParam = parameters.getRawParameterValue(glueEnabledId);
  glueMultibandParam = parameters.getRawParameterValue(glueMultibandId);
  glueThresholdParam = parameters.getRawParameterValue(glueThresholdId);
  glueLowThresholdParam = parameters.getRawParameterValue(glueLowThresholdId);
  glueLowMidThresholdParam = parameters.getRawParameterValue(glueLowMidThresholdId);
  glueHighMidThresholdParam = parameters.getRawParameterValue(glueHighMidThresholdId);
  glueAirThresholdParam = parameters.getRawParameterValue(glueAirThresholdId);
  faceEnabledParam = parameters.getRawParameterValue(faceEnabledId);
  faceThresholdParam = parameters.getRawParameterValue(faceThresholdId);
  gateEnabledParam = parameters.getRawParameterValue(gateEnabledId);
  deEsserEnabledParam = parameters.getRawParameterValue(deEsserEnabledId);
  deEsserAmountParam = parameters.getRawParameterValue(deEsserAmountId);
  deEsserLowParam = parameters.getRawParameterValue(deEsserLowId);
  deEsserHighParam = parameters.getRawParameterValue(deEsserHighId);
  stereoEnabledParam = parameters.getRawParameterValue(stereoEnabledId);
  reverbEnabledParam = parameters.getRawParameterValue(reverbEnabledId);
  reverbMixParam = parameters.getRawParameterValue(reverbMixId);
  reverbDecayParam = parameters.getRawParameterValue(reverbDecayId);
  reverbSizeParam = parameters.getRawParameterValue(reverbSizeId);
  reverbPredelayParam = parameters.getRawParameterValue(reverbPredelayId);
  reverbLowCutParam = parameters.getRawParameterValue(reverbLowCutId);
  reverbHighCutParam = parameters.getRawParameterValue(reverbHighCutId);
  reverbModeParam = parameters.getRawParameterValue(reverbModeId);
  reverbSyncParam = parameters.getRawParameterValue(reverbSyncId);
  reverbNoteModeParam = parameters.getRawParameterValue(reverbNoteModeId);
  reverbDecaySyncParam = parameters.getRawParameterValue(reverbDecaySyncId);
  reverbPredelaySyncParam = parameters.getRawParameterValue(reverbPredelaySyncId);
  reverbDecayDivisionParam = parameters.getRawParameterValue(reverbDecayDivisionId);
  reverbPredelayDivisionParam = parameters.getRawParameterValue(reverbPredelayDivisionId);
  delayEnabledParam = parameters.getRawParameterValue(delayEnabledId);
  delayMixParam = parameters.getRawParameterValue(delayMixId);
  delayFeedbackParam = parameters.getRawParameterValue(delayFeedbackId);
  delayLowCutParam = parameters.getRawParameterValue(delayLowCutId);
  delayHighCutParam = parameters.getRawParameterValue(delayHighCutId);
  delaySyncParam = parameters.getRawParameterValue(delaySyncId);
  delayDivisionParam = parameters.getRawParameterValue(delayDivisionId);
  delayNoteModeParam = parameters.getRawParameterValue(delayNoteModeId);
  delayTimeMsParam = parameters.getRawParameterValue(delayTimeMsId);
  delayModeParam = parameters.getRawParameterValue(delayModeId);
  delayPostReverbParam = parameters.getRawParameterValue(delayPostReverbId);
  delayStyleParam = parameters.getRawParameterValue(delayStyleId);
  delayAuxBusParam = parameters.getRawParameterValue(delayAuxBusId);
  reverbAuxBusParam = parameters.getRawParameterValue(reverbAuxBusId);
  eqSettings = std::make_shared<const EqSettings>();
}

VoxanovaAudioProcessor::APVTS::ParameterLayout VoxanovaAudioProcessor::createParameterLayout()
{
  std::vector<std::unique_ptr<juce::RangedAudioParameter>> params;

  auto addFloat = [&params](const juce::String& id, const juce::String& name, float min, float max, float step,
                            float defaultValue, juce::String (*labelFn)(float, int)) {
    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        juce::ParameterID(id, 1), name, juce::NormalisableRange<float>(min, max, step), defaultValue,
        juce::AudioParameterFloatAttributes().withStringFromValueFunction(labelFn)));
  };

  addFloat(inputGainId, "Input Gain", -24.0f, 24.0f, 0.1f, 0.0f, dbLabel);
  addFloat(outputGainId, "Output Gain", -24.0f, 24.0f, 0.1f, 0.0f, dbLabel);
  addFloat(saturationModeId, "Saturation Type", 0.0f, 3.0f, 1.0f, 0.0f, saturationModeLabel);
  addFloat(saturationAmountId, "Saturation Amount", 0.0f, 100.0f, 1.0f, 0.0f, percentLabel);

  return { params.begin(), params.end() };
}

void VoxanovaAudioProcessor::prepareToPlay(double sampleRate, int samplesPerBlock)
{
  currentSampleRate = sampleRate;
  const auto delaySamples = static_cast<int>(sampleRate * 8.0);
  const auto reverbPredelaySamples = static_cast<int>(sampleRate * 2.0);
  const auto reverbEarlySamples = static_cast<int>(sampleRate * 1.5);
  const auto reverbTankSamples = static_cast<int>(sampleRate * 3.0);
  const auto reverbDiffuserSamples = static_cast<int>(sampleRate * 0.6);
  const auto reverbWidthSamples = static_cast<int>(sampleRate * 0.18);
  const auto widenSamples = static_cast<int>(sampleRate * 0.04);

  for (auto& delayBuffer : delayBuffers)
  {
    delayBuffer.setSize(1, delaySamples);
    delayBuffer.clear();
  }

  delayWritePositions = {};
  delayLowCutStates = {};
  delayHighCutStates = {};
  delayStyleLowCutStates = {};
  delayStyleHighCutStates = {};
  reverbPredelayBuffer.setSize(2, reverbPredelaySamples);
  reverbPredelayBuffer.clear();
  reverbPredelayWritePosition = 0;
  reverbEarlyBuffer.setSize(2, reverbEarlySamples);
  reverbEarlyBuffer.clear();
  reverbEarlyWritePosition = 0;
  for (auto& tankBuffer : reverbTankBuffers)
  {
    tankBuffer.setSize(1, reverbTankSamples);
    tankBuffer.clear();
  }
  reverbTankWritePositions = {};
  reverbTankHighDampStates = {};
  reverbTankLowDampStates = {};
  reverbTankModPhases = {};
  for (auto& diffuserBuffer : reverbDiffuserBuffers)
  {
    diffuserBuffer.setSize(1, reverbDiffuserSamples);
    diffuserBuffer.clear();
  }
  reverbDiffuserWritePositions = {};
  reverbDiffuserModPhases = {};
  reverbLowCutStates = {};
  reverbHighCutStates = {};
  reverbModeLowCutStates = {};
  reverbModeHighCutStates = {};
  reverbWarmLowStates = {};
  reverbWarmHighStates = {};
  reverbSilkStates = {};
  reverbWidthBuffer.setSize(1, reverbWidthSamples);
  reverbWidthBuffer.clear();
  reverbWidthWritePosition = 0;
  reverbWidthAllpassLeft = {};
  reverbWidthAllpassRight = {};
  reverbWidthModPhases = {};
  reverbWidthSideLowpass = 0.0f;
  reverbSizeSmoothed = 1.0f;
  reverbDecaySmoothed = 4.0f;
  lastReverbMode = -1;
  monoWidenBuffer.setSize(1, widenSamples);
  monoWidenBuffer.clear();
  prepareSpectra();
  tuneEngine.prepare(sampleRate, samplesPerBlock);
  setLatencySamples(tuneEngine.getLatencySamples());
  monoWidenWritePosition = 0;
  monoWidenSideLowpass = 0.0f;
  gateEnvelope = 0.0f;
  gateSmoothedGain = 1.0f;
  gateHoldSamples = 0;
  deEsserLowStates = {};
  deEsserHighStates = {};
  deEsserEnvelope = 0.0f;
  deEsserGain = 1.0f;
  preCompressorState = {};
  preEqStates.clear();
  postEqStates.clear();
  preEqStates.reserve(64);
  postEqStates.reserve(64);
  peakCompressorState = {};
  glueCompressorState = {};
  glueBandCompressorStates = {};
  for (auto& splitState : glueBandSplitStates)
    splitState.prepare(sampleRate, samplesPerBlock);
  faceCompressorState = {};
  postCompressorState = {};
  clearVisualState();
}

void VoxanovaAudioProcessor::releaseResources()
{
}

VoxanovaAudioProcessor::MeterSnapshot VoxanovaAudioProcessor::getMeterSnapshot() const
{
  MeterSnapshot snapshot;
  snapshot.inputChannels = activeInputChannels.load();
  snapshot.outputChannels = activeOutputChannels.load();

  for (auto i = 0; i < 2; ++i)
  {
    snapshot.input[static_cast<size_t>(i)] = peakToMeter(inputMeterPeaks[static_cast<size_t>(i)].load());
    snapshot.output[static_cast<size_t>(i)] = peakToMeter(outputMeterPeaks[static_cast<size_t>(i)].load());
  }

  snapshot.gateReduction = gateReductionMeter.load();
  snapshot.peakReduction = peakReductionMeter.load();
  snapshot.glueReduction = glueReductionMeter.load();
  snapshot.faceReduction = faceReductionMeter.load();
  snapshot.gateReductionDb = gateReductionDbMeter.load();
  snapshot.peakReductionDb = peakReductionDbMeter.load();
  snapshot.glueReductionDb = glueReductionDbMeter.load();
  snapshot.faceReductionDb = faceReductionDbMeter.load();
  for (auto band = 0u; band < snapshot.glueBandReductions.size(); ++band)
  {
    snapshot.glueBandReductions[band] = glueBandReductionMeters[band].load();
    snapshot.glueBandReductionDbs[band] = glueBandReductionDbMeters[band].load();
  }
  snapshot.peakLevel = peakLevelMeter.load();
  snapshot.glueLevel = glueLevelMeter.load();
  snapshot.faceLevel = faceLevelMeter.load();
  snapshot.gateLevel = gateLevelMeter.load();
  snapshot.hostBpm = hostBpm.load();
  snapshot.tuneFrequency = tuneFrequencyMeter.load();
  snapshot.tuneCents = tuneCentsMeter.load();
  snapshot.tuneConfidence = tuneConfidenceMeter.load();
  snapshot.tuneTargetMidi = tuneTargetMidiMeter.load();
  snapshot.visualSilence = visualSilenceActive.load();
  snapshot.processCounter = meterProcessCounter.load(std::memory_order_relaxed);
  const auto writeIndex = juce::jlimit(0, waveformSampleCount - 1, waveformWriteIndex.load());
  copyWaveform(inputWaveform, snapshot.inputWaveform, writeIndex);
  copyWaveform(peakWaveform, snapshot.peakWaveform, writeIndex);
  copyWaveform(peakOutputWaveform, snapshot.peakOutputWaveform, writeIndex);
  copyWaveform(glueWaveform, snapshot.glueWaveform, writeIndex);
  copyWaveform(glueOutputWaveform, snapshot.glueOutputWaveform, writeIndex);
  copyWaveform(faceWaveform, snapshot.faceWaveform, writeIndex);
  copyWaveform(faceOutputWaveform, snapshot.faceOutputWaveform, writeIndex);
  copyWaveform(gateWaveform, snapshot.gateWaveform, writeIndex);
  copyWaveform(gateOutputWaveform, snapshot.gateOutputWaveform, writeIndex);
  copySpectrum(preCompSpectrumAnalyzer.bins, snapshot.preCompSpectrum);
  copySpectrum(postCompSpectrumAnalyzer.bins, snapshot.postCompSpectrum);
  for (auto band = 0u; band < snapshot.preEqDetectorDbs.size(); ++band)
  {
    snapshot.preEqDetectorDbs[band] = preEqDetectorDbMeters[band].load(std::memory_order_relaxed);
    snapshot.postEqDetectorDbs[band] = postEqDetectorDbMeters[band].load(std::memory_order_relaxed);
  }

  return snapshot;
}

bool VoxanovaAudioProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const
{
  const auto input = layouts.getMainInputChannelSet();
  const auto output = layouts.getMainOutputChannelSet();

  if (output != juce::AudioChannelSet::stereo() ||
      (input != juce::AudioChannelSet::mono() && input != juce::AudioChannelSet::stereo()))
    return false;

  for (auto busIndex = 1; busIndex < layouts.outputBuses.size(); ++busIndex)
  {
    const auto auxOutput = layouts.getChannelSet(false, busIndex);
    if (!auxOutput.isDisabled() && auxOutput != juce::AudioChannelSet::stereo())
      return false;
  }

  return true;
}

void VoxanovaAudioProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
  juce::ScopedNoDenormals noDenormals;
  meterProcessCounter.fetch_add(1, std::memory_order_relaxed);

  const auto totalInputChannels = getTotalNumInputChannels();
  const auto totalOutputChannels = getTotalNumOutputChannels();
  const auto meteredInputChannels = juce::jlimit(1, 2, totalInputChannels);
  const auto meteredOutputChannels = juce::jlimit(1, 2, totalOutputChannels);

  activeInputChannels.store(meteredInputChannels);
  activeOutputChannels.store(meteredOutputChannels);

  for (auto channel = totalInputChannels; channel < totalOutputChannels; ++channel)
    buffer.clear(channel, 0, buffer.getNumSamples());

  const auto inputGain = dbToGain(inputGainParam->load());
  const auto outputGain = dbToGain(outputGainParam->load());
  const auto saturationMode = juce::jlimit(0, 3, juce::roundToInt(saturationModeParam->load()));
  const auto saturationAmount = juce::jlimit(0.0f, 100.0f, saturationAmountParam->load());

  if (saturationMode == 0 || saturationAmount <= 0.0f)
    saturationState = {};

  const auto eqSnapshot = std::atomic_load(&eqSettings);
  const std::vector<EqBandSettings> emptyEqBands;
  const auto& eqBands = eqSnapshot != nullptr ? eqSnapshot->preBands : emptyEqBands;

  for (auto& meter : preEqDetectorDbMeters)
    meter.store(-120.0f, std::memory_order_relaxed);
  for (auto& meter : postEqDetectorDbMeters)
    meter.store(-120.0f, std::memory_order_relaxed);

  if (eqBands.empty())
    resetEqStates(preEqStates);
  else
    prepareEq(preEqStates, eqBands);

  resetEqStates(postEqStates);

  std::array<float, 2> inputPeaks {};
  std::array<float, 2> outputPeaks {};
  const auto waveformHopSamples = juce::jmax(1, juce::roundToInt(currentSampleRate / 40.0));

  auto peakDetectorSample = [](float leftSample, float rightSample) {
    return juce::jlimit(0.0f, 1.0f, juce::jmax(std::abs(leftSample), std::abs(rightSample)));
  };

  auto protectOutput = [](float sampleValue) {
    const auto absSample = std::abs(sampleValue);
    if (absSample <= 0.96f)
      return sampleValue;

    const auto sign = sampleValue < 0.0f ? -1.0f : 1.0f;
    const auto limited = 0.96f + std::tanh((absSample - 0.96f) * 2.8f) * 0.04f;
    return sign * juce::jlimit(0.0f, 0.999f, limited);
  };

  for (auto sample = 0; sample < buffer.getNumSamples(); ++sample)
  {
    const auto rawLeft = totalInputChannels > 0 ? buffer.getSample(0, sample) : 0.0f;
    const auto rawRight = totalInputChannels > 1 ? buffer.getSample(1, sample) : rawLeft;

    inputPeaks[0] = juce::jmax(inputPeaks[0], std::abs(rawLeft));
    inputPeaks[1] = juce::jmax(inputPeaks[1], std::abs(rawRight));

    auto left = rawLeft * inputGain;
    auto right = rawRight * inputGain;
    const auto inputDisplaySample = peakDetectorSample(left, right);

    if (!eqBands.empty())
      applyEq(preEqStates, eqBands, left, right, preEqDetectorDbMeters);

    pushSpectrumSample(preCompSpectrumAnalyzer, (left + right) * 0.5f);

    left = applySaturationModel(left, saturationMode, saturationAmount, saturationState, 0);
    right = applySaturationModel(right, saturationMode, saturationAmount, saturationState, 1);

    pushSpectrumSample(postCompSpectrumAnalyzer, (left + right) * 0.5f);

    inputWaveformPeak = juce::jmax(inputWaveformPeak, std::abs(inputDisplaySample));

    if (++waveformDownsampleCounter >= waveformHopSamples)
    {
      waveformDownsampleCounter = 0;
      const auto writeIndex = juce::jlimit(0, waveformSampleCount - 1, waveformWriteIndex.load());
      storeWaveformSample(inputWaveform, writeIndex, inputWaveformPeak);
      waveformWriteIndex.store((writeIndex + 1) % waveformSampleCount);
      inputWaveformPeak = 0.0f;
    }

    const std::array<float, 2> outputs {
      protectOutput(left * outputGain),
      protectOutput(right * outputGain)
    };

    for (auto channel = 0; channel < juce::jmin(2, totalOutputChannels); ++channel)
    {
      const auto limitedOutput = outputs[static_cast<size_t>(channel)];
      outputPeaks[static_cast<size_t>(channel)] = juce::jmax(outputPeaks[static_cast<size_t>(channel)],
                                                             std::abs(limitedOutput));
      buffer.setSample(channel, sample, limitedOutput);
    }
  }

  if (meteredInputChannels == 1)
    inputPeaks[1] = inputPeaks[0];

  if (meteredOutputChannels == 1)
    outputPeaks[1] = outputPeaks[0];

  visualSilenceActive.store(false);

  for (auto i = 0; i < 2; ++i)
  {
    updateAtomicPeak(inputMeterPeaks[static_cast<size_t>(i)], inputPeaks[static_cast<size_t>(i)]);
    updateAtomicPeak(outputMeterPeaks[static_cast<size_t>(i)], outputPeaks[static_cast<size_t>(i)]);
  }

  peakLevelMeter.store(0.0f);
  glueLevelMeter.store(0.0f);
  faceLevelMeter.store(0.0f);
  gateLevelMeter.store(0.0f);
  gateReductionMeter.store(0.0f);
  peakReductionMeter.store(0.0f);
  glueReductionMeter.store(0.0f);
  faceReductionMeter.store(0.0f);
  gateReductionDbMeter.store(0.0f);
  peakReductionDbMeter.store(0.0f);
  glueReductionDbMeter.store(0.0f);
  faceReductionDbMeter.store(0.0f);

  for (auto& meter : glueBandReductionMeters)
    meter.store(0.0f);
  for (auto& meter : glueBandReductionDbMeters)
    meter.store(0.0f);

  tuneFrequencyMeter.store(0.0f);
  tuneCentsMeter.store(0.0f);
  tuneConfidenceMeter.store(0.0f);
  tuneTargetMidiMeter.store(0.0f);
}

void VoxanovaAudioProcessor::processBlockBypassed(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
  juce::ScopedNoDenormals noDenormals;
  meterProcessCounter.fetch_add(1, std::memory_order_relaxed);

  const auto totalInputChannels = getTotalNumInputChannels();
  const auto totalOutputChannels = getTotalNumOutputChannels();
  activeInputChannels.store(juce::jlimit(1, 2, totalInputChannels));
  activeOutputChannels.store(2);

  if (totalInputChannels == 1 && totalOutputChannels > 1)
    buffer.copyFrom(1, 0, buffer, 0, 0, buffer.getNumSamples());

  for (auto channel = totalInputChannels; channel < totalOutputChannels; ++channel)
    if (!(totalInputChannels == 1 && channel == 1))
      buffer.clear(channel, 0, buffer.getNumSamples());

  clearVisualState();
}

juce::AudioProcessorEditor* VoxanovaAudioProcessor::createEditor()
{
  return new VoxanovaAudioProcessorEditor(*this);
}

bool VoxanovaAudioProcessor::hasEditor() const
{
  return true;
}

const juce::String VoxanovaAudioProcessor::getName() const
{
  return "Supernova EQ";
}

bool VoxanovaAudioProcessor::acceptsMidi() const
{
  return false;
}

bool VoxanovaAudioProcessor::producesMidi() const
{
  return false;
}

bool VoxanovaAudioProcessor::isMidiEffect() const
{
  return false;
}

double VoxanovaAudioProcessor::getTailLengthSeconds() const
{
  return 0.0;
}

int VoxanovaAudioProcessor::getNumPrograms()
{
  return 1;
}

int VoxanovaAudioProcessor::getCurrentProgram()
{
  return 0;
}

void VoxanovaAudioProcessor::setCurrentProgram(int)
{
}

const juce::String VoxanovaAudioProcessor::getProgramName(int)
{
  return {};
}

void VoxanovaAudioProcessor::changeProgramName(int, const juce::String&)
{
}

void VoxanovaAudioProcessor::getStateInformation(juce::MemoryBlock& destData)
{
  auto state = parameters.copyState();

  if (auto snapshot = std::atomic_load(&eqSettings))
    state.setProperty("eqBands", serializeEqBands(*snapshot), nullptr);

  if (auto xml = state.createXml())
    copyXmlToBinary(*xml, destData);
}

void VoxanovaAudioProcessor::setStateInformation(const void* data, int sizeInBytes)
{
  if (auto xml = getXmlFromBinary(data, sizeInBytes))
  {
    if (xml->hasTagName(parameters.state.getType()))
    {
      auto state = juce::ValueTree::fromXml(*xml);
      const auto eqBandsJson = state.getProperty("eqBands", {}).toString();
      parameters.replaceState(state);

      if (eqBandsJson.isNotEmpty())
        setEqBandsFromVar(juce::JSON::parse(eqBandsJson));
      else
        setEqBandsFromVar(juce::var(new juce::DynamicObject()));
    }
  }
}

std::vector<VoxanovaAudioProcessor::EqBandSettings> VoxanovaAudioProcessor::parseEqBandArray(const juce::var& bands)
{
  std::vector<EqBandSettings> parsed;
  const auto* array = bands.getArray();

  if (array == nullptr)
    return parsed;

  parsed.reserve(static_cast<size_t>(array->size()));

  auto readFloat = [](const juce::var& object, const juce::Identifier& id, float defaultValue) {
    const auto value = object.getProperty(id, defaultValue);
    if (value.isVoid())
      return defaultValue;
    return static_cast<float>(value);
  };

  auto readBool = [](const juce::var& object, const juce::Identifier& id, bool defaultValue) {
    const auto value = object.getProperty(id, defaultValue);
    if (value.isBool())
      return static_cast<bool>(value);
    if (value.isString())
    {
      const auto text = value.toString();
      if (text.equalsIgnoreCase("false") || text == "0" || text.equalsIgnoreCase("off"))
        return false;
      if (text.equalsIgnoreCase("true") || text == "1" || text.equalsIgnoreCase("on"))
        return true;
    }
    return static_cast<float>(value) >= 0.5f;
  };

  auto readType = [](const juce::var& object) {
    const auto value = object.getProperty("type", "Bell");

    if (!value.isString())
      return juce::jlimit(0, static_cast<int>(eqFilterTypeLabels.size()) - 1,
                          juce::roundToInt(static_cast<float>(value)));

    const auto text = value.toString();
    for (auto index = 0; index < static_cast<int>(eqFilterTypeLabels.size()); ++index)
      if (text.equalsIgnoreCase(eqFilterTypeLabels[static_cast<size_t>(index)]))
        return index;

    return 0;
  };

  auto defaultQForType = [](int type) {
    if (type == 0)
      return 1.0f;

    if (type == fullSpectrumType)
      return 8.0f;

    return type == 5 || type == 6 ? 1.3f : 5.0f;
  };

  auto defaultSlopeForType = [](int type) {
    return type == 3 ? 30 : 12;
  };

  auto readSlope = [&defaultSlopeForType](const juce::var& object, int type) {
    const auto value = object.getProperty("slope", defaultSlopeForType(type));
    if (value.isString() && value.toString().equalsIgnoreCase("wall"))
      return VoxanovaAudioProcessor::eqWallSlopeDb;

    return juce::jlimit(6, VoxanovaAudioProcessor::eqWallSlopeDb, juce::roundToInt(static_cast<float>(value)));
  };

  for (const auto& band : *array)
  {
    EqBandSettings settings;
    settings.enabled = readBool(band, "on", true) && readBool(band, "enabled", true);
    settings.solo = readBool(band, "solo", false);
    settings.type = readType(band);
    if (settings.type == 2)
      continue;

    settings.frequency = juce::jlimit(20.0f, 20000.0f, readFloat(band, "freq", 1000.0f));
    settings.gainDb = juce::jlimit(settings.type == 3 || settings.type == 4 ? 0.0f : -30.0f, 30.0f,
                                   readFloat(band, "gain", 0.0f));
    settings.q = juce::jlimit(0.1f, 50.0f, readFloat(band, "q", defaultQForType(settings.type)));
    if (settings.type == fullSpectrumType)
    {
      const auto range = normalizeFullSpectrumRange(
          settings.frequency, settings.q, readFloat(band, "rangeLow", std::numeric_limits<float>::quiet_NaN()),
          readFloat(band, "rangeHigh", std::numeric_limits<float>::quiet_NaN()));
      settings.rangeLowHz = range[0];
      settings.rangeHighHz = range[1];
      settings.frequency = getFullSpectrumCenter(settings.rangeLowHz, settings.rangeHighHz);
      settings.rangeLowSlope = juce::jlimit(0.1f, 50.0f, readFloat(band, "rangeLowSlope", settings.q));
      settings.rangeHighSlope = juce::jlimit(0.1f, 50.0f, readFloat(band, "rangeHighSlope", settings.q));
    }
    settings.compDb = juce::jlimit(-30.0f, 30.0f, readFloat(band, "comp", 0.0f));
    const auto legacyCompEnabled = std::abs(settings.compDb) > 0.05f &&
                                   std::abs(settings.compDb - settings.gainDb) > 0.05f;
    settings.compEnabled = readBool(band, "compEnabled", legacyCompEnabled);
    settings.compThresholdDb = juce::jlimit(-60.0f, 0.0f, readFloat(band, "compThreshold", -18.0f));
    settings.compAttackMs = juce::jlimit(0.1f, 200.0f, readFloat(band, "compAttack", 12.0f));
    settings.compReleaseMs = juce::jlimit(5.0f, 1000.0f, readFloat(band, "compRelease", 140.0f));
    settings.compRatio = juce::jlimit(1.0f, 20.0f, readFloat(band, "compRatio", 4.0f));
    settings.saturationMode = juce::jlimit(0, 3, juce::roundToInt(readFloat(band, "saturationMode", readFloat(band, "satMode", 0.0f))));
    settings.saturationAmount = settings.saturationMode > 0
                                    ? juce::jlimit(0.0f, 100.0f,
                                                   readFloat(band, "saturationAmount", readFloat(band, "satAmount", 20.0f)))
                                    : 0.0f;
    if (!eqBandSupportsSaturation(settings))
    {
      settings.saturationMode = 0;
      settings.saturationAmount = 0.0f;
    }
    settings.slopeDb = readSlope(band, settings.type);
    settings.thresholdDb = juce::jlimit(-60.0f, 0.0f, readFloat(band, "threshold", -24.0f));
    settings.intensity = juce::jlimit(0.0f, 100.0f, readFloat(band, "intensity", 50.0f));
    const auto deessMode = band.getProperty("deessMode", "split").toString();
    settings.deessMode = deessMode.equalsIgnoreCase("wider") || deessMode == "1" ? 1 : 0;
    settings.surfRatio = juce::jlimit(0.0f, 128.0f, readFloat(band, "surfRatio", 0.0f));

    parsed.push_back(settings);
  }

  return parsed;
}

juce::var VoxanovaAudioProcessor::eqBandArrayToVar(const std::vector<EqBandSettings>& bands)
{
  juce::Array<juce::var> array;
  array.ensureStorageAllocated(static_cast<int>(bands.size()));

  for (const auto& band : bands)
  {
    auto object = juce::DynamicObject::Ptr(new juce::DynamicObject());
    const auto typeIndex = juce::jlimit(0, static_cast<int>(eqFilterTypeLabels.size()) - 1, band.type);
    object->setProperty("type", eqFilterTypeLabels[static_cast<size_t>(typeIndex)]);
    object->setProperty("freq", band.frequency);
    object->setProperty("gain", band.gainDb);
    object->setProperty("q", band.q);
    if (band.type == fullSpectrumType)
    {
      object->setProperty("rangeLow", band.rangeLowHz);
      object->setProperty("rangeHigh", band.rangeHighHz);
      object->setProperty("rangeLowSlope", band.rangeLowSlope);
      object->setProperty("rangeHighSlope", band.rangeHighSlope);
    }
    object->setProperty("solo", band.solo);
    object->setProperty("comp", band.compDb);
    object->setProperty("compEnabled", band.compEnabled);
    object->setProperty("compThreshold", band.compThresholdDb);
    object->setProperty("compAttack", band.compAttackMs);
    object->setProperty("compRelease", band.compReleaseMs);
    object->setProperty("compRatio", band.compRatio);
    object->setProperty("saturationMode", band.saturationMode);
    object->setProperty("saturationAmount", band.saturationAmount);
    object->setProperty("slope", band.slopeDb >= eqWallSlopeDb ? juce::var("wall") : juce::var(band.slopeDb));
    object->setProperty("threshold", band.thresholdDb);
    object->setProperty("intensity", band.intensity);
    object->setProperty("deessMode", band.deessMode == 1 ? "wider" : "split");
    if (band.surfRatio > 0.0f)
      object->setProperty("surfRatio", band.surfRatio);
    object->setProperty("on", band.enabled);
    object->setProperty("placement", "stereo");
    array.add(juce::var(object.get()));
  }

  return juce::var(array);
}

juce::String VoxanovaAudioProcessor::serializeEqBands(const EqSettings& settings)
{
  auto object = juce::DynamicObject::Ptr(new juce::DynamicObject());
  object->setProperty("pre", eqBandArrayToVar(settings.preBands));
  object->setProperty("post", eqBandArrayToVar(settings.postBands));
  return juce::JSON::toString(juce::var(object.get()), false);
}

juce::var VoxanovaAudioProcessor::getEqBandsState() const
{
  auto snapshot = std::atomic_load(&eqSettings);
  auto object = juce::DynamicObject::Ptr(new juce::DynamicObject());

  if (snapshot != nullptr)
  {
    object->setProperty("pre", eqBandArrayToVar(snapshot->preBands));
    object->setProperty("post", eqBandArrayToVar(snapshot->postBands));
  }
  else
  {
    object->setProperty("pre", juce::var(juce::Array<juce::var>()));
    object->setProperty("post", juce::var(juce::Array<juce::var>()));
  }

  return juce::var(object.get());
}

void VoxanovaAudioProcessor::setEqBandsFromVar(const juce::var& payload)
{
  auto source = payload;
  if (source.isString())
    source = juce::JSON::parse(source.toString());

  auto next = std::make_shared<EqSettings>();
  next->preBands = parseEqBandArray(source.getProperty("pre", {}));
  next->postBands = parseEqBandArray(source.getProperty("post", {}));
  std::shared_ptr<const EqSettings> immutableNext = std::move(next);
  std::atomic_store(&eqSettings, immutableNext);
}

float VoxanovaAudioProcessor::dbToGain(float db)
{
  return juce::Decibels::decibelsToGain(db);
}

float VoxanovaAudioProcessor::peakToMeter(float peak)
{
  if (peak <= 0.000001f)
    return 0.0f;

  const auto db = juce::Decibels::gainToDecibels(peak);
  return juce::jlimit(0.0f, 1.0f, (db + 60.0f) / 72.0f);
}

float VoxanovaAudioProcessor::peakToFader(float peak, float minDb, float maxDb)
{
  if (peak <= 0.000001f)
    return 0.0f;

  const auto db = juce::Decibels::gainToDecibels(peak);
  return juce::jlimit(0.0f, 100.0f, (db - minDb) / (maxDb - minDb) * 100.0f);
}

void VoxanovaAudioProcessor::updateAtomicPeak(std::atomic<float>& target, float value)
{
  auto current = target.load();
  const auto decayed = current * 0.86f;
  target.store(juce::jmax(value, decayed));
}

void VoxanovaAudioProcessor::updateAtomicBallistic(std::atomic<float>& target, float value, double sampleRate,
                                                   int numSamples, float attackMs, float releaseMs)
{
  const auto clampedTarget = juce::jlimit(0.0f, 100.0f, value);

  if (sampleRate <= 0.0 || numSamples <= 0)
  {
    target.store(clampedTarget);
    return;
  }

  const auto current = target.load();
  const auto timeMs = clampedTarget > current ? attackMs : releaseMs;

  if (timeMs <= 0.0f)
  {
    target.store(clampedTarget);
    return;
  }

  const auto coeff = std::exp(-static_cast<float>(numSamples) / static_cast<float>(sampleRate * (timeMs / 1000.0f)));
  const auto smoothed = clampedTarget + coeff * (current - clampedTarget);
  target.store(juce::jlimit(0.0f, 100.0f, smoothed));
}

void VoxanovaAudioProcessor::clearWaveform(std::array<std::atomic<float>, waveformSampleCount>& waveform)
{
  for (auto& sample : waveform)
    sample.store(0.0f);
}

void VoxanovaAudioProcessor::storeWaveformSample(std::array<std::atomic<float>, waveformSampleCount>& waveform,
                                                 int index, float value)
{
  const auto clampedIndex = juce::jlimit(0, waveformSampleCount - 1, index);
  waveform[static_cast<size_t>(clampedIndex)].store(juce::jlimit(-1.0f, 1.0f, value));
}

void VoxanovaAudioProcessor::copyWaveform(const std::array<std::atomic<float>, waveformSampleCount>& source,
                                          std::array<float, waveformSampleCount>& destination, int writeIndex)
{
  const auto clampedWriteIndex = juce::jlimit(0, waveformSampleCount - 1, writeIndex);
  for (auto i = 0; i < waveformSampleCount; ++i)
  {
    const auto index = (clampedWriteIndex + i) % waveformSampleCount;
    destination[static_cast<size_t>(i)] = source[static_cast<size_t>(index)].load();
  }
}

void VoxanovaAudioProcessor::clearSpectrum(std::array<std::atomic<float>, spectrumBinCount>& spectrum)
{
  for (auto& bin : spectrum)
    bin.store(0.0f);
}

void VoxanovaAudioProcessor::copySpectrum(const std::array<std::atomic<float>, spectrumBinCount>& source,
                                          std::array<float, spectrumBinCount>& destination)
{
  for (auto i = 0; i < spectrumBinCount; ++i)
    destination[static_cast<size_t>(i)] = source[static_cast<size_t>(i)].load();
}

void VoxanovaAudioProcessor::prepareSpectrum(SpectrumAnalyzerState& analyzer)
{
  std::fill(analyzer.ring.begin(), analyzer.ring.end(), 0.0f);
  std::fill(analyzer.smoothed.begin(), analyzer.smoothed.end(), 0.0f);
  analyzer.writePosition = 0;
  analyzer.hopCounter = 0;
  clearSpectrum(analyzer.bins);
}

void VoxanovaAudioProcessor::prepareSpectra()
{
  for (auto i = 0; i < spectrumFftSize; ++i)
  {
    spectrumWindow[static_cast<size_t>(i)] =
        0.5f - 0.5f * std::cos(2.0f * juce::MathConstants<float>::pi * static_cast<float>(i) /
                               static_cast<float>(spectrumFftSize - 1));
  }

  prepareSpectrum(preCompSpectrumAnalyzer);
  prepareSpectrum(postCompSpectrumAnalyzer);
}

void VoxanovaAudioProcessor::clearSpectrumAnalyzer(SpectrumAnalyzerState& analyzer)
{
  clearSpectrum(analyzer.bins);
  std::fill(analyzer.smoothed.begin(), analyzer.smoothed.end(), 0.0f);
}

void VoxanovaAudioProcessor::pushSpectrumSample(SpectrumAnalyzerState& analyzer, float sample)
{
  analyzer.ring[static_cast<size_t>(analyzer.writePosition)] =
      juce::jlimit(-2.0f, 2.0f, std::isfinite(sample) ? sample : 0.0f);
  analyzer.writePosition = (analyzer.writePosition + 1) % spectrumFftSize;

  if (++analyzer.hopCounter >= spectrumHopSize)
  {
    analyzer.hopCounter = 0;
    analyseSpectrum(analyzer);
  }
}

void VoxanovaAudioProcessor::analyseSpectrum(SpectrumAnalyzerState& analyzer)
{
  if (currentSampleRate <= 1000.0)
    return;

  std::array<float, spectrumFftSize * 2> fftFrame {};
  auto windowSum = 0.0f;

  for (auto i = 0; i < spectrumFftSize; ++i)
  {
    const auto readIndex = (analyzer.writePosition + i) % spectrumFftSize;
    const auto window = spectrumWindow[static_cast<size_t>(i)];
    fftFrame[static_cast<size_t>(i)] = analyzer.ring[static_cast<size_t>(readIndex)] * window;
    windowSum += window;
  }

  spectrumFft.performFrequencyOnlyForwardTransform(fftFrame.data(), true);

  const auto maxFftBin = spectrumFftSize / 2 - 1;
  const auto maxSpectrumFrequency =
      juce::jlimit(spectrumMinFrequency, 20000.0f, static_cast<float>(currentSampleRate * 0.5 - 1.0));
  const auto spectrumFrequencyRatio = juce::jmax(1.0001f, maxSpectrumFrequency / spectrumMinFrequency);
  const auto analysisIntervalSeconds = static_cast<float>(spectrumHopSize) /
                                       juce::jmax(1.0f, static_cast<float>(currentSampleRate));
  const auto attackCoeff = std::exp(-analysisIntervalSeconds / 0.026f);
  const auto releaseCoeff = std::exp(-analysisIntervalSeconds / 0.62f);
  const auto frequencyToBin = [this](float frequency) {
    return frequency / static_cast<float>(currentSampleRate) * static_cast<float>(spectrumFftSize);
  };
  std::array<float, spectrumFftSize / 2> fftMagnitudes {};

  for (auto fftBin = 1; fftBin <= maxFftBin; ++fftBin)
  {
    const auto magnitude = fftFrame[static_cast<size_t>(fftBin)] * 2.0f / juce::jmax(1.0f, windowSum);
    fftMagnitudes[static_cast<size_t>(fftBin)] = juce::jmax(0.0f, std::isfinite(magnitude) ? magnitude : 0.0f);
  }

  const auto sampleMagnitudeAtBin = [&fftMagnitudes](float binPosition) {
    const auto clamped = juce::jlimit(1.0f, static_cast<float>(maxFftBin), binPosition);
    const auto lower = juce::jlimit(1, maxFftBin, static_cast<int>(std::floor(clamped)));
    const auto upper = juce::jlimit(lower, maxFftBin, lower + 1);
    const auto mix = clamped - static_cast<float>(lower);
    const auto lowerMagnitude = fftMagnitudes[static_cast<size_t>(lower)];
    const auto upperMagnitude = fftMagnitudes[static_cast<size_t>(upper)];
    return lowerMagnitude + (upperMagnitude - lowerMagnitude) * mix;
  };

  for (auto bin = 0; bin < spectrumBinCount; ++bin)
  {
    const auto centerT =
        spectrumBinCount <= 1 ? 0.0f : static_cast<float>(bin) / static_cast<float>(spectrumBinCount - 1);
    const auto halfBinT = spectrumBinCount <= 1 ? 0.5f : 0.5f / static_cast<float>(spectrumBinCount - 1);
    const auto lowT = juce::jlimit(0.0f, 1.0f, centerT - halfBinT);
    const auto highT = juce::jlimit(0.0f, 1.0f, centerT + halfBinT);
    const auto lowFrequency =
        juce::jlimit(spectrumMinFrequency, maxSpectrumFrequency,
                     spectrumMinFrequency * std::pow(spectrumFrequencyRatio, lowT));
    const auto highFrequency =
        juce::jlimit(lowFrequency, maxSpectrumFrequency,
                     spectrumMinFrequency * std::pow(spectrumFrequencyRatio, highT));
    const auto centerFrequency =
        juce::jlimit(spectrumMinFrequency, maxSpectrumFrequency,
                     spectrumMinFrequency * std::pow(spectrumFrequencyRatio, centerT));
    const auto firstFftBin = juce::jlimit(1, maxFftBin, static_cast<int>(std::floor(frequencyToBin(lowFrequency))));
    const auto lastFftBin = juce::jlimit(firstFftBin, maxFftBin, static_cast<int>(std::ceil(frequencyToBin(highFrequency))));

    auto magnitudeSumSquares = 0.0f;
    auto weightSum = 0.0f;
    auto peakMagnitude = 0.0f;
    const auto smoothingOctaves =
        juce::jmax(0.010f, std::log2(juce::jmax(1.0001f, highFrequency / lowFrequency)) * 0.72f);

    for (auto fftBin = firstFftBin; fftBin <= lastFftBin; ++fftBin)
    {
      const auto magnitude = fftMagnitudes[static_cast<size_t>(fftBin)];
      const auto fftFrequency = static_cast<float>(fftBin) * static_cast<float>(currentSampleRate) /
                                static_cast<float>(spectrumFftSize);
      const auto distance = std::abs(std::log2(juce::jmax(1.0f, fftFrequency) / centerFrequency));
      const auto normalizedDistance = distance / smoothingOctaves;
      const auto weight = normalizedDistance >= 1.0f
                              ? 0.0f
                              : 0.5f + 0.5f * std::cos(juce::MathConstants<float>::pi * normalizedDistance);
      magnitudeSumSquares += magnitude * magnitude * weight;
      weightSum += weight;
      peakMagnitude = juce::jmax(peakMagnitude, magnitude);
    }

    const auto rmsMagnitude = weightSum > 0.0f ? std::sqrt(magnitudeSumSquares / weightSum) : 0.0f;
    const auto centerMagnitude = sampleMagnitudeAtBin(frequencyToBin(centerFrequency));
    const auto magnitude = juce::jmax(rmsMagnitude, juce::jmax(centerMagnitude * 0.72f, peakMagnitude * 0.32f));
    const auto db = juce::Decibels::gainToDecibels(magnitude, -120.0f);
    const auto tiltDb = 4.5f * std::log2(juce::jmax(20.0f, centerFrequency) / 1000.0f);
    constexpr auto analyzerFloorDb = -78.0f;
    constexpr auto analyzerCeilingDb = -18.0f;
    const auto normalized = juce::jlimit(0.0f, 1.0f, (db + tiltDb - analyzerFloorDb) /
                                                            (analyzerCeilingDb - analyzerFloorDb));
    auto& smoothed = analyzer.smoothed[static_cast<size_t>(bin)];
    const auto coeff = normalized > smoothed ? attackCoeff : releaseCoeff;
    smoothed = normalized + coeff * (smoothed - normalized);
    analyzer.bins[static_cast<size_t>(bin)].store(juce::jlimit(0.0f, 1.0f, smoothed));
  }
}

void VoxanovaAudioProcessor::resetWaveformAccumulators()
{
  inputWaveformPeak = 0.0f;
  peakWaveformPeak = 0.0f;
  peakOutputWaveformPeak = 0.0f;
  glueWaveformPeak = 0.0f;
  glueOutputWaveformPeak = 0.0f;
  faceWaveformPeak = 0.0f;
  faceOutputWaveformPeak = 0.0f;
  gateWaveformPeak = 0.0f;
  gateOutputWaveformPeak = 0.0f;
}

void VoxanovaAudioProcessor::clearWaveformBuffers()
{
  waveformWriteIndex.store(0);
  waveformDownsampleCounter = 0;
  clearWaveform(inputWaveform);
  clearWaveform(peakWaveform);
  clearWaveform(peakOutputWaveform);
  clearWaveform(glueWaveform);
  clearWaveform(glueOutputWaveform);
  clearWaveform(faceWaveform);
  clearWaveform(faceOutputWaveform);
  clearWaveform(gateWaveform);
  clearWaveform(gateOutputWaveform);
  resetWaveformAccumulators();
}

void VoxanovaAudioProcessor::clearVisualState(bool resetSpectrum)
{
  clearMeters();
  clearWaveformBuffers();
  if (resetSpectrum)
  {
    clearSpectrumAnalyzer(preCompSpectrumAnalyzer);
    clearSpectrumAnalyzer(postCompSpectrumAnalyzer);
  }
  visualSilenceActive.store(true);
}

void VoxanovaAudioProcessor::clearMeters()
{
  for (auto i = 0; i < 2; ++i)
  {
    inputMeterPeaks[static_cast<size_t>(i)].store(0.0f);
    outputMeterPeaks[static_cast<size_t>(i)].store(0.0f);
  }

  peakLevelMeter.store(0.0f);
  glueLevelMeter.store(0.0f);
  faceLevelMeter.store(0.0f);
  gateLevelMeter.store(0.0f);
  gateReductionMeter.store(0.0f);
  peakReductionMeter.store(0.0f);
  glueReductionMeter.store(0.0f);
  faceReductionMeter.store(0.0f);
  gateReductionDbMeter.store(0.0f);
  peakReductionDbMeter.store(0.0f);
  glueReductionDbMeter.store(0.0f);
  faceReductionDbMeter.store(0.0f);

  for (auto& meter : glueBandReductionMeters)
    meter.store(0.0f);
  for (auto& meter : glueBandReductionDbMeters)
    meter.store(0.0f);
  for (auto& meter : preEqDetectorDbMeters)
    meter.store(-120.0f);
  for (auto& meter : postEqDetectorDbMeters)
    meter.store(-120.0f);

  tuneFrequencyMeter.store(0.0f);
  tuneCentsMeter.store(0.0f);
  tuneConfidenceMeter.store(0.0f);
  tuneTargetMidiMeter.store(0.0f);
}

float VoxanovaAudioProcessor::processOnePoleLowpass(float input, float cutoffHz, float& state) const
{
  const auto alpha =
      1.0f - std::exp(-2.0f * juce::MathConstants<float>::pi * cutoffHz / static_cast<float>(currentSampleRate));
  state += alpha * (input - state);
  return state;
}

bool VoxanovaAudioProcessor::eqBandHasEffect(const EqBandSettings& settings)
{
  if (!settings.enabled)
    return false;

  if (settings.solo)
    return true;

  switch (settings.type)
  {
    case 2: // Desser
      return false;
    case 3: // Low Cut
    case 4: // High Cut
    case 7: // Notch
    case 8: // Band Pass
      return true;
    case fullSpectrumType: // Full Spectrum
      return std::abs(settings.gainDb) > 0.01f || eqBandHasCompressionTarget(settings) || eqBandHasSaturation(settings);
    default:
      return std::abs(settings.gainDb) > 0.01f || eqBandHasCompressionTarget(settings) || eqBandHasSaturation(settings);
  }
}

bool VoxanovaAudioProcessor::eqBandSupportsCompression(const EqBandSettings& settings)
{
  switch (settings.type)
  {
    case 0: // Bell
    case 1: // Surfer Bell
    case 5: // Low Shelf
    case 6: // High Shelf
    case 8: // Band Pass
    case fullSpectrumType: // Full Spectrum
      return true;
    default:
      return false;
  }
}

bool VoxanovaAudioProcessor::eqBandSupportsSaturation(const EqBandSettings& settings)
{
  return eqBandSupportsCompression(settings);
}

bool VoxanovaAudioProcessor::eqBandHasCompression(const EqBandSettings& settings)
{
  return eqBandHasCompressionTarget(settings) && settings.compEnabled;
}

bool VoxanovaAudioProcessor::eqBandHasSaturation(const EqBandSettings& settings)
{
  return settings.enabled && eqBandSupportsSaturation(settings) && settings.saturationMode > 0 &&
         settings.saturationAmount > 0.05f;
}

bool VoxanovaAudioProcessor::eqBandHasCompressionTarget(const EqBandSettings& settings)
{
  return settings.enabled && eqBandSupportsCompression(settings) && std::abs(settings.compDb - settings.gainDb) > 0.05f;
}

bool VoxanovaAudioProcessor::eqBandsNeedPitchTracking(const std::vector<EqBandSettings>& settings)
{
  return std::any_of(settings.begin(), settings.end(), [](const auto& band) {
    return band.enabled && band.type == 1;
  });
}

int VoxanovaAudioProcessor::eqFilterStageCount(int slopeDb)
{
  if (slopeDb >= eqWallSlopeDb)
    return eqMaxCutFilterStages;

  return juce::jlimit(1, eqMaxCutFilterStages, eqCutBiquadStageCount(slopeDb) +
                                                   (eqCutHasFirstOrderStage(slopeDb) ? 1 : 0));
}

bool VoxanovaAudioProcessor::eqCutHasFirstOrderStage(int slopeDb)
{
  if (slopeDb >= eqWallSlopeDb)
    return false;

  return slopeDb % 12 == 6;
}

int VoxanovaAudioProcessor::eqCutBiquadStageCount(int slopeDb)
{
  if (slopeDb >= eqWallSlopeDb)
    return eqMaxCutFilterStages;

  return juce::jlimit(0, eqMaxCutFilterStages, slopeDb / 12);
}

int VoxanovaAudioProcessor::eqBandFilterStageCount(const EqBandSettings& settings)
{
  if (settings.type == 3 || settings.type == 4)
    return eqFilterStageCount(settings.slopeDb) + 1;

  return settings.type == fullSpectrumType ? 2 : 1;
}

float VoxanovaAudioProcessor::getCutResonanceFrequency(const EqBandSettings& settings)
{
  const auto stageCount = juce::jmax(1, eqFilterStageCount(settings.slopeDb));
  const auto offsetOctaves = juce::jlimit(0.13f, 0.42f, 0.46f / std::sqrt(static_cast<float>(stageCount)));
  const auto ratio = std::pow(2.0f, offsetOctaves);
  return settings.type == 3
             ? juce::jlimit(20.0f, 20000.0f, settings.frequency * ratio)
             : juce::jlimit(20.0f, 20000.0f, settings.frequency / ratio);
}

float VoxanovaAudioProcessor::getCutResonanceQ(const EqBandSettings& settings)
{
  const auto stageCount = juce::jmax(1, eqFilterStageCount(settings.slopeDb));
  const auto gain = juce::jlimit(0.0f, 30.0f, settings.gainDb);
  return juce::jlimit(0.7f, 10.0f, 0.9f + std::sqrt(static_cast<float>(stageCount)) * 0.82f + gain * 0.055f);
}

float VoxanovaAudioProcessor::getFullSpectrumCenter(float lowHz, float highHz)
{
  return juce::jlimit(20.0f, 20000.0f, std::sqrt(juce::jmax(20.0f, lowHz) * juce::jmax(20.0f, highHz)));
}

std::array<float, 2> VoxanovaAudioProcessor::getFullSpectrumFallbackRange(float frequency, float q)
{
  const auto center = juce::jlimit(20.0f, 20000.0f, frequency);
  juce::ignoreUnused(q);
  constexpr auto factor = 2.0f;
  return {
    juce::jlimit(20.0f, 20000.0f, center / factor),
    juce::jlimit(20.0f, 20000.0f, center * factor)
  };
}

std::array<float, 2> VoxanovaAudioProcessor::normalizeFullSpectrumRange(float frequency, float q, float lowHz,
                                                                        float highHz)
{
  auto fallback = getFullSpectrumFallbackRange(frequency, q);
  auto low = lowHz;
  auto high = highHz;

  if (!std::isfinite(low) || !std::isfinite(high) || low <= 0.0f || high <= 0.0f || high <= low * fullSpectrumMinRatio)
  {
    low = fallback[0];
    high = fallback[1];
  }

  low = juce::jlimit(20.0f, 20000.0f, low);
  high = juce::jlimit(20.0f, 20000.0f, high);

  if (high <= low * fullSpectrumMinRatio)
  {
    const auto center = juce::jlimit(20.0f, 20000.0f, frequency);
    const auto halfRatio = std::sqrt(fullSpectrumMinRatio);
    low = juce::jlimit(20.0f, 20000.0f / fullSpectrumMinRatio, center / halfRatio);
    high = juce::jlimit(low * fullSpectrumMinRatio, 20000.0f, center * halfRatio);
  }

  return { low, high };
}

void VoxanovaAudioProcessor::setBiquadCoefficients(EqFilterStage& stage, float b0, float b1, float b2, float a0,
                                                   float a1, float a2)
{
  if (std::abs(a0) <= 0.000001f || !std::isfinite(a0))
  {
    stage.setBypass();
    return;
  }

  stage.setCoefficients(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
}

void VoxanovaAudioProcessor::setPeakingFilter(EqFilterStage& stage, float frequency, float q, float gainDb) const
{
  const auto safeRate = juce::jmax(1000.0f, static_cast<float>(currentSampleRate));
  const auto freq = juce::jlimit(20.0f, safeRate * 0.45f, frequency);
  const auto safeQ = juce::jlimit(0.1f, 50.0f, q);
  const auto omega = 2.0f * juce::MathConstants<float>::pi * freq / safeRate;
  const auto sinOmega = std::sin(omega);
  const auto cosOmega = std::cos(omega);
  const auto alpha = sinOmega / (2.0f * safeQ);
  const auto a = std::pow(10.0f, gainDb / 40.0f);

  setBiquadCoefficients(stage,
                        1.0f + alpha * a,
                        -2.0f * cosOmega,
                        1.0f - alpha * a,
                        1.0f + alpha / a,
                        -2.0f * cosOmega,
                        1.0f - alpha / a);
}

void VoxanovaAudioProcessor::setLowShelfFilter(EqFilterStage& stage, float frequency, float q, float gainDb) const
{
  const auto safeRate = juce::jmax(1000.0f, static_cast<float>(currentSampleRate));
  const auto freq = juce::jlimit(20.0f, safeRate * 0.45f, frequency);
  const auto slope = juce::jlimit(0.1f, 2.0f, q);
  const auto omega = 2.0f * juce::MathConstants<float>::pi * freq / safeRate;
  const auto sinOmega = std::sin(omega);
  const auto cosOmega = std::cos(omega);
  const auto a = std::pow(10.0f, gainDb / 40.0f);
  const auto twoSqrtAAlpha =
      2.0f * std::sqrt(a) * sinOmega * 0.5f *
      std::sqrt(juce::jmax(0.0f, (a + 1.0f / a) * (1.0f / slope - 1.0f) + 2.0f));

  setBiquadCoefficients(stage,
                        a * ((a + 1.0f) - (a - 1.0f) * cosOmega + twoSqrtAAlpha),
                        2.0f * a * ((a - 1.0f) - (a + 1.0f) * cosOmega),
                        a * ((a + 1.0f) - (a - 1.0f) * cosOmega - twoSqrtAAlpha),
                        (a + 1.0f) + (a - 1.0f) * cosOmega + twoSqrtAAlpha,
                        -2.0f * ((a - 1.0f) + (a + 1.0f) * cosOmega),
                        (a + 1.0f) + (a - 1.0f) * cosOmega - twoSqrtAAlpha);
}

void VoxanovaAudioProcessor::setHighShelfFilter(EqFilterStage& stage, float frequency, float q, float gainDb) const
{
  const auto safeRate = juce::jmax(1000.0f, static_cast<float>(currentSampleRate));
  const auto freq = juce::jlimit(20.0f, safeRate * 0.45f, frequency);
  const auto slope = juce::jlimit(0.1f, 2.0f, q);
  const auto omega = 2.0f * juce::MathConstants<float>::pi * freq / safeRate;
  const auto sinOmega = std::sin(omega);
  const auto cosOmega = std::cos(omega);
  const auto a = std::pow(10.0f, gainDb / 40.0f);
  const auto twoSqrtAAlpha =
      2.0f * std::sqrt(a) * sinOmega * 0.5f *
      std::sqrt(juce::jmax(0.0f, (a + 1.0f / a) * (1.0f / slope - 1.0f) + 2.0f));

  setBiquadCoefficients(stage,
                        a * ((a + 1.0f) + (a - 1.0f) * cosOmega + twoSqrtAAlpha),
                        -2.0f * a * ((a - 1.0f) + (a + 1.0f) * cosOmega),
                        a * ((a + 1.0f) + (a - 1.0f) * cosOmega - twoSqrtAAlpha),
                        (a + 1.0f) - (a - 1.0f) * cosOmega + twoSqrtAAlpha,
                        2.0f * ((a - 1.0f) - (a + 1.0f) * cosOmega),
                        (a + 1.0f) - (a - 1.0f) * cosOmega - twoSqrtAAlpha);
}

void VoxanovaAudioProcessor::setLowPassFilter(EqFilterStage& stage, float frequency, float q) const
{
  const auto safeRate = juce::jmax(1000.0f, static_cast<float>(currentSampleRate));
  const auto freq = juce::jlimit(20.0f, safeRate * 0.45f, frequency);
  const auto safeQ = juce::jlimit(0.25f, 4.0f, q);
  const auto omega = 2.0f * juce::MathConstants<float>::pi * freq / safeRate;
  const auto sinOmega = std::sin(omega);
  const auto cosOmega = std::cos(omega);
  const auto alpha = sinOmega / (2.0f * safeQ);

  setBiquadCoefficients(stage,
                        (1.0f - cosOmega) * 0.5f,
                        1.0f - cosOmega,
                        (1.0f - cosOmega) * 0.5f,
                        1.0f + alpha,
                        -2.0f * cosOmega,
                        1.0f - alpha);
}

void VoxanovaAudioProcessor::setLowPassFirstOrderFilter(EqFilterStage& stage, float frequency) const
{
  const auto safeRate = juce::jmax(1000.0f, static_cast<float>(currentSampleRate));
  const auto freq = juce::jlimit(20.0f, safeRate * 0.45f, frequency);
  const auto k = std::tan(juce::MathConstants<float>::pi * freq / safeRate);

  setBiquadCoefficients(stage, k, k, 0.0f, 1.0f + k, k - 1.0f, 0.0f);
}

void VoxanovaAudioProcessor::setHighPassFilter(EqFilterStage& stage, float frequency, float q) const
{
  const auto safeRate = juce::jmax(1000.0f, static_cast<float>(currentSampleRate));
  const auto freq = juce::jlimit(20.0f, safeRate * 0.45f, frequency);
  const auto safeQ = juce::jlimit(0.25f, 4.0f, q);
  const auto omega = 2.0f * juce::MathConstants<float>::pi * freq / safeRate;
  const auto sinOmega = std::sin(omega);
  const auto cosOmega = std::cos(omega);
  const auto alpha = sinOmega / (2.0f * safeQ);

  setBiquadCoefficients(stage,
                        (1.0f + cosOmega) * 0.5f,
                        -(1.0f + cosOmega),
                        (1.0f + cosOmega) * 0.5f,
                        1.0f + alpha,
                        -2.0f * cosOmega,
                        1.0f - alpha);
}

void VoxanovaAudioProcessor::setHighPassFirstOrderFilter(EqFilterStage& stage, float frequency) const
{
  const auto safeRate = juce::jmax(1000.0f, static_cast<float>(currentSampleRate));
  const auto freq = juce::jlimit(20.0f, safeRate * 0.45f, frequency);
  const auto k = std::tan(juce::MathConstants<float>::pi * freq / safeRate);

  setBiquadCoefficients(stage, 1.0f, -1.0f, 0.0f, 1.0f + k, k - 1.0f, 0.0f);
}

void VoxanovaAudioProcessor::setCutResonanceFilter(EqFilterStage& stage, const EqBandSettings& settings,
                                                   float gainDb) const
{
  const auto resonanceGainDb = juce::jlimit(0.0f, 30.0f, gainDb);
  if (resonanceGainDb <= 0.01f)
  {
    stage.setBypass();
    return;
  }

  setPeakingFilter(stage, getCutResonanceFrequency(settings), getCutResonanceQ(settings), resonanceGainDb);
}

void VoxanovaAudioProcessor::setNotchFilter(EqFilterStage& stage, float frequency, float q) const
{
  const auto safeRate = juce::jmax(1000.0f, static_cast<float>(currentSampleRate));
  const auto freq = juce::jlimit(20.0f, safeRate * 0.45f, frequency);
  const auto safeQ = juce::jlimit(0.1f, 50.0f, q);
  const auto omega = 2.0f * juce::MathConstants<float>::pi * freq / safeRate;
  const auto sinOmega = std::sin(omega);
  const auto cosOmega = std::cos(omega);
  const auto alpha = sinOmega / (2.0f * safeQ);

  setBiquadCoefficients(stage, 1.0f, -2.0f * cosOmega, 1.0f, 1.0f + alpha, -2.0f * cosOmega, 1.0f - alpha);
}

void VoxanovaAudioProcessor::setBandPassFilter(EqFilterStage& stage, float frequency, float q, float gainDb) const
{
  const auto safeRate = juce::jmax(1000.0f, static_cast<float>(currentSampleRate));
  const auto freq = juce::jlimit(20.0f, safeRate * 0.45f, frequency);
  const auto safeQ = juce::jlimit(0.1f, 50.0f, q);
  const auto omega = 2.0f * juce::MathConstants<float>::pi * freq / safeRate;
  const auto sinOmega = std::sin(omega);
  const auto cosOmega = std::cos(omega);
  const auto alpha = sinOmega / (2.0f * safeQ);
  const auto gain = dbToGain(gainDb);

  setBiquadCoefficients(stage, alpha * gain, 0.0f, -alpha * gain, 1.0f + alpha, -2.0f * cosOmega, 1.0f - alpha);
}

float VoxanovaAudioProcessor::getSurferEqFrequency(EqBandState& state, const EqBandSettings& settings) const
{
  const auto maxEqFrequency = juce::jmax(20.0f, static_cast<float>(currentSampleRate) * 0.45f);
  auto targetFrequency = juce::jlimit(20.0f, maxEqFrequency, settings.frequency);
  const auto detectedFrequency = tuneEngine.getDetectedFrequency();
  const auto detectorReady = detectedFrequency >= 55.0f && tuneEngine.getDetectedClarity() >= 0.58f;
  const auto staticFrequencyChanged = std::abs(settings.frequency - state.previousStaticFrequency) > 0.5f;

  if (!detectorReady && staticFrequencyChanged)
    state.hasSurferRatio = false;

  if (detectorReady)
  {
    const auto explicitRatio = settings.surfRatio > 0.0001f;

    if (explicitRatio)
    {
      state.surferRatio = settings.surfRatio;
      state.hasSurferRatio = true;
    }
    else if (!state.hasSurferRatio || staticFrequencyChanged)
    {
      state.surferRatio = juce::jlimit(0.125f, 128.0f, settings.frequency / detectedFrequency);
      state.hasSurferRatio = true;
    }

    if (state.hasSurferRatio)
    {
      const auto trackedFrequency = juce::jlimit(20.0f, maxEqFrequency, detectedFrequency * state.surferRatio);
      const auto trackingWindow = getSurferTrackingWindow(settings.frequency, maxEqFrequency);
      targetFrequency = trackedFrequency >= trackingWindow[0] && trackedFrequency <= trackingWindow[1]
                            ? trackedFrequency
                            : juce::jlimit(20.0f, maxEqFrequency, settings.frequency);
    }
  }

  state.previousStaticFrequency = settings.frequency;

  if (!detectorReady)
  {
    state.surferFrequency = targetFrequency;
    return state.surferFrequency;
  }

  if (!state.hasSurferFrequency)
  {
    state.surferFrequency = targetFrequency;
    state.hasSurferFrequency = true;
  }
  else
  {
    state.surferFrequency = targetFrequency + 0.68f * (state.surferFrequency - targetFrequency);
  }

  return state.surferFrequency;
}

void VoxanovaAudioProcessor::configureEqBandForGain(EqBandState& state, const EqBandSettings& settings,
                                                    float gainDb) const
{
  const auto bandFrequency =
      settings.type == 1 && state.hasSurferFrequency ? state.surferFrequency : settings.frequency;
  const auto safeGainDb = juce::jlimit(-30.0f, 30.0f, gainDb);

  for (auto& channelStages : state.filters)
  {
    for (auto& stage : channelStages)
      stage.setBypass();

    switch (settings.type)
    {
      case 1: // Surfer Bell
        setPeakingFilter(channelStages[0], bandFrequency, juce::jlimit(0.1f, 50.0f, settings.q * 0.58f),
                         safeGainDb);
        break;
      case 3: // Low Cut
      {
        auto stage = 0;
        if (eqCutHasFirstOrderStage(settings.slopeDb))
          setHighPassFirstOrderFilter(channelStages[static_cast<size_t>(stage++)], bandFrequency);
        for (auto biquad = 0; biquad < eqCutBiquadStageCount(settings.slopeDb); ++biquad)
          setHighPassFilter(channelStages[static_cast<size_t>(stage++)], bandFrequency, 0.7071f);
        setCutResonanceFilter(channelStages[static_cast<size_t>(stage)], settings, safeGainDb);
        break;
      }
      case 4: // High Cut
      {
        auto stage = 0;
        if (eqCutHasFirstOrderStage(settings.slopeDb))
          setLowPassFirstOrderFilter(channelStages[static_cast<size_t>(stage++)], bandFrequency);
        for (auto biquad = 0; biquad < eqCutBiquadStageCount(settings.slopeDb); ++biquad)
          setLowPassFilter(channelStages[static_cast<size_t>(stage++)], bandFrequency, 0.7071f);
        setCutResonanceFilter(channelStages[static_cast<size_t>(stage)], settings, safeGainDb);
        break;
      }
      case 5: // Low Shelf
        setLowShelfFilter(channelStages[0], bandFrequency, settings.q, safeGainDb);
        break;
      case 6: // High Shelf
        setHighShelfFilter(channelStages[0], bandFrequency, settings.q, safeGainDb);
        break;
      case 7: // Notch
        setNotchFilter(channelStages[0], bandFrequency, settings.q);
        break;
      case 8: // Band Pass
        setBandPassFilter(channelStages[0], bandFrequency, settings.q, safeGainDb);
        break;
      case fullSpectrumType: // Full Spectrum
        juce::ignoreUnused(safeGainDb);
        setHighPassFilter(channelStages[0], settings.rangeLowHz, 0.7071f);
        setLowPassFilter(channelStages[1], settings.rangeHighHz, 0.7071f);
        break;
      case 2: // Desser
        break;
      case 0: // Bell
      default:
        setPeakingFilter(channelStages[0], bandFrequency, settings.q, safeGainDb);
        break;
    }
  }
}

void VoxanovaAudioProcessor::configureEqBandSolo(EqBandState& state, const EqBandSettings& settings) const
{
  const auto bandFrequency =
      settings.type == 1 && state.hasSurferFrequency ? state.surferFrequency : settings.frequency;

  for (auto& channelStages : state.soloFilters)
  {
    for (auto& stage : channelStages)
      stage.setBypass();

    if (!settings.enabled || !settings.solo)
      continue;

    switch (settings.type)
    {
      case 3: // Low Cut
      case 5: // Low Shelf
        setLowPassFilter(channelStages[0], bandFrequency, 0.7071f);
        break;
      case 4: // High Cut
      case 6: // High Shelf
        setHighPassFilter(channelStages[0], bandFrequency, 0.7071f);
        break;
      case 1: // Surfer Bell
        setBandPassFilter(channelStages[0], bandFrequency, juce::jlimit(0.1f, 50.0f, settings.q * 0.58f), 0.0f);
        break;
      case 0: // Bell
      case 7: // Notch
      case 8: // Band Pass
        setBandPassFilter(channelStages[0], bandFrequency, settings.q, 0.0f);
        break;
      case fullSpectrumType: // Full Spectrum
        setHighPassFilter(channelStages[0], settings.rangeLowHz, 0.7071f);
        setLowPassFilter(channelStages[1], settings.rangeHighHz, 0.7071f);
        break;
      default:
        setBandPassFilter(channelStages[0], bandFrequency, settings.q, 0.0f);
        break;
    }
  }
}

void VoxanovaAudioProcessor::configureEqBandCompressionDetector(EqBandState& state,
                                                                const EqBandSettings& settings) const
{
  for (auto& detector : state.compDetectorFilters)
    for (auto& stage : detector)
      stage.setBypass();

  if (!eqBandHasCompressionTarget(settings))
    return;

  const auto bandFrequency =
      settings.type == 1 && state.hasSurferFrequency ? state.surferFrequency : settings.frequency;
  const auto detectorQ = settings.type == 1
                             ? juce::jlimit(0.1f, 50.0f, settings.q * 0.58f)
                             : juce::jlimit(0.35f, 50.0f, settings.q * 0.48f);

  for (auto& detectorStages : state.compDetectorFilters)
  {
    switch (settings.type)
    {
      case 5: // Low Shelf
        setLowPassFilter(detectorStages[0], bandFrequency, 0.7071f);
        break;
      case 6: // High Shelf
        setHighPassFilter(detectorStages[0], bandFrequency, 0.7071f);
        break;
      case fullSpectrumType: // Full Spectrum
        setHighPassFilter(detectorStages[0], settings.rangeLowHz, 0.7071f);
        setLowPassFilter(detectorStages[1], settings.rangeHighHz, 0.7071f);
        break;
      case 0: // Bell
      case 1: // Surfer Bell
      case 8: // Band Pass
      default:
        setBandPassFilter(detectorStages[0], bandFrequency, detectorQ, 0.0f);
        break;
    }
  }
}

void VoxanovaAudioProcessor::configureEqBandSaturationFilter(EqBandState& state,
                                                             const EqBandSettings& settings) const
{
  for (auto& channelStages : state.saturationFilters)
    for (auto& stage : channelStages)
      stage.setBypass();

  if (!eqBandHasSaturation(settings))
  {
    state.saturationState = {};
    return;
  }

  const auto bandFrequency =
      settings.type == 1 && state.hasSurferFrequency ? state.surferFrequency : settings.frequency;
  const auto bandQ = settings.type == 1
                         ? juce::jlimit(0.1f, 50.0f, settings.q * 0.58f)
                         : juce::jlimit(0.35f, 50.0f, settings.q * 0.58f);

  for (auto& channelStages : state.saturationFilters)
  {
    switch (settings.type)
    {
      case 5: // Low Shelf
        setLowPassFilter(channelStages[0], bandFrequency, 0.7071f);
        break;
      case 6: // High Shelf
        setHighPassFilter(channelStages[0], bandFrequency, 0.7071f);
        break;
      case fullSpectrumType: // Full Spectrum
        setHighPassFilter(channelStages[0], settings.rangeLowHz, 0.7071f);
        setLowPassFilter(channelStages[1], settings.rangeHighHz, 0.7071f);
        break;
      case 0: // Bell
      case 1: // Surfer Bell
      case 8: // Band Pass
      default:
        setBandPassFilter(channelStages[0], bandFrequency, bandQ, 0.0f);
        break;
    }
  }
}

void VoxanovaAudioProcessor::configureEqBand(EqBandState& state, const EqBandSettings& settings) const
{
  const auto active = eqBandHasEffect(settings);
  const auto stageCount = eqBandFilterStageCount(settings);

  if (!active)
  {
    if (state.wasActive)
      state.reset();
    return;
  }

  const auto resetState = !state.wasActive || state.previousType != settings.type || state.previousStageCount != stageCount;
  if (resetState)
    state.reset();

  state.wasActive = true;
  state.previousType = settings.type;
  state.previousStageCount = stageCount;

  if (settings.type == 1)
    getSurferEqFrequency(state, settings);

  if (!state.compGainInitialized || !eqBandHasCompression(settings))
  {
    state.compGainDb = settings.gainDb;
    state.compGainInitialized = true;
  }

  configureEqBandCompressionDetector(state, settings);
  configureEqBandSaturationFilter(state, settings);
  configureEqBandForGain(state, settings, settings.gainDb);
  configureEqBandSolo(state, settings);
}

void VoxanovaAudioProcessor::prepareEq(std::vector<EqBandState>& states,
                                       const std::vector<EqBandSettings>& settings) const
{
  if (states.size() < settings.size())
  {
    const auto oldSize = states.size();
    states.resize(settings.size());
    for (auto index = oldSize; index < states.size(); ++index)
      states[index].reset();
  }

  for (auto index = 0u; index < settings.size(); ++index)
    configureEqBand(states[index], settings[index]);

  for (auto index = settings.size(); index < states.size(); ++index)
    if (states[index].wasActive)
      states[index].reset();
}

float VoxanovaAudioProcessor::updateEqBandDetectorLevel(EqBandState& state, const EqBandSettings& settings, float left,
                                                        float right) const
{
  if (!eqBandHasCompressionTarget(settings))
  {
    state.compDetectorDb = -120.0f;
    return state.compDetectorDb;
  }

  auto detectorLeft = left;
  auto detectorRight = right;
  for (auto& detector : state.compDetectorFilters[0])
    detectorLeft = detector.process(detectorLeft);
  for (auto& detector : state.compDetectorFilters[1])
    detectorRight = detector.process(detectorRight);
  const auto peakDetector = juce::jmax(std::abs(detectorLeft), std::abs(detectorRight));
  const auto rmsDetector = std::sqrt((detectorLeft * detectorLeft + detectorRight * detectorRight) * 0.5f);
  const auto detector = peakDetector * 0.58f + rmsDetector * 0.42f;
  const auto safeRate = juce::jmax(1000.0f, static_cast<float>(currentSampleRate));
  const auto detectorAttackMs = juce::jlimit(0.1f, 200.0f, settings.compAttackMs * 0.72f);
  const auto detectorReleaseMs = juce::jlimit(5.0f, 1000.0f, settings.compReleaseMs);
  const auto detectorCoeff =
      detector > state.compEnvelope
          ? std::exp(-1.0f / (safeRate * (detectorAttackMs / 1000.0f)))
          : std::exp(-1.0f / (safeRate * (detectorReleaseMs / 1000.0f)));
  state.compEnvelope = detector + detectorCoeff * (state.compEnvelope - detector);

  const auto detectorDb = state.compEnvelope > 0.000001f
                              ? juce::jlimit(-120.0f, 24.0f,
                                             juce::Decibels::gainToDecibels(state.compEnvelope) +
                                                 eqDynamicDetectorCalibrationDb)
                              : -120.0f;
  state.compDetectorDb = detectorDb;

  return detectorDb;
}

float VoxanovaAudioProcessor::updateEqBandDynamicGain(EqBandState& state, const EqBandSettings& settings, float left,
                                                      float right) const
{
  if (!eqBandHasCompressionTarget(settings))
    return settings.gainDb;

  if (!state.compGainInitialized)
  {
    state.compGainDb = settings.gainDb;
    state.compGainInitialized = true;
  }

  const auto detectorDb = updateEqBandDetectorLevel(state, settings, left, right);

  if (!eqBandHasCompression(settings))
  {
    state.compGainDb = settings.gainDb;
    return settings.gainDb;
  }

  const auto overDb = juce::jmax(0.0f, detectorDb - settings.compThresholdDb);
  const auto kneeEngagement = thresholdEngagement(detectorDb, settings.compThresholdDb, 6.0f);
  const auto dynamicRangeDb = std::abs(settings.compDb - settings.gainDb);
  const auto ratio = juce::jlimit(1.0f, 20.0f, settings.compRatio);
  const auto ratioMoveDb = overDb * (1.0f - 1.0f / ratio);
  const auto ratioEngagement = dynamicRangeDb > 0.001f
                                   ? juce::jlimit(0.0f, 1.0f, ratioMoveDb / dynamicRangeDb)
                                   : 0.0f;
  const auto engagement = juce::jlimit(0.0f, 1.0f, kneeEngagement * ratioEngagement);
  const auto targetGainDb = juce::jlimit(-30.0f, 30.0f,
                                         settings.gainDb + (settings.compDb - settings.gainDb) * engagement);
  const auto currentDepth = std::abs(state.compGainDb - settings.gainDb);
  const auto targetDepth = std::abs(targetGainDb - settings.gainDb);
  const auto gainTimeMs = targetDepth > currentDepth ? settings.compAttackMs : settings.compReleaseMs;
  const auto safeRate = juce::jmax(1000.0f, static_cast<float>(currentSampleRate));
  const auto gainCoeff = std::exp(-1.0f / (safeRate * (juce::jmax(0.1f, gainTimeMs) / 1000.0f)));
  state.compGainDb = targetGainDb + gainCoeff * (state.compGainDb - targetGainDb);

  return juce::jlimit(-30.0f, 30.0f, state.compGainDb);
}

void VoxanovaAudioProcessor::applyEqBandSaturation(EqBandState& state, const EqBandSettings& settings, float& left,
                                                   float& right) const
{
  if (!eqBandHasSaturation(settings))
    return;

  auto bandLeft = left;
  auto bandRight = right;
  for (auto stage = 0; stage < 2; ++stage)
  {
    bandLeft = state.saturationFilters[0][static_cast<size_t>(stage)].process(bandLeft);
    bandRight = state.saturationFilters[1][static_cast<size_t>(stage)].process(bandRight);
  }

  const auto saturatedLeft =
      applySaturationModel(bandLeft, settings.saturationMode, settings.saturationAmount, state.saturationState, 0);
  const auto saturatedRight =
      applySaturationModel(bandRight, settings.saturationMode, settings.saturationAmount, state.saturationState, 1);

  left = juce::jlimit(-4.0f, 4.0f, left + saturatedLeft - bandLeft);
  right = juce::jlimit(-4.0f, 4.0f, right + saturatedRight - bandRight);
}

void VoxanovaAudioProcessor::applyEq(std::vector<EqBandState>& states, const std::vector<EqBandSettings>& settings,
                                     float& left, float& right,
                                     std::array<std::atomic<float>, eqMeterBandCount>& detectorDbMeters)
{
  const auto count = juce::jmin(states.size(), settings.size());
  const auto hasSolo = std::any_of(settings.begin(), settings.begin() + static_cast<std::ptrdiff_t>(count),
                                   [](const auto& band) { return band.enabled && band.solo; });

  if (hasSolo)
  {
    const auto sourceLeft = left;
    const auto sourceRight = right;
    auto soloLeft = 0.0f;
    auto soloRight = 0.0f;

    for (auto index = 0u; index < count; ++index)
    {
      const auto& band = settings[index];
      if (!band.enabled || !band.solo)
        continue;

      auto& state = states[index];
      auto bandLeft = sourceLeft;
      auto bandRight = sourceRight;
      auto effectiveGainDb = band.gainDb;

      if (eqBandHasCompressionTarget(band))
      {
        effectiveGainDb = updateEqBandDynamicGain(state, band, sourceLeft, sourceRight);
        configureEqBandForGain(state, band, effectiveGainDb);
        if (index < detectorDbMeters.size())
          detectorDbMeters[index].store(state.compDetectorDb, std::memory_order_relaxed);
      }

      const auto eqStageCount = eqBandFilterStageCount(band);
      for (auto stage = 0; stage < eqStageCount; ++stage)
      {
        bandLeft = state.filters[0][static_cast<size_t>(stage)].process(bandLeft);
        bandRight = state.filters[1][static_cast<size_t>(stage)].process(bandRight);
      }

      if (band.type == fullSpectrumType)
      {
        const auto bandGain = dbToGain(effectiveGainDb);
        auto processedLeft = bandLeft * bandGain;
        auto processedRight = bandRight * bandGain;
        if (eqBandHasSaturation(band))
        {
          processedLeft =
              applySaturationModel(processedLeft, band.saturationMode, band.saturationAmount, state.saturationState, 0);
          processedRight =
              applySaturationModel(processedRight, band.saturationMode, band.saturationAmount, state.saturationState, 1);
        }
        soloLeft += processedLeft;
        soloRight += processedRight;
        continue;
      }

      for (auto stage = 0; stage < 2; ++stage)
      {
        bandLeft = state.soloFilters[0][static_cast<size_t>(stage)].process(bandLeft);
        bandRight = state.soloFilters[1][static_cast<size_t>(stage)].process(bandRight);
      }

      if (eqBandHasSaturation(band))
      {
        bandLeft = applySaturationModel(bandLeft, band.saturationMode, band.saturationAmount, state.saturationState, 0);
        bandRight =
            applySaturationModel(bandRight, band.saturationMode, band.saturationAmount, state.saturationState, 1);
      }

      soloLeft += bandLeft;
      soloRight += bandRight;
    }

    left = juce::jlimit(-4.0f, 4.0f, soloLeft);
    right = juce::jlimit(-4.0f, 4.0f, soloRight);
    return;
  }

  for (auto index = 0u; index < count; ++index)
  {
    const auto& band = settings[index];
    if (!eqBandHasEffect(band))
      continue;

    auto& state = states[index];
    if (band.type == 2)
      continue;

    auto effectiveGainDb = band.gainDb;
    if (eqBandHasCompressionTarget(band))
    {
      effectiveGainDb = updateEqBandDynamicGain(state, band, left, right);
      configureEqBandForGain(state, band, effectiveGainDb);
      if (index < detectorDbMeters.size())
        detectorDbMeters[index].store(state.compDetectorDb, std::memory_order_relaxed);
    }

    if (band.type == fullSpectrumType)
    {
      auto bandLeft = left;
      auto bandRight = right;
      const auto stageCount = eqBandFilterStageCount(band);
      for (auto stage = 0; stage < stageCount; ++stage)
      {
        bandLeft = state.filters[0][static_cast<size_t>(stage)].process(bandLeft);
        bandRight = state.filters[1][static_cast<size_t>(stage)].process(bandRight);
      }

      const auto bandGain = dbToGain(effectiveGainDb);
      auto processedLeft = bandLeft * bandGain;
      auto processedRight = bandRight * bandGain;
      if (eqBandHasSaturation(band))
      {
        processedLeft =
            applySaturationModel(processedLeft, band.saturationMode, band.saturationAmount, state.saturationState, 0);
        processedRight =
            applySaturationModel(processedRight, band.saturationMode, band.saturationAmount, state.saturationState, 1);
      }

      left = juce::jlimit(-4.0f, 4.0f, left + processedLeft - bandLeft);
      right = juce::jlimit(-4.0f, 4.0f, right + processedRight - bandRight);
      continue;
    }

    const auto stageCount = eqBandFilterStageCount(band);
    for (auto stage = 0; stage < stageCount; ++stage)
    {
      left = state.filters[0][static_cast<size_t>(stage)].process(left);
      right = state.filters[1][static_cast<size_t>(stage)].process(right);
    }

    applyEqBandSaturation(state, band, left, right);
  }
}

void VoxanovaAudioProcessor::applyEqDeEsser(EqBandState& state, const EqBandSettings& settings, float& left,
                                            float& right)
{
  const auto amount = juce::jlimit(0.0f, 1.0f, settings.intensity / 100.0f);
  if (amount <= 0.0f)
    return;

  const auto splitHz =
      juce::jlimit(1800.0f, static_cast<float>(currentSampleRate) * 0.42f,
                   settings.frequency * (settings.deessMode == 1 ? 0.68f : 1.0f));
  const auto detectorAttackMs = settings.deessMode == 1 ? 0.75f : 0.35f;
  const auto detectorReleaseMs = settings.deessMode == 1 ? 72.0f : 42.0f;
  const auto gainAttackMs = settings.deessMode == 1 ? 1.4f : 0.65f;
  const auto gainReleaseMs = settings.deessMode == 1 ? 96.0f : 58.0f;

  const auto lowLeft = processOnePoleLowpass(left, splitHz, state.deEsserLowStates[0]);
  const auto lowRight = processOnePoleLowpass(right, splitHz, state.deEsserLowStates[1]);
  const auto highLeft = left - lowLeft;
  const auto highRight = right - lowRight;
  const auto peakDetector = juce::jmax(std::abs(highLeft), std::abs(highRight));
  const auto rmsDetector = std::sqrt((highLeft * highLeft + highRight * highRight) * 0.5f);
  const auto detector = peakDetector * 0.62f + rmsDetector * 0.38f;

  const auto detectorCoeff =
      detector > state.deEsserEnvelope
          ? std::exp(-1.0f / static_cast<float>(currentSampleRate * (detectorAttackMs / 1000.0f)))
          : std::exp(-1.0f / static_cast<float>(currentSampleRate * (detectorReleaseMs / 1000.0f)));
  state.deEsserEnvelope = detector + detectorCoeff * (state.deEsserEnvelope - detector);

  const auto detectorDb = state.deEsserEnvelope > 0.000001f
                              ? juce::Decibels::gainToDecibels(state.deEsserEnvelope)
                              : -120.0f;
  const auto overDb = juce::jmax(0.0f, detectorDb - settings.thresholdDb);
  const auto maxReductionDb = 1.5f + amount * (settings.deessMode == 1 ? 12.0f : 18.0f);
  const auto targetReductionDb = juce::jlimit(0.0f, maxReductionDb, overDb * (0.32f + amount * 0.62f));
  const auto targetGain = dbToGain(-targetReductionDb);
  const auto gainCoeff =
      targetGain < state.deEsserGain
          ? std::exp(-1.0f / static_cast<float>(currentSampleRate * (gainAttackMs / 1000.0f)))
          : std::exp(-1.0f / static_cast<float>(currentSampleRate * (gainReleaseMs / 1000.0f)));
  state.deEsserGain = targetGain + gainCoeff * (state.deEsserGain - targetGain);

  left = lowLeft + highLeft * state.deEsserGain;
  right = lowRight + highRight * state.deEsserGain;
}

void VoxanovaAudioProcessor::resetEqStates(std::vector<EqBandState>& states)
{
  for (auto& state : states)
    state.reset();
}

VoxanovaAudioProcessor::GateResult VoxanovaAudioProcessor::applyVocalGate(float left, float right, float detectorLeft,
                                                                          float detectorRight, float thresholdDb)
{
  GateResult result { left, right, 0.0f };

  if (thresholdDb <= -79.9f)
  {
    gateEnvelope = 0.0f;
    gateSmoothedGain = 1.0f;
    gateHoldSamples = 0;
    result.detectorLevel = peakToFader(juce::jmax(std::abs(detectorLeft), std::abs(detectorRight)), -80.0f, 0.0f);
    return result;
  }

  constexpr auto detectorAttackMs = 0.75f;
  constexpr auto detectorReleaseMs = 48.0f;
  constexpr auto openAttackMs = 2.2f;
  constexpr auto closeReleaseMs = 125.0f;
  constexpr auto closeDeepReleaseMs = 185.0f;
  constexpr auto holdMs = 58.0f;
  constexpr auto closeKneeDb = 12.0f;
  constexpr auto maxReductionDb = 120.0f;

  const auto peakDetector = juce::jmax(std::abs(detectorLeft), std::abs(detectorRight));
  const auto rmsDetector = std::sqrt((detectorLeft * detectorLeft + detectorRight * detectorRight) * 0.5f);
  const auto detector = peakDetector * 0.46f + rmsDetector * 0.54f;

  const auto detectorCoeff =
      detector > gateEnvelope
          ? std::exp(-1.0f / static_cast<float>(currentSampleRate * (detectorAttackMs / 1000.0f)))
          : std::exp(-1.0f / static_cast<float>(currentSampleRate * (detectorReleaseMs / 1000.0f)));
  gateEnvelope = detector + detectorCoeff * (gateEnvelope - detector);
  result.detectorLevel = peakToFader(gateEnvelope, -80.0f, 0.0f);

  const auto envelopeDb = gateEnvelope > 0.000001f ? juce::Decibels::gainToDecibels(gateEnvelope) : -120.0f;
  auto targetReductionDb = 0.0f;

  if (envelopeDb >= thresholdDb)
  {
    gateHoldSamples = juce::roundToInt(currentSampleRate * (holdMs / 1000.0));
  }
  else if (gateHoldSamples > 0)
  {
    --gateHoldSamples;
  }
  else
  {
    const auto underThresholdDb = thresholdDb - envelopeDb;
    const auto closeProgress = juce::jlimit(0.0f, 1.0f, underThresholdDb / closeKneeDb);
    const auto softClose = closeProgress * closeProgress * (3.0f - 2.0f * closeProgress);
    targetReductionDb = maxReductionDb * softClose;
  }

  const auto targetGateGain = dbToGain(-juce::jlimit(0.0f, maxReductionDb, targetReductionDb));
  const auto closeDepth = juce::jlimit(0.0f, 1.0f, targetReductionDb / maxReductionDb);
  const auto effectiveCloseReleaseMs = closeReleaseMs + (closeDeepReleaseMs - closeReleaseMs) * closeDepth;
  const auto gainCoeff =
      targetGateGain > gateSmoothedGain
          ? std::exp(-1.0f / static_cast<float>(currentSampleRate * (openAttackMs / 1000.0f)))
          : std::exp(-1.0f / static_cast<float>(currentSampleRate * (effectiveCloseReleaseMs / 1000.0f)));
  gateSmoothedGain = targetGateGain + gainCoeff * (gateSmoothedGain - targetGateGain);

  result.left = left * gateSmoothedGain;
  result.right = right * gateSmoothedGain;

  const auto reductionDb =
      gateSmoothedGain > 0.000001f && gateSmoothedGain < 0.999f ? -juce::Decibels::gainToDecibels(gateSmoothedGain)
                                                                 : targetReductionDb;
  result.reductionDb = reductionDb > 0.02f ? reductionDb : 0.0f;
  result.reduction = reductionDb > 0.02f ? juce::jlimit(0.0f, 100.0f, reductionDb / maxReductionDb * 100.0f) : 0.0f;
  return result;
}
VoxanovaAudioProcessor::CompressorResult VoxanovaAudioProcessor::applyPeakTamer(float left, float right,
                                                                                float thresholdDb,
                                                                                CompressorState& state) const
{
  CompressorResult result { left, right, 0.0f };

  const auto rawDetector = juce::jmax(std::abs(left), std::abs(right));

  constexpr auto detectorAttackMs = 0.18f;
  constexpr auto detectorReleaseMs = 54.0f;
  constexpr auto gainAttackMs = 0.75f;
  constexpr auto minReleaseMs = 62.0f;
  constexpr auto maxReleaseMs = 260.0f;
  constexpr auto ratio = 12.0f;
  constexpr auto kneeDb = 10.0f;
  constexpr auto maxReductionDb = 28.0f;
  constexpr auto recoveryRatio = 0.28f;
  constexpr auto outputLiftRatio = 0.06f;
  constexpr auto thresholdLiftRatio = 0.025f;
  constexpr auto maxOutputLiftDb = 3.2f;
  constexpr auto inputKneeDb = 18.0f;
  constexpr auto engagementAttackMs = 5.0f;
  constexpr auto engagementHoldMs = 48.0f;
  constexpr auto engagementReleaseMs = 150.0f;

  const auto rawLevelDb = rawDetector > 0.000001f ? juce::Decibels::gainToDecibels(rawDetector) : -120.0f;
  auto targetEngagement = thresholdEngagement(rawLevelDb, thresholdDb, inputKneeDb);

  if (targetEngagement > state.engagement + 0.001f)
  {
    state.holdSamples = juce::roundToInt(currentSampleRate * (engagementHoldMs / 1000.0));
  }
  else if (state.holdSamples > 0)
  {
    targetEngagement = juce::jmax(targetEngagement, state.engagement);
    --state.holdSamples;
  }

  const auto engagementCoeff =
      targetEngagement > state.engagement
          ? std::exp(-1.0f / static_cast<float>(currentSampleRate * (engagementAttackMs / 1000.0f)))
          : std::exp(-1.0f / static_cast<float>(currentSampleRate * (engagementReleaseMs / 1000.0f)));
  state.engagement = targetEngagement + engagementCoeff * (state.engagement - targetEngagement);

  const auto pushDepth = juce::jlimit(0.0f, 1.0f, -thresholdDb / 60.0f);
  const auto inputPushDb = 42.0f * std::pow(pushDepth, 1.18f) * state.engagement;
  const auto inputPushGain = dbToGain(inputPushDb);
  const auto drivenLeft = left * inputPushGain;
  const auto drivenRight = right * inputPushGain;
  const auto detector = juce::jmax(std::abs(drivenLeft), std::abs(drivenRight));

  const auto detectorCoeff =
      detector > state.envelope
          ? std::exp(-1.0f / static_cast<float>(currentSampleRate * (detectorAttackMs / 1000.0f)))
          : std::exp(-1.0f / static_cast<float>(currentSampleRate * (detectorReleaseMs / 1000.0f)));
  state.envelope = detector + detectorCoeff * (state.envelope - detector);
  result.detectorLevel = peakToFader(state.envelope, compressorMinDb, compressorMaxDb);

  auto targetGainDb = 0.0f;
  const auto levelDb = state.envelope > 0.000001f ? juce::Decibels::gainToDecibels(state.envelope) : -120.0f;
  const auto overDb = levelDb - thresholdDb;
  const auto halfKnee = kneeDb * 0.5f;

  if (overDb > 0.0f && overDb < kneeDb)
  {
    targetGainDb = (1.0f / ratio - 1.0f) * overDb * overDb / (2.0f * kneeDb);
  }
  else if (overDb >= kneeDb)
  {
    targetGainDb = (1.0f / ratio - 1.0f) * (overDb - halfKnee);
  }

  const auto unclampedReductionDb = juce::jmax(0.0f, -targetGainDb);
  const auto dynamicMaxReductionDb = maxReductionDb + pushDepth * 8.0f;
  const auto shapedReductionDb =
      dynamicMaxReductionDb * (1.0f - std::exp(-unclampedReductionDb / dynamicMaxReductionDb));
  targetGainDb = -juce::jlimit(0.0f, dynamicMaxReductionDb, shapedReductionDb);

  const auto targetGain = dbToGain(targetGainDb);
  const auto reductionDepth = juce::jlimit(0.0f, 1.0f, -targetGainDb / dynamicMaxReductionDb);
  const auto releaseCurve = reductionDepth * reductionDepth * (3.0f - 2.0f * reductionDepth);
  const auto releaseMs = minReleaseMs + (maxReleaseMs - minReleaseMs) * releaseCurve;
  const auto gainCoeff =
      targetGain < state.gain
          ? std::exp(-1.0f / static_cast<float>(currentSampleRate * (gainAttackMs / 1000.0f)))
          : std::exp(-1.0f / static_cast<float>(currentSampleRate * (releaseMs / 1000.0f)));
  state.gain = targetGain + gainCoeff * (state.gain - targetGain);

  const auto reductionDb = state.gain < 0.999f ? -juce::Decibels::gainToDecibels(state.gain) : 0.0f;
  const auto requestedReductionDb = juce::jmax(0.0f, -targetGainDb);
  const auto recoveryDb = reductionDb * recoveryRatio;
  const auto outputLiftDb = reductionDb > 0.02f ? requestedReductionDb * outputLiftRatio : 0.0f;
  const auto thresholdLiftDb = reductionDb > 0.02f ? juce::jmax(0.0f, -thresholdDb) * thresholdLiftRatio : 0.0f;
  const auto inputLiftDb = reductionDb > 0.02f ? pushDepth * state.engagement * 1.6f : 0.0f;
  const auto dynamicMaxOutputLiftDb = maxOutputLiftDb + pushDepth * 2.6f;
  const auto outputDb = reductionDb > 0.02f
                            ? juce::jlimit(0.0f, dynamicMaxOutputLiftDb,
                                           recoveryDb + outputLiftDb + thresholdLiftDb + inputLiftDb)
                            : 0.0f;
  const auto outputGain = dbToGain(outputDb);

  result.left = left * state.gain * outputGain;
  result.right = right * state.gain * outputGain;
  result.reductionDb = reductionDb > 0.02f ? reductionDb : 0.0f;
  result.reduction =
      reductionDb > 0.02f ? juce::jlimit(0.0f, 100.0f, reductionDb / dynamicMaxReductionDb * 100.0f) : 0.0f;
  return result;
}

VoxanovaAudioProcessor::CompressorResult VoxanovaAudioProcessor::applyGlueCompressor(float left, float right,
                                                                                     float thresholdDb,
                                                                                     CompressorState& state,
                                                                                     bool multiband,
                                                                                     int bandIndex) const
{
  juce::ignoreUnused(bandIndex);

  CompressorResult result { left, right, 0.0f };

  const auto rawPeakDetector = juce::jmax(std::abs(left), std::abs(right));
  const auto rawRmsDetector = std::sqrt((left * left + right * right) * 0.5f);
  const auto rawDetector = multiband ? rawPeakDetector : rawPeakDetector * 0.48f + rawRmsDetector * 0.52f;

  auto detectorAttackMs = 7.5f;
  auto detectorReleaseMs = 115.0f;
  auto gainAttackMs = 6.0f;
  auto minReleaseMs = 125.0f;
  auto maxReleaseMs = 620.0f;
  auto ratio = 4.25f;
  auto kneeDb = 9.0f;
  auto maxReductionDb = 14.0f;
  auto makeupRatio = 0.74f;
  auto outputLiftRatio = 0.30f;
  auto thresholdLiftRatio = 0.09f;
  auto maxMakeupDb = 9.5f;
  auto maxInputPushDb = 36.0f;
  auto inputKneeDb = 8.0f;
  auto engagementAttackMs = 10.0f;
  auto engagementHoldMs = 70.0f;
  auto engagementReleaseMs = 320.0f;

  if (multiband)
  {
    detectorAttackMs = 2.5f;
    detectorReleaseMs = 250.0f;
    gainAttackMs = 2.5f;
    minReleaseMs = 250.0f;
    maxReleaseMs = 250.0f;
    ratio = 2.0f;
    kneeDb = 0.0f;
    maxReductionDb = 48.0f;
    makeupRatio = 0.0f;
    outputLiftRatio = 0.0f;
    thresholdLiftRatio = 0.0f;
    maxMakeupDb = 0.0f;
    maxInputPushDb = 0.0f;
    inputKneeDb = 0.0f;
    engagementAttackMs = 2.5f;
    engagementHoldMs = 0.0f;
    engagementReleaseMs = 250.0f;
  }

  const auto rawLevelDb = rawDetector > 0.000001f ? juce::Decibels::gainToDecibels(rawDetector) : -120.0f;
  auto targetEngagement = thresholdEngagement(rawLevelDb, thresholdDb, inputKneeDb);

  if (targetEngagement > state.engagement + 0.001f)
  {
    state.holdSamples = juce::roundToInt(currentSampleRate * (engagementHoldMs / 1000.0));
  }
  else if (state.holdSamples > 0)
  {
    targetEngagement = juce::jmax(targetEngagement, state.engagement);
    --state.holdSamples;
  }

  const auto engagementCoeff =
      targetEngagement > state.engagement
          ? std::exp(-1.0f / static_cast<float>(currentSampleRate * (engagementAttackMs / 1000.0f)))
          : std::exp(-1.0f / static_cast<float>(currentSampleRate * (engagementReleaseMs / 1000.0f)));
  state.engagement = targetEngagement + engagementCoeff * (state.engagement - targetEngagement);

  const auto pushDepth = juce::jlimit(0.0f, 1.0f, -thresholdDb / 60.0f);
  const auto inputPushDb = maxInputPushDb * std::pow(pushDepth, 1.12f) * state.engagement;
  const auto inputPushGain = dbToGain(inputPushDb);
  const auto drivenLeft = left * inputPushGain;
  const auto drivenRight = right * inputPushGain;
  const auto peakDetector = juce::jmax(std::abs(drivenLeft), std::abs(drivenRight));
  const auto rmsDetector = std::sqrt((drivenLeft * drivenLeft + drivenRight * drivenRight) * 0.5f);
  const auto detector = multiband ? peakDetector : peakDetector * 0.48f + rmsDetector * 0.52f;

  const auto detectorCoeff =
      detector > state.envelope
          ? std::exp(-1.0f / static_cast<float>(currentSampleRate * (detectorAttackMs / 1000.0f)))
          : std::exp(-1.0f / static_cast<float>(currentSampleRate * (detectorReleaseMs / 1000.0f)));
  state.envelope = detector + detectorCoeff * (state.envelope - detector);
  result.detectorLevel = peakToFader(state.envelope, compressorMinDb, compressorMaxDb);

  const auto levelDb = state.envelope > 0.000001f ? juce::Decibels::gainToDecibels(state.envelope) : -120.0f;
  const auto overDb = levelDb - thresholdDb;
  const auto halfKnee = kneeDb * 0.5f;
  auto targetGainDb = 0.0f;

  if (overDb > 0.0f && overDb < kneeDb)
  {
    targetGainDb = (1.0f / ratio - 1.0f) * overDb * overDb / (2.0f * kneeDb);
  }
  else if (overDb >= kneeDb)
  {
    targetGainDb = (1.0f / ratio - 1.0f) * (overDb - halfKnee);
  }

  const auto unclampedReductionDb = juce::jmax(0.0f, -targetGainDb);
  const auto dynamicMaxReductionDb = maxReductionDb + pushDepth * (multiband ? 5.0f : 16.0f);
  if (multiband)
  {
    targetGainDb = -juce::jlimit(0.0f, dynamicMaxReductionDb, unclampedReductionDb);
  }
  else
  {
    const auto shapedReductionDb =
        dynamicMaxReductionDb * (1.0f - std::exp(-unclampedReductionDb / dynamicMaxReductionDb));
    targetGainDb = -juce::jlimit(0.0f, dynamicMaxReductionDb, shapedReductionDb);
  }

  const auto targetGain = dbToGain(targetGainDb);
  const auto reductionDepth = juce::jlimit(0.0f, 1.0f, -targetGainDb / dynamicMaxReductionDb);
  const auto releaseMs = minReleaseMs + (maxReleaseMs - minReleaseMs) * reductionDepth;
  const auto gainCoeff =
      targetGain < state.gain
          ? std::exp(-1.0f / static_cast<float>(currentSampleRate * (gainAttackMs / 1000.0f)))
          : std::exp(-1.0f / static_cast<float>(currentSampleRate * (releaseMs / 1000.0f)));
  state.gain = targetGain + gainCoeff * (state.gain - targetGain);

  const auto reductionDb = state.gain < 0.999f ? -juce::Decibels::gainToDecibels(state.gain) : 0.0f;
  const auto requestedReductionDb = juce::jmax(0.0f, -targetGainDb);
  const auto recoveryDb = reductionDb * makeupRatio;
  const auto outputLiftDb = reductionDb > 0.02f ? requestedReductionDb * outputLiftRatio : 0.0f;
  const auto thresholdLiftDb = reductionDb > 0.02f ? juce::jmax(0.0f, -thresholdDb) * thresholdLiftRatio : 0.0f;
  const auto inputLiftDb = reductionDb > 0.02f ? pushDepth * state.engagement * (multiband ? 1.8f : 5.2f) : 0.0f;
  const auto dynamicMaxMakeupDb = maxMakeupDb + pushDepth * (multiband ? 3.2f : 7.0f);
  const auto makeupGain =
      multiband ? 1.0f
                : dbToGain(juce::jlimit(0.0f, dynamicMaxMakeupDb,
                                        recoveryDb + outputLiftDb + thresholdLiftDb + inputLiftDb));

  result.left = left * state.gain * makeupGain;
  result.right = right * state.gain * makeupGain;
  result.reductionDb = reductionDb > 0.02f ? reductionDb : 0.0f;
  result.reduction =
      reductionDb > 0.02f ? juce::jlimit(0.0f, 100.0f, reductionDb / dynamicMaxReductionDb * 100.0f) : 0.0f;
  return result;
}

VoxanovaAudioProcessor::CompressorResult VoxanovaAudioProcessor::applyInYourFaceCompressor(float left, float right,
                                                                                           float mixPercent,
                                                                                           CompressorState& state) const
{
  CompressorResult result { left, right, 0.0f };

  const auto amount = juce::jlimit(0.0f, 1.0f, mixPercent / 100.0f);
  if (amount <= 0.0001f)
  {
    state = {};
    return result;
  }

  constexpr auto detectorAttackMs = 0.55f;
  constexpr auto detectorReleaseMs = 92.0f;
  constexpr auto gainAttackMs = 0.75f;
  constexpr auto minReleaseMs = 95.0f;
  constexpr auto maxReleaseMs = 310.0f;
  constexpr auto kneeDb = 11.0f;
  constexpr auto maxReductionDb = 36.0f;
  constexpr auto maxMakeupDb = 28.0f;
  auto smoothstep = [](float edge0, float edge1, float value) {
    const auto t = juce::jlimit(0.0f, 1.0f, (value - edge0) / (edge1 - edge0));
    return t * t * (3.0f - 2.0f * t);
  };

  const auto topSquash = smoothstep(0.68f, 1.0f, amount);
  const auto ratio = 2.4f + amount * 10.5f + topSquash * 8.0f;
  const auto thresholdDb = -36.0f * amount;
  const auto peakDetector = juce::jmax(std::abs(left), std::abs(right));
  const auto rmsDetector = std::sqrt((left * left + right * right) * 0.5f);
  const auto detector = peakDetector * 0.32f + rmsDetector * 0.68f;

  const auto detectorCoeff =
      detector > state.envelope
          ? std::exp(-1.0f / static_cast<float>(currentSampleRate * (detectorAttackMs / 1000.0f)))
          : std::exp(-1.0f / static_cast<float>(currentSampleRate * (detectorReleaseMs / 1000.0f)));
  state.envelope = detector + detectorCoeff * (state.envelope - detector);
  result.detectorLevel = peakToFader(state.envelope, compressorMinDb, compressorMaxDb);

  const auto levelDb = state.envelope > 0.000001f ? juce::Decibels::gainToDecibels(state.envelope) : -120.0f;
  const auto overDb = levelDb - thresholdDb;
  const auto halfKnee = kneeDb * 0.5f;
  auto targetGainDb = 0.0f;

  if (overDb > 0.0f && overDb < kneeDb)
  {
    targetGainDb = (1.0f / ratio - 1.0f) * overDb * overDb / (2.0f * kneeDb);
  }
  else if (overDb >= kneeDb)
  {
    targetGainDb = (1.0f / ratio - 1.0f) * (overDb - halfKnee);
  }

  const auto unclampedReductionDb = juce::jmax(0.0f, -targetGainDb);
  constexpr auto dynamicMaxReductionDb = maxReductionDb;
  const auto shapedReductionDb =
      dynamicMaxReductionDb * (1.0f - std::exp(-unclampedReductionDb / dynamicMaxReductionDb));
  targetGainDb = -juce::jlimit(0.0f, dynamicMaxReductionDb, shapedReductionDb);

  const auto targetGain = dbToGain(targetGainDb);
  const auto reductionDepth = juce::jlimit(0.0f, 1.0f, -targetGainDb / dynamicMaxReductionDb);
  const auto releaseMs = minReleaseMs + (maxReleaseMs - minReleaseMs) * reductionDepth;
  const auto gainCoeff =
      targetGain < state.gain
          ? std::exp(-1.0f / static_cast<float>(currentSampleRate * (gainAttackMs / 1000.0f)))
          : std::exp(-1.0f / static_cast<float>(currentSampleRate * (releaseMs / 1000.0f)));
  state.gain = targetGain + gainCoeff * (state.gain - targetGain);

  const auto reductionDb = state.gain < 0.999f ? -juce::Decibels::gainToDecibels(state.gain) : 0.0f;
  const auto activeSignal = juce::jlimit(0.0f, 1.0f, (levelDb + 70.0f) / 40.0f);
  const auto compressedMakeupDb =
      juce::jlimit(0.0f, maxMakeupDb, reductionDb * 0.86f + amount * 7.0f + topSquash * 5.0f) * activeSignal;
  const auto compressedMakeupGain = dbToGain(compressedMakeupDb);

  auto applyCleanLimiter = [this, &state](float& leftSample, float& rightSample) {
    constexpr auto ceiling = 0.965f;
    const auto peak = juce::jmax(std::abs(leftSample), std::abs(rightSample));
    const auto limiterTargetGain = peak > ceiling ? ceiling / peak : 1.0f;

    if (limiterTargetGain < state.limiterGain)
    {
      state.limiterGain = limiterTargetGain;
    }
    else
    {
      const auto releaseCoeff = std::exp(-1.0f / static_cast<float>(currentSampleRate * 0.115f));
      state.limiterGain = limiterTargetGain + releaseCoeff * (state.limiterGain - limiterTargetGain);
    }

    leftSample *= state.limiterGain;
    rightSample *= state.limiterGain;

    const auto limitedPeak = juce::jmax(std::abs(leftSample), std::abs(rightSample));
    if (limitedPeak > ceiling)
    {
      const auto safetyGain = ceiling / limitedPeak;
      leftSample *= safetyGain;
      rightSample *= safetyGain;
      state.limiterGain *= safetyGain;
    }
  };

  auto mixedLeft = left * state.gain * compressedMakeupGain;
  auto mixedRight = right * state.gain * compressedMakeupGain;

  const auto requestedLoudnessLiftDb =
      juce::jlimit(0.0f, 14.0f, (amount * 5.5f + topSquash * 4.0f + reductionDb * 0.18f) * activeSignal);
  const auto loudnessLiftGain = dbToGain(requestedLoudnessLiftDb);
  mixedLeft *= loudnessLiftGain;
  mixedRight *= loudnessLiftGain;
  applyCleanLimiter(mixedLeft, mixedRight);

  const auto peak = juce::jmax(std::abs(mixedLeft), std::abs(mixedRight));
  if (peak > 0.965f)
  {
    const auto safetyGain = 0.965f / peak;
    mixedLeft *= safetyGain;
    mixedRight *= safetyGain;
  }

  result.left = mixedLeft;
  result.right = mixedRight;
  result.reductionDb = reductionDb > 0.02f ? reductionDb : 0.0f;
  result.reduction =
      reductionDb > 0.02f ? juce::jlimit(0.0f, 100.0f, reductionDb / dynamicMaxReductionDb * 100.0f) : 0.0f;
  return result;
}

VoxanovaAudioProcessor::CompressorResult VoxanovaAudioProcessor::applyCompressor(float left, float right,
                                                                                 float thresholdDb, float ratio,
                                                                                 float amountPercent, float attackMs,
                                                                                 float releaseMs, float kneeDb,
                                                                                 CompressorState& state) const
{
  CompressorResult result { left, right, 0.0f };
  const auto amount = amountPercent / 100.0f;
  if (amount <= 0.0f)
    return result;

  const auto detector = juce::jmax(std::abs(left), std::abs(right));

  const auto detectorCoeff =
      detector > state.envelope
          ? std::exp(-1.0f / static_cast<float>(currentSampleRate * (attackMs / 1000.0f)))
          : std::exp(-1.0f / static_cast<float>(currentSampleRate * (releaseMs / 1000.0f)));
  state.envelope = detector + detectorCoeff * (state.envelope - detector);

  auto targetGainDb = 0.0f;
  if (state.envelope > 0.000001f)
  {
    const auto levelDb = juce::Decibels::gainToDecibels(state.envelope);
    const auto halfKnee = kneeDb * 0.5f;
    const auto overDb = levelDb - thresholdDb;

    if (kneeDb > 0.0f && overDb > 0.0f && overDb < kneeDb)
    {
      targetGainDb = (1.0f / ratio - 1.0f) * overDb * overDb / (2.0f * kneeDb);
    }
    else if (overDb >= kneeDb || (kneeDb <= 0.0f && overDb > 0.0f))
    {
      targetGainDb =
          kneeDb > 0.0f ? (1.0f / ratio - 1.0f) * (overDb - halfKnee) : (1.0f / ratio - 1.0f) * overDb;
    }
  }

  targetGainDb *= amount;
  const auto targetGain = dbToGain(targetGainDb);
  const auto gainCoeff =
      targetGain < state.gain
          ? std::exp(-1.0f / static_cast<float>(currentSampleRate * (attackMs / 1000.0f)))
          : std::exp(-1.0f / static_cast<float>(currentSampleRate * (releaseMs / 1000.0f)));
  state.gain = targetGain + gainCoeff * (state.gain - targetGain);

  result.left = left * state.gain;
  result.right = right * state.gain;
  result.reduction =
      state.gain < 0.999f
          ? juce::jlimit(0.0f, 100.0f, -juce::Decibels::gainToDecibels(state.gain) / 24.0f * 100.0f)
          : 0.0f;
  return result;
}

void VoxanovaAudioProcessor::applyDeEsser(float& left, float& right, float amountPercent, float lowHz, float highHz)
{
  const auto amount = juce::jlimit(0.0f, 1.0f, amountPercent / 100.0f);
  if (amount <= 0.0f)
    return;

  const auto safeLowHz = juce::jlimit(1800.0f, static_cast<float>(currentSampleRate) * 0.38f, lowHz);
  const auto safeHighHz = juce::jlimit(safeLowHz + 250.0f, static_cast<float>(currentSampleRate) * 0.46f, highHz);
  constexpr auto detectorAttackMs = 0.22f;
  constexpr auto detectorReleaseMs = 64.0f;
  constexpr auto gainAttackMs = 0.38f;
  constexpr auto gainReleaseMs = 86.0f;

  const auto lowLeft = processOnePoleLowpass(left, safeLowHz, deEsserLowStates[0]);
  const auto lowRight = processOnePoleLowpass(right, safeLowHz, deEsserLowStates[1]);
  const auto highSplitLeft = processOnePoleLowpass(left, safeHighHz, deEsserHighStates[0]);
  const auto highSplitRight = processOnePoleLowpass(right, safeHighHz, deEsserHighStates[1]);
  const auto bandLeft = highSplitLeft - lowLeft;
  const auto bandRight = highSplitRight - lowRight;
  const auto peakDetector = juce::jmax(std::abs(bandLeft), std::abs(bandRight));
  const auto rmsDetector = std::sqrt((bandLeft * bandLeft + bandRight * bandRight) * 0.5f);
  const auto detector = peakDetector * 0.58f + rmsDetector * 0.42f;

  const auto detectorCoeff =
      detector > deEsserEnvelope
          ? std::exp(-1.0f / static_cast<float>(currentSampleRate * (detectorAttackMs / 1000.0f)))
          : std::exp(-1.0f / static_cast<float>(currentSampleRate * (detectorReleaseMs / 1000.0f)));
  deEsserEnvelope = detector + detectorCoeff * (deEsserEnvelope - detector);

  const auto amountCurve = std::pow(amount, 0.62f);
  const auto detectorBoost = 2.8f + amountCurve * 7.2f;
  const auto detectorDb =
      deEsserEnvelope > 0.000001f ? juce::Decibels::gainToDecibels(deEsserEnvelope * detectorBoost) : -120.0f;
  const auto thresholdDb = -30.0f - amountCurve * 38.0f;
  const auto maxReductionDb = 10.0f + amountCurve * 50.0f;
  const auto overDb = juce::jmax(0.0f, detectorDb - thresholdDb);
  const auto targetReductionDb = juce::jlimit(0.0f, maxReductionDb, overDb * (0.82f + amountCurve * 2.25f));
  const auto targetGain = dbToGain(-targetReductionDb);
  const auto gainCoeff =
      targetGain < deEsserGain
          ? std::exp(-1.0f / static_cast<float>(currentSampleRate * (gainAttackMs / 1000.0f)))
          : std::exp(-1.0f / static_cast<float>(currentSampleRate * (gainReleaseMs / 1000.0f)));
  deEsserGain = targetGain + gainCoeff * (deEsserGain - targetGain);

  const auto forcedReduction = amountCurve * amountCurve * 0.72f;
  const auto dynamicReduction = (1.0f - deEsserGain) * (1.0f + amountCurve * 1.9f);
  const auto reductionMix = juce::jlimit(0.0f, 1.18f, forcedReduction + dynamicReduction);
  left -= bandLeft * reductionMix;
  right -= bandRight * reductionMix;
}

float VoxanovaAudioProcessor::applySoftClip(float sample, float drive)
{
  return std::tanh(sample * drive) / std::tanh(drive);
}

float VoxanovaAudioProcessor::applySaturationModel(float sample, int mode, float amountPercent, SaturationState& state,
                                                   int channel) const
{
  const auto amount = juce::jlimit(0.0f, 1.0f, amountPercent / 100.0f);
  if (mode <= 0 || amount <= 0.0f)
    return sample;

  const auto index = static_cast<size_t>(juce::jlimit(0, 1, channel));
  const auto highCut = [this, &state, index](float value, float cutoffHz) {
    return processOnePoleLowpass(value, cutoffHz, state.highTone[index]);
  };
  const auto lowBand = [this, &state, index](float value, float cutoffHz) {
    return processOnePoleLowpass(value, cutoffHz, state.lowTone[index]);
  };
  const auto dcBlock = [this, &state, index](float value) {
    const auto dc = processOnePoleLowpass(value, 18.0f, state.dcBlock[index]);
    return value - dc;
  };

  auto wet = sample;

  switch (mode)
  {
    case 1: // 1073-inspired Class-A transformer color.
    {
      const auto low = lowBand(sample, 260.0f);
      const auto shapedInput = sample + low * (0.035f + amount * 0.10f);
      const auto drive = 1.12f + amount * 3.15f;
      const auto bias = amount * 0.035f;
      const auto biased = std::tanh(shapedInput * drive + bias) - std::tanh(bias);
      const auto transformer = biased / juce::jmax(0.2f, std::tanh(drive));
      const auto softened = highCut(transformer, 18000.0f - amount * 5200.0f);
      wet = dcBlock(softened * (1.0f + amount * 0.045f));
      break;
    }
    case 2: // Studer-style tape: rounded transients, head bump, soft top.
    {
      const auto low = lowBand(sample, 95.0f);
      const auto tapeInput = sample + low * (0.06f + amount * 0.16f);
      const auto drive = 1.05f + amount * 4.25f;
      const auto compressed = std::atan(tapeInput * drive) / std::atan(drive);
      const auto tapeTop = highCut(compressed, 15000.0f - amount * 7800.0f);
      wet = dcBlock(tapeTop * (1.0f - amount * 0.035f));
      break;
    }
    case 3: // Triode-style tube attitude for vocals without hard clipping.
    {
      const auto low = lowBand(sample, 180.0f);
      const auto tubeInput = sample - low * amount * 0.035f;
      const auto drive = 1.18f + amount * 5.4f;
      const auto bias = amount * 0.075f;
      const auto triode = (std::tanh(tubeInput * drive + bias) - std::tanh(bias)) / std::tanh(drive + bias);
      const auto oddControl = triode - triode * triode * triode * (0.06f + amount * 0.10f);
      const auto rounded = highCut(oddControl, 14200.0f - amount * 5600.0f);
      wet = dcBlock(rounded * (1.0f + amount * 0.025f));
      break;
    }
    default:
      return sample;
  }

  const auto blend = std::pow(amount, 0.78f);
  const auto output = sample + (wet - sample) * blend;
  return juce::jlimit(-1.15f, 1.15f, output);
}

float VoxanovaAudioProcessor::applyUnitySaturation(float sample, float drive, float mix)
{
  const auto clampedMix = juce::jlimit(0.0f, 1.0f, mix);
  if (clampedMix <= 0.0f || drive <= 1.0f)
    return sample;

  const auto wet = std::tanh(sample * drive) / drive;
  return sample + (wet - sample) * clampedMix;
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
  return new VoxanovaAudioProcessor();
}
