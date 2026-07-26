[CmdletBinding()]
param(
    [Parameter()]
    [string]$SourceDirectory = 'C:\Program Files\Tesseract-OCR'
)

$ErrorActionPreference = 'Stop'

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$targetDirectory = [System.IO.Path]::GetFullPath(
    (Join-Path $projectRoot 'apps\desktop\src-tauri\resources\ocr')
)
$sourceDirectory = [System.IO.Path]::GetFullPath($SourceDirectory)
$sourceExecutable = Join-Path $sourceDirectory 'tesseract.exe'
$targetExecutable = Join-Path $targetDirectory 'tesseract.exe'
$targetTessdata = Join-Path $targetDirectory 'tessdata'

if (-not (Test-Path -LiteralPath $sourceExecutable -PathType Leaf)) {
    throw "Runtime Tesseract introuvable dans le répertoire indiqué."
}

$versionOutput = (& $sourceExecutable --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch 'tesseract v(?<version>5\.[^\s]+)') {
    throw "Le runtime installé n'est pas une version Tesseract 5 compatible."
}
$runtimeVersion = $Matches.version

$sourceDlls = @(Get-ChildItem -LiteralPath $sourceDirectory -Filter '*.dll' -File)
if ($sourceDlls.Count -eq 0) {
    throw "Aucune dépendance DLL Tesseract n'a été trouvée."
}

New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $targetTessdata -Force | Out-Null

$resolvedTarget = (Resolve-Path -LiteralPath $targetDirectory).Path
if (-not $resolvedTarget.StartsWith($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Le répertoire OCR cible se trouve hors du projet."
}

# Replace only the imported native runtime. Pinned traineddata files are untouched.
Get-ChildItem -LiteralPath $targetDirectory -Filter '*.dll' -File |
    Remove-Item -Force
Copy-Item -LiteralPath $sourceExecutable -Destination $targetExecutable -Force
foreach ($dll in $sourceDlls) {
    Copy-Item -LiteralPath $dll.FullName -Destination $targetDirectory -Force
}

# TSV output relies on packaged config files. Never replace language models.
foreach ($supportDirectoryName in @('configs', 'tessconfigs')) {
    $sourceSupport = Join-Path (Join-Path $sourceDirectory 'tessdata') $supportDirectoryName
    if (Test-Path -LiteralPath $sourceSupport -PathType Container) {
        Copy-Item -LiteralPath $sourceSupport -Destination $targetTessdata -Recurse -Force
    }
}

function Get-FileDigest([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

$manifest = [ordered]@{
    schemaVersion = 1
    runtimeVersion = $runtimeVersion
    executable = [ordered]@{
        name = 'tesseract.exe'
        sha256 = Get-FileDigest $targetExecutable
    }
    dlls = @(
        $sourceDlls |
            Sort-Object Name |
            ForEach-Object {
                $targetDll = Join-Path $targetDirectory $_.Name
                [ordered]@{
                    name = $_.Name
                    sha256 = Get-FileDigest $targetDll
                }
            }
    )
}

$manifestPath = Join-Path $targetDirectory 'ocr-runtime-manifest.json'
$manifestJson = $manifest | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText(
    $manifestPath,
    $manifestJson,
    [System.Text.UTF8Encoding]::new($false)
)

$bundledVersion = (& $targetExecutable --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $bundledVersion -notmatch [regex]::Escape($runtimeVersion)) {
    throw "L'exécutable OCR importé ne peut pas être lancé ou sa version est inattendue."
}

$languageOutput = (
    & $targetExecutable --tessdata-dir $targetTessdata --list-langs 2>&1 |
        Out-String
).Trim()
if ($LASTEXITCODE -ne 0) {
    throw "Impossible de lister les langues depuis le tessdata du projet."
}
$availableLanguages = @(
    $languageOutput -split '\r?\n' |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -in @('fra', 'ara', 'eng') }
)
$missingLanguages = @('fra', 'ara', 'eng') |
    Where-Object { $_ -notin $availableLanguages }
if ($missingLanguages.Count -gt 0) {
    throw "Langues OCR manquantes: $($missingLanguages -join ', ')."
}

Write-Host "Runtime Tesseract importé: $runtimeVersion"
Write-Host "DLL importées: $($sourceDlls.Count)"
Write-Host "Langues vérifiées avec le tessdata du projet: fra, ara, eng"
Write-Host ""
Write-Host ($bundledVersion -split '\r?\n' | Select-Object -First 1)
Write-Host $languageOutput
