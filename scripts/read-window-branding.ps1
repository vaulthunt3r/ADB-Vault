param([Parameter(Mandatory)][string]$Handle, [Parameter(Mandatory)][string]$Output)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class VaultWindowBranding {
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, UIntPtr wp, IntPtr lp, uint flags, uint timeout, out UIntPtr result);
  [DllImport("user32.dll", EntryPoint="GetClassLongPtrW")] static extern IntPtr GetClassLongPtr(IntPtr hwnd, int index);
  [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant value);
  [StructLayout(LayoutKind.Sequential)] public struct PropertyKey { public Guid fmtid; public uint pid; }
  [StructLayout(LayoutKind.Explicit, Size=24)] public struct PropVariant {
    [FieldOffset(0)] public ushort type;
    [FieldOffset(8)] public IntPtr value;
  }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropertyStore {
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int GetAt(uint index, out PropertyKey key);
    [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
    [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
    [PreserveSig] int Commit();
  }
  public static IntPtr Icon(IntPtr hwnd, uint size) {
    UIntPtr result;
    SendMessageTimeout(hwnd, 0x7f, (UIntPtr)size, IntPtr.Zero, 2, 2000, out result);
    IntPtr icon = (IntPtr)(long)result.ToUInt64();
    return icon != IntPtr.Zero ? icon : GetClassLongPtr(hwnd, size == 1 ? -14 : -34);
  }
  public static string Property(IntPtr hwnd, uint id) {
    Guid iid = typeof(IPropertyStore).GUID;
    IPropertyStore store;
    Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(hwnd, ref iid, out store));
    try {
      var key = new PropertyKey { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = id };
      PropVariant value;
      Marshal.ThrowExceptionForHR(store.GetValue(ref key, out value));
      try { return value.type == 31 ? Marshal.PtrToStringUni(value.value) : null; }
      finally { PropVariantClear(ref value); }
    } finally { Marshal.ReleaseComObject(store); }
  }
}
'@
$nativeWindow = [IntPtr]::new([Convert]::ToInt64($Handle, 16))
$outputFolder = [IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Path $outputFolder -Force | Out-Null
$icons = foreach ($kind in @(@{name='small'; value=0}, @{name='large'; value=1})) {
  $iconHandle = [VaultWindowBranding]::Icon($nativeWindow, $kind.value)
  if ($iconHandle -eq [IntPtr]::Zero) { throw 'Window has no icon handle.' }
  $icon = [System.Drawing.Icon]::FromHandle($iconHandle)
  $bitmap = $icon.ToBitmap()
  try {
    $green = 0; $opaque = 0
    for ($y=0; $y -lt $bitmap.Height; $y++) {
      for ($x=0; $x -lt $bitmap.Width; $x++) {
        $pixel = $bitmap.GetPixel($x,$y)
        if ($pixel.A -gt 200) {
          $opaque++
          if ($pixel.G -gt ($pixel.R + 25) -and $pixel.G -gt ($pixel.B + 10)) { $green++ }
        }
      }
    }
    $bitmap.Save((Join-Path $outputFolder ($kind.name + '.png')), [System.Drawing.Imaging.ImageFormat]::Png)
    [pscustomobject]@{kind=$kind.name;width=$bitmap.Width;height=$bitmap.Height;green=$green;opaque=$opaque}
  } finally { $bitmap.Dispose(); $icon.Dispose() }
}
[pscustomobject]@{
  icons=@($icons)
  appId=[VaultWindowBranding]::Property($nativeWindow,5)
  relaunchIcon=[VaultWindowBranding]::Property($nativeWindow,3)
  relaunchCommand=[VaultWindowBranding]::Property($nativeWindow,2)
  relaunchName=[VaultWindowBranding]::Property($nativeWindow,4)
} | ConvertTo-Json -Depth 5
