import { it, expect, vi, afterEach } from 'vitest';
vi.mock('server-only',()=>({}));
import { createCompanionWallet, companionWallet } from '@/lib/companion-wallet';
import { sessionValue, readSession } from '@/lib/session';
import { openDb } from '@/lib/db';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();});
it('sessions expire and reject tampering and legacy indefinite tokens',()=>{
 vi.stubEnv('APP_SECRET','unit-test-secret');vi.useFakeTimers();vi.setSystemTime(1000);
 const token=sessionValue('alice');expect(readSession(token)).toBe('alice');
 expect(readSession(token.replace('alice','bob'))).toBeNull();
 expect(readSession('alice.old')).toBeNull();
 vi.setSystemTime(86401001);expect(readSession(token)).toBeNull();
});
it('wallets are distinct and ciphertext is bound to the companion and encryption key',async()=>{
 vi.stubEnv('COMPANION_WALLET_KEY','11'.repeat(32));vi.stubEnv('SEPOLIA_RPC_URL','http://127.0.0.1:1');
 const alice=createCompanionWallet('alice'),bob=createCompanionWallet('bob');
 expect(alice.address).not.toBe(bob.address);
 const dir=await mkdtemp(path.join(tmpdir(),'otomo-wallet-'));const db=await openDb(`file:${dir}/db`);
 try{
  for(const [name,w] of [['alice',alice],['bob',bob]] as const){
   await db.execute({sql:'INSERT INTO companions VALUES (?,?,?,?,?,?,?,?)',args:[name,`${name}.otomo.eth`,w.address,'','{}',name,null,1]});
   await db.execute({sql:'INSERT INTO companion_identity VALUES (?,?,?,?,?)',args:[name,w.ciphertext,null,'sandbox',1]});
  }
  expect((await companionWallet(db,'alice')).account.address).toBe(alice.address);
  await db.execute({sql:'UPDATE companion_identity SET wallet_cipher=? WHERE label=?',args:[alice.ciphertext,'bob']});
  await expect(companionWallet(db,'bob')).rejects.toThrow();
  vi.stubEnv('COMPANION_WALLET_KEY','22'.repeat(32));await expect(companionWallet(db,'alice')).rejects.toThrow();
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});
