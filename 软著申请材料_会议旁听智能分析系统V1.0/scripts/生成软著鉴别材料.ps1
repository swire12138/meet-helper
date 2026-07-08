$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$materialsRoot = Split-Path -Parent $PSScriptRoot
$generatedDir = Join-Path $materialsRoot "generated"
$softwareName = "Meeting Observer Analysis System"
$version = "V1.0"

if (!(Test-Path -LiteralPath $generatedDir)) {
  New-Item -ItemType Directory -Path $generatedDir | Out-Null
}

function Get-ProgramFiles {
  $roots = @(
    (Join-Path $projectRoot "server\src"),
    (Join-Path $projectRoot "web-static"),
    (Join-Path $projectRoot "screen-catch")
  )

  $includeExt = @("*.js", "*.mjs", "*.cjs", "*.html", "*.css", "*.py", "*.json")
  $files = @()

  foreach ($root in $roots) {
    if (!(Test-Path -LiteralPath $root)) {
      continue
    }
    foreach ($ext in $includeExt) {
      $files += Get-ChildItem -Path $root -Recurse -File -Filter $ext | Where-Object {
        $_.FullName -notmatch "\\node_modules\\" -and
        $_.FullName -notmatch "\\data\\" -and
        $_.FullName -notmatch "\\__pycache__\\" -and
        $_.FullName -notmatch "\\ref\\" -and
        $_.FullName -notmatch "\\软著申请材料_"
      }
    }
  }

  return $files | Sort-Object FullName -Unique
}

function Normalize-Lines {
  param([string[]]$Lines)

  $normalized = New-Object System.Collections.Generic.List[string]
  foreach ($line in $Lines) {
    $trimmed = $line.TrimEnd()
    if ([string]::IsNullOrWhiteSpace($trimmed)) {
      continue
    }
    $normalized.Add($trimmed)
  }
  return $normalized
}

function Write-PagedText {
  param(
    [string[]]$Lines,
    [int]$LinesPerPage,
    [string]$HeaderText,
    [string]$OutputPath,
    [bool]$TakeHeadTail60 = $false
  )

  $pages = @()
  for ($i = 0; $i -lt $Lines.Count; $i += $LinesPerPage) {
    $end = [Math]::Min($i + $LinesPerPage - 1, $Lines.Count - 1)
    $page = @($Lines[$i..$end])
    while ($page.Count -lt $LinesPerPage) {
      $page += " "
    }
    $pages += ,$page
  }

  if ($TakeHeadTail60 -and $pages.Count -gt 60) {
    $pages = @($pages[0..29]) + @($pages[($pages.Count - 30)..($pages.Count - 1)])
  }

  $result = New-Object System.Collections.Generic.List[string]
  $separator = [string]::new('=', 80)
  for ($p = 0; $p -lt $pages.Count; $p++) {
    $pageNo = $p + 1
    $result.Add("$HeaderText`tPage $pageNo")
    foreach ($line in $pages[$p]) {
      $result.Add($line)
    }
    $result.Add($separator)
  }

  [System.IO.File]::WriteAllLines($OutputPath, $result, [System.Text.UTF8Encoding]::new($true))
}

$programLines = New-Object System.Collections.Generic.List[string]
$programFiles = Get-ProgramFiles
foreach ($file in $programFiles) {
  $relativePath = $file.FullName.Substring($projectRoot.Length + 1)
  $programLines.Add("// ===== FILE BEGIN: $relativePath =====")
  $content = Get-Content -LiteralPath $file.FullName -Encoding UTF8
  $normalized = Normalize-Lines -Lines $content
  foreach ($line in $normalized) {
    $programLines.Add($line)
  }
  $programLines.Add("// ===== FILE END =====")
}

$programOutput = Join-Path $generatedDir "software_copyright_program_material.txt"
Write-PagedText -Lines $programLines -LinesPerPage 50 -HeaderText "$softwareName $version Program Material" -OutputPath $programOutput -TakeHeadTail60 $true

$docInput = Get-ChildItem -LiteralPath $materialsRoot -File | Where-Object { $_.Name -like "02_*" } | Select-Object -First 1
if (-not $docInput) {
  throw "Software manual file not found."
}

$docLines = Get-Content -LiteralPath $docInput.FullName -Encoding UTF8
$docOutput = Join-Path $generatedDir "software_copyright_document_material.txt"
Write-PagedText -Lines $docLines -LinesPerPage 30 -HeaderText "$softwareName $version Document Material" -OutputPath $docOutput -TakeHeadTail60 $true

Write-Host "Generated files:"
Write-Host $programOutput
Write-Host $docOutput
