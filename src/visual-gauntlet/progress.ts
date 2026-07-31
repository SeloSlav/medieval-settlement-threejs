import './progress.css';
import {
  HAMLET_FIXTURE_ID,
  HAMLET_MOTION_ROUTE,
} from '../e2e/hamletFixtureConfig.ts';

type GateState = 'blocked' | 'failed' | 'unproven' | 'unreviewed' | 'verified';

interface ReferenceEvidence {
  ordinal: string;
  file: string;
  source: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
}

interface StoredCapture {
  label: string;
  path: string;
  href: string;
}

interface EvidenceGate {
  title: string;
  target: string;
  status: GateState;
  evidence: string;
}

const references: ReferenceEvidence[] = [
  {
    ordinal: '01',
    file: 'manor-lords-01.png',
    source: 'image-1.png',
    width: 2269,
    height: 1309,
    bytes: 4485664,
    sha256: '4514B9C63D2CF1619CB1728095315094990248A000935FC44298850115FBB5C3',
  },
  {
    ordinal: '02',
    file: 'manor-lords-02.png',
    source: 'image-2.png',
    width: 2559,
    height: 1438,
    bytes: 6382274,
    sha256: '3C897E6A28E5E9E82FC1EA554B4BFB6F916D5606BD8B9641A45A9086E1C91715',
  },
  {
    ordinal: '03',
    file: 'manor-lords-03.png',
    source: 'image-3.png',
    width: 2559,
    height: 1438,
    bytes: 7472372,
    sha256: 'AB5EDEE0F29B3F04585CE89C089786D298E72A750F9AC746896F30122D854127',
  },
  {
    ordinal: '04',
    file: 'manor-lords-04.png',
    source: 'image-4.png',
    width: 2559,
    height: 1438,
    bytes: 6988951,
    sha256: '5C0F65919A9A332640E52C346409CA179CF64FDD63B4851662E5C95CE0B9A752',
  },
  {
    ordinal: '05',
    file: 'manor-lords-05.png',
    source: 'image-5.png',
    width: 2559,
    height: 1438,
    bytes: 5973443,
    sha256: 'F40415B4B2813C4E2FEFAACADCDFBDA37CD13969DDDC8ECC6C1C163F4C61D333',
  },
  {
    ordinal: '06',
    file: 'manor-lords-06.png',
    source: 'image-6.png',
    width: 2559,
    height: 1438,
    bytes: 5383905,
    sha256: '4CA23CE351E4E54AC2577659D61FBC33F4D39E772A5532F0C81C45FEA2794F1D',
  },
  {
    ordinal: '07',
    file: 'manor-lords-07.png',
    source: 'image-7.png',
    width: 2559,
    height: 1438,
    bytes: 5519593,
    sha256: '381C67F850C725D0AE95CA149390984582585ED5577191E49EB994BFFDC8FE30',
  },
  {
    ordinal: '08',
    file: 'manor-lords-08.png',
    source: 'image-8.png',
    width: 1930,
    height: 916,
    bytes: 2925531,
    sha256: 'D980389B6FA223434C563AA4D236AC681A407B405FE74271000D7775ACC3423C',
  },
  {
    ordinal: '09',
    file: 'manor-lords-09.png',
    source: 'image-9.png',
    width: 1762,
    height: 978,
    bytes: 2976818,
    sha256: 'D09E45501268E8FEE792828937C29B75F94387999B79669C56F520C6DF821601',
  },
  {
    ordinal: '10',
    file: 'manor-lords-10.png',
    source: 'image-10.png',
    width: 904,
    height: 925,
    bytes: 1342684,
    sha256: '063D300CA3889069F7A844E01DB9EA2892366FD94C8E6D539BF388D5C12B6877',
  },
];

