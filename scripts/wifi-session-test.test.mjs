import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDevices, targetState, validateEndpoint } from './wifi-session-test.mjs';

test('matches both transports for the target, without another phone masking its disconnection', () => {
  const devices = parseDevices('List of devices attached\r\n192.168.1.134:40971 offline transport_id:10\r\nadb-OTHER-abc._adb-tls-connect._tcp device transport_id:11\r\n');
  assert.equal(targetState(devices, '192.168.1.134:40971', 'adb-PHONE-').state, 'offline');
  devices.push(...parseDevices('adb-PHONE-abc._adb-tls-connect._tcp device transport_id:12'));
  const result = targetState(devices, '192.168.1.134:40971', 'adb-PHONE-');
  assert.equal(result.state, 'device');
  assert.equal(result.transports.length, 2);
});

test('does not interpret server notices or empty results as a connected phone', () => {
  assert.deepEqual(parseDevices('* daemon started successfully\nList of devices attached\n'), []);
  assert.equal(targetState([], '192.168.1.134:40971', '').state, 'absent');
  assert.equal(targetState(parseDevices('192.168.1.134:40971 unauthorized'), '192.168.1.134:40971', '').state, 'unauthorized');
});

test('rejects unsafe or invalid endpoint input', () => {
  assert.deepEqual(validateEndpoint('192.168.1.134:40971'), { ip: '192.168.1.134', port: 40971 });
  for (const value of ['192.168.1.999:55', '192.168.1.1:0', '192.168.1.1:65536', 'host:55', '192.168.1.1:55; echo x']) {
    assert.throws(() => validateEndpoint(value));
  }
});
