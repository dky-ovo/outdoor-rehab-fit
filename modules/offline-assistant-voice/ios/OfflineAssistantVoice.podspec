Pod::Spec.new do |s|
  s.name = 'OfflineAssistantVoice'
  s.version = '1.1.0'
  s.summary = 'Installed-voice reply playback for OUTDOOR-FIT'
  s.description = 'Local Expo bridge for Cantonese and English answer playback. No microphone access.'
  s.author = 'OUTDOOR-FIT'
  s.homepage = 'https://github.com/Anesthesia-ovo/outdoor-rehab-fit'
  s.license = { :type => 'MIT', :file => '../LICENSE' }
  s.platforms = { :ios => '15.1' }
  s.swift_version = '5.9'
  s.source = { :git => 'https://github.com/Anesthesia-ovo/outdoor-rehab-fit.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  # Keep the former local bridge/resources on disk, but never compile or bundle them.
  s.source_files = 'OfflineAssistantVoiceModule.swift', 'OfflineReplySpeaker.swift'
  s.frameworks = 'AVFoundation', 'Foundation', 'UIKit'
  s.resource_bundles = { 'OfflineAssistantVoice_privacy' => ['PrivacyInfo.xcprivacy'] }
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }
end
