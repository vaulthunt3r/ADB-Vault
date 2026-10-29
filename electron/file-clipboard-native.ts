import path from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

export interface NativeFileClipboard { sequence: number; paths: string[]; mode: 'copy' | 'move'; marker: string }
export interface FileClipboardPort {
  start?(): Promise<void>
  shutdown?(): Promise<void>
  read(): Promise<NativeFileClipboard>
  write(paths: string[], mode: 'copy' | 'move', marker: string, expected?: number): Promise<number>
  clear(expected: number): Promise<boolean>
}

// CF_HDROP and Preferred DropEffect are the Windows Shell file-transfer formats.
// Paths are stdin JSON, never executable PowerShell text. The owner window is message-only.
export const FILE_CLIPBOARD_SCRIPT = `
$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::InputEncoding=[Text.UTF8Encoding]::new(); [Console]::OutputEncoding=[Text.UTF8Encoding]::new()
try {
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class VaultFileClipboard {
  [DllImport("user32.dll")] static extern bool OpenClipboard(IntPtr owner);
  [DllImport("user32.dll")] static extern bool CloseClipboard();
  [DllImport("user32.dll")] static extern bool EmptyClipboard();
  [DllImport("user32.dll")] static extern IntPtr GetClipboardData(uint format);
  [DllImport("user32.dll")] static extern IntPtr SetClipboardData(uint format, IntPtr data);
  [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern uint RegisterClipboardFormat(string name);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr CreateWindowEx(uint ex, string cls, string name, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
  [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr window);
  [DllImport("kernel32.dll")] static extern IntPtr GlobalAlloc(uint flags, UIntPtr bytes);
  [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr value);
  [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr value);
  [DllImport("kernel32.dll")] static extern UIntPtr GlobalSize(IntPtr value);
  [DllImport("kernel32.dll")] static extern IntPtr GlobalFree(IntPtr value);
  [DllImport("shell32.dll", CharSet=CharSet.Unicode)] static extern uint DragQueryFile(IntPtr drop, uint index, StringBuilder name, uint length);
  public class Snapshot { public uint sequence; public string[] paths; public string mode; public string marker; }
  static uint Marker { get { return RegisterClipboardFormat("ADB Vault File Selection"); } }
  static uint Effect { get { return RegisterClipboardFormat("Preferred DropEffect"); } }
  static void Open(IntPtr owner) {
    for (int i=0; i<20; i++) { if (OpenClipboard(owner)) return; System.Threading.Thread.Sleep(25); }
    throw new Exception("Windows clipboard is busy. Try again.");
  }
  static byte[] Bytes(uint format, int limit) {
    IntPtr handle=GetClipboardData(format); if (handle==IntPtr.Zero) return new byte[0];
    ulong size=GlobalSize(handle).ToUInt64(); if (size> (ulong)limit) throw new Exception("Clipboard format exceeds its limit.");
    IntPtr data=GlobalLock(handle); if (data==IntPtr.Zero) throw new Exception("Cannot read clipboard data.");
    try { byte[] bytes=new byte[(int)size]; Marshal.Copy(data,bytes,0,bytes.Length); return bytes; } finally { GlobalUnlock(handle); }
  }
  static void Put(uint format, byte[] bytes) {
    IntPtr handle=GlobalAlloc(2,(UIntPtr)bytes.Length); if(handle==IntPtr.Zero) throw new Exception("Cannot allocate clipboard data.");
    bool transferred=false;
    try { IntPtr data=GlobalLock(handle); if(data==IntPtr.Zero) throw new Exception("Cannot write clipboard data.");
      try { Marshal.Copy(bytes,0,data,bytes.Length); } finally { GlobalUnlock(handle); }
      if(SetClipboardData(format,handle)==IntPtr.Zero) throw new Exception("Windows rejected the file clipboard."); transferred=true;
    } finally { if(!transferred) GlobalFree(handle); }
  }
  public static Snapshot Read() {
    Open(IntPtr.Zero);
    try {
      var result=new Snapshot { sequence=GetClipboardSequenceNumber(), paths=new string[0], mode="copy", marker="" };
      byte[] marker=Bytes(Marker,128); result.marker=Encoding.UTF8.GetString(marker).TrimEnd((char)0);
      byte[] effect=Bytes(Effect,64); if(effect.Length>=4 && (BitConverter.ToUInt32(effect,0)&2)!=0) result.mode="move";
      IntPtr drop=GetClipboardData(15);
      if(drop!=IntPtr.Zero) {
        uint count=DragQueryFile(drop,0xffffffff,null,0); if(count>10000) throw new Exception("Clipboard contains too many files.");
        result.paths=new string[count]; long total=0;
        for(uint i=0; i<count; i++) {
          uint length=DragQueryFile(drop,i,null,0); total+=length;
          if(length==0 || length>4096 || total>1000000) throw new Exception("Clipboard file paths exceed their limit.");
          var text=new StringBuilder((int)length+1); DragQueryFile(drop,i,text,length+1); result.paths[i]=text.ToString();
        }
      }
      return result;
    } finally { CloseClipboard(); }
  }
  public class WriteResult { public bool changed; public uint sequence; }
  static WriteResult Result(bool changed) { return new WriteResult { changed=changed, sequence=GetClipboardSequenceNumber() }; }
  public static WriteResult Write(string[] paths, bool move, string marker, long expected, bool clear) {
    IntPtr owner=CreateWindowEx(0,"STATIC","",0,0,0,0,0,new IntPtr(-3),IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
    if(owner==IntPtr.Zero) throw new Exception("Cannot create clipboard owner.");
    try { Open(owner); try {
      if(expected>=0 && GetClipboardSequenceNumber()!=(uint)expected) return Result(false);
      if(!EmptyClipboard()) throw new Exception("Cannot update Windows clipboard.");
      if(clear) return Result(true);
      if(paths.Length>0) {
        byte[] names=Encoding.Unicode.GetBytes(String.Join("\\0",paths)+"\\0\\0");
        byte[] drop=new byte[20+names.Length]; Array.Copy(BitConverter.GetBytes(20),0,drop,0,4); Array.Copy(BitConverter.GetBytes(1),0,drop,16,4); Array.Copy(names,0,drop,20,names.Length);
        Put(15,drop); Put(Effect,BitConverter.GetBytes(move?2:1));
      }
      if(!String.IsNullOrEmpty(marker)) Put(Marker,Encoding.UTF8.GetBytes(marker+"\\0"));
      return Result(true);
    } finally { CloseClipboard(); } } finally { DestroyWindow(owner); }
  }
}
'@
[Console]::Out.WriteLine('{"ready":true}')
while ($null -ne ($line=[Console]::In.ReadLine())) {
  try {
    $request=$line | ConvertFrom-Json
    if($request.operation -eq 'read') { $result=[VaultFileClipboard]::Read() }
    elseif($request.operation -eq 'write' -or $request.operation -eq 'clear') {
      $expected=if($null -eq $request.expected){ -1L }else{ [long]$request.expected }
      $result=[VaultFileClipboard]::Write([string[]]@($request.paths),$request.mode -eq 'move',[string]$request.marker,$expected,$request.operation -eq 'clear')
    } else { throw 'Unknown clipboard operation.' }
    [Console]::Out.WriteLine((@{ok=$true; value=$result} | ConvertTo-Json -Compress -Depth 5))
  } catch { [Console]::Out.WriteLine((@{ok=$false; error=$_.Exception.Message} | ConvertTo-Json -Compress)) }
}

} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
`

