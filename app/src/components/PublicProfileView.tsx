"use client";

import Link from "next/link";
import { LANG_LABELS, LANG_LOCALES, SUPPORTED_LANGS, isLang, type Lang } from "@/lib/i18n";
import { useLanguage } from "@/hooks/useLanguage";
import type { ReputationSnapshot } from "@/lib/reputation";
import { CompanionAvatar } from "./CompanionAvatar";
import { ProfileDisclosure } from "./ProfileDisclosure";

const COPY = {
  en: { language: "Language", unavailable: "Not published yet", unavailableBody: "Your companion's activity will appear here once it is published to ENS.", home: "Back to Otomo", title: "Published activity", matched: "Matches the current ENS record", saved: "Saved publication. The current ENS record could not be confirmed.", delivered: "Delivered", reviewed: "Reviewed", paid: "Paid", birth: "Birth verification", approval: "Approval service", sandbox: "Sandbox (test identity)", disclaimer: "Activity recorded by Otomo, not a World ID credit rating. Rewards on Sepolia are test tokens.", asOf: "Updated", transaction: "ENS publication transaction", data: "View public ENS data" },
  ja: { language: "表示言語", unavailable: "まだ公開されていません", unavailableBody: "相棒が実績をENSに公開すると、ここで確認できます。", home: "Otomoへ戻る", title: "公開された活動実績", matched: "ENSの現在の記録と一致しています", saved: "保存済みの公開記録です。ENSの現在値との一致は確認できません。", delivered: "納品", reviewed: "検収済み", paid: "報酬受領", birth: "誕生時の本人確認", approval: "承認サービス", sandbox: "Sandbox（模擬ID）", disclaimer: "Otomoが記録した活動実績です。World IDの信用評価ではありません。Sepoliaの報酬はテストトークンです。", asOf: "集計日時", transaction: "ENS公開トランザクション", data: "ENSの公開データを見る" },
  zh: { language: "语言", unavailable: "尚未公开", unavailableBody: "搭档将活动记录发布到 ENS 后，即可在这里查看。", home: "返回 Otomo", title: "已公开的活动记录", matched: "与当前 ENS 记录一致", saved: "这是已保存的公开记录，暂时无法确认当前 ENS 记录。", delivered: "已交付", reviewed: "已验收", paid: "已获酬", birth: "创建时的身份验证", approval: "授权服务", sandbox: "Sandbox（测试身份）", disclaimer: "这是 Otomo 记录的活动，并非 World ID 信用评级。Sepolia 上的奖励为测试代币。", asOf: "更新时间", transaction: "ENS 发布交易", data: "查看 ENS 公开数据" },
  ko: { language: "언어", unavailable: "아직 공개되지 않았어요", unavailableBody: "파트너가 활동 기록을 ENS에 공개하면 여기서 확인할 수 있어요.", home: "Otomo로 돌아가기", title: "공개된 활동 기록", matched: "현재 ENS 기록과 일치합니다", saved: "저장된 공개 기록입니다. 현재 ENS 기록과의 일치는 확인하지 못했습니다.", delivered: "납품", reviewed: "검수 완료", paid: "보상 수령", birth: "생성 시 본인 확인", approval: "승인 서비스", sandbox: "Sandbox (테스트 신원)", disclaimer: "Otomo가 기록한 활동이며 World ID의 신용 평가가 아닙니다. Sepolia 보상은 테스트 토큰입니다.", asOf: "집계 시각", transaction: "ENS 공개 트랜잭션", data: "ENS 공개 데이터 보기" },
} satisfies Record<Lang, Record<string, string>>;

export interface PublishedProfile {
  name: string;
  snapshot: ReputationSnapshot;
  raw: string;
  verified: boolean;
  txHash: string;
}

export function PublicProfileView({ profile, name }: { profile: PublishedProfile | null; name: string }) {
  const { lang, setLang } = useLanguage();
  const copy = COPY[lang];
  const snapshot = profile?.snapshot;
  return <main className="profile-page"><section className="panel profile-panel">
    <div className="langbar"><label>{copy.language} <select className="langsel" value={lang} onChange={event => { if (isLang(event.target.value)) setLang(event.target.value); }}>{SUPPORTED_LANGS.map(value => <option key={value} value={value}>{LANG_LABELS[value]}</option>)}</select></label></div>
    <header className="profile-hero"><CompanionAvatar seed={name} className="profile-avatar" /><div><p className="eyebrow">OTOMO · ENS</p><h1>{name}</h1><p>{copy.title}</p></div></header>
    {!profile || !snapshot ? <>
      <h1>{copy.unavailable}</h1><p>{copy.unavailableBody}</p>
    </> : <>
      <p className="profile-proof">{profile.verified ? copy.matched : copy.saved}</p>
      <dl className="profile-metrics">
        <div><dt>{copy.delivered}</dt><dd>{snapshot.delivered}</dd></div>
        <div><dt>{copy.reviewed}</dt><dd>{snapshot.reviewed}</dd></div>
        <div><dt>{copy.paid}</dt><dd>{snapshot.paid}</dd></div>
      </dl>
      <div className="profile-verification"><p>{copy.birth}<strong>{snapshot.verification.environment}</strong></p><p>{copy.approval}<strong>{snapshot.verification.approvalIssuer.includes("sandbox") ? copy.sandbox : snapshot.verification.approvalIssuer}</strong></p></div>
      <p>{copy.disclaimer}</p>
      <p>{copy.asOf}: {new Date(snapshot.asOf).toLocaleString(LANG_LOCALES[lang], { timeZone: "UTC", timeZoneName: "short" })}</p>
      <p><a href={`https://sepolia.etherscan.io/tx/${profile.txHash}`} target="_blank" rel="noreferrer">{copy.transaction}</a></p>
      <details className="plain"><summary>{copy.data}</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{profile.raw}</pre></details>
    </>}
    <ProfileDisclosure lang={lang} />
    <p><Link href="/services">{lang === "ja" ? "相棒の有料サービス・価格・受け取れるもの" : "Companion services, prices and deliverables"}</Link></p>
    <p><Link href="/">{copy.home}</Link></p>
  </section></main>;
}
