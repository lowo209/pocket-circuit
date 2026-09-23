param([Parameter(Mandatory=$true)][string]$Godot)
$ErrorActionPreference = 'Stop'
$projectDirectory = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$engineExecutable = (Resolve-Path -LiteralPath $Godot).Path
Push-Location $projectDirectory
try {
    New-Item -ItemType Directory -Force -Path 'builds/PocketCircuit_v0.4.0-dev' | Out-Null
    function Run-Godot([string]$Arguments, [string]$Log) {
        $process = Start-Process -FilePath $engineExecutable -ArgumentList $Arguments -WindowStyle Hidden -PassThru
        $deadline = (Get-Date).AddMinutes(2)
        while (-not $process.WaitForExit(1000)) {
            if ((Get-Date) -gt $deadline) { $process.Kill(); throw "Godot timed out; see $Log" }
        }
        if ($process.ExitCode -ne 0) { throw "Godot failed ($($process.ExitCode)); see $Log" }
        if (Test-Path $Log) {
            $errors = Select-String -Path $Log -Pattern 'SCRIPT ERROR:|Parse Error:|ERROR:'
            if ($errors) { throw "Godot logged errors: $errors" }
        }
    }
    Run-Godot '--headless --path . --editor --import --quit --log-file builds/import.log' 'builds/import.log'
    Run-Godot '--headless --path . --quit-after 120 --script res://tests/visual_regressions.gd --log-file builds/regression.log' 'builds/regression.log'
    if (-not (Select-String -Path 'builds/regression.log' -SimpleMatch 'VISUAL REGRESSIONS: PASS')) { throw 'Geometry and wheel regressions failed.' }
    Run-Godot '--headless --path . --log-file builds/simulation.log -- --smoke-test' 'builds/simulation.log'
    if (-not (Select-String -Path 'builds/simulation.log' -SimpleMatch 'SMOKE RESULT: PASS')) { throw 'Simulation did not complete.' }
    foreach ($track in 0..2) {
        Run-Godot "--headless --path . --log-file builds/physics-$track.log -- --autoplay-test --track=$track" "builds/physics-$track.log"
        if (-not (Select-String -Path "builds/physics-$track.log" -SimpleMatch 'LIVE PHYSICS TEST: PASS')) { throw "Track $track did not complete." }
    }
    Run-Godot '--headless --path . --export-release "Windows Desktop" --log-file builds/export.log' 'builds/export.log'
    $exported = Join-Path $projectDirectory 'builds/PocketCircuit_v0.4.0-dev/PocketCircuit.exe'
    $exportCheck = Start-Process -FilePath $exported -ArgumentList '--headless --log-file ../export-check.log -- --autoplay-test' -WorkingDirectory (Split-Path $exported) -WindowStyle Hidden -PassThru
    $deadline = (Get-Date).AddMinutes(2)
    while (-not $exportCheck.WaitForExit(1000)) {
        if ((Get-Date) -gt $deadline) { $exportCheck.Kill(); throw 'Exported test timed out.' }
    }
    if ($exportCheck.ExitCode -ne 0) { throw 'Exported game failed its race test.' }
    if (-not (Select-String -Path 'builds/export-check.log' -SimpleMatch 'LIVE PHYSICS TEST: PASS')) { throw 'Exported game did not complete its test.' }
    Copy-Item -LiteralPath 'tools/PLAYER_README.txt' -Destination 'builds/PocketCircuit_v0.4.0-dev/README.txt'
    Copy-Item -LiteralPath 'tools/GODOT_LICENSE.txt' -Destination 'builds/PocketCircuit_v0.4.0-dev/GODOT_LICENSE.txt'
    Compress-Archive -Path 'builds/PocketCircuit_v0.4.0-dev/*' -DestinationPath 'builds/PocketCircuit_v0.4.0-dev.zip' -Force
    Write-Output "Built: $projectDirectory\builds\PocketCircuit_v0.4.0-dev.zip"
} finally {
    Pop-Location
}
