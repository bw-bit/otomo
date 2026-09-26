import { it, expect, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import { createPublicClient, createWalletClient, http, parseUnits, type Address, type Hex } from "viem";
import { foundry } from "viem/chains";
import { openDb } from "@/lib/db";
import { acceptWork, deliverWork, reviewWork } from "@/lib/work";
import { startAuthFlow, handleAuthCallback } from "@/lib/approval";
import { executeApprovedAction } from "@/lib/actions";
import { reputationSnapshot } from "@/lib/reputation";
import { erc20Abi } from "@/lib/ens";
import * as chain from "@/lib/chain";

vi.mock("server-only", () => ({}));

it.skipIf(process.env.RUN_LOCAL_PAYMENT !== "1")("pays a reviewed job once through a real local ERC20 contract", async () => {
  const rpc = process.env.LOCAL_PAYMENT_RPC!;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(rpc)) throw Error("Local Anvil endpoint required");
  const token = process.env.LOCAL_PAYMENT_TOKEN as Address;
  const output = process.env.LOCAL_PAYMENT_OUTPUT!;
  const client = createPublicClient({ chain: foundry, transport: http(rpc) });
  expect(await client.getChainId()).toBe(31337);
  const accounts = await createWalletClient({ chain: foundry, transport: http(rpc) }).getAddresses();
  expect(accounts.length).toBeGreaterThan(8);
  const payer = accounts[7]!, recipient = accounts[8]!;
  const wallet = createWalletClient({ chain: foundry, account: payer, transport: http(rpc) });
  const mint = await wallet.writeContract({ address: token, abi: erc20Abi, functionName: "mint", args: [payer, parseUnits("2", 6)] });
  expect((await client.waitForTransactionReceipt({ hash: mint })).status).toBe("success");
  const balance = (owner: Address) => client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
  const before = { payer: await balance(payer), recipient: await balance(recipient) };
  const db = await openDb("file::memory:");
  const transfer = vi.spyOn(chain, "companionTransferUsdc").mockImplementation(async (companion, to, amount, onSubmitted) => {
    expect(companion.owner.toLowerCase()).toBe(payer.toLowerCase());
    expect(to.toLowerCase()).toBe(recipient.toLowerCase());
    expect(amount).toBe(2);
    const tx = await wallet.writeContract({ address: token, abi: erc20Abi, functionName: "transfer", args: [to, parseUnits(String(amount), 6)] });
    await onSubmitted?.(tx);
    expect((await client.waitForTransactionReceipt({ hash: tx })).status).toBe("success");
    return tx;
  });
  try {
    for (const [name, owner, role] of [["demo-sora", payer, "personal"], ["demo-taro", recipient, "work"]]) await db.execute({ sql: "INSERT INTO companions(label,full_name,owner,resolver,personality,world_nullifier,agent_sub,created_at,role) VALUES(?,?,?,?,?,?,?,?,?)", args: [name,`${name}.otomo.eth`,owner,"0xresolver","{}",name,"local-test-human",Date.now(),role] });
    await db.execute({ sql: "INSERT INTO friend_requests VALUES(?,?,?,?,?,?,?)", args: ["local-job","demo-sora","demo-taro","Write an Otomo introduction",2,"open",Date.now()] });
    await acceptWork(db,"local-job","demo-taro");
    await deliverWork(db,"local-job","demo-taro",async()=>"Otomo companions use ENS names. The human owner reviews work and approves testnet rewards.");
    const id = await reviewWork(db,"local-job","demo-sora");
    const flow = await startAuthFlow(db,{kind:"approve",ref:id!,now:Date.now()});
    const deps = { db, authenticate: async()=>({sub:"local-test-human",authTime:Math.ceil(Date.now()/1000)}), execute: (a: Parameters<typeof executeApprovedAction>[1], c: Parameters<typeof executeApprovedAction>[2])=>executeApprovedAction(db,a,c) };
    const input = {state:flow.state,code:"local-fixture-only",error:null,now:Date.now()};
    const result = await handleAuthCallback(input,deps);
    expect(result.ok).toBe(true);
    expect((await handleAuthCallback(input,deps)).ok).toBe(false);
    expect(transfer).toHaveBeenCalledTimes(1);
    const after = {payer:await balance(payer),recipient:await balance(recipient)};
    expect(before.payer-after.payer).toBe(parseUnits("2",6));
    expect(after.recipient-before.recipient).toBe(parseUnits("2",6));
    const reputation = await reputationSnapshot(db,"demo-taro");
    expect(reputation).toMatchObject({delivered:1,reviewed:1,paid:1});
    const action = (await db.execute({sql:"SELECT status,reason,tx_hash FROM pending_actions WHERE id=?",args:[id!]})).rows[0];
    const receipt = await client.getTransactionReceipt({hash:String(action.tx_hash) as Hex});
    await writeFile(output,JSON.stringify({passed:true,scope:"Local Anvil real ERC20 transfer; fixture identity and local signing adapter; no production funds or sessions",chainId:31337,token,amountMusdc:2,before,after,action,receipt:{status:receipt.status,blockNumber:receipt.blockNumber},replayRejected:true,reputation},(_,v)=>typeof v==="bigint"?v.toString():v,2));
  } finally {transfer.mockRestore();db.close();}
},60_000);
