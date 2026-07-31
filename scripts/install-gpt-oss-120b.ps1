# Install OpenAI GPT-OSS 120B for the PERSONAL ThinkPad llama-swap instance.
#
# The default target is the user's existing model library:
#   C:\Users\jacob\AI Models\Library\OpenAI\gpt-oss-120b
#
# This installer is intentionally separate from start-compcat.ps1. The model is about
# 59 GiB and should be downloaded once, explicitly, rather than during normal app startup.
# The download is resumable, SHA-256 verified, and the existing llama-swap config is backed
# up before an idempotent model entry is inserted.
#
# Preview checks and paths without changing anything:
#   pwsh -File scripts\install-gpt-oss-120b.ps1 -PlanOnly
#
# Download, configure llama-swap, select the model in .env.deploy, and restart the personal
# stack without rebuilding or ingesting:
#   pwsh -File scripts\install-gpt-oss-120b.ps1 -ActivateForCompCat
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$ModelDirectory = (Join-Path $env:USERPROFILE 'AI Models\Library\OpenAI\gpt-oss-120b'),
    [string]$ConfigPath = (Join-Path $env:USERPROFILE 'llama-swap.yaml'),
    [string]$CompCatEnvPath = (Join-Path (Split-Path -Parent $PSScriptRoot) '.env.deploy'),
    [switch]$ActivateForCompCat,
    [switch]$PlanOnly,
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$modelId = 'openai/gpt-oss-120b'
$modelFileName = 'gpt-oss-120b-MXFP4.gguf'
$modelUrl = 'https://huggingface.co/ggml-org/gpt-oss-120b-GGUF/resolve/main/gpt-oss-120b-MXFP4.gguf?download=true'
$expectedBytes = [int64]63387346208
$expectedSha256 = '582bd40f6886200101f4c4ed9f25f3fe80cc14c86e9e2b37746cd8904a0c622d'
$minimumRamBytes = [int64](60GB)
$diskHeadroomBytes = [int64](5GB)
$modelTtlSeconds = 3600
$healthCheckTimeoutSeconds = 300
$modelPath = Join-Path $ModelDirectory $modelFileName
$partialPath = "$modelPath.partial"

function Format-GiB([int64]$Bytes) {
    return '{0:N1} GiB' -f ($Bytes / 1GB)
}

function Write-Utf8NoBom([string]$Destination, [string]$Content) {
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Destination, $Content, $encoding)
}

function Resolve-LlamaSwap {
    $command = Get-Command llama-swap -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }

    $wingetPath = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\mostlygeek.llama-swap_Microsoft.Winget.Source_8wekyb3d8bbwe\llama-swap.exe'
    if (Test-Path -LiteralPath $wingetPath) { return $wingetPath }

    throw 'llama-swap.exe was not found in PATH or the standard WinGet package directory.'
}

