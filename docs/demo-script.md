# Otomo — English demo script (about 3 minutes)

Recording and a continuous rehearsal are not yet complete. Use the updated live application: https://otomo-world-id.vercel.app/. These are observed results; do not describe the Sandbox as real human verification.

| Time | Screen/action | Narration |
| --- | --- | --- |
| 0:00–0:20 | Companion room, with the Sepolia and Sandbox labels visible | “Otomo gives an AI companion a human partner, an ENS name and its own testnet wallet. World ID handles birth, ENS identifies the companion, and 1inch Aqua plus SwapVM enables token exchange.” |
| 0:20–0:45 | Show sora; switch to taro using the name buttons | “sora is my personal companion. taro takes small writing jobs. The first birth completed in the real World App; additional companions use the authenticated household session. That birth check is separate from the approvals in this demo, which use Sandbox identities.” |
| 0:45–1:25 | Work → paid job → View delivery & receipt | “sora requested a short introduction. taro accepted and delivered it. I reviewed the text, then approved the two mUSDC reward separately. The receipt shows the transfer from sora's wallet to taro's wallet on Sepolia. These are test tokens.” |
| 1:25–2:10 | 1inch Aqua → wallet → stopped strategy → ship/dock receipts | “This strategy used ten mUSDC and 0.005 mWETH. At setup, the tokens stayed in sora's wallet. A separate demo agent supplied 0.01 mWETH and received 6.659986 mUSDC in the swap. SwapVM applies a 0.3% input fee. The initial 2,000-to-one ratio is only a demo setting. We stopped the strategy, and its virtual balances are now zero.” |
| 2:10–2:35 | Evidence & profile, then taro's worker counts | “Each companion owns an ENSv2 name and resolver records. Worker delivery, review and reward counts come from Otomo's recorded activity. They are not a World-issued credit score. sora requested the job; taro earned the delivery record.” |
| 2:35–3:00 | Keep the approval environment visible; show failure evidence | “The backend validates approvals and binds each one to the action and expiry. The Sandbox protects this testnet flow. Production Session-proof approval is implemented but not working on the tested World App: it returned world_id_4_not_available and no human session was accepted. We show that limitation explicitly.” |

## Evidence to open

- [sora ENS registration](https://sepolia.etherscan.io/tx/0xc79ab334111faad4ef0d46561372f2c63ecca99e0d159fd0c7f4bf58c060d926)
- [Reward payment](https://sepolia.etherscan.io/tx/0x665e2ba50bd08a3c23c73ce8acfdc55d5fe7e291a447d0f19cf01890141a5279)
- [Aqua ship](https://sepolia.etherscan.io/tx/0xfdf6a1a210bbe96dec32c1f86ee5aebee1104c2610bdcb83400a9888fa19cb73)
- [Aqua swap: actual token transfers](https://sepolia.etherscan.io/tx/0x90fd7ab3e00d650f05a4b3b43faf43816c7b22d51d9266b93c50cda4725b22af)
- [Aqua dock](https://sepolia.etherscan.io/tx/0x45235c721d1158e96c8e32e9ddb121b4e35b6dd98d321f7d8472e3299cf1db9a)
- [sora ENS reputation publication](https://sepolia.etherscan.io/tx/0x7b224d66805a00f3bbaf5fe384df18c147e6e6df8804d227543ed40dee9ac310)
- Machine-readable read-only recheck: [sepolia-demo.json](evidence/sepolia-demo.json).

The initial introduction delivered only English. The “small job” prompt now requests English and Japanese, but that revised bilingual job has not been executed. Do not present the old delivery as bilingual.

## Still to demonstrate

World ID for Agents denial/cancellation in the live browser, with no protected execution, and a continuous narrated rehearsal. Unit tests cover failure paths but do not replace that live demonstration. Live microphone conversation has not been reverified in this UI pass.

The [official video rules](https://ethglobal.com/events/tokyo2026/info/details) describe the video as optional, 2–4 minutes and at least 720p if uploaded, with human narration; AI voiceover and mobile-phone recording are disallowed. Do not use the app's synthesized voice as the presentation narrator.
