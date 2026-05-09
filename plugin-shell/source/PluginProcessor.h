#pragma once

#include <array>
#include <atomic>
#include <cstdint>
#include <memory>
#include <vector>

#include "FatTuneEngine.h"

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_dsp/juce_dsp.h>

class VoxanovaAudioProcessor final : public juce::AudioProcessor
{
public:
  using APVTS = juce::AudioProcessorValueTreeState;
  static constexpr auto waveformSampleCount = 256;
  static constexpr auto spectrumBinCount = 256;
  static constexpr auto eqMeterBandCount = 128;

  struct MeterSnapshot
  {
    std::array<float, 2> input {};
    std::array<float, 2> output {};
    std::array<float, waveformSampleCount> inputWaveform {};
    std::array<float, waveformSampleCount> peakWaveform {};
    std::array<float, waveformSampleCount> peakOutputWaveform {};
    std::array<float, waveformSampleCount> glueWaveform {};
    std::array<float, waveformSampleCount> glueOutputWaveform {};
    std::array<float, waveformSampleCount> faceWaveform {};
    std::array<float, waveformSampleCount> faceOutputWaveform {};
    std::array<float, waveformSampleCount> gateWaveform {};
    std::array<float, waveformSampleCount> gateOutputWaveform {};
    std::array<float, spectrumBinCount> preCompSpectrum {};
    std::array<float, spectrumBinCount> postCompSpectrum {};
    std::array<float, eqMeterBandCount> preEqDetectorDbs {};
    std::array<float, eqMeterBandCount> postEqDetectorDbs {};
    float peakLevel = 0.0f;
    float glueLevel = 0.0f;
    float faceLevel = 0.0f;
    float gateLevel = 0.0f;
    float gateReduction = 0.0f;
    float peakReduction = 0.0f;
    float glueReduction = 0.0f;
    float faceReduction = 0.0f;
    float gateReductionDb = 0.0f;
    float peakReductionDb = 0.0f;
    float glueReductionDb = 0.0f;
    float faceReductionDb = 0.0f;
    std::array<float, 4> glueBandReductions {};
    std::array<float, 4> glueBandReductionDbs {};
    float hostBpm = 120.0f;
    float tuneFrequency = 0.0f;
    float tuneCents = 0.0f;
    float tuneConfidence = 0.0f;
    float tuneTargetMidi = 0.0f;
    int inputChannels = 2;
    int outputChannels = 2;
    bool visualSilence = true;
    std::uint64_t processCounter = 0;
  };

  VoxanovaAudioProcessor();
  ~VoxanovaAudioProcessor() override = default;