function Assert-HardwareAndDisk {
    $computer = Get-CimInstance Win32_ComputerSystem
    $ramBytes = [int64]$computer.TotalPhysicalMemory
    Write-Host ('System RAM: {0}' -f (Format-GiB $ramBytes))
    if ($ramBytes -lt $minimumRamBytes -and -not $Force) {
        throw ('GPT-OSS 120B needs about 64 GiB aggregate memory at 8K context. ' +
            'This machine reports less than 60 GiB RAM. Re-run with -Force only after reviewing the llama.cpp memory plan.')
    }

    $root = [System.IO.Path]::GetPathRoot($modelPath)
    if (-not $root) { throw "Could not determine a drive for model path: $modelPath" }
    $driveName = $root.TrimEnd('\').TrimEnd(':')
    $drive = Get-PSDrive -Name $driveName
    $partialBytes = 0
    $modelInstalled = Test-Path -LiteralPath $modelPath
    if (-not $modelInstalled -and (Test-Path -LiteralPath $partialPath)) {
        $partialBytes = [int64](Get-Item -LiteralPath $partialPath).Length
        if ($partialBytes -gt $expectedBytes) {
            throw "Partial download is larger than expected: $partialPath"
        }
    }
    $remainingBytes = [int64]0
    if (-not $modelInstalled) {
        $remainingBytes = [Math]::Max([int64]0, $expectedBytes - $partialBytes)
    }
    $requiredFreeBytes = $remainingBytes + $diskHeadroomBytes
    Write-Host ('Free disk on {0}: {1}; download remaining: {2}' -f $root, (Format-GiB $drive.Free), (Format-GiB $remainingBytes))
    if ($drive.Free -lt $requiredFreeBytes) {
        throw ('Not enough free disk. Need at least {0} free for the remaining download plus headroom.' -f (Format-GiB $requiredFreeBytes))
    }
}

function Assert-ModelFile([string]$CandidatePath) {
    if (-not (Test-Path -LiteralPath $CandidatePath)) {
        throw "Model file is missing after download: $CandidatePath"
    }
    $actualBytes = [int64](Get-Item -LiteralPath $CandidatePath).Length
    if ($actualBytes -ne $expectedBytes) {
        throw "Model size mismatch. Expected $expectedBytes bytes, found $actualBytes bytes."
    }

    Write-Host 'Verifying model SHA-256 (this reads the full 59 GiB file)...'
    $actualHash = (Get-FileHash -LiteralPath $CandidatePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedSha256) {
        throw "Model SHA-256 mismatch. Expected $expectedSha256, found $actualHash. The file was left in place for inspection."
    }
    Write-Host 'Model checksum: verified'
}

function Install-ModelFile {
    if (Test-Path -LiteralPath $modelPath) {
        Write-Host "Model file already exists: $modelPath"
        Assert-ModelFile $modelPath
        return
    }

    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if (-not $curl) { throw 'curl.exe is required for the resumable model download.' }

    if (-not (Test-Path -LiteralPath $ModelDirectory)) {
        New-Item -ItemType Directory -Path $ModelDirectory -Force | Out-Null
    }
    Write-Host ('Downloading {0} to:' -f (Format-GiB $expectedBytes))
    Write-Host "  $partialPath"
    Write-Host 'The .partial file is resumable; re-run this script if the connection is interrupted.'
    & $curl.Source --location --fail --retry 5 --retry-delay 10 --continue-at - `
        --progress-bar --output $partialPath $modelUrl
    if ($LASTEXITCODE -ne 0) {
        throw "Model download failed with curl exit code $LASTEXITCODE. The partial file was kept for resume."
    }

    $downloadedBytes = [int64](Get-Item -LiteralPath $partialPath).Length
    if ($downloadedBytes -ne $expectedBytes) {
        throw "Downloaded size mismatch. Expected $expectedBytes bytes, found $downloadedBytes bytes."
    }
    Assert-ModelFile $partialPath
    Move-Item -LiteralPath $partialPath -Destination $modelPath
}

function New-LlamaSwapModelBlock([string]$NewLine) {
    if ($modelPath.Contains('"')) { throw 'The model path cannot contain a double quote.' }
    $blockLines = @(
        '  "openai/gpt-oss-120b":',
        '    name: "OpenAI GPT-OSS 120B (local MXFP4, 8K)"',
        '    description: "Local OpenAI GPT-OSS 120B tuned for the ThinkPad 64 GB RAM / 12 GB VRAM profile"',
        ('    ttl: {0}' -f $modelTtlSeconds),
        '    cmd: >',
        ('      llama-server --host 127.0.0.1 --port {0}' -f '${PORT}'),
        ('      --model "{0}" --alias "openai/gpt-oss-120b"' -f $modelPath),
        '      --ctx-size 8192 --parallel 1 --jinja',
        '      --n-gpu-layers 99 --n-cpu-moe 34 --flash-attn on',
        '      --batch-size 2048 --ubatch-size 2048 --cache-ram 0',
        '    filters:',
        '      setParams:',
        '        chat_template_kwargs:',
        '          reasoning_effort: low'
    )
    return ($blockLines -join $NewLine) + $NewLine
}

function Set-LlamaSwapHealthCheckTimeout {
    $config = [System.IO.File]::ReadAllText($ConfigPath)
    # llama-swap accepts this setting only at the document root. Refuse duplicate root
    # entries instead of guessing which one the YAML parser will honor.
    $pattern = '(?m)^healthCheckTimeout:[ \t]*\d+[ \t]*(?=\r?$)'
    $matches = [regex]::Matches($config, $pattern)
    if ($matches.Count -gt 1) {
        throw "Multiple root-level healthCheckTimeout entries found in $ConfigPath"
    }
    $assignment = "healthCheckTimeout: $healthCheckTimeoutSeconds"
    if ($matches.Count -eq 1) {
        $updated = [regex]::Replace($config, $pattern, $assignment, 1)
    } else {
        $newLine = "`n"
        if ($config.Contains("`r`n")) { $newLine = "`r`n" }
        $updated = $assignment + $newLine + $config
    }
    if ($updated -eq $config) {
        Write-Host "llama-swap healthCheckTimeout already set to $healthCheckTimeoutSeconds seconds."
        return $null
    }

    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backupPath = "$ConfigPath.backup-$stamp-health"
    Copy-Item -LiteralPath $ConfigPath -Destination $backupPath
    Write-Utf8NoBom $ConfigPath $updated
    Write-Host "llama-swap healthCheckTimeout updated to $healthCheckTimeoutSeconds seconds; backup: $backupPath"
    return $backupPath
}

