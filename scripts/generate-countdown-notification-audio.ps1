[CmdletBinding()]
param(
    [string]$EnglishVoiceName = 'Microsoft Zira Desktop',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech

$repoDirectory = Split-Path -Parent $PSScriptRoot
$audioDirectory = Join-Path $repoDirectory 'assets/sounds/notifications'
$cues = @(
    @{ File = 'countdown_en_halfway.wav'; Text = 'The countdown is halfway complete.' },
    @{ File = 'countdown_en_complete.wav'; Text = 'The countdown has finished.' }
)

function Get-NotificationWaveInfo {
    param([string]$Path)

    $stream = [System.IO.File]::OpenRead($Path)
    $reader = [System.IO.BinaryReader]::new($stream)
    try {
        if ([System.Text.Encoding]::ASCII.GetString($reader.ReadBytes(4)) -ne 'RIFF') {
            throw "Not a RIFF file: $Path"
        }
        $null = $reader.ReadUInt32()
        if ([System.Text.Encoding]::ASCII.GetString($reader.ReadBytes(4)) -ne 'WAVE') {
            throw "Not a WAVE file: $Path"
        }
        $format = $null
        [long]$audioBytes = 0
        while ($stream.Position + 8 -le $stream.Length) {
            $chunkId = [System.Text.Encoding]::ASCII.GetString($reader.ReadBytes(4))
            $chunkLength = $reader.ReadUInt32()
            $chunkEnd = $stream.Position + $chunkLength
            if ($chunkEnd -gt $stream.Length) { throw "Truncated WAV chunk: $Path" }
            if ($chunkId -eq 'fmt ') {
                if ($chunkLength -lt 16) { throw "Invalid WAV format chunk: $Path" }
                $format = @{
                    Encoding = $reader.ReadUInt16()
                    Channels = $reader.ReadUInt16()
                    SampleRate = $reader.ReadUInt32()
                    ByteRate = $reader.ReadUInt32()
                    BlockAlign = $reader.ReadUInt16()
                    BitsPerSample = $reader.ReadUInt16()
                }
            } elseif ($chunkId -eq 'data') {
                $audioBytes += $chunkLength
            }
            $stream.Position = $chunkEnd + ($chunkLength % 2)
        }
        if ($null -eq $format -or $format.Encoding -ne 1 -or $format.Channels -ne 1 -or
            $format.SampleRate -ne 24000 -or $format.BitsPerSample -ne 16 -or
            $format.BlockAlign -ne 2 -or $format.ByteRate -ne 48000 -or $audioBytes -le 0) {
            throw "Expected nonempty 24 kHz, 16-bit, mono linear PCM WAV: $Path"
        }
        $durationSeconds = $audioBytes / [double]$format.ByteRate
        if ($durationSeconds -ge 30) { throw "Notification audio must be shorter than 30 seconds: $Path" }
        [PSCustomObject]@{
            File = Split-Path -Leaf $Path
            Encoding = 'PCM'
            SampleRate = $format.SampleRate
            Channels = $format.Channels
            BitsPerSample = $format.BitsPerSample
            DurationSeconds = [Math]::Round($durationSeconds, 3)
            Bytes = $stream.Length
            SHA256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    } finally {
        $reader.Dispose()
        $stream.Dispose()
    }
}

$synthesizer = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
    $voice = $synthesizer.GetInstalledVoices() | Where-Object {
        $_.Enabled -and $_.VoiceInfo.Name -eq $EnglishVoiceName -and $_.VoiceInfo.Culture.Name -like 'en-*'
    } | Select-Object -First 1
    if ($null -eq $voice) {
        throw "Installed English voice not found: $EnglishVoiceName. This script never installs or downloads voices."
    }
    foreach ($cue in $cues) {
        $targetPath = Join-Path $audioDirectory $cue.File
        if ((Test-Path -LiteralPath $targetPath) -and -not $Force) {
            throw "Audio already exists: $targetPath. Pass -Force to regenerate these countdown assets."
        }
    }
    $null = New-Item -ItemType Directory -Path $audioDirectory -Force
    $synthesizer.SelectVoice($EnglishVoiceName)
    $synthesizer.Rate = -1
    $synthesizer.Volume = 100
    $waveFormat = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(
        24000,
        [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
        [System.Speech.AudioFormat.AudioChannel]::Mono
    )
    foreach ($cue in $cues) {
        $targetPath = Join-Path $audioDirectory $cue.File
        $synthesizer.SetOutputToWaveFile($targetPath, $waveFormat)
        $synthesizer.Speak($cue.Text)
        $synthesizer.SetOutputToNull()
        Get-NotificationWaveInfo -Path $targetPath
    }
} finally {
    $synthesizer.Dispose()
}
