#include "PluginEditor.h"

#include "BinaryData.h"

#include <cstring>

namespace
{
constexpr int baseEditorWidth = 1360;
constexpr int baseEditorHeight = 820;
constexpr float defaultEditorScale = 0.9f;
constexpr float minEditorScale = 0.5f;
constexpr float maxEditorScale = 2.0f;
constexpr const char* webAssetVersion = "20260509-responsive-editor-01";

juce::WebBrowserComponent::Resource makeTextResource(const juce::String& text)
{
  const auto utf8 = text.toRawUTF8();
  const auto size = std::strlen(utf8);
  std::vector<std::byte> bytes(size);
  std::memcpy(bytes.data(), utf8, size);
  return { std::move(bytes), "application/json" };
}

juce::String normaliseResourcePath(juce::String path)
{
  const auto queryOrHash = path.indexOfAnyOf("?#");
  if (queryOrHash >= 0)
    path = path.substring(0, queryOrHash);

  if (path == "/" || path.isEmpty())
    return "index.html";

  while (path.startsWithChar('/'))
    path = path.substring(1);

  return path;
}

juce::String getQueryValue(const juce::String& path, const juce::String& key)
{
  const auto question = path.indexOfChar('?');

  if (question < 0)
    return {};

  const auto query = path.substring(question + 1);
  const auto pairs = juce::StringArray::fromTokens(query, "&", "");

  for (const auto& pair : pairs)
  {
    const auto equals = pair.indexOfChar('=');

    if (equals < 0)
      continue;

    if (pair.substring(0, equals) == key)
      return juce::URL::removeEscapeChars(pair.substring(equals + 1));
  }

  return {};
}

juce::String resourceFileName(juce::String path)
{
  path = normaliseResourcePath(std::move(path));
  return juce::File::createFileWithoutCheckingPath(path).getFileName();
}

bool isApiPath(const juce::String& path, const juce::String& endpoint)
{
  return path.startsWith(endpoint) || path.startsWith(endpoint.substring(1)) || path.contains(endpoint + "?");
}

juce::String mimeTypeForPath(const juce::String& path)
{
  if (path.endsWithIgnoreCase(".html"))
    return "text/html";

  if (path.endsWithIgnoreCase(".js"))
    return "text/javascript";

  if (path.endsWithIgnoreCase(".css"))
    return "text/css";

  if (path.endsWithIgnoreCase(".svg"))
    return "image/svg+xml";

  if (path.endsWithIgnoreCase(".png"))
    return "image/png";

  if (path.endsWithIgnoreCase(".jpg") || path.endsWithIgnoreCase(".jpeg"))
    return "image/jpeg";

  if (path.endsWithIgnoreCase(".woff2"))
    return "font/woff2";

  return "application/octet-stream";
}

std::optional<juce::WebBrowserComponent::Resource> getWebResource(const juce::String& requestedPath)
{
  const auto path = normaliseResourcePath(requestedPath);
  const auto fileName = resourceFileName(path);

  for (auto i = 0; i < BinaryData::namedResourceListSize; ++i)
  {
    const juce::String originalName(BinaryData::originalFilenames[i]);

    if (originalName != path && originalName != fileName && !originalName.endsWith(path))
      continue;

    int dataSize = 0;
    const auto* data = BinaryData::getNamedResource(BinaryData::namedResourceList[i], dataSize);

    if (data == nullptr || dataSize <= 0)
      return std::nullopt;

    std::vector<std::byte> bytes(static_cast<size_t>(dataSize));
    std::memcpy(bytes.data(), data, static_cast<size_t>(dataSize));

    return juce::WebBrowserComponent::Resource { std::move(bytes), mimeTypeForPath(path) };
  }

  return std::nullopt;
}
} // namespace

