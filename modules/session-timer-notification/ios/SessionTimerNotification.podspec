Pod::Spec.new do |s|
  s.name = 'SessionTimerNotification'
  s.version = '1.0.0'
  s.summary = 'OUTDOOR-FIT system-managed exercise timer Live Activity'
  s.description = 'Local ActivityKit bridge for the OUTDOOR-FIT exercise timer.'
  s.author = 'OUTDOOR-FIT'
  s.homepage = 'https://docs.expo.dev/modules/'
  s.license = { :type => 'MIT' }
  s.platforms = { :ios => '15.1' }
  s.swift_version = '5.9'
  s.source = { :git => 'https://github.com/expo/expo.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }
  # Weak linking plus runtime availability guards preserve iOS 15.1 support.
  s.weak_frameworks = 'ActivityKit'
  s.source_files = 'SessionTimerNotificationModule.swift', 'SessionTimerLiveActivityController.swift', 'LiveActivity/OutdoorFitTimerAttributes.swift'
  s.resource_bundles = { 'SessionTimerNotification_privacy' => ['PrivacyInfo.xcprivacy'] }
  # OutdoorFitTimerWidget.swift has @main and belongs ONLY to the extension.
end
