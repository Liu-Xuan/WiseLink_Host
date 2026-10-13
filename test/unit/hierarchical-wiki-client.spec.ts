import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { enableHierarchicalWiki, listHierarchicalWiki } from '@client/src/api/hierarchical-wiki';
import { requireCanonicalHostClientAuthentication } from '@client/src/api/canonical-host';

jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({ axiosForBackend: jest.fn() }));
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => 1,
  requireCanonicalHostClientAuthentication: jest.fn(),
}));
const transport = jest.mocked(axiosForBackend);
beforeEach(() => jest.clearAllMocks());

test.each([500, 502, 503])('Wiki HTTP %s shows a server failure without blaming scope or resubmitting', async status => {
  transport.mockRejectedValueOnce({ response: { status, data: { error: { stack: 'private SQL' } } } });
  const input = { fleetFamilyId: 'B787', fleetModelId: null };
  await expect(enableHierarchicalWiki(input)).rejects.toMatchObject({ message: 'Wiki更新失败，请稍后重试。', statusCode: status });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', data: input }));
  expect(requireCanonicalHostClientAuthentication).not.toHaveBeenCalled();
});

test.each([
  [401, '请先登录，再读取Wiki。'],
  [403, 'Wiki或相关材料不可读取，已停止展示。'],
  [404, 'Wiki或相关材料不可读取，已停止展示。'],
  [400, 'Wiki操作未完成，请重新核对范围和材料。'],
])('Wiki HTTP %s retains its existing business/authentication mapping', async (status, message) => {
  transport.mockRejectedValueOnce({ response: { status } });
  await expect(listHierarchicalWiki()).rejects.toMatchObject({ message, statusCode: status });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(requireCanonicalHostClientAuthentication).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
});