VoxanovaAudioProcessorEditor::VoxanovaAudioProcessorEditor(VoxanovaAudioProcessor& p)
    : juce::AudioProcessorEditor(&p),
      audioProcessor(p),
      webView(juce::WebBrowserComponent::Options {}
                  .withKeepPageLoadedWhenBrowserIsHidden()
                  .withNativeIntegrationEnabled()
                  .withEventListener("supernovaEqSetParameter", [this](const juce::var& payload) {
                    setParameterFromNativeEvent(payload);
                  })
                  .withEventListener("supernovaEqSetEditorSize", [this](const juce::var& payload) {
                    setEditorSizeFromNativeEvent(payload);
                  })
                  .withEventListener("supernovaEqSetEqBands", [this](const juce::var& payload) {
                    audioProcessor.setEqBandsFromVar(payload);
                  })
                  .withResourceProvider([this](const juce::String& path) {
                    return provideResource(path);
                  }))
{
  setResizeLimits(juce::roundToInt(baseEditorWidth * minEditorScale),
                  juce::roundToInt(baseEditorHeight * minEditorScale),
                  juce::roundToInt(baseEditorWidth * maxEditorScale),
                  juce::roundToInt(baseEditorHeight * maxEditorScale));
  if (auto* editorConstrainer = getConstrainer())
    editorConstrainer->setFixedAspectRatio(static_cast<double>(baseEditorWidth) / static_cast<double>(baseEditorHeight));
  setSize(juce::roundToInt(baseEditorWidth * defaultEditorScale),
          juce::roundToInt(baseEditorHeight * defaultEditorScale));
  addAndMakeVisible(webView);
  setResizable(true, true);
  webView.goToURL(juce::WebBrowserComponent::getResourceProviderRoot() + "?v=" + webAssetVersion);
  startTimerHz(30);
}

void VoxanovaAudioProcessorEditor::paint(juce::Graphics& g)
{
  g.fillAll(juce::Colour::fromRGB(4, 11, 18));
}

void VoxanovaAudioProcessorEditor::resized()
{
  webView.setBounds(getLocalBounds());

  if (resizableCorner != nullptr)
  {
    constexpr int resizerSize = 18;
    resizableCorner->setBounds(getWidth() - resizerSize, getHeight() - resizerSize, resizerSize, resizerSize);
    resizableCorner->toFront(false);
  }

  webView.evaluateJavascript(
      "requestAnimationFrame(() => { window.dispatchEvent(new Event('resize')); document.body.classList.add('is-render-refresh'); requestAnimationFrame(() => document.body.classList.remove('is-render-refresh')); });");
}

