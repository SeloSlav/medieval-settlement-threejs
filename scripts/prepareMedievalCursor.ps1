param(
    [ValidateSet('pointer', 'pan', 'orbit')]
    [string[]]$Cursors = @('pointer', 'pan', 'orbit')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies @('System.Drawing.Common', 'System.Drawing.Primitives', 'System.Private.Windows.GdiPlus', 'System.Private.Windows.Core', 'System.Console') -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
public static class MedievalCursorAsset {
    public static void Prepare(string sourcePath, string destinationPath, bool centered) {
        using var source = new Bitmap(sourcePath);
        int minX = source.Width, minY = source.Height, maxX = 0, maxY = 0;
        for (int y = 0; y < source.Height; y++)
            for (int x = 0; x < source.Width; x++) {
                // Ignore nearly invisible generation fringe when locating the
                // silhouette, while preserving the original alpha when resizing.
                if (source.GetPixel(x, y).A < 32) continue;
                minX = Math.Min(minX, x); minY = Math.Min(minY, y);
                maxX = Math.Max(maxX, x); maxY = Math.Max(maxY, y);
            }
        int width = maxX - minX + 1, height = maxY - minY + 1;
        if (minX > maxX || minY > maxY) throw new InvalidOperationException("Cursor source is empty.");
        float scale = 36f / Math.Max(width, height);
        float left = centered ? (40 - width * scale) / 2 : 2;
        float top = centered ? (40 - height * scale) / 2 : 2;
        using var cursor = new Bitmap(40, 40, PixelFormat.Format32bppArgb);
        using (var graphics = Graphics.FromImage(cursor)) {
            graphics.Clear(Color.Transparent);
            graphics.CompositingMode = CompositingMode.SourceCopy;
            graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
            graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
            graphics.DrawImage(source, new RectangleF(left, top, width * scale, height * scale),
                new RectangleF(minX, minY, width, height), GraphicsUnit.Pixel);
        }
        cursor.Save(destinationPath, ImageFormat.Png);
        Console.WriteLine($"{destinationPath}: 40x40 RGBA, artwork bounds {minX},{minY} to {maxX},{maxY}, hotspot {(centered ? "20,20" : "2,2")}.");
    }
}
'@
$cursorDirectory = Join-Path $PSScriptRoot '../public/assets/ui/cursors'
foreach ($cursorName in $Cursors) {
    [MedievalCursorAsset]::Prepare(
        (Join-Path $cursorDirectory "medieval-$cursorName-source.png"),
        (Join-Path $cursorDirectory "medieval-$cursorName.png"),
        $cursorName -ne 'pointer')
}
