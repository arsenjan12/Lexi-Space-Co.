# MathML -> OMML (формулы Word) штатным конвертером Microsoft Office (MML2OMML.XSL).
# Вход и выход — JSON-массив [{ id, xml }]. Запускается из scripts/export-formulas-docx.mjs.
param([string]$In, [string]$Out)

$xsl = Get-ChildItem 'C:\Program Files\Microsoft Office', 'C:\Program Files (x86)\Microsoft Office' -Recurse -Filter MML2OMML.XSL -ErrorAction SilentlyContinue |
  Select-Object -First 1 -ExpandProperty FullName
if (-not $xsl) { throw 'Не найден MML2OMML.XSL — нужен установленный Microsoft Word' }

$transform = New-Object System.Xml.Xsl.XslCompiledTransform
$transform.Load($xsl)

$items = [System.IO.File]::ReadAllText($In, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$result = @()
foreach ($item in $items) {
  $reader = [System.Xml.XmlReader]::Create((New-Object System.IO.StringReader $item.xml))
  $settings = New-Object System.Xml.XmlWriterSettings
  $settings.OmitXmlDeclaration = $true
  $sw = New-Object System.IO.StringWriter
  $writer = [System.Xml.XmlWriter]::Create($sw, $settings)
  $transform.Transform($reader, $writer)
  $writer.Close()
  $result += [pscustomobject]@{ id = $item.id; xml = $sw.ToString() }
}
[System.IO.File]::WriteAllText($Out, ($result | ConvertTo-Json -Depth 3 -Compress), (New-Object System.Text.UTF8Encoding $false))
