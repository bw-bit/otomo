import { describe,it,expect } from "vitest";
import { readDisplayIntent,rewardPaid,rewardNeedsRenewal,workStage,type DemoRequest } from "../src/lib/demo-view";
import { intentPlainText } from "../src/lib/plain";
const job:DemoRequest = {id:"job",from_label:"sora",to_label:"taro",task:"intro",reward_usdc:2,status:"done",content:"Delivered",reviewed_at:20,reward_action_id:"action",reward_status:"pending",reward_expires_at:100};
describe("honest demo state",()=>{
 it("does not count review or an unconfirmed transaction as paid",()=>{
  expect(workStage(job)).toBe(3);
  expect(rewardPaid({...job,reward_status:"executed"})).toBe(false);
  expect(rewardPaid({...job,reward_status:"executed",reward_tx_hash:"0xabc",reward_reason:"confirmation_pending"})).toBe(false);
  expect(workStage({...job,reward_status:"executed",reward_tx_hash:"0xabc",reward_reason:null})).toBe(4);
 });
 it("distinguishes expired approvals from paid or still-live work",()=>{
  expect(rewardNeedsRenewal(job,100)).toBe(true);
  expect(rewardNeedsRenewal(job,99)).toBe(false);
  expect(rewardNeedsRenewal({...job,reward_tx_hash:"0xabc"},200)).toBe(false);
  expect(rewardNeedsRenewal({...job,reward_status:"rejected"},99)).toBe(true);
 });
 it("rejects malformed stored intents without crashing or offering approval",()=>{
  for(const raw of ['invalid','null','[]','{"type":"send_usdc"}','{"type":"unknown"}']) expect(readDisplayIntent(raw)).toBeNull();
 });
 it("tells the user the actual Aqua operation rather than a generic approval",()=>{
  const ship=readDisplayIntent('{"type":"strategy_operation","operation":"ship","strategyId":"x"}')!;
  expect(intentPlainText(ship,"en")).toBe("Start this 1inch Aqua strategy?");
  expect(intentPlainText({...ship,operation:"dock"},"ja")).toContain("停止");
  expect(intentPlainText({...ship,operation:"demo_swap"},"en")).toContain("Exchange test tokens");
  expect(intentPlainText({type:"publish_reputation"},"en")).toContain("ENS");
 });
});
