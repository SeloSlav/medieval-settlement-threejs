import { writeFileSync } from 'node:fs';

/** A separate capture after frame measurements: includes browser/GPU scheduling. */
export async function captureBrowserFrameTrace(page, path, durationMs = 5000) {
  const session = await page.context().newCDPSession(page);
  const completed = new Promise(resolve => session.once('Tracing.tracingComplete', resolve));
  await session.send('Tracing.start', {
    categories: 'devtools.timeline,blink,cc,gpu,viz,toplevel,disabled-by-default-gpu.service,disabled-by-default-dawn',
    options: 'record-as-much-as-possible',
    transferMode: 'ReturnAsStream',
  });
  await page.waitForTimeout(durationMs);
  await session.send('Tracing.end');
  const { stream } = await completed;
  const parts = [];
  for (;;) {
    const { data, base64Encoded, eof } = await session.send('IO.read', { handle: stream });
    parts.push(Buffer.from(data, base64Encoded ? 'base64' : 'utf8'));
    if (eof) break;
  }
  await session.send('IO.close', { handle: stream });
  await session.detach();
  writeFileSync(path, Buffer.concat(parts));
}
