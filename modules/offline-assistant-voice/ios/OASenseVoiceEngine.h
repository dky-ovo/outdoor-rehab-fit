#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Worker-only C wrapper. Input is mono float32 PCM, not a path or URL.
@interface OASenseVoiceEngine : NSObject
+ (nullable NSString *)transcribeSamples:(NSData *)samples
                             sampleRate:(int32_t)sampleRate
                              modelPath:(NSString *)modelPath
                             tokensPath:(NSString *)tokensPath
                               language:(NSString *)language
                                  error:(NSError **)error
    NS_SWIFT_NAME(transcribe(samples:sampleRate:modelPath:tokensPath:language:));
@end

NS_ASSUME_NONNULL_END
