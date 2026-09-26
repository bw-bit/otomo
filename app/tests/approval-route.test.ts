import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {NextRequest} from 'next/server';
import {openDb,type Db} from '@/lib/db';
import {sessionValue,SESSION_COOKIE} from '@/lib/session';
import {startAuthFlow,createPendingAction} from '@/lib/approval';

let db:Db; let dir:string;
const mocks=vi.hoisted(()=>({getDb:vi.fn(),exchange:vi.fn(),verify:vi.fn(),execute:vi.fn()}));
vi.mock('@/lib/db',async original=>({...await original<object>(),getDb:mocks.getDb}));
vi.mock('@/lib/actions',()=>({executeApprovedAction:mocks.execute}));
vi.mock('@/lib/oidc',async original=>({...await original<object>(),agentOidcConfig:()=>({issuer:'https://sandbox.example',clientId:'test',clientSecret:'test',redirectUri:'https://app.example/api/approval/callback'}),exchangeCode:mocks.exchange,verifyIdToken:mocks.verify,remoteJwks:()=>undefined}));
import {GET} from '@/app/api/approval/callback/route';

beforeEach(async()=>{
 vi.stubEnv('APP_SECRET','route-test-secret');
 dir=await mkdtemp(path.join(tmpdir(),'otomo-route-'));db=await openDb(`file:${dir}/test.db`);mocks.getDb.mockResolvedValue(db);
 mocks.exchange.mockReset().mockResolvedValue('verified-test-token');mocks.verify.mockReset().mockResolvedValue({sub:'owner-sub',authTime:Math.floor(Date.now()/1000)+1});mocks.execute.mockReset().mockResolvedValue({txHash:'0xtest'});
 await db.execute({sql:'INSERT INTO companions (label,full_name,owner,resolver,personality,world_nullifier,agent_sub,created_at) VALUES (?,?,?,?,?,?,?,?)',args:['alice','alice.otomo.eth','0xowner','0xresolver','{}','nullifier','owner-sub',Date.now()]});
});
afterEach(async()=>{db.close();await rm(dir,{recursive:true,force:true});vi.unstubAllEnvs();});
function request(state:string,label?:string){return new NextRequest(`https://app.example/api/approval/callback?state=${encodeURIComponent(state)}&code=test`,{headers:label?{cookie:`${SESSION_COOKIE}=${sessionValue(label)}`}:{}});}
it('missing or another companion session cannot exchange code or consume state',async()=>{
 const action=await createPendingAction(db,{companion:'alice',intent:{type:'private_task',summary:'x'},amountUsdc:0,now:Date.now()});
 const flow=await startAuthFlow(db,{kind:'approve',ref:action.id,now:Date.now()});
 expect((await GET(request(flow.state))).status).toBe(403);
 expect((await GET(request(flow.state,'bob'))).status).toBe(403);
 expect(mocks.exchange).not.toHaveBeenCalled();expect(mocks.execute).not.toHaveBeenCalled();
 expect((await db.execute('SELECT COUNT(*) AS n FROM auth_flows')).rows[0].n).toBe(1);
 expect((await GET(request(flow.state,'alice'))).status).toBe(307);
 expect(mocks.execute).toHaveBeenCalledTimes(1);
 expect((await GET(request(flow.state,'alice'))).status).toBe(403);
 expect(mocks.execute).toHaveBeenCalledTimes(1);
});
it('binding requires the owned session and records approval issuer',async()=>{
 await db.execute("UPDATE companions SET agent_sub=NULL WHERE label='alice'");
 const flow=await startAuthFlow(db,{kind:'bind',ref:'alice',now:Date.now()});
 expect((await GET(request(flow.state,'bob'))).status).toBe(403);
 const response=await GET(request(flow.state,'alice'));
 expect(response.headers.get('location')).toBe('https://app.example/otomo/alice?auth=ok');
 expect((await db.execute("SELECT issuer FROM identity_bindings WHERE label='alice'")).rows[0].issuer).toBe('https://sandbox.example');
});