const storedCaptures: StoredCapture[] = [
  {
    label: 'Baseline daylight overview',
    path: 'artifacts/visual-qa/baseline-day-overview.png',
    href: new URL('../../artifacts/visual-qa/baseline-day-overview.png', import.meta.url).href,
  },
  {
    label: 'Baseline night overview',
    path: 'artifacts/visual-qa/baseline-night-overview.png',
    href: new URL('../../artifacts/visual-qa/baseline-night-overview.png', import.meta.url).href,
  },
  {
    label: 'Historical world setup',
    path: 'artifacts/visual-qa/polished-world-setup.png',
    href: new URL('../../artifacts/visual-qa/polished-world-setup.png', import.meta.url).href,
  },
  {
    label: 'Historical initial world',
    path: 'artifacts/visual-qa/polished-world-initial.png',
    href: new URL('../../artifacts/visual-qa/polished-world-initial.png', import.meta.url).href,
  },
  {
    label: 'Historical daylight overview',
    path: 'artifacts/visual-qa/polished-day-overview.png',
    href: new URL('../../artifacts/visual-qa/polished-day-overview.png', import.meta.url).href,
  },
  {
    label: 'Historical close world',
    path: 'artifacts/visual-qa/polished-close-world.png',
    href: new URL('../../artifacts/visual-qa/polished-close-world.png', import.meta.url).href,
  },
];

const gates: EvidenceGate[] = [
  {
    title: 'Matched conditions',
    target: 'Fixed route, camera, 1280×720, renderer PR 1, weather, and time',
    status: 'unproven',
    evidence: 'Round 56 binds one dependency-closed archive, the fixed route, 1280x720 drawing buffer, renderer PR 1, exact cross-arm camera-pose signatures, and byte-identical prime/repeat frame captures. Weather and time are still not serialized, so the global matched-condition gate remains unproven.',
  },
  {
    title: 'Median FPS',
    target: 'Hard pass: 60–90 FPS during the settled 30-second full-subsystem run',
    status: 'unproven',
    evidence: 'Round 56 records roughly 153 FPS mean throughput in both blind arms with direct rendering, post-processing disabled, and vegetation updates frozen after warmup. That diagnostic validates the forest-floor treatment comparison, not a normal full-system settlement run.',
  },
  {
    title: '1% low',
    target: 'Hard pass: at least 60 FPS in the same target run',
    status: 'unproven',
    evidence: 'Round 56 passes the sealed diagnostic bar at 81.10 FPS for the shadowed-ground treatment and 81.87 FPS for the existing-terrain control. Normal live vegetation updates and post-processing are outside that comparison, so the global target remains unproven rather than failed.',
  },
  {
    title: '>25 ms hitch count',
    target: 'Hard pass: exactly 0 frames during the 30-second trace',
    status: 'unproven',
    evidence: 'Both Round 56 arms record zero frames over 25 ms and maxima at or below 18.0 ms, but only under the sealed forest-floor diagnostic. A normal full-system run is still required.',
  },
  {
    title: '>50 ms hitch count',
    target: 'Hard pass: exactly 0 frames during the 30-second trace',
    status: 'verified',
    evidence: 'Every protocol-valid Round 14–24 trace records exactly 0 frames over 50 ms.',
  },
  {
    title: 'LOD motion review',
    target: 'Fresh critic finds no discrete pop or blank band at normal playback or frame-step',
    status: 'unproven',
    evidence: 'Round 56 provides nine GPU-synchronized, pose-matched frame-step pairs with byte-identical prime/repeat captures, including 0276–0279. The fresh exhaustive critic found no vegetation, shadow, terrain-mask, or road-mask pop, but normal-playback review with all live systems remains outstanding.',
  },
  {
    title: 'Residence roof progression',
    target: 'Wood unless that residence receives physical tiles and completes a consuming retrofit',
    status: 'unproven',
    evidence: 'The lifetime-global production unlock was rejected. Current residences remain wooden; the physical commodity, delivery, labor, consumption, and per-residence retrofit state are intentionally deferred.',
  },
];

