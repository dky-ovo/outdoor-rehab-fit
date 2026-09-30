param(
    [string]$AdbPath = 'adb',
    [string]$Serial,
    [ValidatePattern('^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$')]
    [string]$Package = 'com.maxcch.c.outdoorrehabfit'
)

$ErrorActionPreference = 'Stop'

function Invoke-AdbRead {
    param([string]$Executable, [string[]]$Arguments)
    $lines = @(& $Executable @Arguments 2>&1 | ForEach-Object { "$_" })
    if ($LASTEXITCODE -ne 0) { throw ('ADB read failed: ' + ($Arguments -join ' ') + ' (exit ' + $LASTEXITCODE + '). Check the USB connection and retry.') }
    return $lines
}

function Select-AppCrashLines {
    param([string[]]$Lines, [string]$PackageName)
    $pending = @{}; $blocks = [Collections.Generic.List[object]]::new()
    foreach ($line in $Lines) {
        if ($line -notmatch '^\s*\d\d-\d\d\s+\d\d:\d\d:\d\d\.\d+\s+(\d+)\s+(\d+)\s+[VDIWEF]\s+([^:]+):\s?(.*)$') { continue }
        $pidKey = $Matches[1]; $tag = $Matches[3].Trim(); $message = $Matches[4]
        if ($tag -notin @('AndroidRuntime', 'DEBUG')) { continue }
        $start = ($tag -eq 'AndroidRuntime' -and $message -match '^FATAL EXCEPTION:') -or ($tag -eq 'DEBUG' -and $message -match '^\*\*\* \*\*\*')
        if ($start) {
            if ($pending.ContainsKey($pidKey)) { $blocks.Add($pending[$pidKey]) }
            $pending[$pidKey] = [Collections.Generic.List[object]]::new()
        }
        if ($pending.ContainsKey($pidKey)) { $pending[$pidKey].Add([pscustomobject]@{ Line = $line; Message = $message }) }
    }
    foreach ($block in $pending.Values) { $blocks.Add($block) }
    $packagePattern = [regex]::Escape($PackageName) + '(?::[A-Za-z0-9_.-]+)?'
    $selected = @($blocks | Where-Object {
        @($_ | Where-Object { $_.Message -match ('^Process:\s*' + $packagePattern + ',\s*PID:\s*\d+\s*$') -or
            $_.Message -match ('^pid:\s*\d+.*>>>\s*' + $packagePattern + '\s*<<<') }).Count -gt 0
    })
    $safe = [Collections.Generic.List[string]]::new()
    foreach ($block in $selected) {
        $safe.Add('--- APP crash: common personal/credential patterns redacted; review before sharing ---')
        foreach ($record in $block) {
            # Preserve exception causes, library names, JS errors and stack
            # frames. Do not save unfiltered buffers or unrelated processes.
            $line = $record.Line -replace '(?i)\bBearer\s+[A-Za-z0-9._~+/-]+=*', 'Bearer [REDACTED]'
            $line = $line -replace '\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b', '[REDACTED_TOKEN]'
            $line = $line -replace '(?i)((?:password|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|secret|email|phone)\s*[=:]\s*)[^\s,;]+', '$1[REDACTED]'
            $line = $line -replace '(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', '[REDACTED_EMAIL]'
            $line = $line -replace '(?<![\w.])\+?\d{8,15}(?![\w.])', '[REDACTED_NUMBER]'
            $safe.Add($line)
        }
    }
    return [pscustomobject]@{ Count = $selected.Count; Lines = @($safe) }
}

