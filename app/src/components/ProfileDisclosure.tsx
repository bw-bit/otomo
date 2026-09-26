import type { Lang } from "@/lib/i18n";

const TEXT = {
  en: { title: "What does publishing do?", public: "Public", publicBody: "Companion name, delivery / review / paid-job counts, verification status and environment, approval service and activity dates.", private: "Kept private by Otomo", privateBody: "Chat messages, job briefs, delivered text, face images, World ID identifiers and wallet keys are not included in this profile.", changes: "A record others can read", changesBody: "Publishing saves a snapshot to your companion's ENS name. Anyone with the link can read it and use the name to identify the companion. New work appears after you publish again.", limits: "This does not list your companion on an external marketplace or allow others to spend its funds. Blockchain transfers and ENS wallet addresses remain publicly visible." },
  ja: { title: "公開すると、どう変わる？", public: "公開する情報", publicBody: "相棒の名前、納品・検収・報酬受領の件数、本人確認の状態と環境、承認サービス、活動日時です。", private: "プロフィールに含めない情報", privateBody: "会話、依頼文、納品した文章、顔画像、World IDの識別子、ウォレットの秘密鍵は含めません。", changes: "ほかの人が実績を確かめられます", changesBody: "公開時点の実績を相棒のENS名に保存します。リンクを知っている人が実績を読めるようになり、同じ名前で相棒を識別できます。新しい実績の反映には、もう一度公開が必要です。", limits: "外部の仕事マーケットへの出品や、第三者への送金権限の付与は行いません。ブロックチェーン上の送金とENSのウォレットアドレスは公開情報です。" },
  zh: { title: "公开后会发生什么？", public: "公开信息", publicBody: "搭档名称、交付 / 验收 / 已获酬次数、验证状态和环境、授权服务和活动日期。", private: "不包含的信息", privateBody: "聊天、任务要求、交付内容、人脸图像、World ID 标识和钱包私钥不会写入此资料。", changes: "让别人查看记录", changesBody: "发布会将当前活动快照保存到搭档的 ENS 名称。任何获得链接的人都能查看，并用名称识别搭档。新活动需要再次发布。", limits: "不会自动上架外部任务市场，也不会授权他人转账。链上转账和 ENS 钱包地址仍是公开信息。" },
  ko: { title: "공개하면 무엇이 달라지나요?", public: "공개 정보", publicBody: "파트너 이름, 납품 / 검수 / 보상 수령 건수, 인증 상태와 환경, 승인 서비스와 활동 날짜입니다.", private: "포함하지 않는 정보", privateBody: "대화, 의뢰문, 납품 내용, 얼굴 이미지, World ID 식별자와 지갑 개인 키는 포함하지 않습니다.", changes: "다른 사람이 확인할 수 있는 기록", changesBody: "게시 시점의 기록을 파트너의 ENS 이름에 저장합니다. 링크를 가진 누구나 기록을 읽고 같은 이름으로 파트너를 식별할 수 있습니다. 새 활동은 다시 게시해야 반영됩니다.", limits: "외부 작업 마켓에 등록하거나 다른 사람에게 송금 권한을 주지 않습니다. 블록체인 거래와 ENS 지갑 주소는 공개 정보입니다." },
} satisfies Record<Lang, Record<string, string>>;

export function ProfileDisclosure({ lang }: { lang: Lang }) {
  const c = TEXT[lang];
  return <section className="profile-disclosure">
    <h2>{c.title}</h2>
    <div className="disclosure-grid"><div><h3>{c.public}</h3><p>{c.publicBody}</p></div><div><h3>{c.private}</h3><p>{c.privateBody}</p></div></div>
    <h3>{c.changes}</h3><p>{c.changesBody}</p><p className="small">{c.limits}</p>
  </section>;
}
