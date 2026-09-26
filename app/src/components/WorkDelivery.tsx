import { Fragment } from "react";

function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith("**") && part.endsWith("**")
    ? <strong key={index}>{part.slice(2, -2)}</strong>
    : <Fragment key={index}>{part}</Fragment>);
}

/** A deliberately small, text-only renderer: model output cannot inject HTML. */
export function WorkDelivery({ content, title }: { content: string; title: string }) {
  return <article className="work-delivery" aria-label={title}>
    <h3>{title}</h3>
    {content.split(/\n\s*\n/).map((block, index) => {
      const lines = block.split("\n");
      if (lines.every(line => /^\d+[.)]\s/.test(line))) return <ol key={index}>{lines.map((line, i) => <li key={i}>{inline(line.replace(/^\d+[.)]\s*/, ""))}</li>)}</ol>;
      if (lines.length === 1 && (/^#{1,4}\s/.test(block) || /^\*\*[^*]+\*\*$/.test(block))) return <h4 key={index}>{inline(block.replace(/^#{1,4}\s*/, ""))}</h4>;
      return <p key={index}>{inline(block)}</p>;
    })}
  </article>;
}
