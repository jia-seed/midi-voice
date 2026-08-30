"use client";

import { useEffect, useRef, useState } from "react";

type SR = typeof window extends { SpeechRecognition: infer T } ? T : any;

export function useSpeech(onFinal: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const recRef = useRef<any>(null);

  useEffect(() => {
    const W = window as any;
    const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!Ctor) return;
    setSupported(true);
    const r = new Ctor();
    r.continuous = false;
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (e: any) => {
      let interimText = "";
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t;
        else interimText += t;
      }
      setInterim(interimText);
      if (finalText) {
        setInterim("");
        onFinal(finalText.trim());
      }
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recRef.current = r;
  }, [onFinal]);

  function start() {
    if (!recRef.current || listening) return;
    setInterim("");
    try {
      recRef.current.start();
      setListening(true);
    } catch {}
  }
  function stop() {
    recRef.current?.stop();
  }

  return { supported, listening, interim, start, stop };
}
