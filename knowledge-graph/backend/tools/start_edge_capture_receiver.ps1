param(
    [string]$Python = "",
    [int]$Port = 8770
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Python) {
    $Python = (Get-Command python -ErrorAction Stop).Source
}
if (-not (Test-Path -LiteralPath $Python)) {
    throw "找不到 Python：$Python"
}
Set-Location $ProjectRoot
& $Python tools\serve_edge_capture_receiver.py --port $Port