  void prepareToPlay(double sampleRate, int samplesPerBlock) override;
  void releaseResources() override;
  bool isBusesLayoutSupported(const BusesLayout& layouts) const override;
  void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
  void processBlockBypassed(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

  juce::AudioProcessorEditor* createEditor() override;
  bool hasEditor() const override;

  const juce::String getName() const override;
  bool acceptsMidi() const override;
  bool producesMidi() const override;
  bool isMidiEffect() const override;
  double getTailLengthSeconds() const override;

  int getNumPrograms() override;
  int getCurrentProgram() override;
  void setCurrentProgram(int index) override;
  const juce::String getProgramName(int index) override;
  void changeProgramName(int index, const juce::String& newName) override;

  void getStateInformation(juce::MemoryBlock& destData) override;
  void setStateInformation(const void* data, int sizeInBytes) override;

  APVTS parameters;

  static APVTS::ParameterLayout createParameterLayout();
  MeterSnapshot getMeterSnapshot() const;
  juce::var getEqBandsState() const;
  void setEqBandsFromVar(const juce::var& payload);

private:
  struct CompressorResult
  {
    float left = 0.0f;
    float right = 0.0f;
    float reduction = 0.0f;
    float reductionDb = 0.0f;
    float detectorLevel = 0.0f;
  };

  struct CompressorState
  {
    float envelope = 0.0f;
    float gain = 1.0f;
    float limiterGain = 1.0f;
    float engagement = 0.0f;
    int holdSamples = 0;
  };

  struct BandSplitState
  {
    void prepare(double sampleRate, int samplesPerBlock)
    {
      const juce::dsp::ProcessSpec spec {
        sampleRate,
        static_cast<juce::uint32>(juce::jmax(1, samplesPerBlock)),
        1
      };

      auto prepareSplit = [&spec](juce::dsp::LinkwitzRileyFilter<float>& filter, float cutoffHz) {
        filter.setCutoffFrequency(cutoffHz);
        filter.prepare(spec);
        filter.reset();
      };

      auto prepareAllpass = [&spec](juce::dsp::LinkwitzRileyFilter<float>& filter, float cutoffHz) {
        filter.setType(juce::dsp::LinkwitzRileyFilterType::allpass);
        filter.setCutoffFrequency(cutoffHz);
        filter.prepare(spec);
        filter.reset();
      };

      prepareSplit(split100, 100.0f);
      prepareSplit(split1000, 1000.0f);
      prepareSplit(split10000, 10000.0f);
      prepareAllpass(lowAlign1000, 1000.0f);
      prepareAllpass(lowAlign10000, 10000.0f);
      prepareAllpass(lowMidAlign10000, 10000.0f);
    }

    void reset()
    {
      split100.reset();
      split1000.reset();
      split10000.reset();
      lowAlign1000.reset();
      lowAlign10000.reset();
      lowMidAlign10000.reset();
    }

    std::array<float, 4> process(float input)
    {
      auto low = 0.0f;
      auto highAfter100 = 0.0f;
      split100.processSample(0, input, low, highAfter100);

      auto lowMid = 0.0f;
      auto highAfter1000 = 0.0f;
      split1000.processSample(0, highAfter100, lowMid, highAfter1000);

      auto highMid = 0.0f;
      auto high = 0.0f;
      split10000.processSample(0, highAfter1000, highMid, high);

      low = lowAlign1000.processSample(0, low);
      low = lowAlign10000.processSample(0, low);
      lowMid = lowMidAlign10000.processSample(0, lowMid);

      return { low, lowMid, highMid, high };
    }

    juce::dsp::LinkwitzRileyFilter<float> split100;
    juce::dsp::LinkwitzRileyFilter<float> split1000;
    juce::dsp::LinkwitzRileyFilter<float> split10000;
    juce::dsp::LinkwitzRileyFilter<float> lowAlign1000;
    juce::dsp::LinkwitzRileyFilter<float> lowAlign10000;
    juce::dsp::LinkwitzRileyFilter<float> lowMidAlign10000;
  };

  struct SaturationState
  {
    std::array<float, 2> lowTone {};
    std::array<float, 2> highTone {};
    std::array<float, 2> dcBlock {};
  };

  static constexpr int eqMaxCutFilterStages = 8;
  static constexpr int eqMaxFilterStages = eqMaxCutFilterStages + 1;
  static constexpr int eqWallSlopeDb = 120;

  struct EqFilterStage
  {
    void reset()
    {
      z1 = 0.0f;
      z2 = 0.0f;
    }

    void setBypass()
    {
      b0 = 1.0f;
      b1 = 0.0f;
      b2 = 0.0f;
      a1 = 0.0f;
      a2 = 0.0f;
    }

    void setCoefficients(float nextB0, float nextB1, float nextB2, float nextA1, float nextA2)
    {
      b0 = nextB0;
      b1 = nextB1;
      b2 = nextB2;
      a1 = nextA1;
      a2 = nextA2;
    }

    float process(float input)
    {
      const auto output = b0 * input + z1;
      z1 = b1 * input - a1 * output + z2;
      z2 = b2 * input - a2 * output;
      return output;
    }

    float b0 = 1.0f;
    float b1 = 0.0f;
    float b2 = 0.0f;
    float a1 = 0.0f;
    float a2 = 0.0f;
    float z1 = 0.0f;
    float z2 = 0.0f;
  };

  struct EqBandState
  {
    void reset()
    {
      for (auto& channelStages : filters)
        for (auto& stage : channelStages)
          stage.reset();

      deEsserLowStates = {};
      deEsserEnvelope = 0.0f;
      deEsserGain = 1.0f;
      surferRatio = 0.0f;
      surferFrequency = 0.0f;
      previousStaticFrequency = 0.0f;
      hasSurferRatio = false;
      hasSurferFrequency = false;
      wasActive = false;
      previousType = -1;
      previousStageCount = 0;
      for (auto& channelDetectors : compDetectorFilters)
        for (auto& detector : channelDetectors)
          detector.reset();
      for (auto& channelStages : soloFilters)
        for (auto& stage : channelStages)
          stage.reset();
      for (auto& channelStages : saturationFilters)
        for (auto& stage : channelStages)
          stage.reset();
      saturationState = {};
      compEnvelope = 0.0f;
      compGainDb = 0.0f;
      compDetectorDb = -120.0f;
      compGainInitialized = false;
    }

    std::array<std::array<EqFilterStage, eqMaxFilterStages>, 2> filters {};
    std::array<std::array<EqFilterStage, 2>, 2> compDetectorFilters {};
    std::array<std::array<EqFilterStage, 2>, 2> soloFilters {};
    std::array<std::array<EqFilterStage, 2>, 2> saturationFilters {};
    SaturationState saturationState {};
    std::array<float, 2> deEsserLowStates {};
    float deEsserEnvelope = 0.0f;
    float deEsserGain = 1.0f;
    float compEnvelope = 0.0f;
    float compGainDb = 0.0f;
    float compDetectorDb = -120.0f;
    float surferRatio = 0.0f;
    float surferFrequency = 0.0f;
    float previousStaticFrequency = 0.0f;
    bool hasSurferRatio = false;
    bool hasSurferFrequency = false;
    bool compGainInitialized = false;
    bool wasActive = false;
    int previousType = -1;
    int previousStageCount = 0;
  };

  struct EqBandSettings
  {
    bool enabled = false;
    int type = 0;
    float frequency = 1000.0f;
    float gainDb = 0.0f;
    float q = 1.0f;
    float rangeLowHz = 500.0f;
    float rangeHighHz = 2000.0f;
    float rangeLowSlope = 8.0f;
    float rangeHighSlope = 8.0f;
    float compDb = 0.0f;
    float compThresholdDb = -18.0f;
    float compAttackMs = 12.0f;
    float compReleaseMs = 140.0f;
    float compRatio = 4.0f;
    bool compEnabled = false;
    int saturationMode = 0;
    float saturationAmount = 0.0f;
    bool solo = false;
    int slopeDb = 12;
    float thresholdDb = -24.0f;
    float intensity = 50.0f;
    int deessMode = 0;
    float surfRatio = 0.0f;
  };

  struct EqSettings
  {
    std::vector<EqBandSettings> preBands;
    std::vector<EqBandSettings> postBands;
  };

  static constexpr int spectrumFftOrder = 12;
  static constexpr int spectrumFftSize = 1 << spectrumFftOrder;
  static constexpr int spectrumHopSize = spectrumFftSize / 4;

  struct SpectrumAnalyzerState
  {
    std::array<std::atomic<float>, spectrumBinCount> bins {};
    std::array<float, spectrumFftSize> ring {};
    std::array<float, spectrumBinCount> smoothed {};
    int writePosition = 0;
    int hopCounter = 0;
  };

  struct GateResult
  {
    float left = 0.0f;
    float right = 0.0f;
    float reduction = 0.0f;
    float reductionDb = 0.0f;
    float detectorLevel = 0.0f;
  };

  static float dbToGain(float db);
  static float peakToMeter(float peak);
  static float peakToFader(float peak, float minDb, float maxDb);
  static void updateAtomicPeak(std::atomic<float>& target, float value);
  static void updateAtomicBallistic(std::atomic<float>& target, float value, double sampleRate, int numSamples,
                                    float attackMs, float releaseMs);
  static void clearWaveform(std::array<std::atomic<float>, waveformSampleCount>& waveform);
  static void storeWaveformSample(std::array<std::atomic<float>, waveformSampleCount>& waveform, int index, float value);
  static void copyWaveform(const std::array<std::atomic<float>, waveformSampleCount>& source,
                           std::array<float, waveformSampleCount>& destination, int writeIndex);
  static void clearSpectrum(std::array<std::atomic<float>, spectrumBinCount>& spectrum);
  static void copySpectrum(const std::array<std::atomic<float>, spectrumBinCount>& source,
                           std::array<float, spectrumBinCount>& destination);
  void clearMeters();
  void clearWaveformBuffers();
  void resetWaveformAccumulators();
  void clearVisualState(bool resetSpectrum = true);
  void prepareSpectrum(SpectrumAnalyzerState& analyzer);
  void prepareSpectra();
  void clearSpectrumAnalyzer(SpectrumAnalyzerState& analyzer);
  void pushSpectrumSample(SpectrumAnalyzerState& analyzer, float sample);
  void analyseSpectrum(SpectrumAnalyzerState& analyzer);
  float processOnePoleLowpass(float input, float cutoffHz, float& state) const;
  GateResult applyVocalGate(float left, float right, float detectorLeft, float detectorRight, float thresholdDb);
  static std::vector<EqBandSettings> parseEqBandArray(const juce::var& bands);
  static juce::var eqBandArrayToVar(const std::vector<EqBandSettings>& bands);
  static juce::String serializeEqBands(const EqSettings& settings);
  void configureEqBand(EqBandState& state, const EqBandSettings& settings) const;
  void configureEqBandSolo(EqBandState& state, const EqBandSettings& settings) const;
  void configureEqBandForGain(EqBandState& state, const EqBandSettings& settings, float gainDb) const;
  void configureEqBandCompressionDetector(EqBandState& state, const EqBandSettings& settings) const;
  void configureEqBandSaturationFilter(EqBandState& state, const EqBandSettings& settings) const;
  float updateEqBandDetectorLevel(EqBandState& state, const EqBandSettings& settings, float left, float right) const;
  void applyEqBandSaturation(EqBandState& state, const EqBandSettings& settings, float& left, float& right) const;
  void prepareEq(std::vector<EqBandState>& states, const std::vector<EqBandSettings>& settings) const;
  void applyEq(std::vector<EqBandState>& states, const std::vector<EqBandSettings>& settings, float& left,
               float& right, std::array<std::atomic<float>, eqMeterBandCount>& detectorDbMeters);
  void applyEqDeEsser(EqBandState& state, const EqBandSettings& settings, float& left, float& right);
  float updateEqBandDynamicGain(EqBandState& state, const EqBandSettings& settings, float left, float right) const;
  void resetEqStates(std::vector<EqBandState>& states);
  static bool eqBandHasEffect(const EqBandSettings& settings);
  static bool eqBandSupportsCompression(const EqBandSettings& settings);
  static bool eqBandSupportsSaturation(const EqBandSettings& settings);
  static bool eqBandHasCompressionTarget(const EqBandSettings& settings);
  static bool eqBandHasCompression(const EqBandSettings& settings);
  static bool eqBandHasSaturation(const EqBandSettings& settings);
  static bool eqBandsNeedPitchTracking(const std::vector<EqBandSettings>& settings);
  static int eqFilterStageCount(int slopeDb);
  static bool eqCutHasFirstOrderStage(int slopeDb);
  static int eqCutBiquadStageCount(int slopeDb);
  static int eqBandFilterStageCount(const EqBandSettings& settings);
  static float getCutResonanceFrequency(const EqBandSettings& settings);
  static float getCutResonanceQ(const EqBandSettings& settings);
  static float getFullSpectrumCenter(float lowHz, float highHz);
  static std::array<float, 2> getFullSpectrumFallbackRange(float frequency, float q);
  static std::array<float, 2> normalizeFullSpectrumRange(float frequency, float q, float lowHz, float highHz);
  float getSurferEqFrequency(EqBandState& state, const EqBandSettings& settings) const;
  static void setBiquadCoefficients(EqFilterStage& stage, float b0, float b1, float b2, float a0, float a1, float a2);
  void setPeakingFilter(EqFilterStage& stage, float frequency, float q, float gainDb) const;
  void setLowShelfFilter(EqFilterStage& stage, float frequency, float q, float gainDb) const;
  void setHighShelfFilter(EqFilterStage& stage, float frequency, float q, float gainDb) const;
  void setLowPassFilter(EqFilterStage& stage, float frequency, float q) const;
  void setLowPassFirstOrderFilter(EqFilterStage& stage, float frequency) const;
  void setHighPassFilter(EqFilterStage& stage, float frequency, float q) const;
  void setHighPassFirstOrderFilter(EqFilterStage& stage, float frequency) const;
  void setCutResonanceFilter(EqFilterStage& stage, const EqBandSettings& settings, float gainDb) const;
  void setNotchFilter(EqFilterStage& stage, float frequency, float q) const;
  void setBandPassFilter(EqFilterStage& stage, float frequency, float q, float gainDb) const;
  CompressorResult applyPeakTamer(float left, float right, float thresholdDb, CompressorState& state) const;
  CompressorResult applyGlueCompressor(float left, float right, float thresholdDb, CompressorState& state,
                                       bool multiband, int bandIndex) const;
  CompressorResult applyInYourFaceCompressor(float left, float right, float mixPercent, CompressorState& state) const;
  CompressorResult applyCompressor(float left, float right, float thresholdDb, float ratio, float amountPercent,
                                   float attackMs, float releaseMs, float kneeDb, CompressorState& state) const;
  void applyDeEsser(float& left, float& right, float amountPercent, float lowHz, float highHz);
  float applySaturationModel(float sample, int mode, float amountPercent, SaturationState& state, int channel) const;
  static float applySoftClip(float sample, float drive);
  static float applyUnitySaturation(float sample, float drive, float mix);

  std::atomic<float>* inputGainParam = nullptr;
  std::atomic<float>* outputGainParam = nullptr;
  std::atomic<float>* gateParam = nullptr;
  std::atomic<float>* stereoWidthParam = nullptr;
  std::atomic<float>* stereoLowBypassParam = nullptr;
  std::atomic<float>* saturationModeParam = nullptr;
  std::atomic<float>* saturationAmountParam = nullptr;
  std::atomic<float>* tuneEnabledParam = nullptr;
  std::atomic<float>* tuneAmountParam = nullptr;
  std::atomic<float>* tuneKeyParam = nullptr;
  std::atomic<float>* tuneScaleParam = nullptr;
  std::atomic<float>* tuneCustomNotesParam = nullptr;
  std::atomic<float>* tuneVoiceTypeParam = nullptr;
  std::atomic<float>* peakEnabledParam = nullptr;
  std::atomic<float>* peakThresholdParam = nullptr;
  std::atomic<float>* glueEnabledParam = nullptr;
  std::atomic<float>* glueMultibandParam = nullptr;
  std::atomic<float>* glueThresholdParam = nullptr;
  std::atomic<float>* glueLowThresholdParam = nullptr;
  std::atomic<float>* glueLowMidThresholdParam = nullptr;
  std::atomic<float>* glueHighMidThresholdParam = nullptr;
  std::atomic<float>* glueAirThresholdParam = nullptr;
  std::atomic<float>* faceEnabledParam = nullptr;
  std::atomic<float>* faceThresholdParam = nullptr;
  std::atomic<float>* gateEnabledParam = nullptr;
  std::atomic<float>* deEsserEnabledParam = nullptr;
  std::atomic<float>* deEsserAmountParam = nullptr;
  std::atomic<float>* deEsserLowParam = nullptr;
  std::atomic<float>* deEsserHighParam = nullptr;
  std::atomic<float>* stereoEnabledParam = nullptr;
  std::atomic<float>* reverbEnabledParam = nullptr;
  std::atomic<float>* reverbMixParam = nullptr;
  std::atomic<float>* reverbDecayParam = nullptr;
  std::atomic<float>* reverbSizeParam = nullptr;
  std::atomic<float>* reverbPredelayParam = nullptr;
  std::atomic<float>* reverbLowCutParam = nullptr;
  std::atomic<float>* reverbHighCutParam = nullptr;
  std::atomic<float>* reverbModeParam = nullptr;
  std::atomic<float>* reverbSyncParam = nullptr;
  std::atomic<float>* reverbNoteModeParam = nullptr;
  std::atomic<float>* reverbDecaySyncParam = nullptr;
  std::atomic<float>* reverbPredelaySyncParam = nullptr;
  std::atomic<float>* reverbDecayDivisionParam = nullptr;
  std::atomic<float>* reverbPredelayDivisionParam = nullptr;
  std::atomic<float>* delayEnabledParam = nullptr;
  std::atomic<float>* delayMixParam = nullptr;
  std::atomic<float>* delayFeedbackParam = nullptr;
  std::atomic<float>* delayLowCutParam = nullptr;
  std::atomic<float>* delayHighCutParam = nullptr;
  std::atomic<float>* delaySyncParam = nullptr;
  std::atomic<float>* delayDivisionParam = nullptr;
  std::atomic<float>* delayNoteModeParam = nullptr;
  std::atomic<float>* delayTimeMsParam = nullptr;
  std::atomic<float>* delayModeParam = nullptr;
  std::atomic<float>* delayPostReverbParam = nullptr;
  std::atomic<float>* delayStyleParam = nullptr;
  std::atomic<float>* delayAuxBusParam = nullptr;
  std::atomic<float>* reverbAuxBusParam = nullptr;
  std::shared_ptr<const EqSettings> eqSettings {};

  std::array<juce::AudioBuffer<float>, 2> delayBuffers;
  std::array<int, 2> delayWritePositions {};
  std::array<std::array<float, 4>, 2> delayLowCutStates {};
  std::array<std::array<float, 4>, 2> delayHighCutStates {};
  std::array<std::array<float, 2>, 2> delayStyleLowCutStates {};
  std::array<std::array<float, 2>, 2> delayStyleHighCutStates {};
  juce::AudioBuffer<float> reverbPredelayBuffer;
  int reverbPredelayWritePosition = 0;
  juce::AudioBuffer<float> reverbEarlyBuffer;
  int reverbEarlyWritePosition = 0;
  std::array<juce::AudioBuffer<float>, 8> reverbTankBuffers;
  std::array<int, 8> reverbTankWritePositions {};
  std::array<float, 8> reverbTankHighDampStates {};
  std::array<float, 8> reverbTankLowDampStates {};
  std::array<float, 8> reverbTankModPhases {};
  std::array<juce::AudioBuffer<float>, 8> reverbDiffuserBuffers;
  std::array<int, 8> reverbDiffuserWritePositions {};
  std::array<float, 8> reverbDiffuserModPhases {};
  std::array<std::array<float, 4>, 2> reverbLowCutStates {};
  std::array<std::array<float, 4>, 2> reverbHighCutStates {};
  std::array<std::array<float, 2>, 2> reverbModeLowCutStates {};
  std::array<std::array<float, 2>, 2> reverbModeHighCutStates {};
  std::array<float, 2> reverbWarmLowStates {};
  std::array<float, 2> reverbWarmHighStates {};
  std::array<float, 2> reverbSilkStates {};
  juce::AudioBuffer<float> reverbWidthBuffer;
  int reverbWidthWritePosition = 0;
  std::array<float, 4> reverbWidthAllpassLeft {};
  std::array<float, 4> reverbWidthAllpassRight {};
  std::array<float, 2> reverbWidthModPhases {};
  float reverbWidthSideLowpass = 0.0f;
  FatTuneEngine tuneEngine;
  float reverbSizeSmoothed = 1.0f;
  float reverbDecaySmoothed = 4.0f;
  int lastReverbMode = -1;
  juce::AudioBuffer<float> monoWidenBuffer;
  int monoWidenWritePosition = 0;
  float monoWidenSideLowpass = 0.0f;
  float gateEnvelope = 0.0f;
  float gateSmoothedGain = 1.0f;
  int gateHoldSamples = 0;
  std::array<float, 2> deEsserLowStates {};
  std::array<float, 2> deEsserHighStates {};
  float deEsserEnvelope = 0.0f;
  float deEsserGain = 1.0f;
  CompressorState preCompressorState;
  SaturationState saturationState;
  std::vector<EqBandState> preEqStates;
  CompressorState peakCompressorState;
  CompressorState glueCompressorState;
  std::array<CompressorState, 4> glueBandCompressorStates {};
  std::array<BandSplitState, 2> glueBandSplitStates {};
  CompressorState faceCompressorState;
  CompressorState postCompressorState;
  std::vector<EqBandState> postEqStates;
  std::array<std::atomic<float>, eqMeterBandCount> preEqDetectorDbMeters {};
  std::array<std::atomic<float>, eqMeterBandCount> postEqDetectorDbMeters {};
  std::array<std::atomic<float>, 2> inputMeterPeaks {};
  std::array<std::atomic<float>, 2> outputMeterPeaks {};
  std::array<std::atomic<float>, waveformSampleCount> inputWaveform {};
  std::array<std::atomic<float>, waveformSampleCount> peakWaveform {};
  std::array<std::atomic<float>, waveformSampleCount> peakOutputWaveform {};
  std::array<std::atomic<float>, waveformSampleCount> glueWaveform {};
  std::array<std::atomic<float>, waveformSampleCount> glueOutputWaveform {};
  std::array<std::atomic<float>, waveformSampleCount> faceWaveform {};
  std::array<std::atomic<float>, waveformSampleCount> faceOutputWaveform {};
  std::array<std::atomic<float>, waveformSampleCount> gateWaveform {};
  std::array<std::atomic<float>, waveformSampleCount> gateOutputWaveform {};
  juce::dsp::FFT spectrumFft { spectrumFftOrder };
  std::array<float, spectrumFftSize> spectrumWindow {};
  SpectrumAnalyzerState preCompSpectrumAnalyzer;
  SpectrumAnalyzerState postCompSpectrumAnalyzer;
  std::atomic<int> waveformWriteIndex { 0 };
  int waveformDownsampleCounter = 0;
  float inputWaveformPeak = 0.0f;
  float peakWaveformPeak = 0.0f;
  float peakOutputWaveformPeak = 0.0f;
  float glueWaveformPeak = 0.0f;
  float glueOutputWaveformPeak = 0.0f;
  float faceWaveformPeak = 0.0f;
  float faceOutputWaveformPeak = 0.0f;
  float gateWaveformPeak = 0.0f;
  float gateOutputWaveformPeak = 0.0f;
  std::atomic<float> peakLevelMeter { 0.0f };
  std::atomic<float> glueLevelMeter { 0.0f };
  std::atomic<float> faceLevelMeter { 0.0f };
  std::atomic<float> gateLevelMeter { 0.0f };
  std::atomic<float> gateReductionMeter { 0.0f };
  std::atomic<float> peakReductionMeter { 0.0f };
  std::atomic<float> glueReductionMeter { 0.0f };
  std::atomic<float> faceReductionMeter { 0.0f };
  std::atomic<float> gateReductionDbMeter { 0.0f };
  std::atomic<float> peakReductionDbMeter { 0.0f };
  std::atomic<float> glueReductionDbMeter { 0.0f };
  std::atomic<float> faceReductionDbMeter { 0.0f };
  std::array<std::atomic<float>, 4> glueBandReductionMeters {};
  std::array<std::atomic<float>, 4> glueBandReductionDbMeters {};
  std::atomic<float> tuneFrequencyMeter { 0.0f };
  std::atomic<float> tuneCentsMeter { 0.0f };
  std::atomic<float> tuneConfidenceMeter { 0.0f };
  std::atomic<float> tuneTargetMidiMeter { 0.0f };
  std::atomic<bool> visualSilenceActive { true };
  std::atomic<std::uint64_t> meterProcessCounter { 0 };
  std::atomic<int> activeInputChannels { 2 };
  std::atomic<int> activeOutputChannels { 2 };
  std::atomic<float> hostBpm { 120.0f };

  double currentSampleRate = 44100.0;
};
