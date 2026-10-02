import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const { JSDOM } = require('jsdom');

const request = jest.fn();

jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({
  axiosForBackend: request,
}));
jest.mock('../../client/src/pages/RuntimeProbePage/runtime-probe.css', () => ({}));
jest.mock('@client/src/config/runtime-build', () => ({
  runtimeBuildFingerprint: {
    sourceCommit: 'frontend-commit',
    buildTime: '2026-10-02T00:00:00Z',
    visualVersion: 'R10.0-candidate-review',
  },
}));

import {
  getHostedRuntimeFingerprint,
  getReadOnlyRuntimeProbe,
  runtimeFingerprintFrom,
} from '../../client/src/api/runtime-probe';
import RuntimeProbePage from '../../client/src/pages/RuntimeProbePage/RuntimeProbePage';

const completeFingerprint = {
  schemaVersion: 'wiselink.3_1.hosted_runtime_probe.v1',
  status: 'PASS',
  deployedCommit: 'host-commit',
  releaseId: 'host-release',
  apiContractVersion: 'host-contract',
};

function probeResult(body: unknown, status = 200) {
  return [{ path: '/api/runtime-probe', status, body }];
}

describe('runtime probe read-only client', () => {
  beforeEach(() => request.mockReset());

  it('only reads hosted runtime and Unified readiness', async () => {
    request
      .mockResolvedValueOnce({ status: 200, data: { status: 'PASS' } })
      .mockResolvedValueOnce({ status: 200, data: { status: 'READY' } });

    await expect(getReadOnlyRuntimeProbe()).resolves.toEqual([
      { path: '/api/runtime-probe', status: 200, body: { status: 'PASS' } },
      {
        path: '/api/unified-reader/readiness',
        status: 200,
        body: { status: 'READY' },
      },
    ]);
    expect(request.mock.calls).toEqual([
      [{ url: '/api/runtime-probe', method: 'GET' }],
      [{ url: '/api/unified-reader/readiness', method: 'GET' }],
    ]);
  });
  it('extracts only an explicit runtime fingerprint contract', () => {
    expect(
      runtimeFingerprintFrom([
        {
          path: '/api/runtime-probe',
          status: 200,
          body: {
            schemaVersion: 'wiselink.3_1.hosted_runtime_probe.v1',
            status: 'PASS',
            deployedCommit: 'commit-1',
            releaseId: 'release-1',
            apiContractVersion: 'contract-1',
          },
        },
      ]),
    ).toMatchObject({
      deployedCommit: 'commit-1',
      releaseId: 'release-1',
      apiContractVersion: 'contract-1',
    });
    expect(
      runtimeFingerprintFrom([
        { path: '/api/runtime-probe', status: 200, body: { status: 'PASS' } },
      ]),
    ).toBeNull();
  });

  it('reads only the hosted fingerprint when Review diagnostics need it', async () => {
    request.mockResolvedValue({
      status: 200,
      data: {
        schemaVersion: 'wiselink.3_1.hosted_runtime_probe.v1',
        status: 'PASS',
        deployedCommit: 'commit-review',
        releaseId: 'release-review',
        apiContractVersion: 'contract-review',
      },
    });

    await expect(getHostedRuntimeFingerprint()).resolves.toMatchObject({
      deployedCommit: 'commit-review',
      releaseId: 'release-review',
      apiContractVersion: 'contract-review',
    });
    expect(request).toHaveBeenCalledWith({
      url: '/api/runtime-probe',
      method: 'GET',
    });
  });

  it.each([
    { deployedCommit: 'host-commit' },
    { deployedCommit: 'host-commit', releaseId: 'host-release' },
    { deployedCommit: 'host-commit', apiContractVersion: 'host-contract' },
  ])('keeps independently supplied fingerprint fields: %j', (fields) => {
    const body = {
      schemaVersion: completeFingerprint.schemaVersion,
      status: 'BLOCKED',
      selectedContract: { contractId: 'techpub.parsed-package.v1' },
      ...fields,
    };
    expect(runtimeFingerprintFrom(probeResult(body))).toEqual({
      schemaVersion: completeFingerprint.schemaVersion,
      status: 'BLOCKED',
      ...fields,
    });
  });

  it('does not invent metadata from selectedContract or invalid optional values', () => {
    expect(runtimeFingerprintFrom(probeResult({
      ...completeFingerprint,
      releaseId: 42,
      apiContractVersion: '  ',
      selectedContract: { contractId: 'not-the-api-contract' },
    }))).toEqual({
      schemaVersion: completeFingerprint.schemaVersion,
      status: 'PASS',
      deployedCommit: 'host-commit',
    });
  });

  it.each([
    null,
    [],
    'login HTML',
    { ...completeFingerprint, schemaVersion: 'other-probe' },
    { ...completeFingerprint, status: 'READY' },
    { ...completeFingerprint, deployedCommit: 42 },
    { ...completeFingerprint, deployedCommit: '  ' },
  ])('rejects an invalid fingerprint: %j', (body) => {
    expect(runtimeFingerprintFrom(probeResult(body))).toBeNull();
  });

  it('does not treat an error HTTP body as a successful fingerprint', async () => {
    expect(runtimeFingerprintFrom(probeResult(completeFingerprint, 500))).toBeNull();
    request.mockResolvedValue({ status: 500, data: completeFingerprint });
    await expect(getHostedRuntimeFingerprint()).rejects.toThrow(
      'HOSTED_RUNTIME_FINGERPRINT_UNAVAILABLE',
    );
  });

  it('reads the actual partial Host response without a second request', async () => {
    request.mockResolvedValue({ status: 200, data: {
      schemaVersion: completeFingerprint.schemaVersion,
      status: 'PASS',
      deployedCommit: 'actual-deployed-commit',
      selectedContract: { contractId: 'techpub.parsed-package.v1' },
    } });
    await expect(getHostedRuntimeFingerprint()).resolves.toEqual({
      schemaVersion: completeFingerprint.schemaVersion,
      status: 'PASS',
      deployedCommit: 'actual-deployed-commit',
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ url: '/api/runtime-probe', method: 'GET' });
  });

  it('preserves read failures and rejects invalid successful responses', async () => {
    request.mockRejectedValueOnce(new Error('read unavailable'));
    await expect(getHostedRuntimeFingerprint()).rejects.toThrow('read unavailable');
    request.mockResolvedValueOnce({ status: 200, data: '<html>login</html>' });
    await expect(getHostedRuntimeFingerprint()).rejects.toThrow(
      'HOSTED_RUNTIME_FINGERPRINT_UNAVAILABLE',
    );
  });

  it('renders source, release and API contract from build plus Host readback', async () => {
    const [page, vite] = await Promise.all([
      readFile(
        resolve(
          __dirname,
          '../../client/src/pages/RuntimeProbePage/RuntimeProbePage.tsx',
        ),
        'utf8',
      ),
      readFile(resolve(__dirname, '../../vite.config.ts'), 'utf8'),
    ]);

    expect(page).toContain('frontendSourceCommit');
    expect(page).toContain('releaseId');
    expect(page).toContain('apiContractVersion');
    expect(page).toContain('复制运行指纹');
    expect(vite).toContain('__WISELINK_SOURCE_COMMIT__');
    expect(vite).toContain("visualVersion: 'R10.0-candidate-review'");
  });
});

