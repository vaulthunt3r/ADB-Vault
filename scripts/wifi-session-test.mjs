// Standalone, read-only diagnostic. Does not modify ADB Vault or VPN settings.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { readFile, mkdir, appendFile, writeFile, stat, open } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Socket } from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function parseDevices(output) {
  return output.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^(\S+)\s+(device|offline|unauthorized)\b(.*)$/);
    return match ? [{ serial: match[1], state: match[2], transport: match[3].match(/transport_id:(\d+)/)?.[1] ?? null }] : [];
  });
}
export function targetState(devices, endpoint, aliasPrefix) {
  const matches = devices.filter(item => item.serial === endpoint || (aliasPrefix && item.serial.startsWith(aliasPrefix)));
  return { state: matches.some(item => item.state === 'device') ? 'device' : matches.some(item => item.state === 'offline') ? 'offline' : matches.some(item => item.state === 'unauthorized') ? 'unauthorized' : 'absent', transports: matches };
}
export function validateEndpoint(value) {
  const match = value.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/);
  if (!match || match[1].split('.').some(n => Number(n) > 255) || Number(match[2]) < 1 || Number(match[2]) > 65535) throw new Error('Нужен адрес вида 192.168.1.134:40971');
  return { ip: match[1], port: Number(match[2]) };
}
const delay = ms => new Promise(done => setTimeout(done, ms));
function command(file, args, timeout = 6000, env = {}) {
  return new Promise(done => {
    const child = spawn(file, args, { windowsHide: true, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false, settled = false;
    const finish = result => { if (!settled) { settled = true; clearTimeout(timer); done(result); } };
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    child.stdout.on('data', data => { stdout = (stdout + data).slice(-200000); });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-20000); });
    child.on('error', error => finish({ code: -1, stdout, stderr: error.message, timedOut }));
    child.on('close', code => finish({ code, stdout, stderr, timedOut }));
  });
}
function powershell(source, env = {}) {
  return command('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], 8000, env);
}
function tcp(ip, port) {
  return new Promise(done => {
    const socket = new Socket();
    let finished = false;
    const finish = result => { if (!finished) { finished = true; socket.destroy(); done(result); } };
    socket.setTimeout(2000);
    socket.once('connect', () => finish('reachable'));
    socket.once('error', error => finish(error.code ?? 'error'));
    socket.once('timeout', () => finish('timeout'));
    socket.connect(port, ip);
  });
}
const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

async function main() {
  if (process.platform !== 'win32') throw new Error('Этот тест предназначен для Windows.');
  const args = process.argv.slice(2);
  const option = name => args[args.indexOf(name) + 1];
  const config = JSON.parse(await readFile(join(process.env.APPDATA, 'adb-vault', 'backend.json'), 'utf8'));
  const adb = join(config.paths.adb, 'adb.exe');
  await stat(adb);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const endpoint = args.includes('--target') ? option('--target') : (await rl.question('IP и порт телефона с главного экрана «Беспроводная отладка»: ')).trim();
  const { ip, port } = validateEndpoint(endpoint);
  const aliasPrefix = args.includes('--alias-prefix') ? option('--alias-prefix') : '';
  if (aliasPrefix && !/^adb-[A-Za-z0-9]+-$/.test(aliasPrefix)) throw new Error('Некорректный префикс устройства.');
  const folder = join(root, 'desktop-test-results', 'wifi-session-' + new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(folder, { recursive: true });
  const eventsFile = join(folder, 'events.jsonl');
  const adbLog = join(process.env.TEMP, 'adb.log');
  let logOffset = (await stat(adbLog).catch(() => ({ size: 0 }))).size;
  let logRemainder = '', phase = 'Подготовка', expected = null, stopping = false, cancelled = false;
  let current = { state: 'unknown', transports: [] }, machine = null, lastRouteAt = 0, lastStateKey = '';
  let writes = Promise.resolve();
  const events = [];
  function record(type, data) {
    const event = { time: new Date().toISOString(), phase, type, ...data };
    events.push(event);
    writes = writes.then(() => appendFile(eventsFile, JSON.stringify(event) + '\n', 'utf8'));
    return event;
  }
  record('start', { endpoint, aliasPrefix, intervalMs: 2000, note: 'Screen/VPN phase markers are user-reported. No shell, connect, disconnect, pair, or kill-server commands. TCP probes occur only during awake baselines.' });
  async function readAdbLog() {
    try {
      const size = (await stat(adbLog)).size;
      if (size < logOffset) { logOffset = 0; logRemainder = ''; record('log-reset', {}); }
      if (size === logOffset) return;
      const handle = await open(adbLog, 'r');
      try {
        const buffer = Buffer.alloc(Math.min(size - logOffset, 1024 * 1024));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, logOffset);
        logOffset += bytesRead;
        const lines = (logRemainder + buffer.subarray(0, bytesRead).toString('utf8')).split(/\r?\n/);
        logRemainder = lines.pop() ?? '';
        // TLS messages are global; explicitly label them instead of attributing them to the target.
        const relevant = lines.filter(line => line.includes(endpoint) || (aliasPrefix && line.includes(aliasPrefix)) || /tls_connection.*(Handshake succeeded|SSL_read failed)/.test(line));
        if (relevant.length) {
          await appendFile(join(folder, 'adb-events.log'), relevant.join('\n') + '\n', 'utf8');
          for (const line of relevant) record('adb-log', { scope: line.includes(endpoint) || (aliasPrefix && line.includes(aliasPrefix)) ? 'target' : 'global-tls', line });
        }
      } finally { await handle.close(); }
    } catch (error) { record('log-error', { message: error.message }); }
  }
  const machineScript = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$routeData = $null
$routeError = $null
try {
  $found = @(Find-NetRoute -RemoteIPAddress $env:ADB_DIAG_IP)
  $route = $found | Where-Object { $_.PSObject.Properties.Name -contains 'DestinationPrefix' } | Select-Object -First 1
  $source = $found | Where-Object { $_.PSObject.Properties.Name -contains 'IPAddress' } | Select-Object -First 1
  $routeData = [pscustomobject]@{ Interface=$route.InterfaceAlias; Index=$route.InterfaceIndex; Prefix=$route.DestinationPrefix; NextHop=$route.NextHop; Metric=$route.RouteMetric; Source=$source.IPAddress }
} catch { $routeError=$_.Exception.Message }
$apps = @(Get-CimInstance Win32_Process -Filter "Name = 'electron.exe' OR Name = 'ADB Vault.exe'" | Where-Object {
  $_.Name -eq 'ADB Vault.exe' -or ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($env:ADB_DIAG_ROOT, [StringComparison]::OrdinalIgnoreCase)) -or ($_.CommandLine -and $_.CommandLine.Contains($env:ADB_DIAG_ROOT))
} | Select-Object ProcessId,Name)
$servers = @(Get-Process -Name adb -ErrorAction SilentlyContinue | Select-Object Id)
[pscustomobject]@{ Route=$routeData; RouteError=$routeError; AppProcesses=$apps; AdbServers=$servers } | ConvertTo-Json -Depth 5 -Compress
`;
  async function sample() {
    const result = await command(adb, ['devices', '-l']);
    current = result.code === 0 && !result.timedOut ? targetState(parseDevices(result.stdout), endpoint, aliasPrefix) : { state: 'query-error', transports: [], error: result.timedOut ? 'timeout' : result.stderr };
    record('sample', current);
    const key = JSON.stringify(current);
    if (key !== lastStateKey) { record('transition', current); lastStateKey = key; }
    await readAdbLog();
    if (Date.now() - lastRouteAt >= 10000) {
      const result = await powershell(machineScript, { ADB_DIAG_IP: ip, ADB_DIAG_ROOT: root });
      try {
        if (result.code !== 0) throw new Error(result.stderr || 'Route query failed');
        machine = JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
        record('machine', { ...machine, expected });
      } catch (error) { machine = null; record('machine-error', { message: error.message }); }
      lastRouteAt = Date.now();
    }
  }
  if (args.includes('--self-check')) {
    await sample();
    await writes;
    await writeFile(join(folder, 'report.html'), report(), 'utf8');
    rl.close();
    console.log(JSON.stringify({ state: current, machine, report: join(folder, 'report.html') }, null, 2));
    if (!machine || !machine.Route || current.state === 'query-error') process.exitCode = 1;
    return;
  }
  const monitor = (async () => {
    while (!stopping) { await sample(); if (!stopping) await delay(2000); }
  })();
  // Convert background failures into a visible failure, not an unhandled rejection.
  let monitorError;
  monitor.catch(error => { monitorError = error; stopping = true; });
  async function prompt(text) {
    if (cancelled) throw new Error('Тест прерван; частичный отчёт сохранён.');
    console.log('\n' + text);
    const answer = (await rl.question('Enter — готово; S — пропустить этот блок; Q — закончить тест: ')).trim().toLowerCase();
    if (monitorError) throw monitorError;
    if (answer === 'q') throw new Error('Тест остановлен пользователем; частичный отчёт сохранён.');
    return answer !== 's';
  }
  async function countdown(seconds, label) {
    phase = label;
    record('phase-start', { durationSeconds: seconds, expected });
    const end = Date.now() + seconds * 1000;
    let nextPrint = 0;
    while (Date.now() < end) {
      if (cancelled) throw new Error('Тест прерван; частичный отчёт сохранён.');
      if (monitorError) throw monitorError;
      if (Date.now() >= nextPrint) {
        console.log(`  Осталось ${Math.ceil((end - Date.now()) / 1000)} с. | ADB: ${current.state} | маршрут: ${machine?.Route?.Interface ?? 'не определён'}`);
        nextPrint = Date.now() + 10000;
      }
      await delay(500);
    }
    record('phase-end', {});
    process.stdout.write('\x07');
  }
  function report() {
    const rows = events.filter(event => ['phase-start', 'phase-end', 'transition', 'baseline', 'skip', 'finish', 'error', 'adb-log'].includes(event.type));
    const routes = events.filter(event => event.type === 'machine');
    const table = list => '<table><tr><th>Время</th><th>Этап</th><th>Данные</th></tr>' + list.map(event => '<tr><td>' + escapeHtml(new Date(event.time).toLocaleTimeString('ru-RU')) + '</td><td>' + escapeHtml(event.phase) + '</td><td><pre>' + escapeHtml(JSON.stringify(event, null, 2)) + '</pre></td></tr>').join('') + '</table>';
    return '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Проверка Wi-Fi ADB</title><style>body{font:15px system-ui;max-width:1400px;margin:32px auto;padding:0 24px;color:#20303a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccd2d6;padding:10px;text-align:left;vertical-align:top}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font-size:12px}h2{margin-top:32px}</style><h1>Проверка Wi-Fi ADB</h1><p>Устройство: ' + escapeHtml(endpoint) + '</p><p>Состояние экрана и VPN отмечено пользователем. Фактический маршрут и процессы записаны отдельно. TCP проверялся только до этапа сна. Статус device не доказывает непрерывность связи: сверяйте его с журналом ADB. Время строк ADB — локальное время Windows; global-tls может относиться к другим устройствам. Автоматический вывод о причине обрывов не делается.</p><h2>События и короткие обрывы</h2>' + table(rows) + '<h2>Маршруты и процессы</h2>' + table(routes) + '<p>Полная запись: events.jsonl; внутренние события ADB: adb-events.log.</p></html>';
  }
  process.once('SIGINT', () => { cancelled = true; rl.close(); });
  console.log('\nПРОВЕРКА WI-FI ADB — отдельный локальный тест\n');
  console.log('Телефон: ' + endpoint + '\nОтчёт: ' + folder);
  console.log('4 блока, около 12 минут измерений плюс переключения. Интернет для теста не нужен.');
  console.log('Тест не подключает и не отключает устройства, не меняет VPN и не закрывает ADB Vault.');
  console.log('Для второй половины тест сам откроет текущую сборку ADB Vault после твоего Enter.');
  console.log('Сначала выполняй действие на телефоне/ПК, затем нажимай Enter здесь.');
  try {
    for (const app of [false, true]) {
      if (app) {
        phase = 'Запуск ADB Vault';
        if (!await prompt('Первая половина завершена. Сейчас открою текущую сборку ADB Vault для сравнения.')) {
          record('skip', { reason: 'user-skipped-app-open-half' });
          break;
        }
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        delete env.ADB_VAULT_SMOKE_TEST;
        delete env.VITE_DEV_SERVER_URL;
        const appProcess = spawn(join(root, 'node_modules', 'electron', 'dist', 'electron.exe'), [root], { cwd: root, env, detached: true, windowsHide: false, stdio: 'ignore' });
        await new Promise((done, reject) => { appProcess.once('spawn', done); appProcess.once('error', reject); });
        appProcess.unref();
        record('app-launch', { pid: appProcess.pid });
      }
      for (const vpn of [false, true]) {
        const name = `ADB Vault ${app ? 'открыт' : 'закрыт'} / VPN ${vpn ? 'включён' : 'выключен'}`;
        expected = { appOpen: app, vpnEnabled: vpn };
        phase = name + ' — подготовка';
        console.log('\n============================================================\n' + name);
        let instruction = app ? 'В открывшемся ADB Vault выбери раздел Connection.' : 'Закрой ADB Vault крестиком ×. Не нажимай Disconnect.';
        instruction += '\nРазблокируй телефон. Отключи VPN и подожди 30 секунд, поддерживая экран включённым.';
        if (app) instruction += '\nЕсли нужно, используй Reconnect в строке с IP.';
        if (vpn) instruction += '\nПосле этих 30 секунд включи VPN обратно.';
        instruction += '\nСостояние подключения сценарий проверит сам после Enter.';
        if (!await prompt(instruction)) { record('skip', { reason: 'user' }); continue; }
        let ready = false;
        do {
          // Fresh check prevents accepting a state left over from a previous block.
          const result = await command(adb, ['devices', '-l']);
          const fresh = result.code === 0 && !result.timedOut ? targetState(parseDevices(result.stdout), endpoint, aliasPrefix) : { state: 'query-error' };
          const machineResult = await powershell(machineScript, { ADB_DIAG_IP: ip, ADB_DIAG_ROOT: root });
          let baselineMachine;
          try { baselineMachine = machineResult.code === 0 ? JSON.parse(machineResult.stdout.replace(/^\uFEFF/, '')) : null; } catch { baselineMachine = null; }
          const appMatches = baselineMachine && (baselineMachine.AppProcesses.length > 0) === app;
          record('baseline', { ...fresh, tcp: await tcp(ip, port), expected, machine: baselineMachine });
          ready = fresh.state === 'device' && appMatches;
          if (!ready && !await prompt('Проверка условий: ADB=' + fresh.state + '; окно приложения ' + (appMatches ? 'в ожидаемом состоянии' : 'не соответствует этапу или не удалось проверить') + '.\nОставь экран включённым. Проверь приложение, адрес и VPN. Затем Enter; S пропустит блок.')) break;
        } while (!ready);
        if (!ready) { record('skip', { reason: 'no-connected-baseline' }); continue; }
        console.log('Следующие 30 секунд поддерживай экран включённым касаниями.');
        await countdown(30, name + ' — экран включён');
        if (!await prompt('Теперь ЗАБЛОКИРУЙ телефон и нажми Enter. VPN и ADB Vault не переключай.')) { record('skip', { reason: 'user-before-sleep' }); continue; }
        await countdown(120, name + ' — экран выключен');
        if (!await prompt('Теперь РАЗБЛОКИРУЙ телефон и нажми Enter. Reconnect не нажимай.')) { record('skip', { reason: 'user-before-wake' }); continue; }
        console.log('Следующие 30 секунд поддерживай экран включённым касаниями.');
        await countdown(30, name + ' — после пробуждения');
      }
    }
    record('finish', { result: 'sequence-complete' });
  } catch (error) {
    record('error', { message: error.message });
    console.log('\n' + error.message);
  } finally {
    stopping = true;
    await monitor.catch(error => record('error', { message: error.message }));
    await readAdbLog();
    await writes;
    await writeFile(join(folder, 'report.html'), report(), 'utf8');
    rl.close();
    console.log('\nГОТОВО. При необходимости включи VPN обратно.\nОтчёт: ' + join(folder, 'report.html'));
    console.log('Вернись в чат и напиши «Готово». Пересборка ADB Vault не нужна.');
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
