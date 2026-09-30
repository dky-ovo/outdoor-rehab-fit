#import "OASenseVoiceEngine.h"
#import <SherpaOnnxC/sherpa-onnx/c-api/c-api.h>
#include <cstring>
#include <exception>
#include <memory>

@implementation OASenseVoiceEngine
+ (NSString *)transcribeSamples:(NSData *)samples
                    sampleRate:(int32_t)sampleRate
                     modelPath:(NSString *)modelPath
                    tokensPath:(NSString *)tokensPath
                      language:(NSString *)language
                         error:(NSError **)error {
  try {
  if (sampleRate != 16000 || samples.length == 0 || samples.length % sizeof(float) != 0 ||
      samples.length > 16000 * 60 * sizeof(float)) {
    if (error) *error = [NSError errorWithDomain:@"OfflineAssistantVoice" code:1 userInfo:nil];
    return nil;
  }
  SherpaOnnxOfflineRecognizerConfig config;
  std::memset(&config, 0, sizeof(config));
  config.feat_config.sample_rate = 16000;
  config.feat_config.feature_dim = 80;
  config.decoding_method = "greedy_search";
  config.model_config.debug = 0;
  config.model_config.num_threads = 2;
  config.model_config.provider = "cpu";
  config.model_config.tokens = tokensPath.UTF8String;
  config.model_config.sense_voice.model = modelPath.UTF8String;
  config.model_config.sense_voice.language = language.UTF8String;
  config.model_config.sense_voice.use_itn = 1;

  // RAII destruction stays on this serial worker, including every error path.
  const auto destroyRecognizer = [](const SherpaOnnxOfflineRecognizer *p) { if (p) SherpaOnnxDestroyOfflineRecognizer(p); };
  const auto destroyStream = [](const SherpaOnnxOfflineStream *p) { if (p) SherpaOnnxDestroyOfflineStream(p); };
  const auto destroyResult = [](const SherpaOnnxOfflineRecognizerResult *p) { if (p) SherpaOnnxDestroyOfflineRecognizerResult(p); };
  std::unique_ptr<const SherpaOnnxOfflineRecognizer, decltype(destroyRecognizer)> recognizer(SherpaOnnxCreateOfflineRecognizer(&config), destroyRecognizer);
  if (!recognizer) {
    if (error) *error = [NSError errorWithDomain:@"OfflineAssistantVoice" code:2 userInfo:nil];
    return nil;
  }
  std::unique_ptr<const SherpaOnnxOfflineStream, decltype(destroyStream)> stream(SherpaOnnxCreateOfflineStream(recognizer.get()), destroyStream);
  if (!stream) {
    if (error) *error = [NSError errorWithDomain:@"OfflineAssistantVoice" code:3 userInfo:nil];
    return nil;
  }
  SherpaOnnxAcceptWaveformOffline(stream.get(), sampleRate, static_cast<const float *>(samples.bytes), static_cast<int32_t>(samples.length / sizeof(float)));
  SherpaOnnxDecodeOfflineStream(recognizer.get(), stream.get());
  std::unique_ptr<const SherpaOnnxOfflineRecognizerResult, decltype(destroyResult)> result(SherpaOnnxGetOfflineStreamResult(stream.get()), destroyResult);
  if (!result || !result->text) {
    if (error) *error = [NSError errorWithDomain:@"OfflineAssistantVoice" code:4 userInfo:nil];
    return nil;
  }
  return [NSString stringWithUTF8String:result->text];
  } catch (const std::exception &) {
    if (error) *error = [NSError errorWithDomain:@"OfflineAssistantVoice" code:5 userInfo:nil];
    return nil;
  } catch (...) {
    if (error) *error = [NSError errorWithDomain:@"OfflineAssistantVoice" code:6 userInfo:nil];
    return nil;
  }
}
@end