describe('runtime probe fingerprint page', () => {
  let dom: InstanceType<typeof JSDOM>;
  let container: HTMLElement;
  let root: Root | null;
  const oldGlobals = new Map<string, PropertyDescriptor | undefined>();

  beforeEach(() => {
    request.mockReset();
    root = null;
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'https://example.test/runtime-probe',
    });
    for (const [key, value] of Object.entries({
      window: dom.window,
      document: dom.window.document,
      navigator: dom.window.navigator,
      HTMLElement: dom.window.HTMLElement,
      IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      oldGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    container = dom.window.document.getElementById('root');
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    dom.window.close();
    for (const [key, descriptor] of oldGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    oldGlobals.clear();
  });

  async function mount(): Promise<void> {
    root = createRoot(container);
    await act(async () => root?.render(createElement(RuntimeProbePage)));
  }

  function displayed(label: string): string | null | undefined {
    const item = Array.from(container.querySelectorAll('dl > div')).find(
      (element) => element.querySelector('dt')?.textContent === label,
    );
    return item?.querySelector('dd')?.textContent;
  }

  function respond(body: unknown): void {
    request.mockResolvedValueOnce({ status: 200, data: body });
    request.mockResolvedValueOnce({ status: 200, data: { status: 'VERIFICATION_PENDING' } });
  }

  it('displays complete metadata from the Host without replacing it with frontend values', async () => {
    respond(completeFingerprint);
    await mount();
    expect(displayed('浏览器源码提交')).toBe('frontend-commit');
    expect(displayed('Host 部署提交')).toBe('host-commit');
    expect(displayed('妙搭 Release')).toBe('host-release');
    expect(displayed('API 合同')).toBe('host-contract');
  });

  it('shows and copies the known commit while missing metadata remains unknown', async () => {
    respond({
      schemaVersion: completeFingerprint.schemaVersion,
      status: 'PASS',
      deployedCommit: 'actual-deployed-commit',
      selectedContract: { contractId: 'not-the-api-contract' },
    });
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(dom.window.navigator, 'clipboard', {
      configurable: true, value: { writeText },
    });
    await mount();
    expect(displayed('Host 部署提交')).toBe('actual-deployed-commit');
    expect(displayed('妙搭 Release')).toBe('未知');
    expect(displayed('API 合同')).toBe('未知');
    await act(async () => container.querySelector('button')?.click());
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('deployedCommit: actual-deployed-commit'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('releaseId: 未知'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('apiContractVersion: 未知'));
    expect(container.textContent).toContain('已复制运行指纹');
    expect(request.mock.calls).toEqual([
      [{ url: '/api/runtime-probe', method: 'GET' }],
      [{ url: '/api/unified-reader/readiness', method: 'GET' }],
    ]);
  });

  it('does not display an invalid fingerprint as a known deployment', async () => {
    respond({ ...completeFingerprint, schemaVersion: 'wrong-schema' });
    await mount();
    expect(displayed('Host 部署提交')).toBe('未知');
    expect(displayed('妙搭 Release')).toBe('未知');
    expect(displayed('API 合同')).toBe('未知');
  });

  it.each(['runtime', 'readiness'])('shows the error when the %s read fails', async (stage) => {
    if (stage === 'readiness') {
      request.mockResolvedValueOnce({ status: 200, data: completeFingerprint });
    }
    request.mockRejectedValueOnce(new Error('read unavailable'));
    await mount();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('连接检查失败');
    expect(displayed('Host 部署提交')).toBe('未知');
    expect(displayed('妙搭 Release')).toBe('未知');
    expect(displayed('API 合同')).toBe('未知');
    expect(request).toHaveBeenCalledTimes(stage === 'readiness' ? 2 : 1);
  });
});
