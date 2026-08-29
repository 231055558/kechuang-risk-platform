$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $projectRoot "logs"
$logPath = Join-Path $logDirectory "local-stack.log"
$npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
Set-Location -LiteralPath $projectRoot
& $npmCommand start *>> $logPath
exit $LASTEXITCODE