function Add-LlamaSwapModel {
    if (-not (Test-Path -LiteralPath $ConfigPath)) {
        throw "llama-swap config does not exist: $ConfigPath"
    }
    $config = [System.IO.File]::ReadAllText($ConfigPath)
    $existingModel = [regex]::Match(
        $config,
        '(?m)^\s{2,}["'']?openai/gpt-oss-120b["'']?:\s*$'
    )
    if ($existingModel.Success) {
        $blockStart = $existingModel.Index
        $following = $config.Substring($blockStart + $existingModel.Length)
        $nextEntry = [regex]::Match($following, '(?m)^(?:  \S.*:\s*(?:#.*)?|\S.*)$')
        $blockLength = $existingModel.Length
        if ($nextEntry.Success) {
            $blockLength += $nextEntry.Index
        } else {
            $blockLength = $config.Length - $blockStart
        }
        $block = $config.Substring($blockStart, $blockLength)
        # Match spaces/tabs but not the line ending, so replacing a CRLF file cannot
        # accidentally turn this one line into LF and leave mixed newlines behind.
        $ttlPattern = '(?m)^    ttl:[ \t]*\d+[ \t]*(?=\r?$)'
        if (-not [regex]::IsMatch($block, $ttlPattern)) {
            throw 'Existing GPT-OSS llama-swap entry has no four-space-indented ttl field; update it manually.'
        }
        $updatedBlock = [regex]::Replace($block, $ttlPattern, "    ttl: $modelTtlSeconds", 1)
        if ($updatedBlock -eq $block) {
            Write-Host "llama-swap model entry already exists with ttl $modelTtlSeconds seconds."
            return $null
        }
        $updated = $config.Substring(0, $blockStart) + $updatedBlock + $config.Substring($blockStart + $blockLength)
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $backupPath = "$ConfigPath.backup-$stamp"
        Copy-Item -LiteralPath $ConfigPath -Destination $backupPath
        Write-Utf8NoBom $ConfigPath $updated
        Write-Host "llama-swap GPT-OSS ttl updated to $modelTtlSeconds seconds; backup: $backupPath"
        return $backupPath
    }

    $modelsLine = [regex]::Match($config, '(?m)^models:\s*(?:#.*)?$')
    if (-not $modelsLine.Success) {
        throw "Could not find a top-level 'models:' mapping in $ConfigPath"
    }

    $newLine = "`n"
    if ($config.Contains("`r`n")) { $newLine = "`r`n" }
    $lineEnd = $config.IndexOf("`n", $modelsLine.Index)
    if ($lineEnd -lt 0) {
        $updated = $config + $newLine + (New-LlamaSwapModelBlock $newLine)
    } else {
        $insertAt = $lineEnd + 1
        $updated = $config.Substring(0, $insertAt) + (New-LlamaSwapModelBlock $newLine) + $config.Substring($insertAt)
    }

    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backupPath = "$ConfigPath.backup-$stamp"
    Copy-Item -LiteralPath $ConfigPath -Destination $backupPath
    Write-Utf8NoBom $ConfigPath $updated
    Write-Host "llama-swap config updated; backup: $backupPath"
    return $backupPath
}

function Test-LlamaSwapConfig([string]$LlamaSwapPath, [string]$BackupPath) {
    $config = [System.IO.File]::ReadAllText($ConfigPath)
    if ([regex]::IsMatch($config, '(?m)^hooks:\s*$')) {
        Write-Host 'WARNING: config has startup hooks; skipping the temporary runtime validation to avoid preloading models.'
        return
    }

    $listener = New-Object System.Net.Sockets.TcpListener -ArgumentList @(
        [System.Net.IPAddress]::Loopback,
        0
    )
    $listener.Start()
    $testPort = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
    $listener.Stop()
    $tempBase = Join-Path ([System.IO.Path]::GetTempPath()) ("compcat-llama-swap-check-{0}" -f ([Guid]::NewGuid().ToString('N')))
    $stdoutPath = "$tempBase.out.log"
    $stderrPath = "$tempBase.err.log"
    $process = $null

    try {
        $process = Start-Process -FilePath $LlamaSwapPath `
            -ArgumentList @('-config', $ConfigPath, '-listen', "127.0.0.1:$testPort") `
            -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru -WindowStyle Hidden
        $deadline = (Get-Date).AddSeconds(30)
        $models = $null
        while ((Get-Date) -lt $deadline) {
            if ($process.HasExited) { break }
            try {
                $models = Invoke-RestMethod -Uri "http://127.0.0.1:$testPort/v1/models" -TimeoutSec 2
                break
            } catch {
                Start-Sleep -Milliseconds 500
            }
        }
        $ids = @()
        if ($null -ne $models) {
            $ids = @($models.data | ForEach-Object { $_.id })
        }
        if (-not $models -or $ids -notcontains $modelId) {
            $details = ''
            if (Test-Path -LiteralPath $stderrPath) {
                $details = (Get-Content -LiteralPath $stderrPath -Tail 20) -join [Environment]::NewLine
            }
            throw "llama-swap did not accept the updated config. $details"
        }
        Write-Host 'llama-swap config: validated'
    } catch {
        if ($BackupPath -and (Test-Path -LiteralPath $BackupPath)) {
            Copy-Item -LiteralPath $BackupPath -Destination $ConfigPath -Force
            Write-Host 'Restored the previous llama-swap config after validation failed.'
        }
        throw
    } finally {
        if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }
        Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
    }
}

