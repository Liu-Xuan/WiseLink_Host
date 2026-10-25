import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCodexGateway } from './codex-generation.mjs';

export const modelConfig = maximum => ({ models: { providers: { miaoda: {
  baseUrl: 'https://innerapi.aiforce.cloud/innerapi/api/v1/sgw/model/proxy',
  apiKey: {}, headers: { 'x-api-key': {} },
  models: [{ id: 'glm-5.3', maxTokens: maximum, contextWindow: 200000 }],
} } } });

export function generationInput(requestId, { recoverOnly = false, body = {} } = {}) {
  return { method: 'POST', body: JSON.stringify({ model: 'openclaw/wiselink-engineering',
    messages: [{ role: 'user', content: 'Offline complete materials, no upstream network.' }],
    tools: [{ type: 'function', function: { name: 'return_result', parameters: {
      type: 'object', required: ['workJson'], additionalProperties: false,
      properties: { workJson: { type: 'string', minLength: 2 } },
    } } }], tool_choice: 'auto', parallel_tool_calls: false, n: 1, stream: false, ...body }),
    codexRecovery: { requestId, recoverOnly } };
}

/** Run the real JS gateway, Python runner, and bridge HTTP handler. Only the
 * platform identity, CLI process, listener, and upstream HTTPS connection are
 * synthetic. The saved upstream request is the bridge's exact request bytes. */
export async function offlineGenerationFixture({ maximum = 64000, finish = 'stop' } = {}) {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), 'generation-budget-offline-')));
  const configPath = resolve(root, 'config.json');
  await writeFile(configPath, JSON.stringify(modelConfig(maximum)), { mode: 0o600 });
  const wrapper = resolve(root, 'offline-python');
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  await writeFile(wrapper, `#!/usr/bin/env python3
import io,json,pathlib,sys,types
sys.path.insert(0,${JSON.stringify(moduleDirectory)})
import run_codex_generation as runner
import miaoda_responses_bridge as bridge
ROOT=pathlib.Path(${JSON.stringify(root)})
FINISH=${JSON.stringify(finish)}
FINAL=json.dumps({'tool_name':'return_result','arguments':{'workJson':'{}'}})
class Socket:
 def settimeout(self,value): pass
class OfflineServer:
 server_port=12345
 def __init__(self,address,handler): self.handler=handler
 def serve_forever(self): pass
 def shutdown(self): pass
 def server_close(self): pass
class Upstream:
 def __init__(self,*args,**options): self.sock=Socket()
 def connect(self): pass
 def request(self,method,path,body,headers):
  with (ROOT/'dispatch-count').open('a') as output: output.write('1\\n')
  payload=json.loads(body)
  assert payload['reasoning_effort']=='max'
 def getresponse(self):
  self.status=200
  output_tokens=5 if FINISH=='stop' else 16384
  event={'model':'glm-5.3','choices':[{'index':0,'delta':{'content':FINAL if FINISH=='stop' else 'Partial'},'finish_reason':FINISH}], 'usage':{'prompt_tokens':169583,'completion_tokens':output_tokens,'total_tokens':169583+output_tokens}}
  self.lines=io.BytesIO(('data: '+json.dumps(event)+'\\n\\ndata: [DONE]\\n\\n').encode())
  return self
 def readline(self,size): return self.lines.readline(size)
 def close(self): pass
bridge.ThreadingHTTPServer=OfflineServer
bridge.http.client.HTTPSConnection=Upstream
bridge.resolve=lambda *args: 'offline-ephemeral-secret'
runner.runner_identity=lambda: {'synthetic':True}
runner.close_process_group=lambda process: (True,False)
original_start=runner.start_server
server_slot=[]
def start(*args,**options):
 result=original_start(*args,**options)
 server_slot[:]=[result[0],result[3]]
 return result
runner.start_server=start
runner.subprocess.run=lambda *args,**options: types.SimpleNamespace(stdout='codex-cli 0.164.0\\n')
class Process:
 def __init__(self,command,**options):
  self.run=pathlib.Path(options['cwd']).parent
  self.final=pathlib.Path(command[command.index('--output-last-message')+1])
  self.returncode=0 if FINISH=='stop' else 1
 def poll(self): return self.returncode
 def communicate(self,prompt,timeout):
  server,token=server_slot
  raw=json.dumps({'model':'glm-5.3','stream':True,'input':[{'role':'user','content':prompt}]}).encode()
  handler=object.__new__(server.handler)
  handler.path='/v1/responses'
  handler.headers={'Authorization':'Bearer '+token,'Content-Length':str(len(raw))}
  handler.connection=Socket(); handler.rfile=io.BytesIO(raw); handler.wfile=io.BytesIO()
  handler.send_response=lambda *args: None
  handler.send_header=lambda *args: None
  handler.end_headers=lambda: None
  handler.do_POST()
  stream=handler.wfile.getvalue().decode()
  assert ('response.completed' if FINISH=='stop' else 'response.failed') in stream
  if FINISH=='stop': self.final.write_text(FINAL)
  return json.dumps({'type':'turn.completed' if FINISH=='stop' else 'turn.failed'})+'\\n',''
runner.subprocess.Popen=Process
try: sys.exit(runner.main())
except ValueError as error:
 print(json.dumps({'transport_passed':False,'failure':str(error)})); sys.exit(1)
`, { mode: 0o700 });
  const options = { codexBinary: '/offline/codex', configPath, runRoot: root,
    pythonBinary: wrapper, timeoutSeconds: 30, reasoningEffort: 'max' };
  return { root, configPath, options,
    gateway: extra => createCodexGateway({ ...options, ...extra }),
    readJson: async (directory, name) => JSON.parse(await readFile(resolve(directory, name), 'utf8')) };
}
