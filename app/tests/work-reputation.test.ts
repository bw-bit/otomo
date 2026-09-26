import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb, type Db } from '@/lib/db';
import { acceptWork, deliverWork, reviewWork, renewWorkReward } from '@/lib/work';
import { reputationSnapshot, recheckPublication } from '@/lib/reputation';
import { createBirthChallenge, consumeBirthChallenge } from '@/lib/birth-challenge';
let db: Db; let dir: string;
beforeEach(async () => {
 dir = await mkdtemp(path.join(tmpdir(),'otomo-work-'));
 db = await openDb(`file:${dir}/test.db`);
 for (const name of ['alice','bob']) await db.execute({sql:'INSERT INTO companions (label,full_name,owner,resolver,personality,world_nullifier,agent_sub,created_at) VALUES (?,?,?,?,?,?,?,?)',args:[name,`${name}.otomo.eth`,`0x${name}`,'0xresolver','{}',name,`sub-${name}`,1]});
 await db.execute({sql:"UPDATE companions SET role='work' WHERE label='bob'",args:[]});
 await db.execute({sql:'INSERT INTO friend_requests VALUES (?,?,?,?,?,?,?)',args:['work1','alice','bob','Translate hello',5,'open',1]});
});
it('personal companions cannot accept outside work', async () => {
 await db.execute({sql:'INSERT INTO friend_requests VALUES (?,?,?,?,?,?,?)',args:['work2','bob','alice','Write a memo',0,'open',1]});
 await expect(acceptWork(db,'work2','alice')).rejects.toThrow('個人の相棒は外部の依頼を受けません');
 await acceptWork(db,'work1','bob');
});
afterEach(async()=> {db.close();await rm(dir,{recursive:true,force:true});});
it('only recipient delivers and requester reviews; reward is queued once',async()=>{
 await expect(acceptWork(db,'work1','alice')).rejects.toThrow();
 await acceptWork(db,'work1','bob');
 const model=vi.fn(async()=> 'こんにちは');
 await deliverWork(db,'work1','bob',model);
 await expect(deliverWork(db,'work1','bob',model)).rejects.toThrow();
 expect(model).toHaveBeenCalledTimes(1);
 await expect(reviewWork(db,'work1','bob')).rejects.toThrow();
 const outcomes=await Promise.allSettled([reviewWork(db,'work1','alice'),reviewWork(db,'work1','alice')]);
 expect(outcomes.filter(x=>x.status==='fulfilled')).toHaveLength(1);
 expect((await db.execute('SELECT COUNT(*) AS n FROM pending_actions')).rows[0].n).toBe(1);
 const before=await reputationSnapshot(db,'bob');
 expect(before).toMatchObject({delivered:1,reviewed:1,paid:0});
 await db.execute("UPDATE pending_actions SET status='executed',reason=NULL,tx_hash='0xreceipt'");
 expect(await reputationSnapshot(db,'bob')).toMatchObject({delivered:1,reviewed:1,paid:1});
 expect(JSON.stringify(before)).not.toMatch(/sub-bob|world_nullifier|wallet_cipher|sybil_score/);
});
it('model failure leaves request retryable with no delivery or payment',async()=>{
 await acceptWork(db,'work1','bob');
 await expect(deliverWork(db,'work1','bob',async()=>{throw Error('offline')})).rejects.toThrow();
 expect((await db.execute("SELECT status FROM friend_requests WHERE id='work1'")).rows[0].status).toBe('accepted');
 expect((await db.execute('SELECT COUNT(*) AS n FROM work_deliveries')).rows[0].n).toBe(0);
});
it('renews only expired unpaid rewards, without duplicating or replaying payment', async()=>{
 await acceptWork(db,'work1','bob'); await deliverWork(db,'work1','bob',async()=> 'done');
 const id=await reviewWork(db,'work1','alice',1000);
 await expect(renewWorkReward(db,'work1','bob',302000)).rejects.toThrow();
 await expect(renewWorkReward(db,'work1','alice',2000)).rejects.toThrow();
 expect(await renewWorkReward(db,'work1','alice',302000)).toBe(id);
 expect((await db.execute('SELECT COUNT(*) AS n FROM pending_actions')).rows[0].n).toBe(1);
 await db.execute("UPDATE pending_actions SET status='executed',reason=NULL,tx_hash='0xreceipt'");
 await expect(renewWorkReward(db,'work1','alice',999000)).rejects.toThrow();
});
it('birth challenges expire and cannot be replayed across database connections',async()=>{
 const a=await createBirthChallenge(db,1000);
 const other=await openDb(`file:${dir}/test.db`);
 try {expect(await consumeBirthChallenge(other,a.id,1001)).toBe(a.signal);expect(await consumeBirthChallenge(db,a.id,1002)).toBeNull();}
 finally{other.close();}
 const expired=await createBirthChallenge(db,1000);
 expect(await consumeBirthChallenge(db,expired.id,601001)).toBeNull();
});
it('unreviewed and failed payments never count as paid work',async()=>{
 await acceptWork(db,'work1','bob');await deliverWork(db,'work1','bob',async()=> 'done');
 expect(await reputationSnapshot(db,'bob')).toMatchObject({delivered:1,reviewed:0,paid:0});
 await reviewWork(db,'work1','alice');
 await db.execute("UPDATE pending_actions SET status='executed',reason='executing'");
 expect((await reputationSnapshot(db,'bob')).paid).toBe(0);
});