type LaunchClipboard = (file: string, args: string[]) => ChildProcessWithoutNullStreams
const launchClipboard: LaunchClipboard = (file, args) => spawn(file, args, { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })

// One hidden helper compiles once. It never polls/reads the clipboard in the
// background: every clipboard operation is an explicit line on its stdin.
export class WindowsFileClipboard implements FileClipboardPort {
  private child?: ChildProcessWithoutNullStreams
  private ready?: Promise<void>
  private queue: Promise<unknown> = Promise.resolve()
  private closed = false
  private rejectReady?: (error: Error) => void
  private request?: { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  constructor(private launch: LaunchClipboard = launchClipboard) {}
  start(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Clipboard is shutting down.'))
    if (this.ready) return this.ready
    if (process.platform !== 'win32') return Promise.reject(new Error('Windows file clipboard is only available on Windows.'))
    let resolveReady!: () => void
    this.ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; this.rejectReady = reject })
    const ready = this.ready
    const file = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    let child: ChildProcessWithoutNullStreams
    try { child = this.launch(file, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(FILE_CLIPBOARD_SCRIPT, 'utf16le').toString('base64')]) }
    catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); return ready }
    this.child = child
    let output = '', stderr = '', initialized = false
    const startup = setTimeout(() => { if (this.child === child) this.fail(new Error('Windows clipboard helper timed out while starting.')) }, 20000)
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-2000) })
    child.stdout.on('data', data => {
      if (this.child !== child) return
      output += data
      if (Buffer.byteLength(output) > 8_000_000) { this.fail(new Error('Clipboard reply exceeded its limit.')); return }
      let newline: number
      while ((newline = output.indexOf('\n')) >= 0) {
        const line = output.slice(0, newline).trim(); output = output.slice(newline + 1)
        if (!line) continue
        try {
          const reply = JSON.parse(line)
          if (!initialized && reply.ready === true) { initialized = true; clearTimeout(startup); this.rejectReady = undefined; resolveReady(); continue }
          const request = this.request
          if (!initialized || !request || typeof reply.ok !== 'boolean') throw new Error('Invalid clipboard helper reply.')
          clearTimeout(request.timer); this.request = undefined
          if (reply.ok) request.resolve(reply.value); else request.reject(new Error(String(reply.error || 'Windows clipboard operation failed.')))
        } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); return }
      }
    })
    child.once('error', error => { clearTimeout(startup); if (this.child === child) this.fail(error) })
    child.stdin.on('error', error => { if (this.child === child) this.fail(error) })
    child.once('exit', () => { clearTimeout(startup); if (this.child === child) this.fail(new Error(stderr || 'Windows clipboard helper stopped. Try again.')) })
    return ready
  }
  private fail(error: Error) {
    this.rejectReady?.(error); this.rejectReady = undefined
    if (this.request) { clearTimeout(this.request.timer); this.request.reject(error); this.request = undefined }
    const child = this.child; this.child = undefined; this.ready = undefined
    child?.kill()
  }
  private invoke(value: unknown): Promise<any> {
    const input = JSON.stringify(value)
    if (Buffer.byteLength(input) > 4_000_000) return Promise.reject(new Error('Clipboard selection is too large.'))
    const result = this.queue.then(async () => {
      await this.start()
      if (this.closed) throw new Error('Clipboard is shutting down.')
      return new Promise((resolve, reject) => {
        const child = this.child!
        const request = { resolve, reject, timer: setTimeout(() => { if (this.request === request) this.fail(new Error('Windows clipboard operation timed out. Try again.')) }, 20000) }
        this.request = request
        child.stdin.write(input + '\n', 'utf8', error => { if (error && this.child === child && this.request === request) this.fail(error) })
      })
    })
    this.queue = result.catch(() => {})
    return result
  }
  async read(): Promise<NativeFileClipboard> { return this.invoke({ operation: 'read' }) }
  async write(paths: string[], mode: 'copy' | 'move', marker: string, expected?: number) {
    const result = await this.invoke({ operation: 'write', paths, mode, marker, expected })
    if (!result.changed) throw new Error('The clipboard changed. Copy the files again.')
    return result.sequence as number
  }
  async clear(expected: number) { return !!(await this.invoke({ operation: 'clear', paths: [], expected })).changed }
  async shutdown() {
    this.closed = true
    const child = this.child
    this.fail(new Error('Clipboard is shutting down.'))
    if (child && child.exitCode === null && child.signalCode === null) await new Promise<void>(resolve => { const timer = setTimeout(resolve, 2000); child.once('exit', () => { clearTimeout(timer); resolve() }) })
    await this.queue
  }
}
