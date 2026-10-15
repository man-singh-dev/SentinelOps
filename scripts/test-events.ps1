# Manual smoke test for POST /api/v1/events (synchronous ingestion).
# The API key is read from $env:SENTINELOPS_API_KEY and is never printed.
# Every run uses a fresh eventId, so existing events are never touched; the
# events a run creates are left in the database.
#
#   $env:SENTINELOPS_API_KEY = "<your service API key>"
#   .\scripts\test-events.ps1 [-Base http://localhost:3000] [-ServiceId <service uuid>]
param(
  [string]$Base = "http://localhost:3000",
  # Optional: the authenticated service's UUID, to also test a matching serviceId.
  [string]$ServiceId = ""
)

$ApiKey = $env:SENTINELOPS_API_KEY
if ([string]::IsNullOrWhiteSpace($ApiKey)) {
  Write-Error "Set `$env:SENTINELOPS_API_KEY to a service API key first."
  exit 1
}

function Send-Json($Url, $Json, $Key, [int]$Expect) {
  $req = [System.Net.HttpWebRequest]::Create($Url)
  $req.Method = "POST"
  $req.ContentType = "application/json"
  if ($Key) { $req.Headers.Add("X-API-Key", $Key) }
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Json)
  $req.ContentLength = $bytes.Length
  $s = $req.GetRequestStream(); $s.Write($bytes, 0, $bytes.Length); $s.Close()
  try { $res = $req.GetResponse() } catch [System.Net.WebException] { $res = $_.Exception.Response }
  $body = (New-Object System.IO.StreamReader($res.GetResponseStream())).ReadToEnd()
  $status = [int]$res.StatusCode
  $mark = if ($status -eq $Expect) { "PASS" } else { "FAIL" }
  "  {0} expected {1}, got {2} {3}" -f $mark, $Expect, $status, $body
}

$Url = "$Base/api/v1/events"
$runId = [guid]::NewGuid().ToString("N")
$event = @{
  eventId   = "evt_manual_$runId"
  eventType = "payment.failed"
  severity  = "critical"
  timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  message   = "Gateway timeout"
}
function With($Changes) { $e = $event.Clone(); foreach ($k in $Changes.Keys) { $e[$k] = $Changes[$k] }; $e | ConvertTo-Json -Compress }
$valid = $event | ConvertTo-Json -Compress

Write-Host "Missing API key:";             Send-Json $Url $valid $null 401
Write-Host "Invalid API key:";             Send-Json $Url $valid "sk_invalid_smoke_test" 401
Write-Host "Empty object:";                Send-Json $Url "{}" $ApiKey 400
Write-Host "Invalid severity:";            Send-Json $Url (With @{ severity = "bogus" }) $ApiKey 400
Write-Host "Mismatched serviceId:";        Send-Json $Url (With @{ serviceId = [guid]::NewGuid().ToString() }) $ApiKey 403
Write-Host "Valid event ($($event.eventId)):"; Send-Json $Url $valid $ApiKey 201
Write-Host "Same eventId again:";          Send-Json $Url $valid $ApiKey 200
if ($ServiceId) {
  Write-Host "Matching serviceId:"
  Send-Json $Url (With @{ eventId = "evt_manual_match_$runId"; serviceId = $ServiceId }) $ApiKey 201
}
