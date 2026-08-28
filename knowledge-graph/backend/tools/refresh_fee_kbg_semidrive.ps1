param(
    [string]$RunId = "semidrive_fee_kbg_$(Get-Date -Format 'yyyyMMdd_HHmmss')",
    [string]$Python = "",
    [switch]$SkipNeo4j,
    [switch]$SyncOnly,
    [switch]$RestartApi,
    [string]$CambriconRunId = "cambricon_fee_kbg_20260826_v1"
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Python) {
    $BundledPython = "C:\Users\cwwww\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
    if (Test-Path -LiteralPath $BundledPython) {
        & $BundledPython -c "import neo4j" 2>$null
        if ($LASTEXITCODE -eq 0) {
            $Python = $BundledPython
        }
    }
    if (-not $Python) {
        $Python = (Get-Command python -ErrorAction Stop).Source
    }
}
if (-not (Test-Path -LiteralPath $Python)) {
    throw "Python was not found: $Python"
}
& $Python -c "import neo4j" 2>$null
if ($LASTEXITCODE -ne 0) {
    throw "The selected Python does not have the Neo4j driver: $Python"
}

if (-not $SyncOnly) {
    & $Python (Join-Path $ProjectRoot 'tools\seed_cambricon_public_round.py')
    if ($LASTEXITCODE -ne 0) { throw 'Cambricon public evidence seeding failed.' }
    & $Python (Join-Path $ProjectRoot 'tools\seed_semidrive_pilot.py')
    if ($LASTEXITCODE -ne 0) { throw 'SemiDrive evidence seeding failed.' }
}

& $Python (Join-Path $ProjectRoot 'tools\run_fee_kbg_pilot.py') `
    --run-id $CambriconRunId `
    --stock-code 688256 `
    --config (Join-Path $ProjectRoot 'config\fee_kbg_cambricon_pilot_20260826.json')
if ($LASTEXITCODE -ne 0) { throw 'Cambricon FEE-KBG rebuild failed.' }
& $Python (Join-Path $ProjectRoot 'tools\verify_fee_kbg_pilot.py') --run-id $CambriconRunId
if ($LASTEXITCODE -ne 0) { throw 'Cambricon FEE-KBG verification failed.' }

& $Python (Join-Path $ProjectRoot 'tools\run_fee_kbg_pilot.py') `
    --run-id $RunId `
    --stock-code PRIVATE-SEMIDRIVE `
    --config (Join-Path $ProjectRoot 'config\fee_kbg_semidrive_pilot_20260827.json')
if ($LASTEXITCODE -ne 0) { throw 'SemiDrive FEE-KBG build failed.' }
& $Python (Join-Path $ProjectRoot 'tools\verify_fee_kbg_pilot.py') --run-id $RunId
if ($LASTEXITCODE -ne 0) { throw 'SemiDrive FEE-KBG verification failed.' }

if (-not $SkipNeo4j) {
    if (-not $env:NEO4J_PASSWORD) {
        throw 'NEO4J_PASSWORD is missing. Use -SkipNeo4j for a SQLite-only refresh.'
    }
    # Migrate the existing Cambricon snapshot to multi-run memberships first.
    # Shared suppliers and risk nodes can then belong to both companies.
    & $Python (Join-Path $ProjectRoot 'tools\sync_neo4j_graph.py') `
        --run-id $CambriconRunId --mark-not-in-snapshot --replace-relation-types
    if ($LASTEXITCODE -ne 0) { throw 'Cambricon multi-snapshot migration failed.' }
    & $Python (Join-Path $ProjectRoot 'tools\sync_neo4j_graph.py') `
        --run-id $RunId --mark-not-in-snapshot --replace-relation-types
    if ($LASTEXITCODE -ne 0) { throw 'SemiDrive Neo4j sync failed.' }
}

if ($RestartApi) {
    $ApiScript = Join-Path $ProjectRoot 'tools\serve_risk_graph_api.py'
    $Listeners = @(Get-NetTCPConnection -State Listen -LocalPort 8765 -ErrorAction SilentlyContinue)
    foreach ($Listener in $Listeners) {
        $ExistingProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($Listener.OwningProcess)"
        if ($ExistingProcess -and $ExistingProcess.CommandLine -notmatch 'serve_risk_graph_api\.py') {
            throw "Port 8765 is owned by an unexpected process: $($Listener.OwningProcess)"
        }
        if ($ExistingProcess) {
            Stop-Process -Id $Listener.OwningProcess -Force
        }
    }
    Start-Process -FilePath $Python -ArgumentList @($ApiScript) -WorkingDirectory $ProjectRoot -WindowStyle Hidden
    Start-Sleep -Seconds 2
    $Health = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/api/health'
    if (-not $Health.ok) { throw 'Risk graph API restart health check failed.' }
}

Write-Output "Completed: $RunId"
