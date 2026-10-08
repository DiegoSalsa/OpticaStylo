"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Glasses3DOverlay from "../../glasses-3d-overlay";

// Real MediaStream/video metadata/resize events, synthetic pixels. Available
// only in development: this cannot validate a phone's sensor or hardware zoom.
export default function CameraValidation() {
  const source = useRef({ width: 1280, height: 720, canvas: null, image: null, facing: "user", frames: 0 });
  const [size, setSize] = useState("1280x720"), [profile, setProfile] = useState("mobile");
  const inputRef = useRef(null);
  const [requests, setRequests] = useState([]);
  useEffect(() => {
    const state = source.current;
    const timer = window.setInterval(() => {
      const canvas = state.canvas;
      if (!canvas) return;
      if (canvas.width !== state.width || canvas.height !== state.height) { canvas.width = state.width; canvas.height = state.height; }
      const context = canvas.getContext("2d"), w = canvas.width, h = canvas.height;
      context.fillStyle = "#eef6f4"; context.fillRect(0, 0, w, h);
      if (state.image) context.drawImage(state.image, 0, 0, w, h);
      else {
        context.fillStyle = "#e53935"; context.fillRect(0, 0, w * .15, h);
        context.fillStyle = "#1976d2"; context.fillRect(w * .85, 0, w * .15, h);
        context.fillStyle = "#00897b"; context.fillRect(w * .15, 0, w * .7, h * .15);
        context.fillStyle = "#ffb300"; context.fillRect(w * .15, h * .85, w * .7, h * .15);
        context.strokeStyle = "#364941"; context.lineWidth = 2;
        for (let n = 1; n < 10; n++) { context.beginPath(); context.moveTo(w * n / 10, 0); context.lineTo(w * n / 10, h); context.moveTo(0, h * n / 10); context.lineTo(w, h * n / 10); context.stroke(); }
      }
      context.fillStyle = "#000"; context.font = `${Math.max(16, w / 30)}px sans-serif`;
      context.fillText(`${w}×${h} ${state.facing} #${++state.frames}`, w * .2, h * .25);
    }, 1000 / 30);
    return () => { window.clearInterval(timer); state.canvas = null; state.image = null; };
  }, []);
  const provider = useMemo(() => ({ synthetic: true, mobile: profile === "mobile",
    getSupportedConstraints: () => ({ facingMode: true, frameRate: true, resizeMode: true }),
    getUserMedia: async (constraints) => {
      const state = source.current;
      state.facing = constraints.video.facingMode?.ideal ?? constraints.video.facingMode?.exact ?? "unknown";
      setRequests((previous) => [...previous, constraints]);
      const canvas = document.createElement("canvas");
      canvas.width = state.width; canvas.height = state.height; state.canvas = canvas;
      return canvas.captureStream(30);
    },
  }), [profile]);
  const resize = (value) => {
    const [width, height] = value.split("x").map(Number);
    source.current.width = width; source.current.height = height; setSize(value);
  };
  const loadFace = (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    const url = URL.createObjectURL(file), image = new window.Image();
    image.onload = () => { source.current.image = image; URL.revokeObjectURL(url); };
    image.onerror = () => URL.revokeObjectURL(url); image.src = url;
  };
  return <>
    <section aria-label="Fuentes sintéticas de cámara" style={{ padding: 12, background: "#fff", display: "flex", gap: 10, flexWrap: "wrap" }}>
      <strong>Validación local: fuente sintética; no representa el sensor de un teléfono.</strong>
      <label>Fuente <select aria-label="Dimensiones de fuente" value={size} onChange={(event) => resize(event.target.value)}>
        {["720x1280", "1080x1920", "1280x720", "640x480", "1920x1080", "480x640"].map((value) => <option key={value}>{value}</option>)}
      </select></label>
      <button onClick={() => resize(`${source.current.height}x${source.current.width}`)}>Rotar fuente</button>
      <label>Perfil <select aria-label="Perfil de adquisición" value={profile} onChange={(event) => setProfile(event.target.value)}><option value="mobile">mobile</option><option value="desktop">desktop</option></select></label>
      <input ref={inputRef} type="file" accept="image/*" onChange={loadFace} hidden />
      <button onClick={() => inputRef.current.click()}>Cargar rostro local en stream</button>
      <button onClick={() => { source.current.image = null; }}>Patrón sin rostro</button>
      <details><summary>Solicitudes sintéticas ({requests.length})</summary><pre>{JSON.stringify(requests, null, 2)}</pre></details>
    </section>
    <Glasses3DOverlay cameraDevices={provider} />
  </>;
}
