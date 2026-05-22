$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:8000/")
$listener.Start()
Write-Output "PowerShell Web Server started on http://127.0.0.1:8000/"

$rootDir = $PSScriptRoot

while ($listener.IsListening) {
    $context = $listener.GetContext()
    $req = $context.Request
    $res = $context.Response
    
    $path = $req.Url.LocalPath
    
    if ($path -eq "/" -or $path -eq "/web-simulator") {
        $res.Redirect("http://127.0.0.1:8000/web-simulator/index.html")
        $res.Close()
        continue
    }
    
    $cleanPath = $path.TrimStart("/")
    $filePath = Join-Path $rootDir $cleanPath
    
    if (-not (Test-Path $filePath -PathType Leaf)) {
        $fallbackPath = Join-Path $rootDir "web-simulator"
        $fallbackPath = Join-Path $fallbackPath $cleanPath
        if (Test-Path $fallbackPath -PathType Leaf) {
            $filePath = $fallbackPath
        }
    }
    
    if (Test-Path $filePath -PathType Leaf) {
        $bytes = [System.IO.File]::ReadAllBytes($filePath)
        
        if ($filePath.EndsWith(".html")) {
            $res.ContentType = "text/html; charset=utf-8"
        } elseif ($filePath.EndsWith(".css")) {
            $res.ContentType = "text/css; charset=utf-8"
        } elseif ($filePath.EndsWith(".js")) {
            $res.ContentType = "application/javascript; charset=utf-8"
        }
        
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
        $res.StatusCode = 404
        $errBytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
        $res.OutputStream.Write($errBytes, 0, $errBytes.Length)
    }
    $res.Close()
}
