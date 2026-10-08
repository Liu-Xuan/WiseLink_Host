import { getCanonicalLibraryGraph, getCanonicalHostClientSessionGeneration, invalidateCanonicalHostClientSession, isCanonicalHostClientSessionAuthenticationRequired } from '@client/src/api/canonical-host';
const mockRequest=jest.fn();
jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend',() => ({axiosForBackend:(input:unknown) => mockRequest(input)}));
jest.mock('@lark-apaas/client-toolkit/logger',() => ({logger:{error:jest.fn()}}));
jest.mock('@lark-apaas/client-toolkit/utils/resolveAppUrl',() => ({resolveAppUrl:(url:string) => url}));
beforeEach(() => {mockRequest.mockReset();invalidateCanonicalHostClientSession();});
it('uses the existing read-only Host boundary and explicitly serializes missing classification',async () => {
  const signal=new AbortController().signal;const data={level:'families'};
  mockRequest.mockResolvedValueOnce({status:200,data});
  expect(await getCanonicalLibraryGraph({level:'families',groupBy:'ata',clusterValue:null,limit:50},signal)).toBe(data);
  expect(mockRequest).toHaveBeenCalledWith({method:'GET',url:'/api/canonical-host/library/graph',signal,params:{level:'families',groupBy:'ata',clusterMissing:'true',limit:50}});
});
it('preserves an exact literal empty classification and fresh selected-family request',async () => {
  mockRequest.mockResolvedValue({status:200,data:{}});
  await getCanonicalLibraryGraph({level:'families',groupBy:'ata',clusterValue:'',limit:50});
  expect(mockRequest.mock.calls[0][0].params).toEqual({level:'families',groupBy:'ata',clusterValue:'',limit:50});
  await getCanonicalLibraryGraph({level:'versions',familyId:'r3-family',cursor:'scoped',limit:50});
  expect(mockRequest.mock.calls[1][0].params).toEqual({level:'versions',familyId:'r3-family',cursor:'scoped',limit:50});
});
it('retains typed cursor errors for same-scope reset rather than retrying wrong context',async () => {
  mockRequest.mockResolvedValue({status:400,data:{code:'LIBRARY_GRAPH_CURSOR_INVALID'}});
  await expect(getCanonicalLibraryGraph({level:'clusters',groupBy:'ata',cursor:'old'})).rejects.toMatchObject({code:'LIBRARY_GRAPH_CURSOR_INVALID',statusCode:400});
});
it.each([403,404])('denies object data on %s without inventing an empty page',async status => {
  mockRequest.mockResolvedValue({status,data:{secret:'must not return'}});
  await expect(getCanonicalLibraryGraph({level:'versions',familyId:'denied'})).rejects.toMatchObject({code:'CANONICAL_WORK_ITEM_NOT_FOUND',statusCode:404});
});
it('uses the existing global login invalidation after 401',async () => {
  const before=getCanonicalHostClientSessionGeneration();mockRequest.mockResolvedValue({status:401,data:{}});
  await expect(getCanonicalLibraryGraph({level:'clusters',groupBy:'ata'})).rejects.toThrow('LOGIN_REQUIRED');
  expect(getCanonicalHostClientSessionGeneration()).toBe(before+1);expect(isCanonicalHostClientSessionAuthenticationRequired()).toBe(true);
});