void VoxanovaAudioProcessorEditor::timerCallback()
{
  drainQueuedParameterChanges();

  const auto snapshot = audioProcessor.getMeterSnapshot();
  if (snapshot.processCounter == lastMeterProcessCounter)
    ++staleMeterTicks;
  else
    staleMeterTicks = 0;
  lastMeterProcessCounter = snapshot.processCounter;

  const auto meterStale = staleMeterTicks >= 4;
  const auto visualSilence = snapshot.visualSilence || meterStale;
  const auto sampleRate = audioProcessor.getSampleRate();
  const auto spectrumMaxFrequency = sampleRate > 0.0
    ? juce::jlimit(20.0f, 20000.0f, static_cast<float>(sampleRate * 0.5 - 1.0))
    : 20000.0f;
  auto payload = juce::DynamicObject::Ptr(new juce::DynamicObject());

  payload->setProperty("inputL", visualSilence ? 0.0f : snapshot.input[0]);
  payload->setProperty("inputR", visualSilence ? 0.0f : snapshot.input[1]);
  payload->setProperty("outputL", visualSilence ? 0.0f : snapshot.output[0]);
  payload->setProperty("outputR", visualSilence ? 0.0f : snapshot.output[1]);
  payload->setProperty("inputChannels", snapshot.inputChannels);
  payload->setProperty("outputChannels", snapshot.outputChannels);
  payload->setProperty("visualSilence", visualSilence);
  payload->setProperty("meterStale", meterStale);
  payload->setProperty("gateGr", visualSilence ? 0.0f : snapshot.gateReduction);
  payload->setProperty("peakGr", visualSilence ? 0.0f : snapshot.peakReduction);
  payload->setProperty("glueGr", visualSilence ? 0.0f : snapshot.glueReduction);
  payload->setProperty("faceGr", visualSilence ? 0.0f : snapshot.faceReduction);
  payload->setProperty("gateGrDb", visualSilence ? 0.0f : snapshot.gateReductionDb);
  payload->setProperty("peakGrDb", visualSilence ? 0.0f : snapshot.peakReductionDb);
  payload->setProperty("glueGrDb", visualSilence ? 0.0f : snapshot.glueReductionDb);
  payload->setProperty("faceGrDb", visualSilence ? 0.0f : snapshot.faceReductionDb);
  payload->setProperty("peakLevel", visualSilence ? 0.0f : snapshot.peakLevel);
  payload->setProperty("glueLevel", visualSilence ? 0.0f : snapshot.glueLevel);
  payload->setProperty("faceLevel", visualSilence ? 0.0f : snapshot.faceLevel);
  payload->setProperty("gateLevel", visualSilence ? 0.0f : snapshot.gateLevel);
  payload->setProperty("hostBpm", snapshot.hostBpm);
  payload->setProperty("tuneFrequency", visualSilence ? 0.0f : snapshot.tuneFrequency);
  payload->setProperty("tuneCents", visualSilence ? 0.0f : snapshot.tuneCents);
  payload->setProperty("tuneConfidence", visualSilence ? 0.0f : snapshot.tuneConfidence);
  payload->setProperty("tuneTargetMidi", visualSilence ? 0.0f : snapshot.tuneTargetMidi);
  payload->setProperty("spectrumMaxFrequency", spectrumMaxFrequency);
  payload->setProperty("sampleRate", sampleRate > 0.0 ? sampleRate : 48000.0);
  auto makeWaveformPayload = [](const auto& samples) {
    juce::Array<juce::var> waveform;
    waveform.ensureStorageAllocated(static_cast<int>(samples.size()));
    for (const auto sample : samples)
      waveform.add(sample);
    return juce::var(waveform);
  };

  payload->setProperty("inputWaveform", makeWaveformPayload(snapshot.inputWaveform));
  payload->setProperty("peakWaveform", makeWaveformPayload(snapshot.peakWaveform));
  payload->setProperty("peakOutputWaveform", makeWaveformPayload(snapshot.peakOutputWaveform));
  payload->setProperty("glueWaveform", makeWaveformPayload(snapshot.glueWaveform));
  payload->setProperty("glueOutputWaveform", makeWaveformPayload(snapshot.glueOutputWaveform));
  payload->setProperty("faceWaveform", makeWaveformPayload(snapshot.faceWaveform));
  payload->setProperty("faceOutputWaveform", makeWaveformPayload(snapshot.faceOutputWaveform));
  payload->setProperty("gateWaveform", makeWaveformPayload(snapshot.gateWaveform));
  payload->setProperty("gateOutputWaveform", makeWaveformPayload(snapshot.gateOutputWaveform));
  payload->setProperty("inputSpectrum", makeWaveformPayload(snapshot.preCompSpectrum));
  payload->setProperty("preCompSpectrum", makeWaveformPayload(snapshot.preCompSpectrum));
  payload->setProperty("postCompSpectrum", makeWaveformPayload(snapshot.postCompSpectrum));
  payload->setProperty("preEqDetectorDb", makeWaveformPayload(snapshot.preEqDetectorDbs));
  payload->setProperty("postEqDetectorDb", makeWaveformPayload(snapshot.postEqDetectorDbs));

  juce::Array<juce::var> glueBandGr;
  juce::Array<juce::var> glueBandGrDb;
  glueBandGr.ensureStorageAllocated(static_cast<int>(snapshot.glueBandReductions.size()));
  glueBandGrDb.ensureStorageAllocated(static_cast<int>(snapshot.glueBandReductionDbs.size()));
  for (auto band = 0u; band < snapshot.glueBandReductions.size(); ++band)
  {
    glueBandGr.add(snapshot.glueBandReductions[band]);
    glueBandGrDb.add(snapshot.glueBandReductionDbs[band]);
  }
  payload->setProperty("glueBandGr", juce::var(glueBandGr));
  payload->setProperty("glueBandGrDb", juce::var(glueBandGrDb));

  if (auto* inputGain = audioProcessor.parameters.getRawParameterValue("inputGain"))
    payload->setProperty("inputGain", inputGain->load());

  if (auto* outputGain = audioProcessor.parameters.getRawParameterValue("outputGain"))
    payload->setProperty("outputGain", outputGain->load());

  if (auto* gateThreshold = audioProcessor.parameters.getRawParameterValue("gateThreshold"))
    payload->setProperty("gateThreshold", gateThreshold->load());

  if (auto* stereoWidth = audioProcessor.parameters.getRawParameterValue("stereoWidth"))
    payload->setProperty("stereoWidth", stereoWidth->load());

  if (auto* stereoLowBypass = audioProcessor.parameters.getRawParameterValue("stereoLowBypass"))
    payload->setProperty("stereoLowBypass", stereoLowBypass->load());

  if (auto* saturationMode = audioProcessor.parameters.getRawParameterValue("saturationMode"))
    payload->setProperty("saturationMode", saturationMode->load());

  if (auto* saturationAmount = audioProcessor.parameters.getRawParameterValue("saturationAmount"))
    payload->setProperty("saturationAmount", saturationAmount->load());

  if (auto* tuneEnabled = audioProcessor.parameters.getRawParameterValue("tuneEnabled"))
    payload->setProperty("tuneEnabled", tuneEnabled->load());

  if (auto* tuneAmount = audioProcessor.parameters.getRawParameterValue("tuneAmount"))
    payload->setProperty("tuneAmount", tuneAmount->load());

  if (auto* tuneKey = audioProcessor.parameters.getRawParameterValue("tuneKey"))
    payload->setProperty("tuneKey", tuneKey->load());

  if (auto* tuneScale = audioProcessor.parameters.getRawParameterValue("tuneScale"))
    payload->setProperty("tuneScale", tuneScale->load());

  if (auto* tuneCustomNotes = audioProcessor.parameters.getRawParameterValue("tuneCustomNotes"))
    payload->setProperty("tuneCustomNotes", tuneCustomNotes->load());

  if (auto* tuneVoiceType = audioProcessor.parameters.getRawParameterValue("tuneVoiceType"))
    payload->setProperty("tuneVoiceType", tuneVoiceType->load());

  if (auto* peakEnabled = audioProcessor.parameters.getRawParameterValue("peakEnabled"))
    payload->setProperty("peakEnabled", peakEnabled->load());

  if (auto* peakThreshold = audioProcessor.parameters.getRawParameterValue("peakThreshold"))
    payload->setProperty("peakThreshold", peakThreshold->load());

  if (auto* glueEnabled = audioProcessor.parameters.getRawParameterValue("glueEnabled"))
    payload->setProperty("glueEnabled", glueEnabled->load());

  if (auto* glueMultiband = audioProcessor.parameters.getRawParameterValue("glueMultiband"))
    payload->setProperty("glueMultiband", glueMultiband->load());

  if (auto* glueThreshold = audioProcessor.parameters.getRawParameterValue("glueThreshold"))
    payload->setProperty("glueThreshold", glueThreshold->load());

  if (auto* glueLowThreshold = audioProcessor.parameters.getRawParameterValue("glueLowThreshold"))
    payload->setProperty("glueLowThreshold", glueLowThreshold->load());

  if (auto* glueLowMidThreshold = audioProcessor.parameters.getRawParameterValue("glueLowMidThreshold"))
    payload->setProperty("glueLowMidThreshold", glueLowMidThreshold->load());

  if (auto* glueHighMidThreshold = audioProcessor.parameters.getRawParameterValue("glueHighMidThreshold"))
    payload->setProperty("glueHighMidThreshold", glueHighMidThreshold->load());

  if (auto* glueAirThreshold = audioProcessor.parameters.getRawParameterValue("glueAirThreshold"))
    payload->setProperty("glueAirThreshold", glueAirThreshold->load());

  if (auto* faceEnabled = audioProcessor.parameters.getRawParameterValue("faceEnabled"))
    payload->setProperty("faceEnabled", faceEnabled->load());

  if (auto* faceThreshold = audioProcessor.parameters.getRawParameterValue("faceThreshold"))
    payload->setProperty("faceThreshold", faceThreshold->load());

  if (auto* gateEnabled = audioProcessor.parameters.getRawParameterValue("gateEnabled"))
    payload->setProperty("gateEnabled", gateEnabled->load());

  if (auto* deEsserEnabled = audioProcessor.parameters.getRawParameterValue("deEsserEnabled"))
    payload->setProperty("deEsserEnabled", deEsserEnabled->load());

  if (auto* deEsserAmount = audioProcessor.parameters.getRawParameterValue("deEsserAmount"))
    payload->setProperty("deEsserAmount", deEsserAmount->load());

  if (auto* deEsserLow = audioProcessor.parameters.getRawParameterValue("deEsserLow"))
    payload->setProperty("deEsserLow", deEsserLow->load());

  if (auto* deEsserHigh = audioProcessor.parameters.getRawParameterValue("deEsserHigh"))
    payload->setProperty("deEsserHigh", deEsserHigh->load());

  if (auto* stereoEnabled = audioProcessor.parameters.getRawParameterValue("stereoEnabled"))
    payload->setProperty("stereoEnabled", stereoEnabled->load());

  if (auto* reverbEnabled = audioProcessor.parameters.getRawParameterValue("reverbEnabled"))
    payload->setProperty("reverbEnabled", reverbEnabled->load());

  if (auto* reverbMix = audioProcessor.parameters.getRawParameterValue("reverbMix"))
    payload->setProperty("reverbMix", reverbMix->load());

  if (auto* reverbDecay = audioProcessor.parameters.getRawParameterValue("reverbDecay"))
    payload->setProperty("reverbDecay", reverbDecay->load());

  if (auto* reverbSize = audioProcessor.parameters.getRawParameterValue("reverbSize"))
    payload->setProperty("reverbSize", reverbSize->load());

  if (auto* reverbPredelay = audioProcessor.parameters.getRawParameterValue("reverbPredelay"))
    payload->setProperty("reverbPredelay", reverbPredelay->load());

  if (auto* reverbLowCut = audioProcessor.parameters.getRawParameterValue("reverbLowCut"))
    payload->setProperty("reverbLowCut", reverbLowCut->load());

  if (auto* reverbHighCut = audioProcessor.parameters.getRawParameterValue("reverbHighCut"))
    payload->setProperty("reverbHighCut", reverbHighCut->load());

  if (auto* reverbMode = audioProcessor.parameters.getRawParameterValue("reverbMode"))
    payload->setProperty("reverbMode", reverbMode->load());

  if (auto* reverbSync = audioProcessor.parameters.getRawParameterValue("reverbSync"))
    payload->setProperty("reverbSync", reverbSync->load());

  if (auto* reverbNoteMode = audioProcessor.parameters.getRawParameterValue("reverbNoteMode"))
    payload->setProperty("reverbNoteMode", reverbNoteMode->load());

  if (auto* reverbDecaySync = audioProcessor.parameters.getRawParameterValue("reverbDecaySync"))
    payload->setProperty("reverbDecaySync", reverbDecaySync->load());

  if (auto* reverbPredelaySync = audioProcessor.parameters.getRawParameterValue("reverbPredelaySync"))
    payload->setProperty("reverbPredelaySync", reverbPredelaySync->load());

  if (auto* reverbDecayDivision = audioProcessor.parameters.getRawParameterValue("reverbDecayDivision"))
    payload->setProperty("reverbDecayDivision", reverbDecayDivision->load());

  if (auto* reverbPredelayDivision = audioProcessor.parameters.getRawParameterValue("reverbPredelayDivision"))
    payload->setProperty("reverbPredelayDivision", reverbPredelayDivision->load());

  if (auto* reverbAuxBus = audioProcessor.parameters.getRawParameterValue("reverbAuxBus"))
    payload->setProperty("reverbAuxBus", reverbAuxBus->load());

  if (auto* delayEnabled = audioProcessor.parameters.getRawParameterValue("delayEnabled"))
    payload->setProperty("delayEnabled", delayEnabled->load());

  if (auto* delayMix = audioProcessor.parameters.getRawParameterValue("delayMix"))
    payload->setProperty("delayMix", delayMix->load());

  if (auto* delayFeedback = audioProcessor.parameters.getRawParameterValue("delayFeedback"))
    payload->setProperty("delayFeedback", delayFeedback->load());

  if (auto* delayLowCut = audioProcessor.parameters.getRawParameterValue("delayLowCut"))
    payload->setProperty("delayLowCut", delayLowCut->load());

  if (auto* delayHighCut = audioProcessor.parameters.getRawParameterValue("delayHighCut"))
    payload->setProperty("delayHighCut", delayHighCut->load());

  if (auto* delaySync = audioProcessor.parameters.getRawParameterValue("delaySync"))
    payload->setProperty("delaySync", delaySync->load());

  if (auto* delayDivision = audioProcessor.parameters.getRawParameterValue("delayDivision"))
    payload->setProperty("delayDivision", delayDivision->load());

  if (auto* delayNoteMode = audioProcessor.parameters.getRawParameterValue("delayNoteMode"))
    payload->setProperty("delayNoteMode", delayNoteMode->load());

  if (auto* delayTimeMs = audioProcessor.parameters.getRawParameterValue("delayTimeMs"))
    payload->setProperty("delayTimeMs", delayTimeMs->load());

  if (auto* delayMode = audioProcessor.parameters.getRawParameterValue("delayMode"))
    payload->setProperty("delayMode", delayMode->load());

  if (auto* delayPostReverb = audioProcessor.parameters.getRawParameterValue("delayPostReverb"))
    payload->setProperty("delayPostReverb", delayPostReverb->load());

  if (auto* delayStyle = audioProcessor.parameters.getRawParameterValue("delayStyle"))
    payload->setProperty("delayStyle", delayStyle->load());

  if (auto* delayAuxBus = audioProcessor.parameters.getRawParameterValue("delayAuxBus"))
    payload->setProperty("delayAuxBus", delayAuxBus->load());

  payload->setProperty("eqBands", audioProcessor.getEqBandsState());

  const auto json = juce::JSON::toString(juce::var(payload.get()), true);
  webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('supernovaEqMeterUpdate', { detail: " + json + " }));");
}