const runtimeHooks = [
  'window.__HAMLET_FIXTURE_MOTION_ROUTE__',
  'window.__HAMLET_FIXTURE_MOTION_READY__',
  'window.__HAMLET_FIXTURE_MOTION_STATE__',
  'window.__HAMLET_FIXTURE_MOTION_SETTLED_START__()',
  'window.__HAMLET_FIXTURE_START_MOTION__(elapsedMs?)',
  'window.__HAMLET_FIXTURE_SEEK_MOTION__(elapsedMs)',
  'window.__HAMLET_FIXTURE_STOP_MOTION__()',
  'window.__HAMLET_FIXTURE_CAPTURE_VIEW__(viewId)',
  'window.__HAMLET_FIXTURE_CAPTURE_MOTION__(elapsedMs)',
  'window.__HAMLET_FIXTURE_CAPTURE_READY__(captureId?)',
  'window.__HAMLET_FIXTURE_SYSTEMS__',
] as const;

function element<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Visual gauntlet is missing ${selector}.`);
  return node;
}

function referenceHref(reference: ReferenceEvidence): string {
  return `/visual-gauntlet/references/${reference.file}`;
}

function formatBytes(bytes: number): string {
  return new Intl.NumberFormat('en-US').format(bytes);
}

function renderReferenceGrid(): void {
  const grid = element<HTMLElement>('[data-reference-grid]');
  grid.innerHTML = references
    .map(
      (reference, index) => `
        <button
          class="reference-thumb"
          type="button"
          data-reference-index="${index}"
          aria-pressed="${index === 0}"
          aria-label="Show supplied reference ${reference.ordinal}"
        >
          <img src="${referenceHref(reference)}" alt="" loading="lazy" />
          <span>Reference ${reference.ordinal}</span>
        </button>
      `,
    )
    .join('');
}

function selectReference(index: number): void {
  const reference = references[index];
  if (!reference) return;

  const href = referenceHref(reference);
  const image = element<HTMLImageElement>('[data-reference-image]');
  image.src = href;
  image.alt = `User-supplied Manor Lords visual reference ${reference.ordinal} of ${references.length}`;
  element<HTMLElement>('[data-reference-label]').textContent =
    `Reference ${reference.ordinal} of ${references.length}`;
  element<HTMLElement>('[data-reference-path]').textContent =
    `public/visual-gauntlet/references/${reference.file}`;
  element<HTMLElement>('[data-reference-meta]').textContent =
    `${reference.width} × ${reference.height} · ${formatBytes(reference.bytes)} bytes`;
  element<HTMLElement>('[data-reference-hash]').textContent =
    `SHA-256 ${reference.sha256.slice(0, 12)}…`;
  const open = element<HTMLAnchorElement>('[data-reference-open]');
  open.href = href;
  open.setAttribute(
    'aria-label',
    `Open supplied reference ${reference.ordinal} at original resolution`,
  );

  document.querySelectorAll<HTMLButtonElement>('[data-reference-index]').forEach((button) => {
    button.setAttribute('aria-pressed', String(Number(button.dataset.referenceIndex) === index));
  });
}

function renderCaptures(): void {
  element<HTMLElement>('[data-capture-grid]').innerHTML = storedCaptures
    .map(
      (capture) => `
        <a class="capture-card" href="${capture.href}" target="_blank" rel="noopener">
          <div class="capture-card__image">
            <img src="${capture.href}" alt="${capture.label}" loading="lazy" />
            <span>Historical / insufficient</span>
          </div>
          <strong>${capture.label}</strong>
          <code>${capture.path}</code>
          <small>Open stored artifact</small>
        </a>
      `,
    )
    .join('');
}

function statusLabel(status: GateState): string {
  switch (status) {
    case 'blocked':
      return 'Blocked';
    case 'failed':
      return 'Failed';
    case 'unproven':
      return 'Unproven';
    case 'unreviewed':
      return 'Unreviewed';
    case 'verified':
      return 'Verified';
  }
}

function renderGates(): void {
  element<HTMLElement>('[data-gates]').innerHTML = gates
    .map(
      (gate, index) => `
        <article class="gate gate--${gate.status}">
          <span class="gate__index">${String(index + 1).padStart(2, '0')}</span>
          <div>
            <div class="gate__heading">
              <strong>${gate.title}</strong>
              <em>${statusLabel(gate.status)}</em>
            </div>
            <p>${gate.target}</p>
            <small>${gate.evidence}</small>
          </div>
        </article>
      `,
    )
    .join('');
}

function formatVector(values: readonly number[]): string {
  return `[${values.join(', ')}]`;
}

function renderMotionRoute(): void {
  element<HTMLElement>('[data-route-label]').textContent =
    `${HAMLET_MOTION_ROUTE.label} · ${HAMLET_MOTION_ROUTE.id}`;

  const routeHref = `/hamlet-fixture.html?route=${encodeURIComponent(HAMLET_MOTION_ROUTE.id)}&clean=1&visualProfile=1`;
  const routeOpen = element<HTMLAnchorElement>('[data-route-open]');
  routeOpen.href = routeHref;
  routeOpen.textContent = `Open ${HAMLET_FIXTURE_ID}`;

  const settled = HAMLET_MOTION_ROUTE.settledStartPredicate;
  element<HTMLElement>('[data-route-spec]').innerHTML = `
    <article>
      <span>Configured duration</span>
      <strong>${HAMLET_MOTION_ROUTE.durationMs.toLocaleString('en-US')} ms</strong>
      <small>Shorter than the required 30-second acceptance trace.</small>
    </article>
    <article>
      <span>Interpolation</span>
      <strong>${HAMLET_MOTION_ROUTE.interpolation}</strong>
      <small>Easing: ${HAMLET_MOTION_ROUTE.easing}</small>
    </article>
    <article>
      <span>Settled predicate</span>
      <strong>${settled.id}</strong>
      <small>fixtureReady=${settled.fixtureReady}; detailedTexturesReady=${settled.detailedTexturesReady}; minimumRenderedFrames=${settled.minimumRenderedFrames}; motionInactive=${settled.motionInactive}</small>
    </article>
    <article>
      <span>Declared LOD bands</span>
      <strong>${HAMLET_MOTION_ROUTE.lodBands.forest.id} · ${HAMLET_MOTION_ROUTE.lodBands.groundcover.id} · ${HAMLET_MOTION_ROUTE.lodBands.building.id}</strong>
      <small>Forest near ${HAMLET_MOTION_ROUTE.lodBands.forest.nearDistanceMeters} m; groundcover transition/full ${HAMLET_MOTION_ROUTE.lodBands.groundcover.transitionStartMeters}/${HAMLET_MOTION_ROUTE.lodBands.groundcover.fullDetailMeters} m; buildings ${HAMLET_MOTION_ROUTE.lodBands.building.settlementMeters}/${HAMLET_MOTION_ROUTE.lodBands.building.roadEyeMeters} m.</small>
    </article>
  `;

  element<HTMLOListElement>('[data-route-keyframes]').innerHTML =
    HAMLET_MOTION_ROUTE.keyframes
      .map(
        (keyframe) => `
          <li>
            <time>${(keyframe.timeMs / 1000).toFixed(keyframe.timeMs % 1000 === 0 ? 0 : 1)}s</time>
            <strong>${keyframe.id}</strong>
            <span>${keyframe.distanceMeters} m · FOV ${keyframe.fov}</span>
            <code>position ${formatVector(keyframe.position)}</code>
            <code>target ${formatVector(keyframe.target)}</code>
            <code>orientation ${formatVector(keyframe.orientation)}</code>
          </li>
        `,
      )
      .join('');

  element<HTMLElement>('[data-runtime-hooks]').innerHTML = runtimeHooks
    .map((hook) => `<code>${hook}</code>`)
    .join('');
}

element<HTMLElement>('[data-reference-grid]').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    '[data-reference-index]',
  );
  if (!button?.dataset.referenceIndex) return;
  selectReference(Number(button.dataset.referenceIndex));
});

renderReferenceGrid();
selectReference(0);
renderCaptures();
renderGates();
renderMotionRoute();
