param([string]$Base = "http://localhost:3000")

function Send-Json($Url, $Json) {
  $req = [System.Net.HttpWebRequest]::Create($Url)
  $req.Method = "POST"
  $req.ContentType = "application/json"
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Json)
  $req.ContentLength = $bytes.Length
  $s = $req.GetRequestStream(); $s.Write($bytes, 0, $bytes.Length); $s.Close()
  try { $res = $req.GetResponse() } catch [System.Net.WebException] { $res = $_.Exception.Response }
  $body = (New-Object System.IO.StreamReader($res.GetResponseStream())).ReadToEnd()
  "{0} -> {1} {2}" -f $Url, [int]$res.StatusCode, $body
}

$valid = @{ eventId="evt_manual_001"; eventType="payment.failed"; severity="critical"; timestamp="2026-01-01T12:00:00Z"; message="Gateway timeout" } | ConvertTo-Json -Compress
Write-Host "Valid (expect 501):"; Send-Json "$Base/api/v1/events" $valid
Write-Host "Invalid severity (expect 400):"; Send-Json "$Base/api/v1/events" ($valid -replace "critical","bogus")
Write-Host "Empty object (expect 400):"; Send-Json "$Base/api/v1/events" "{}"
