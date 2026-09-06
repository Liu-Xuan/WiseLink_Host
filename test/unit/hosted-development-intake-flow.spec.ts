import {
  beginHostedIntakeSubmission,
  developmentWorkItemRequest,
  endHostedIntakeSubmission,
  hostedIntakeError,
  resolveHostedIntakeSelection,
} from '../../client/src/pages/WorkspaceHomePage/hosted-development-intake-flow';

describe('hosted development intake source flow', () => {
  it('distinguishes PDF identity refusal from login and does not expose an upstream stack', () => {
    const reason = Object.assign(
      new Error(
        'Actual PDF text did not prove the primary publication identity.',
      ),
      {
        code: 'DM_PDF_IDENTITY_UNRESOLVED',
        statusCode: 422,
        stack: 'private upstream stack',
      },
    );
    expect(hostedIntakeError(reason)).toContain('PDF 正文');
    expect(hostedIntakeError(reason)).toContain('DM_PDF_IDENTITY_UNRESOLVED');
    expect(hostedIntakeError(reason)).not.toContain('请先完成飞书授权');
    expect(hostedIntakeError(reason)).not.toContain('private');
  });

  it('explains storage read failure without promising that a candidate exists', () => {
    expect(
      hostedIntakeError(
        Object.assign(new Error('safe message'), {
          code: 'DOCUMENT_STORAGE_BUCKET_READ_FAILED',
          statusCode: 503,
        }),
      ),
    ).toContain('同一请求重试');
    expect(
      hostedIntakeError(
        Object.assign(new Error('safe message'), {
          code: 'DOCUMENT_ACTION_FORBIDDEN',
          statusCode: 403,
        }),
      ),
    ).toContain('不会跳过授权核验');
  });

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