function Set-EnvValue([string]$Content, [string]$Name, [string]$Value, [string]$NewLine) {
    $pattern = '(?m)^' + [regex]::Escape($Name) + '=.*$'
    $matches = [regex]::Matches($Content, $pattern)
    if ($matches.Count -gt 1) { throw "Multiple $Name entries found in $CompCatEnvPath" }
    $assignment = "$Name=$Value"
    if ($matches.Count -eq 1) {
        $regex = New-Object System.Text.RegularExpressions.Regex($pattern)
        return $regex.Replace($Content, $assignment, 1)
    }
    if ($Content.Length -gt 0 -and -not $Content.EndsWith($NewLine)) { $Content += $NewLine }
    return $Content + $assignment + $NewLine
}

function Activate-ForCompCat {
    if (-not (Test-Path -LiteralPath $CompCatEnvPath)) {
        throw "CompCat env file does not exist: $CompCatEnvPath"
    }
    $envContent = [System.IO.File]::ReadAllText($CompCatEnvPath)
    $newLine = "`n"
    if ($envContent.Contains("`r`n")) { $newLine = "`r`n" }
    $envContent = Set-EnvValue $envContent 'MCA_LLM_PROVIDER' 'openai' $newLine
    $envContent = Set-EnvValue $envContent 'MCA_LLM_MODEL' $modelId $newLine
    $envContent = Set-EnvValue $envContent 'MCA_LLM_TIMEOUT_S' '300' $newLine
    $envContent = Set-EnvValue $envContent 'MCA_LLM_DISABLE_THINKING' 'false' $newLine
    $envContent = Set-EnvValue $envContent 'MCA_ASSISTANT_NARRATION_ENABLED' 'true' $newLine

    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backupPath = "$CompCatEnvPath.backup-$stamp"
    Copy-Item -LiteralPath $CompCatEnvPath -Destination $backupPath
    Write-Utf8NoBom $CompCatEnvPath $envContent
    Write-Host "CompCat now selects $modelId; env backup: $backupPath"

    $running = Get-Process llama-swap -ErrorAction SilentlyContinue
    if ($running) {
        $running | Stop-Process
        Write-Host 'Stopped the old llama-swap process so it can read the updated config.'
    }
    $startScript = Join-Path $repo 'scripts\start-compcat.ps1'
    try {
        & $startScript -SkipPull -SkipIngest
    } catch {
        Copy-Item -LiteralPath $backupPath -Destination $CompCatEnvPath -Force
        Write-Host 'Restored the previous CompCat env after restart failed.'
        throw
    }
}

Write-Host '== CompCat local GPT-OSS 120B installer =='
Write-Host "Model:  $modelId"
Write-Host "File:   $modelPath"
Write-Host "Config: $ConfigPath"
Write-Host "Profile: 8K context, one parallel slot, 34 of 36 MoE layers on CPU, $modelTtlSeconds-second ttl, $healthCheckTimeoutSeconds-second health timeout"

if (-not (Test-Path -LiteralPath $ConfigPath)) {
    throw "llama-swap config does not exist: $ConfigPath"
}
Assert-HardwareAndDisk
$llamaSwapPath = Resolve-LlamaSwap
Write-Host "llama-swap: $llamaSwapPath"

if ($PlanOnly) {
    Write-Host 'Plan only: no files were downloaded or changed.'
    exit 0
}

if (-not $PSCmdlet.ShouldProcess($modelPath, 'Download and install GPT-OSS 120B')) { exit 0 }
Install-ModelFile
$healthBackup = Set-LlamaSwapHealthCheckTimeout
$modelBackup = Add-LlamaSwapModel
$configBackup = if ($healthBackup) { $healthBackup } else { $modelBackup }
Test-LlamaSwapConfig $llamaSwapPath $configBackup

if ($ActivateForCompCat) {
    Activate-ForCompCat
} else {
    Write-Host ''
    Write-Host 'Installed and registered. llama-swap must restart before the model appears.'
    Write-Host 'To select it for the private CompCat instance, re-run:'
    Write-Host '  pwsh -File scripts\install-gpt-oss-120b.ps1 -ActivateForCompCat'
}