void VoxanovaAudioProcessorEditor::drainQueuedParameterChanges()
{
  if (parameterDrainPending)
    return;

  parameterDrainPending = true;
  const juce::Component::SafePointer<VoxanovaAudioProcessorEditor> safeThis(this);

  webView.evaluateJavascript(
      R"js(
        (function() {
          var queue = window.__supernovaEqParameterQueue || [];
          window.__supernovaEqParameterQueue = [];
          return JSON.stringify(queue);
        })();
      )js",
      [safeThis](juce::WebBrowserComponent::EvaluationResult result) {
        if (safeThis == nullptr)
          return;

        safeThis->parameterDrainPending = false;

        if (const auto* value = result.getResult())
          safeThis->applyQueuedParameterChanges(value->toString());
      });
}

void VoxanovaAudioProcessorEditor::applyQueuedParameterChanges(const juce::String& json)
{
  const auto parsed = juce::JSON::parse(json);
  const auto* changes = parsed.getArray();

  if (changes == nullptr)
    return;

  for (const auto& change : *changes)
  {
    const auto id = change.getProperty("id", {}).toString();
    const auto value = static_cast<float>(change.getProperty("value", 0.0));

    if (id.isNotEmpty())
      setParameterFromRequest(id, value);
  }
}

std::optional<juce::WebBrowserComponent::Resource> VoxanovaAudioProcessorEditor::provideResource(
    const juce::String& path)
{
  if (isApiPath(path, "/api/setParameter"))
  {
    const auto id = getQueryValue(path, "id");
    const auto valueText = getQueryValue(path, "value");

    if (id.isNotEmpty() && valueText.isNotEmpty())
    {
      const auto didSet = setParameterFromRequest(id, valueText.getFloatValue());
      return makeTextResource(didSet ? R"({"ok":true})" : R"({"ok":false,"error":"parameter_not_found"})");
    }

    return makeTextResource(R"({"ok":false})");
  }

  if (isApiPath(path, "/api/setEqBands"))
  {
    const auto json = getQueryValue(path, "json");
    if (json.isNotEmpty())
    {
      audioProcessor.setEqBandsFromVar(juce::JSON::parse(json));
      return makeTextResource(R"({"ok":true})");
    }

    return makeTextResource(R"({"ok":false})");
  }

  if (isApiPath(path, "/api/setEditorSize"))
  {
    const auto scaleText = getQueryValue(path, "scale");
    const auto widthText = getQueryValue(path, "width");
    const auto heightText = getQueryValue(path, "height");

    setEditorSizeFromRequest(scaleText.getFloatValue(), widthText.getIntValue(), heightText.getIntValue());
    return makeTextResource(R"({"ok":true})");
  }

  return getWebResource(path);
}

