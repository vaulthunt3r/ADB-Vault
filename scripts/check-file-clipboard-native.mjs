import assert from 'node:assert/strict'
import path from 'node:path'
import * as fs from 'node:fs/promises'
import { WindowsFileClipboard } from '../dist-electron/file-clipboard-native.js'
import { checked, run } from '../dist-electron/process.js'

// No ADB and no windows. Only exercise the clipboard if all previous formats can
// be preserved as plain text. Restore conditionally, never over a newer user copy.
const script = String.raw`
$ErrorActionPreference='Stop'; [Console]::InputEncoding=[Text.UTF8Encoding]::new(); [Console]::OutputEncoding=[Text.UTF8Encoding]::new()
$r=[Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class ClipboardTest {
 [DllImport("user32.dll")] static extern bool OpenClipboard(IntPtr owner);
 [DllImport("user32.dll")] static extern bool CloseClipboard();
 [DllImport("user32.dll")] static extern uint EnumClipboardFormats(uint previous);
 [DllImport("user32.dll")] static extern bool EmptyClipboard();
 [DllImport("user32.dll")] static extern IntPtr GetClipboardData(uint format);
 [DllImport("user32.dll")] static extern IntPtr SetClipboardData(uint format, IntPtr data);
 [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();
 [DllImport("kernel32.dll")] static extern IntPtr GlobalAlloc(uint flags, UIntPtr bytes);
 [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr data);
 [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr data);
 [DllImport("kernel32.dll")] static extern IntPtr GlobalFree(IntPtr data);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr CreateWindowEx(uint ex,string cls,string name,uint style,int x,int y,int w,int h,IntPtr parent,IntPtr menu,IntPtr instance,IntPtr param);
 [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr window);
 public class Saved { public bool safe; public bool empty; public string text; public uint sequence; }
 public static Saved Save() {
  if(!OpenClipboard(IntPtr.Zero)) throw new Exception("Clipboard busy");
  try {
   var s=new Saved { safe=true, empty=true, text="", sequence=GetClipboardSequenceNumber() }; uint f=0;
   while((f=EnumClipboardFormats(f))!=0) { s.empty=false; if(f!=1 && f!=7 && f!=13 && f!=16) s.safe=false; }
   if(s.safe && !s.empty) { var h=GetClipboardData(13); if(h==IntPtr.Zero) s.safe=false; else { var p=GlobalLock(h); if(p==IntPtr.Zero) s.safe=false; else { try { s.text=Marshal.PtrToStringUni(p); } finally { GlobalUnlock(h); } } } }
   s.sequence=GetClipboardSequenceNumber(); return s;
  } finally { CloseClipboard(); }
 }
 public static bool Restore(uint expected, bool empty, string text) {
  var owner=CreateWindowEx(0,"STATIC","",0,0,0,0,0,new IntPtr(-3),IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
  if(owner==IntPtr.Zero) throw new Exception("Cannot create owner");
  try { if(!OpenClipboard(owner)) throw new Exception("Clipboard busy"); try {
   if(GetClipboardSequenceNumber()!=expected) return false;
   if(!EmptyClipboard()) throw new Exception("Cannot clear clipboard");
   if(!empty) {
    var bytes=Encoding.Unicode.GetBytes(text+"\0"); var handle=GlobalAlloc(2,(UIntPtr)bytes.Length); bool handed=false;
    try { var p=GlobalLock(handle); if(p==IntPtr.Zero) throw new Exception("Cannot allocate"); try { Marshal.Copy(bytes,0,p,bytes.Length); } finally { GlobalUnlock(handle); }
     if(SetClipboardData(13,handle)==IntPtr.Zero) throw new Exception("Cannot restore"); handed=true;
    } finally { if(!handed) GlobalFree(handle); }
   } return true;
  } finally { CloseClipboard(); } } finally { DestroyWindow(owner); }
 }
}
'@
if($r.operation -eq 'save') { [ClipboardTest]::Save() | ConvertTo-Json -Compress }
elseif($r.operation -eq 'restore') { [ClipboardTest]::Restore([uint32]$r.expected,[bool]$r.empty,[string]$r.text) | ConvertTo-Json -Compress }
else {
 $data=[Windows.Forms.Clipboard]::GetDataObject(); $effect=$data.GetData('Preferred DropEffect'); $bytes=$effect.ToArray()
 @{ paths=@([Windows.Forms.Clipboard]::GetFileDropList()); effect=[BitConverter]::ToUInt32($bytes,0) } | ConvertTo-Json -Compress
}
`
const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const invoke = async value => JSON.parse(checked(await run(powershell, ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], 20000, JSON.stringify(value))))
const port = new WindowsFileClipboard()
try {
const began = performance.now()
await port.start()
const startupMs = Math.round(performance.now() - began), readMs = []
for (let i = 0; i < 5; i++) { const start = performance.now(); await port.read(); readMs.push(Number((performance.now() - start).toFixed(2))) }
console.log(JSON.stringify({ startupMs, readMs }))
await fs.mkdir('desktop-test-results/clipboard-speed', { recursive: true })
await fs.writeFile('desktop-test-results/clipboard-speed/after.json', JSON.stringify({ startupMs, readMs }))
const initial = await port.read() // Also compiles and exercises the production Win32 reader.
const saved = await invoke({ operation: 'save' })
if (!saved.safe) {
  console.log('PASS: native reader compiled and returned a snapshot. Native writes skipped to preserve non-text clipboard.')
} else {
  const root = path.resolve('desktop-test-results', 'file-clipboard-native-' + Date.now())
  await fs.mkdir(root, { recursive: true })
  const paths = [path.join(root, 'музыка $ ` (1).txt'), path.join(root, 'folder')]
  await fs.writeFile(paths[0], 'native clipboard test'); await fs.mkdir(paths[1])
  let last
  try {
    // Compare-and-set ensures the earlier clipboard is still the one we saved.
    last = await port.write(paths, 'copy', 'native-test-copy', saved.sequence)
    const copied = await port.read(); assert.equal(copied.sequence, last); assert.deepEqual(copied.paths, paths); assert.equal(copied.marker, 'native-test-copy')
    assert.deepEqual(await invoke({ operation: 'inspect' }), { paths, effect: 1 })
    last = await port.write(paths, 'move', 'native-test-cut', last)
    assert.equal((await port.read()).mode, 'move'); assert.deepEqual(await invoke({ operation: 'inspect' }), { paths, effect: 2 })
    assert.equal(await port.clear(initial.sequence), false)
    await assert.rejects(port.write([], 'copy', 'stale', saved.sequence), /clipboard changed/)
    assert.equal((await port.read()).sequence, last)
    console.log('PASS: native CF_HDROP copy/cut, Unicode paths, independent Windows Forms read, conditional write/clear.')
  } finally {
    if (last !== undefined) await invoke({ operation: 'restore', expected: last, empty: saved.empty, text: saved.text })
    // Keep tiny fixtures: if the user copied these paths during the test, they remain valid.
  }
}



} finally { await port.shutdown() }
