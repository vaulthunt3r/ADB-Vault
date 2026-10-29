import test from 'node:test'
import assert from 'node:assert/strict'
import { parseFileStorages, profileFileStorages } from '../dist-electron/file-storage.js'
import { FileIO, FilesService } from '../dist-electron/files.js'

const dump = `Disks:
  DiskInfo{disk:179,64}:
    flags=ADOPTABLE|SD size=64000000000 label=null
    sysPath=/sys/devices/mmc
  DiskInfo{disk:8,0}:
    flags=USB size=16000000000 label=Flash
    sysPath=/sys/devices/usb
Volumes:
  VolumeInfo{private}:
    type=PRIVATE diskId=null partGuid=null mountFlags=0 mountUserId=-1 state=MOUNTED
    fsType=null fsUuid=null fsLabel=null
    path=/data internalPath=null
  VolumeInfo{emulated;0}:
    type=EMULATED diskId=null mountFlags=PRIMARY|VISIBLE mountUserId=0 state=MOUNTED
    fsType=null fsUuid=null fsLabel=null
    path=/storage/emulated internalPath=/data/media
  VolumeInfo{public:179,65}:
    type=PUBLIC diskId=disk:179,64 partGuid=null mountFlags=VISIBLE mountUserId=0
    state=MOUNTED fsType=exfat fsUuid=1234-5678 fsLabel=My SD card
    path=/storage/1234-5678 internalPath=/mnt/media_rw/1234-5678
  VolumeInfo{public:8,1}:
    type=PUBLIC diskId=disk:8,0 state=MOUNTED_READ_ONLY
    fsType=vfat fsUuid=ABCD-1234 fsLabel=null
    path=/storage/ABCD-1234 internalPath=/mnt/media_rw/ABCD-1234
Records:
  VolumeRecord{old}:
    fsUuid=old
Primary storage UUID: null
`

test('storage discovery distinguishes internal storage, mounted SD and read-only USB', () => {
  assert.deepEqual(parseFileStorages(dump, '/storage/emulated/0'), [
    { kind: 'internal', name: 'Internal storage', path: '/storage/emulated/0' },
    { kind: 'sd', name: 'SD card · My SD card', path: '/storage/1234-5678', readOnly: false },
    { kind: 'usb', name: 'USB storage', path: '/storage/ABCD-1234', readOnly: true },
  ])
  assert.equal(parseFileStorages(dump.replace('ADOPTABLE|SD', '0x5').replace('flags=USB', 'flags=8'), '/sdcard')[1].kind, 'sd')
  const physical = parseFileStorages(dump, '/storage/1234-5678')
  assert.equal(physical.filter(v => v.path === '/storage/1234-5678').length, 1)
  assert.equal(physical[0].kind, 'sd')
})

test('removed, private, unmapped and unsafe storage volumes are not invented as SD cards', () => {
  const removed = dump.replace('state=MOUNTED fsType=exfat', 'state=UNMOUNTED fsType=exfat')
  assert.equal(parseFileStorages(removed, '/sdcard').some(v => v.kind === 'sd'), false)
  for (const p of ['/storage/../data', '/storage/emulated', '/data', 'null']) {
    assert.equal(parseFileStorages(dump.replace('path=/storage/1234-5678 ', `path=${p} `), '/sdcard').some(v => v.kind === 'sd'), false)
  }
  const unknown = parseFileStorages(dump.replace('flags=ADOPTABLE|SD', 'flags=0'), '/sdcard')
  assert.equal(unknown[1].kind, 'external')
  assert.throws(() => parseFileStorages('Permission Denial: cannot dump mount', '/sdcard'), /supported storage list/)
})

test('storage reads use the exact transport, no root or polling, and fail after reconnection', async () => {
  const device = { id: 'phone', serial: 'PHONE', transportId: '7', status: 'connected' }, calls = []
  const io = new FileIO(() => 'adb.exe', () => ({ devices: [device] }), async (_file, args) => {
    calls.push(args)
    return { stdout: args.at(-1).startsWith('readlink') ? '/storage/emulated/0\n' : dump, stderr: '', code: 0 }
  })
  const location = { kind: 'device', path: '/', id: device.id, serial: device.serial, transportId: device.transportId, root: true }
  assert.equal((await io.storages(location)).length, 3)
  assert.equal(calls.length, 3)
  assert.ok(calls.every(args => args.slice(0, 4).join(' ') === '-t 7 shell -T' && !args.at(-1).includes('su -c')))
  assert.equal(calls[1].at(-1), 'dumpsys mount')
  const busy = new FilesService(io, () => {}, () => true)
  await assert.rejects(() => busy.storages(location), /current device operation/)
  device.transportId = '8'
  await assert.rejects(() => io.storages(location), /connection changed/)
  assert.equal(calls.length, 3)
})

test('internal storage identifies each Android profile without redirecting aliases or duplicating removable disks', () => {
  const profiles = [{ id: 0, name: 'Personal', managed: false, running: true }, { id: 10, name: 'Office', managed: true, running: true }]
  const storages = profileFileStorages(parseFileStorages(dump, '/storage/emulated/0'), profiles, '/storage/emulated/0')
  assert.deepEqual(storages.filter(s => s.kind === 'internal'), [
    { kind: 'internal', name: 'Internal storage · Personal · ID 0', path: '/storage/emulated/0', userId: 0, primary: true },
    { kind: 'internal', name: 'Internal storage · Office · ID 10 · Work profile', path: '/storage/emulated/10', userId: 10, primary: false },
  ])
  assert.equal(storages.filter(s => s.kind === 'sd').length, 1)
  const secondary = profileFileStorages(parseFileStorages(dump, '/storage/emulated/10'), profiles, '/storage/emulated/10')
  assert.equal(secondary[0].userId, 10)
  assert.equal(secondary[0].primary, true)
  const physical = parseFileStorages(dump, '/storage/1234-5678')
  assert.deepEqual(profileFileStorages(physical, profiles, '/storage/1234-5678'), physical)
})

test('profile discovery is a cached UI request, uses unprivileged commands and keeps storage on denied user listing', async () => {
  const device = { id: 'phone', serial: 'PHONE', transportId: '7', status: 'connected' }, calls = []
  let denied = false, changed = false
  const io = new FileIO(() => 'adb.exe', () => ({ devices: [device] }), async (_file, args) => {
    calls.push(args)
    if (args.at(-1) === 'pm list users') {
      if (changed) device.transportId = '8'
      return denied ? { code: 1, stdout: '', stderr: 'Permission denied' } : { code: 0, stderr: '', stdout: 'Users:\n UserInfo{0:Personal:13} running\n UserInfo{10:Office:30} running' }
    }
    return { code: 0, stderr: '', stdout: args.at(-1).startsWith('readlink') ? '/storage/emulated/0\n' : dump }
  })
  const location = { kind: 'device', path: '/', id: device.id, serial: device.serial, transportId: '7', root: true }
  assert.equal((await io.storages(location)).find(s => s.userId === 10).path, '/storage/emulated/10')
  assert.ok(calls.every(args => args.slice(0, 4).join(' ') === '-t 7 shell -T' && !args.at(-1).includes('su -c')))
  denied = true
  assert.equal((await io.storages(location)).length, 3)
  changed = true
  await assert.rejects(() => io.storages(location), /connection changed/)
})
