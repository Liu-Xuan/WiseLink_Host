import {
  beginHostedIntakeSubmission,
  developmentWorkItemRequest,
  endHostedIntakeSubmission,
  resolveHostedIntakeSelection,
} from '../../client/src/pages/WorkspaceHomePage/hosted-development-intake-flow';

describe('hosted development intake source flow', () => {
  it('submits an existing object selection without uploading bytes', async () => {
    const upload = jest.fn();
    const existing = {
      bucketId: 'opaque-bucket-for-request-only',
      filePath: 'private/path/manual.pdf',
      developmentRunToken: 'stable-action-token',
    };

    const resolved = await resolveHostedIntakeSelection(
      { kind: 'existing', selection: existing },
      { createToken: () => 'unused-token', upload },
    );
    const request = developmentWorkItemRequest(resolved.selection);

    expect(upload).not.toHaveBeenCalled();
    expect(resolved.localFile).toBeNull();
    expect(request).toEqual({
      selection: {
        bucketId: 'opaque-bucket-for-request-only',
        filePath: 'private/path/manual.pdf',
      },
      developmentRunToken: 'stable-action-token',
      query: 'applicability',
    });
    expect(Object.keys(request).sort()).toEqual([
      'developmentRunToken',
      'query',
      'selection',
    ]);
  });

  it('uploads a local file once and reuses the stable prepared selection', async () => {
    const file = { name: 'manual.pdf', size: 128 };
    const upload = jest.fn(async () => ({
      bucketId: 'uploaded-bucket',
      filePath: 'uploaded/path/manual.pdf',
    }));
    const tokens = ['upload-id', 'development-run-id'];
    const createToken = jest.fn(() => tokens.shift() ?? 'unexpected-token');

    const first = await resolveHostedIntakeSelection(
      { kind: 'local', file, cachedUpload: null },
      { createToken, upload },
    );
    const retried = await resolveHostedIntakeSelection(
      { kind: 'local', file, cachedUpload: first.selection },
      { createToken, upload },
    );

    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith(file, 'upload-id');
    expect(first.selection.developmentRunToken).toBe('development-run-id');
    expect(retried.selection).toEqual(first.selection);
    expect(createToken).toHaveBeenCalledTimes(2);
  });

  it('rejects a repeated click until the current submission settles', () => {
    const gate = { current: false };

    expect(beginHostedIntakeSubmission(gate)).toBe(true);
    expect(beginHostedIntakeSubmission(gate)).toBe(false);
    endHostedIntakeSubmission(gate);
    expect(beginHostedIntakeSubmission(gate)).toBe(true);
  });
});