it('ENS recheck recovers read failures without publishing another transaction', async()=>{
 await db.execute({sql:'INSERT INTO reputation_publications VALUES (?,?,?,?,?,?)',args:['bob','snapshot','0xtx','unverified',1,'read failed']});
 const read=vi.fn(async()=> 'snapshot');
 expect(await recheckPublication(db,'bob',read)).toMatchObject({status:'verified',tx_hash:'0xtx',published_at:1,error:null});
 expect(read).toHaveBeenCalledWith('bob.otomo.eth','otomo.reputation');
 expect(await recheckPublication(db,'bob',async()=>{throw Error('RPC down')})).toMatchObject({status:'unverified',tx_hash:'0xtx'});
 expect(await recheckPublication(db,'bob',async()=> 'different')).toMatchObject({status:'unverified'});
});
it('a delayed recheck cannot change a newer publication', async()=>{
 await db.execute({sql:'INSERT INTO reputation_publications VALUES (?,?,?,?,?,?)',args:['bob','old','0xold','unverified',1,null]});
 const result=await recheckPublication(db,'bob',async()=>{
  await db.execute("UPDATE reputation_publications SET snapshot='new',tx_hash='0xnew',status='unverified' WHERE label='bob'");
  return 'old';
 });
 expect(result).toMatchObject({snapshot:'new',tx_hash:'0xnew',status:'unverified'});
});

it('expired work can be retried and stale workers cannot overwrite the new delivery', async()=>{
 await acceptWork(db,'work1','bob');
 let release!: (value:string)=>void;
 let started!: ()=>void;
 const ready=new Promise<void>(resolve=>{started=resolve});
 const first=deliverWork(db,'work1','bob',async()=>{started();return new Promise<string>(resolve=>{release=resolve});},1000);
 const stale=expect(first).rejects.toThrow('古い結果');
 await ready;
 await expect(deliverWork(db,'work1','bob',async()=> 'too soon',1001)).rejects.toThrow();
 await deliverWork(db,'work1','bob',async()=> 'new delivery',301001);
 release('stale delivery');
 await stale;
 expect((await db.execute("SELECT content FROM work_deliveries WHERE request_id='work1'")).rows[0].content).toBe('new delivery');
 expect((await db.execute("SELECT status FROM friend_requests WHERE id='work1'")).rows[0].status).toBe('delivered');
});
