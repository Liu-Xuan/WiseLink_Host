import { readLibraryGraphEntry } from './library-graph-entry';
export interface LibraryGraphReturnSnapshot {query:string;parent?:string;root?:string}
const entries=new Map<string,{session:number;snapshot:LibraryGraphReturnSnapshot;bytes:number;expires:number}>();
const MAX_BYTES=256*1024,TTL=30*60*1000;
let activeSession:number|null=null;
export function activateLibraryGraphReturnSession(session:number,denied:boolean):void {
  if (session !== activeSession || denied) entries.clear(); activeSession=session;
}
export const isLibraryGraphReturnToken=(token:string) => /^lr-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(token);
const validQuery=(query:unknown):query is string => typeof query === 'string' && query.length > 0 && query.length <= 24000
  && readLibraryGraphEntry(new URLSearchParams(query)).kind === 'library';
/** Display navigation only. A token never authorizes an object or skips a Host page read. */
export function saveLibraryGraphReturn(snapshot:LibraryGraphReturnSnapshot,session:number):string|undefined {
  activateLibraryGraphReturnSession(session,false);
  if (!validQuery(snapshot.query) || (snapshot.parent !== undefined && !validQuery(snapshot.parent))
    || (snapshot.root !== undefined && !validQuery(snapshot.root))) return undefined;
  const serialized=JSON.stringify(snapshot),bytes=new TextEncoder().encode(serialized).byteLength;
  if (bytes > MAX_BYTES) return undefined;
  for (const [key,value] of entries) if (value.expires <= Date.now()) entries.delete(key);
  const token=`lr-${globalThis.crypto.randomUUID()}`;
  entries.set(token,{session,snapshot:JSON.parse(serialized),bytes,expires:Date.now()+TTL});
  let total=[...entries.values()].reduce((sum,value) => sum+value.bytes,0);
  while (entries.size > 8 || total > MAX_BYTES) {const key=entries.keys().next().value!;total-=entries.get(key)!.bytes;entries.delete(key);}
  return token;
}
export function readLibraryGraphReturn(token:string,session:number):LibraryGraphReturnSnapshot|null {
  activateLibraryGraphReturnSession(session,false);
  if (!isLibraryGraphReturnToken(token)) return null;
  const entry=entries.get(token);
  if (!entry || entry.session !== session || entry.expires <= Date.now()) {entries.delete(token);return null;}
  entries.delete(token);entries.set(token,entry);
  return JSON.parse(JSON.stringify(entry.snapshot));
}
