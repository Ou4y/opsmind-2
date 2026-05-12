param(
    [Parameter(Mandatory = $true)]
    [string]$AssetId,

    [string]$InventoryApiUrl = "http://localhost:5000/api",

    [int]$IntervalSeconds = 60,

    [int]$IdleThresholdSeconds = 300
)

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class IdleTime {
    [StructLayout(LayoutKind.Sequential)]
    struct LASTINPUTINFO {
        public uint cbSize;
        public uint dwTime;
    }

    [DllImport("user32.dll")]
    static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

    public static uint Seconds() {
        LASTINPUTINFO info = new LASTINPUTINFO();
        info.cbSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf(info);
        GetLastInputInfo(ref info);
        return ((uint)Environment.TickCount - info.dwTime) / 1000;
    }
}
"@

function Send-Telemetry {
    param(
        [bool]$IsOnline,
        [bool]$IsActive
    )

    $uri = "$InventoryApiUrl/assets/$AssetId/telemetry"
    $payload = @{
        isOnline = $IsOnline
        isActive = $IsActive
        reportedAt = (Get-Date).ToUniversalTime().ToString("o")
    } | ConvertTo-Json

    Invoke-RestMethod -Method Patch -Uri $uri -ContentType "application/json" -Body $payload | Out-Null
}

Write-Host "OpsMind telemetry agent started for asset $AssetId"
Write-Host "Posting to $InventoryApiUrl every $IntervalSeconds seconds"

try {
    while ($true) {
        $idleSeconds = [IdleTime]::Seconds()
        $isActive = $idleSeconds -lt $IdleThresholdSeconds

        Send-Telemetry -IsOnline $true -IsActive $isActive
        Start-Sleep -Seconds $IntervalSeconds
    }
}
finally {
    try {
        Send-Telemetry -IsOnline $false -IsActive $false
    } catch {
        # Best effort during shutdown.
    }
}
