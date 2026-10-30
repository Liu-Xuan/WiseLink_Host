import { types } from 'node:util';
import {
  createAilyChat,
  serializeAilyChatRequest,
  readAilyChatResult,
  observeAilyChat,
  streamAilyChat,
} from '../../server/modules/canonical-host/aily-chat-client';

describe('Host Aily transport', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  const request = {
    agentId: 'agent_test',
    accessToken: 'test-secret',
    message: '解释假设',
    remoteSessionId: 'remote-1',
  };

  it('observes exact enterprise state for a full long answer while preserving the private-chat display limit',async()=>{
    const body={code:0,data:{agent_chat_id:'1234',session_id:'remote-1',status:'Completed',content:[{type:'text',text:'完整工程正文'.repeat(20000)}]}};
    globalThis.fetch=jest.fn().mockImplementation(async()=>Response.json(body));
    await expect(observeAilyChat({...request,chatId:'1234'})).resolves.toMatchObject({chatId:'1234',remoteStatus:'Completed'});
    await expect(readAilyChatResult({...request,chatId:'1234'})).rejects.toThrow('AILY_RESULT_TOO_LARGE');
    expect((globalThis.fetch as jest.Mock).mock.calls.every(call=>call[1].method==='GET')).toBe(true);
  });

  it('does not infer a platform state from a response exceeding the original HTTP byte boundary',async()=>{
    globalThis.fetch=jest.fn().mockResolvedValue(Response.json({code:0,data:{agent_chat_id:'1234',session_id:'remote-1',
      status:'Completed',answer:'large'.repeat(500000)}}));
    await expect(observeAilyChat({...request,chatId:'1234'})).rejects.toThrow();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect((globalThis.fetch as jest.Mock).mock.calls[0][1].method).toBe('GET');
  });

  async function getFailure(response:Response,chatId='1'.repeat(19)):Promise<Error> {
    globalThis.fetch=jest.fn().mockResolvedValue(response);
    try {await observeAilyChat({...request,chatId});throw new Error('SYNTHETIC_GET_REJECTION_REQUIRED');}
    catch(cause) {
      if(!types.isNativeError(cause))throw cause;
      expect(cause.message).not.toBe('SYNTHETIC_GET_REJECTION_REQUIRED');
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const [url,init]=(globalThis.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe(`https://open.feishu.cn/open-apis/aily/v1/agents/agent_test/chats/${chatId}`);
      expect(init).toMatchObject({method:'GET',redirect:'error',headers:{authorization:`Bearer ${request.accessToken}`}});
      expect(new URL(url).search).toBe('');
      return cause;
    }
  }
  function numericMetadata(error:Error) {
    return {status:Object.getOwnPropertyDescriptor(error,'status')?.value,
      code:Object.getOwnPropertyDescriptor(error,'code')?.value};
  }

  it('keeps the actual HTTP and numeric platform code from a bounded original GET rejection',async()=>{
    const marker='SYNTHETIC_PRIVATE_TOKEN_AND_BODY';
    const error=await getFailure(Response.json({code:2700001,msg:marker,data:{token:marker,answer:marker}},{status:400}));
    expect(error.message).toBe('AILY_HTTP_400');expect(numericMetadata(error)).toEqual({status:400,code:2700001});
    expect(JSON.stringify(error)).toBe(JSON.stringify({status:400,code:2700001}));
    expect(String(error)).not.toContain(marker);
    for(const field of ['body','response','cause','token','msg'])expect(Object.hasOwn(error,field)).toBe(false);
  });

  it.each([
    {name:'non-JSON sensitive body',response:()=>new Response('SYNTHETIC_PRIVATE_BODY https://synthetic.invalid/?token=SYNTHETIC_SECRET',{status:400})},
    {name:'over-boundary body',response:()=>new Response('SYNTHETIC_PRIVATE_BODY'.repeat(100001),{status:400})},
    {name:'invalid UTF-8',response:()=>new Response(new Uint8Array([0xc3,0x28]),{status:400})},
    {name:'missing body',response:()=>new Response(null,{status:400})},
    {name:'failed body stream',response:()=>new Response(new ReadableStream<Uint8Array>({start(controller){
      controller.error(new Error('SYNTHETIC_PRIVATE_BODY_STREAM'));}}),{status:400})},
  ])('retains HTTP 400 when the $name cannot supply a verified platform code',async test=>{
    const error=await getFailure(test.response());
    expect(error.message).toBe('AILY_HTTP_400');expect(numericMetadata(error)).toEqual({status:400,code:null});
    expect(JSON.stringify(error)).toBe(JSON.stringify({status:400,code:null}));
    expect(String(error)).not.toContain('SYNTHETIC_PRIVATE');
  });

  it.each(['2700001',2700001.5,Number.MAX_SAFE_INTEGER+1,-1,null,true])(
    'never coerces an unverified platform code %s from an HTTP rejection',async code=>{
      const error=await getFailure(Response.json({code,msg:'SYNTHETIC_PRIVATE_BODY'},{status:400}));
      expect(error.message).toBe('AILY_HTTP_400');expect(numericMetadata(error)).toEqual({status:400,code:null});
    });

  it('keeps HTTP 200 nonzero platform code rejected with the original message and own numeric fields',async()=>{
    const error=await getFailure(Response.json({code:2700002,msg:'SYNTHETIC_PRIVATE_BODY',data:{status:'Completed'}}));
    expect(error.message).toBe('AILY_RESULT_REJECTED');expect(numericMetadata(error)).toEqual({status:200,code:2700002});
    expect(JSON.stringify(error)).toBe(JSON.stringify({status:200,code:2700002}));
  });

  it.each([
    {name:'invalid JSON',response:()=>new Response('SYNTHETIC_PRIVATE_BODY'),message:'AILY_RESULT_INVALID'},
    {name:'oversized body',response:()=>new Response('x'.repeat(2_000_001)),message:'AILY_RESULT_TOO_LARGE'},
  ])('preserves the existing HTTP 200 $name error while retaining its known status',async test=>{
    const error=await getFailure(test.response());
    expect(error.message).toBe(test.message);expect(numericMetadata(error)).toEqual({status:200,code:null});
  });

  it('keeps the original successful-response decoder error message with numeric status only',async()=>{
    const bytes=new Uint8Array([0xc3,0x28]);let expected:Error|undefined;
    try {new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch(cause){if(types.isNativeError(cause))expected=cause;else throw cause;}
    expect(expected).toBeDefined();const error=await getFailure(new Response(bytes));
    expect(error.message).toBe(expected!.message);expect(types.isNativeError(error)).toBe(true);
    expect(Object.getPrototypeOf(error)).toBe(Object.getPrototypeOf(expected));
    expect(numericMetadata(error)).toEqual({status:200,code:null});
  });

  it('observes the exact synthetic 19-digit original chat with its unchanged caller and no replacement POST',async()=>{
    const chatId='1'.repeat(19);
    globalThis.fetch=jest.fn().mockResolvedValue(Response.json({code:0,data:{agent_chat_id:chatId,
      session_id:request.remoteSessionId,status:'Running',content:[{type:'text',text:'SYNTHETIC_PRIVATE_BODY'}]}}));
    expect(await observeAilyChat({...request,chatId})).toEqual({chatId,remoteStatus:'Running'});
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(`https://open.feishu.cn/open-apis/aily/v1/agents/agent_test/chats/${chatId}`,
      expect.objectContaining({method:'GET',redirect:'error',headers:{authorization:`Bearer ${request.accessToken}`,accept:'application/json'}}));
  });

  it.each([
    {fields:{agent_chat_id:'2'.repeat(19)},message:'AILY_RESULT_CHAT_MISMATCH'},
    {fields:{session_id:'synthetic-other-session'},message:'AILY_RESULT_SESSION_MISMATCH'},
  ])('retains exact original-pair refusal $message after platform success',async test=>{
    const chatId='1'.repeat(19);
    const error=await getFailure(Response.json({code:0,data:{agent_chat_id:chatId,session_id:request.remoteSessionId,
      status:'Completed',...test.fields}}),chatId);
    expect(error.message).toBe(test.message);expect(numericMetadata(error)).toEqual({status:200,code:0});
  });

  it('sends the exact persisted full task once with stream false and no model or lease fields', async () => {
    const full = {...request, message: `完整安全任务${'完整原文'.repeat(16000)}`};
    const expectedRequestBody = serializeAilyChatRequest(full);
    globalThis.fetch = jest.fn().mockResolvedValue(Response.json({code: 0,
      data: {agent_chat_id: '9'.repeat(64), session_id: request.remoteSessionId}}));
    await expect(createAilyChat({...full, expectedRequestBody})).resolves.toEqual({chatId: '9'.repeat(64), remoteSessionId: request.remoteSessionId});
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(init.body).toBe(expectedRequestBody);
    expect(JSON.parse(init.body)).toEqual({user_message: {content: [{type: 'text', text: full.message}]},
      stream: false, session_id: request.remoteSessionId});
    expect(init.redirect).toBe('error');
  });

  it('rejects changed original POST bytes before sending and never retries a missing chat receipt', async () => {
    globalThis.fetch = jest.fn();
    await expect(createAilyChat({...request, expectedRequestBody: '{}'})).rejects.toThrow('AILY_DISPATCH_BODY_CHANGED');
    expect(globalThis.fetch).not.toHaveBeenCalled();
    (globalThis.fetch as jest.Mock).mockResolvedValue(Response.json({code: 0, data: {session_id: 'remote-1'}}));
    await expect(createAilyChat(request)).rejects.toThrow('AILY_CHAT_RECEIPT_INVALID');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('passes the Host remote session and public text directly without an analysis attempt', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(
          'event: start\ndata: {"agent_chat_id":"123","session_id":"remote-1"}\n\n' +
            'event: message_delta\ndata: {"agent_chat_id":"123","delta":{"type":"content","text":"解释"}}\n\n' +
            'event: done\ndata: {"agent_chat_id":"123","status":"Completed"}\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      );
    const progress = jest.fn().mockResolvedValue(undefined);
    expect(await streamAilyChat(request, progress)).toMatchObject({
      remoteSessionId: 'remote-1',
      answer: '解释',
      status: 'COMPLETED',
    });
    expect(progress.mock.calls[0][0]).toMatchObject({
      chatId: '123',
      remoteSessionId: 'remote-1',
      answer: '',
    });
    const [, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      user_message: { content: [{ type: 'text', text: '解释假设' }] },
      stream: true,
      session_id: 'remote-1',
    });
    expect(init.redirect).toBe('error');
    expect(init.body).not.toContain('test-secret');
  });

  it('reads a snapshot from exactly the saved remote chat and ignores reasoning/artifacts', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      Response.json({
        code: 0,
        data: {
          status: 'SomeUnverifiedPlatformState',
          content: [
            { type: 'text', text: '原片段完整回答' },
            { type: 'reasoning', text: 'private' },
            { type: 'artifact', agent_artifact_id: 'artifact' },
          ],
        },
      }),
    );
    expect(await readAilyChatResult({ ...request, chatId: '123' })).toEqual({
      chatId: '123',
      answer: '原片段完整回答',
      remoteStatus: 'SomeUnverifiedPlatformState',
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://open.feishu.cn/open-apis/aily/v1/agents/agent_test/chats/123',
      expect.objectContaining({ method: 'GET', redirect: 'error' }),
    );
  });

  it.each([401, 403, 429, 500])(
    'does not retry HTTP %s or create a replacement generation',
    async (status) => {
      globalThis.fetch = jest
        .fn()
        .mockResolvedValue(new Response('', { status }));
      await expect(
        readAilyChatResult({ ...request, chatId: '123' }),
      ).rejects.toThrow(`AILY_HTTP_${status}`);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [{ code: 1, msg: 'private upstream details' }, 'AILY_RESULT_REJECTED'],
    [
      { code: 0, data: { status: 'Completed', content: [{ type: 'text' }] } },
      'AILY_RESULT_INVALID',
    ],
    [
      {
        code: 0,
        data: {
          status: 'Completed',
          content: [{ type: 'text', text: 'x'.repeat(60001) }],
        },
      },
      'AILY_RESULT_TOO_LARGE',
    ],
  ])(
    'rejects malformed or denied results without leaking remote diagnostics',
    async (body, error) => {
      globalThis.fetch = jest.fn().mockResolvedValue(Response.json(body));
      await expect(
        readAilyChatResult({ ...request, chatId: '123' }),
      ).rejects.toThrow(error);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects invalid path bindings before sending credentials', async () => {
    globalThis.fetch = jest.fn();
    await expect(
      readAilyChatResult({ ...request, chatId: '../other' }),
    ).rejects.toThrow('AILY_CHAT_INVALID');
    await expect(
      streamAilyChat(
        { ...request, agentId: '../other' },
        async () => undefined,
      ),
    ).rejects.toThrow('AILY_AGENT_INVALID');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects an oversized wire response even when the excess is non-public content', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      Response.json({
        code: 0,
        data: {
          status: 'Completed',
          content: [{ type: 'reasoning', text: 'x'.repeat(2_000_001) }],
        },
      }),
    );
    await expect(
      readAilyChatResult({ ...request, chatId: '123' }),
    ).rejects.toThrow('AILY_RESULT_TOO_LARGE');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not accept a stream returning a different remote session', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(
          'event: start\ndata: {"agent_chat_id":"123","session_id":"other-session"}\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      );
    const progress = jest.fn();
    await expect(streamAilyChat(request, progress)).rejects.toThrow(
      'AILY_STREAM_SESSION_MISMATCH',
    );
    expect(progress).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves the remote finish reason without turning a cancelled result into success', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      Response.json({
        code: 0,
        data: {
          status: 'Cancelled',
          finish_reason: 'stop',
          content: [{ type: 'text', text: '部分公开文本' }],
        },
      }),
    );
    expect(await readAilyChatResult({ ...request, chatId: '123' })).toEqual({
      chatId: '123',
      answer: '部分公开文本',
      remoteStatus: 'Cancelled',
      remoteFinishReason: 'stop',
    });
  });

  it('distinguishes an HTTP 200 application rejection from an interrupted generation', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(
        Response.json({ code: 2700001, msg: 'private diagnostic' }),
      );
    await expect(
      streamAilyChat(request, async () => undefined),
    ).rejects.toThrow('AILY_API_REJECTED_2700001');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([3, 31, 64])('retains a %s-digit asynchronous receipt without pretending completion', async (length) => {
    const chatId = '1'.repeat(length);
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(
        Response.json({
          code: 0,
          data: { agent_chat_id: chatId, session_id: 'remote-1' },
        }),
      );
    const progress = jest.fn().mockResolvedValue(undefined);
    await expect(streamAilyChat(request, progress)).rejects.toThrow(
      'AILY_STREAM_RESULT_UNCONFIRMED',
    );
    expect(progress).toHaveBeenCalledWith({
      chatId,
      remoteSessionId: 'remote-1',
      answer: '',
      status: 'RUNNING',
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([19, 31, 64])('reads an exact %s-digit original chat without truncating its ID', async (length) => {
    const chatId = '1'.repeat(length);
    globalThis.fetch = jest.fn().mockResolvedValue(Response.json({
      code: 0,
      data: { agent_chat_id: chatId, session_id: request.remoteSessionId,
        status: 'Completed', content: [{ type: 'text', text: '完整快照' }] },
    }));
    expect(await readAilyChatResult({ ...request, chatId })).toMatchObject({ chatId, answer: '完整快照' });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `https://open.feishu.cn/open-apis/aily/v1/agents/agent_test/chats/${chatId}`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it.each(['', '1'.repeat(65), '123/456', '123-other'])('rejects an invalid decimal chat ID before GET: %s', async (chatId) => {
    globalThis.fetch = jest.fn();
    await expect(readAilyChatResult({ ...request, chatId })).rejects.toThrow('AILY_CHAT_INVALID');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    [{ agent_chat_id: '456' }, 'AILY_RESULT_CHAT_MISMATCH'],
    [{ session_id: 'other-session' }, 'AILY_RESULT_SESSION_MISMATCH'],
  ])('rejects an echoed binding outside the original chat/session', async (binding, error) => {
    globalThis.fetch = jest.fn().mockResolvedValue(Response.json({
      code: 0,
      data: { ...binding, status: 'Completed', content: [{ type: 'text', text: 'wrong chat' }] },
    }));
    await expect(readAilyChatResult({ ...request, chatId: '123' })).rejects.toThrow(error);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