function Invoke-AndroidStartupDiagnostics {
    param([string]$AdbPath, [string]$Serial, [string]$Package)
    $command = Get-Command -Name $AdbPath -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $command) { throw 'ADB was not found. Supply -AdbPath with the full path to the official adb.exe.' }
    $executable = $command.Source
    $devices = @(Invoke-AdbRead $executable @('devices', '-l') | ForEach-Object {
        if ($_ -match '^([^\s]+)\s+(device|unauthorized|offline|recovery|sideload|bootloader)(?:\s|$)') {
            [pscustomobject]@{ Serial = $Matches[1]; State = $Matches[2] }
        }
    })
    if (-not $devices.Count) { throw 'No Android device found. Connect the tablet by USB, enable USB debugging and run this command again. No waiting or device changes were performed.' }
    if ($Serial) {
        $device = @($devices | Where-Object Serial -eq $Serial)
        if ($device.Count -ne 1) { throw 'The requested serial is not connected. Check adb devices -l and retry with an exact -Serial.' }
        $device = $device[0]
    } else {
        if ($devices.Count -gt 1) { throw 'Multiple Android devices found. Run adb devices -l and specify the tablet using -Serial; no device was selected automatically.' }
        $device = $devices[0]
    }
    if ($device.State -eq 'unauthorized') { throw 'Device is unauthorized. Unlock the tablet and accept its USB debugging authorization dialog, then run again.' }
    if ($device.State -ne 'device') { throw ('Device is ' + $device.State + '. Reconnect it and retry; this script does not wait, reboot or change the device.') }
    $deviceArgs = @('-s', $device.Serial)
    $properties = [ordered]@{}
    foreach ($property in @('ro.product.manufacturer', 'ro.product.model', 'ro.build.version.release', 'ro.build.version.sdk', 'ro.product.cpu.abilist', 'ro.product.cpu.abi')) {
        $properties[$property] = ((Invoke-AdbRead $executable ($deviceArgs + @('shell', 'getprop', $property))) -join "`n").Trim()
    }
    $memory = @(Invoke-AdbRead $executable ($deviceArgs + @('shell', 'cat', '/proc/meminfo')) | Where-Object { $_ -match '^(MemTotal|MemAvailable|MemFree|SwapTotal):\s+\d+\s+kB\s*$' })
    $packageInfo = @(Invoke-AdbRead $executable ($deviceArgs + @('shell', 'dumpsys', 'package', $Package)) | Where-Object { $_ -match '^\s*(versionCode=|versionName=|primaryCpuAbi=|secondaryCpuAbi=)' })
    if (-not ($packageInfo | Where-Object { $_ -match '^\s*versionCode=\d+' })) { throw 'The APP package was not found or its version could not be read. No successful diagnostic report was created.' }
    $crashes = Select-AppCrashLines -Lines @(Invoke-AdbRead $executable ($deviceArgs + @('logcat', '-b', 'crash', '-d', '-v', 'threadtime'))) -PackageName $Package
    $report = [ordered]@{ collectedAt = [DateTime]::UtcNow.ToString('o'); package = $Package; device = $properties; memory = $memory; installedPackage = $packageInfo;
        appCrashBlocks = $crashes.Count; crashStatus = $(if ($crashes.Count) { 'found' } else { 'none_found_in_crash_buffer' });
        privacy = 'Only this APP process crash blocks are retained. Common credential/email/phone patterns are redacted; manually review the report before sharing.' }
    $projectRoot = Split-Path -Parent $PSScriptRoot
    $outputRoot = Join-Path $projectRoot 'workspace-artifacts'
    $destination = Join-Path $outputRoot ('android-startup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $destination | Out-Null
    $utf8 = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText((Join-Path $destination 'device-summary.json'), (($report | ConvertTo-Json -Depth 6) + "`n"), $utf8)
    $crashText = if ($crashes.Count) { $crashes.Lines -join "`n" } else { 'No matching APP crash was present. This does not prove the APP is working; reproduce the failure manually and collect again.' }
    [IO.File]::WriteAllText((Join-Path $destination 'app-crash.log'), ($crashText + "`n"), $utf8)
    return [pscustomobject]@{ OutputDirectory = $destination; AppCrashBlocks = $crashes.Count; DeviceModel = $properties['ro.product.model'] }
}

if ($MyInvocation.InvocationName -ne '.') {
    try { Invoke-AndroidStartupDiagnostics -AdbPath $AdbPath -Serial $Serial -Package $Package | Format-List }
    catch { Write-Error $_.Exception.Message; exit 1 }
}
