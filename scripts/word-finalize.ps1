# Открывает документ в Word, обновляет содержание и поля, сохраняет и делает PDF рядом.
# Так оглавление заполнено сразу, без вопроса «обновить поля?» при открытии.
param([string]$Path, [string]$Pdf)

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $doc = $word.Documents.Open($Path)
  foreach ($toc in $doc.TablesOfContents) { $toc.Update() }
  $doc.Fields.Update() | Out-Null
  $doc.Save()
  if ($Pdf) { $doc.ExportAsFixedFormat($Pdf, 17) }   # 17 = wdExportFormatPDF
  "pages: " + $doc.ComputeStatistics(2)               # 2 = wdStatisticPages
  "equations: " + $doc.OMaths.Count
  $doc.Close()
} finally {
  $word.Quit()
}
