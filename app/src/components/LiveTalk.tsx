"use client";

import { useEffect, useRef, useState } from "react";
import { t, type Lang } from "@/lib/i18n";

interface LiveSession {
  sendRealtimeInput(params: { audio: { data: string; mimeType: string } }): void;
  close(): void;
}

const WORKLET = `class PcmTap extends AudioWorkletProcessor {
  process(inputs) { const c = inputs[0]?.[0]; if (c && c.length) this.port.postMessage(c.slice(0)); return true; }
}
registerProcessor("pcm-tap", PcmTap);`;

const toBase64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x4000) s += String.fromCharCode(...bytes.subarray(i, i + 0x4000));
  return btoa(s);
};

const f32ToPcm16 = (f: Float32Array) => {
  const b = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const v = Math.max(-1, Math.min(1, f[i]!));
    b[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return new Uint8Array(b.buffer);
};

const pcm16ToF32 = (bytes: Uint8Array) => {
  const i16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length >> 1);
  const f = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f[i] = i16[i]! / 0x8000;
  return f;
};

type Status = "off" | "connecting" | "live";

/**
 * Real-time voice conversation via Gemini Live. The browser connects directly
 * to Gemini over WebSocket using a single-use ephemeral token from
 * /api/live/token (the API key never reaches the client).
 */
export function LiveTalk({ label, lang }: { label: string; lang: Lang }) {
  const [status, setStatus] = useState<Status>("off");
  const [err, setErr] = useState<string | null>(null);
  const [userLine, setUserLine] = useState("");
  const [botLine, setBotLine] = useState("");
  const sessionRef = useRef<LiveSession | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const inCtxRef = useRef<AudioContext | null>(null);
  const outCtxRef = useRef<AudioContext | null>(null);
  const workletUrlRef = useRef<string | null>(null);
  const nextTimeRef = useRef(0);
  const sourcesRef = useRef(new Set<AudioBufferSourceNode>());

  const stop = () => {
    sessionRef.current?.close();
    sessionRef.current = null;
    micRef.current?.getTracks().forEach((tr) => tr.stop());
    micRef.current = null;
    void inCtxRef.current?.close();
    inCtxRef.current = null;
    for (const src of sourcesRef.current) src.stop();
    sourcesRef.current.clear();
    void outCtxRef.current?.close();
    outCtxRef.current = null;
    if (workletUrlRef.current) URL.revokeObjectURL(workletUrlRef.current);
    workletUrlRef.current = null;
    setStatus("off");
  };

  useEffect(() => stop, []); // eslint-disable-line react-hooks/exhaustive-deps

  const playChunk = (base64: string) => {
    const ctx = outCtxRef.current;
    if (!ctx) return;
    const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const f32 = pcm16ToF32(bin);
    const buf = ctx.createBuffer(1, f32.length, 24000);
    buf.copyToChannel(f32, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const at = Math.max(nextTimeRef.current, ctx.currentTime);
    src.start(at);
    nextTimeRef.current = at + buf.duration;
    sourcesRef.current.add(src);
    src.onended = () => sourcesRef.current.delete(src);
  };

  const handleMessage = (m: { serverContent?: {
    interrupted?: boolean;
    turnComplete?: boolean;
    modelTurn?: { parts?: { inlineData?: { data?: string } }[] };
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
  } }) => {
    const sc = m.serverContent;
    if (!sc) return;
    if (sc.interrupted) {
      for (const src of sourcesRef.current) src.stop();
      sourcesRef.current.clear();
      if (outCtxRef.current) nextTimeRef.current = outCtxRef.current.currentTime;
    }
    for (const part of sc.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) playChunk(part.inlineData.data);
    }
    if (sc.inputTranscription?.text) setUserLine((prev) => prev + sc.inputTranscription!.text);
    if (sc.outputTranscription?.text) setBotLine((prev) => prev + sc.outputTranscription!.text);
    if (sc.turnComplete) {
      setUserLine("");
      setBotLine("");
    }
  };

  const start = async () => {
    setErr(null);
    setStatus("connecting");
    try {
      const res = await fetch("/api/live/token", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);

      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: body.token, httpOptions: { apiVersion: "v1alpha" } });

      const outCtx = new AudioContext();
      outCtxRef.current = outCtx;
      nextTimeRef.current = outCtx.currentTime;

      const session = (await ai.live.connect({
        model: body.model,
        callbacks: {
          onmessage: handleMessage,
          onerror: (e) => setErr(e.message || "live session error"),
          onclose: (e) => {
            if (e.reason) setErr(e.reason);
            stop();
          },
        },
        config: body.config,
      })) as LiveSession;
      sessionRef.current = session;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      micRef.current = stream;
      const inCtx = new AudioContext({ sampleRate: 16000 });
      inCtxRef.current = inCtx;
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
      workletUrlRef.current = url;
      await inCtx.audioWorklet.addModule(url);
      const node = new AudioWorkletNode(inCtx, "pcm-tap");
      node.port.onmessage = (e: MessageEvent<Float32Array>) => {
        sessionRef.current?.sendRealtimeInput({
          audio: { data: toBase64(f32ToPcm16(e.data)), mimeType: "audio/pcm;rate=16000" },
        });
      };
      inCtx.createMediaStreamSource(stream).connect(node);
      const silent = inCtx.createGain();
      silent.gain.value = 0;
      node.connect(silent).connect(inCtx.destination); // keep processing without mic monitoring
      setStatus("live");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      stop();
    }
  };

  return (
    <div className="card">
      <div className="row">
        <button onClick={status === "off" ? start : stop} disabled={status === "connecting"}>
          {status === "off" ? t("liveTalk", lang) : status === "connecting" ? t("liveConnecting", lang) : t("liveStop", lang)}
        </button>
        {status === "live" && <span aria-live="polite">🎙️</span>}
      </div>
      {status === "live" && (
        <>
          <p className="mono" style={{ margin: "6px 0 0" }}>{t("liveYou", lang)}{userLine}</p>
          <p className="mono" style={{ margin: "2px 0 0" }}>{label}: {botLine}</p>
        </>
      )}
      {err && <p className="ng">{t("liveFail", lang)}: {err}</p>}
    </div>
  );
}
