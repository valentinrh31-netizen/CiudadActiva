# Simple PowerShell Static File Server
$port = 8080
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Prefixes.Add("http://127.0.0.1:$port/")
# Si tienes permisos de admin, podrías usar "+", pero con localhost y 127.0.0.1 debería bastar para pruebas locales.
$listener.Start()
Write-Host "Server started at http://localhost:$port/ and http://127.0.0.1:$port/"

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $url = $request.Url.LocalPath
        if ($url -eq "/") { $url = "/index.html" }
        
        $path = Join-Path $pwd $url
        
        if (Test-Path $path -PathType Leaf) {
            $content = [System.IO.File]::ReadAllBytes($path)
            $response.ContentLength64 = $content.Length
            
            # Set Content-Type
            $ext = [System.IO.Path]::GetExtension($path).ToLower()
            $types = @{
                ".html" = "text/html"
                ".css"  = "text/css"
                ".js"   = "application/javascript"
                ".png"  = "image/png"
                ".jpg"  = "image/jpeg"
                ".jpeg" = "image/jpeg"
                ".json" = "application/json"
                ".ico"  = "image/x-icon"
                ".svg"  = "image/svg+xml"
            }
            if ($types.ContainsKey($ext)) {
                $response.ContentType = $types[$ext]
            } else {
                $response.ContentType = "application/octet-stream"
            }
            
            $response.OutputStream.Write($content, 0, $content.Length)
        } else {
            $response.StatusCode = 404
        }
        $response.Close()
    }
} finally {
    $listener.Stop()
}
