"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Glasses3DOverlay from "../../glasses-3d-overlay";
import { scaleFace } from "../../../../../../tests/fixtures/scale-face.js";

// Stream verdadero con píxeles sintéticos. El modo determinista prueba la
// integración temporal, nunca la precisión de MediaPipe ni el sensor físico.
export default function CameraValidation() {
  const source = useRef({ width: 1280, height: 720, canvas: null, image: null, facing: "user", frames: 0 });
  const [size, setSize] = useState("1280x720"), [profile, setProfile] = useState("mobile");
  const inputRef = useRef(null);
  const [requests, setRequests] = useState([]);
  const [deterministic, setDeterministic] = useState(false);
  const simulation = useRef({ state: "face", delay: 20, distance: 2, yaw: 0 });
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
    ...(deterministic ? { createTracking: async () => {
      const result = (width, height) => {
        const state = simulation.current;
        if (state.state === "none") return { faceLandmarks: [] };
        const face = scaleFace({ pixelsPerMm: state.distance, yaw: state.yaw });
        face.landmarks = face.landmarks.map((p) => ({ ...p,
          x: .5 + (p.x - .5) * 1000 / width, y: .5 + (p.y - .5) * 500 / height }));
        if (state.state === "invalid") face.landmarks[33].x = NaN;
        if (state.state === "blink") for (let i = 468; i < 478; i++) face.landmarks[i] = undefined;
        return { faceLandmarks: [face.landmarks], facialTransformationMatrixes: [face.transform] };
      };
      return { backend: "main-thread", faceMeshTriangleIndices: [], landmarker: {
        async detectForVideo(video) {
          const captured = result(video.videoWidth, video.videoHeight);
          await new Promise((resolve) => window.setTimeout(resolve, simulation.current.delay));
          return captured;
        },
        detect: (image) => result(image.naturalWidth, image.naturalHeight), close() {},
      } };
    } } : {}),
    getSupportedConstraints: () => ({ facingMode: true, frameRate: true, resizeMode: true }),
    getUserMedia: async (constraints) => {
      const state = source.current;
      state.facing = constraints.video.facingMode?.ideal ?? constraints.video.facingMode?.exact ?? "unknown";
      setRequests((previous) => [...previous, constraints]);
      const canvas = document.createElement("canvas");
      canvas.width = state.width; canvas.height = state.height; state.canvas = canvas;
      return canvas.captureStream(30);
    },
  }), [profile, deterministic]);
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
      <label><input type="checkbox" aria-label="Seguimiento determinista" checked={deterministic} onChange={(event) => setDeterministic(event.target.checked)} />Seguimiento determinista (activar antes de iniciar)</label>
      <label>Estímulo <select aria-label="Estímulo de tracking" onChange={(event) => { simulation.current.state = event.target.value; }}>
        <option value="face">Rostro sintético</option><option value="none">Sin rostro</option><option value="invalid">Rostro con pose inválida</option><option value="blink">Iris oculto</option>
      </select></label>
      <label>Latencia <input aria-label="Latencia sintética" type="number" defaultValue={20} onChange={(event) => { simulation.current.delay = Number(event.target.value); }} /></label>
      <label>Distancia <input aria-label="Escala sintética" type="number" step="0.1" defaultValue={2} onChange={(event) => { simulation.current.distance = Number(event.target.value); }} /></label>
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
