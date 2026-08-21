param(
    [Parameter(Mandatory = $true)][string]$InputDocx,
    [Parameter(Mandatory = $true)][string]$OutputPdf
)

$word = $null
$document = $null

try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $document = $word.Documents.Open($InputDocx, $false, $true)
    $pages = $document.ComputeStatistics(2)
    $words = $document.ComputeStatistics(0)
    $paragraphs = $document.Paragraphs.Count
    $document.ExportAsFixedFormat($OutputPdf, 17)
    [pscustomobject]@{
        InputDocx = $InputDocx
        OutputPdf = $OutputPdf
        Pages = $pages
        Words = $words
        Paragraphs = $paragraphs
    } | ConvertTo-Json -Compress
}
finally {
    if ($document -ne $null) {
        $document.Close($false)
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($document)
    }
    if ($word -ne $null) {
        $word.Quit()
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word)
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