void VoxanovaAudioProcessorEditor::setParameterFromNativeEvent(const juce::var& payload)
{
  const auto id = payload.getProperty("id", {}).toString();
  const auto value = static_cast<float>(payload.getProperty("value", 0.0));

  if (id.isNotEmpty())
    setParameterFromRequest(id, value);
}

void VoxanovaAudioProcessorEditor::setEditorSizeFromNativeEvent(const juce::var& payload)
{
  const auto scale = static_cast<float>(payload.getProperty("scale", 0.0));
  const auto width = static_cast<int>(payload.getProperty("width", 0));
  const auto height = static_cast<int>(payload.getProperty("height", 0));

  setEditorSizeFromRequest(scale, width, height);
}

bool VoxanovaAudioProcessorEditor::setParameterFromRequest(const juce::String& parameterId, float value)
{
  if (auto* parameter = audioProcessor.parameters.getParameter(parameterId))
  {
    const auto normalised = parameter->convertTo0to1(value);
    parameter->beginChangeGesture();
    parameter->setValueNotifyingHost(normalised);
    parameter->endChangeGesture();
    return true;
  }

  return false;
}

void VoxanovaAudioProcessorEditor::setEditorSizeFromRequest(float requestedScale, int requestedWidth, int requestedHeight)
{
  auto scale = requestedScale;

  if (scale <= 0.0f && requestedWidth > 0)
    scale = static_cast<float>(requestedWidth) / static_cast<float>(baseEditorWidth);

  if (scale <= 0.0f && requestedHeight > 0)
    scale = static_cast<float>(requestedHeight) / static_cast<float>(baseEditorHeight);

  if (scale <= 0.0f)
    return;

  scale = juce::jlimit(minEditorScale, maxEditorScale, scale);

  auto nextBounds = getBounds();
  nextBounds.setSize(juce::roundToInt(baseEditorWidth * scale), juce::roundToInt(baseEditorHeight * scale));
  setBoundsConstrained(nextBounds);
  webView.setBounds(getLocalBounds());
  webView.evaluateJavascript(
      "requestAnimationFrame(() => { window.dispatchEvent(new Event('resize')); document.body.classList.add('is-render-refresh'); requestAnimationFrame(() => document.body.classList.remove('is-render-refresh')); });");
}
