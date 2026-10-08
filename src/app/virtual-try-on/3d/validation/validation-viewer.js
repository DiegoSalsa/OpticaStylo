"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Canvas, useFrame } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, DoubleSide, Euler, Matrix4, Quaternion, Vector3 } from "three";
import { landmarksToGlassesPose } from "@/utils/virtual-try-on-3d-geometry";
import { cameraProjection } from "@/virtual-try-on-3d/camera-projection";
import { PoseFilter } from "@/virtual-try-on-3d/pose-filter";

const GlassesModel = dynamic(() => import("../glasses-model"), { ssr: false });
const WIDTH = 1000, HEIGHT = 700, PIXELS_PER_MM = 2.5;
function markLoaded(metrics, id) { metrics.current.loadedModel = id; }

function Replay({ face, metadata, modelUrl, lensOpacity, lensTintStrength, yaw, pitch, zoom, moving, metrics, outputRef }) {
  const groupRef = useRef(), headProxyRef = useRef(), poseRef = useRef(null), filterRef = useRef(null), frameRef = useRef(0);
  const head = useMemo(() => {
    const points = face.vertices.map((p) => new Vector3().fromArray(p));
    const nose = points[6].clone(), factor = 135 / points[234].distanceTo(points[454]);
    const local = points.map((p) => p.sub(nose).multiplyScalar(factor));
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(local.flatMap((p) => p.toArray())), 3));
    geometry.setIndex(face.triangles); geometry.computeVertexNormals();
    return { local, geometry };
  }, [face]);
  useEffect(() => { filterRef.current = new PoseFilter(); return () => { filterRef.current = null; }; }, [metadata]);
  useEffect(() => () => head.geometry.dispose(), [head]);
  const handleReady = () => markLoaded(metrics, metadata.identity.modelId);
  useFrame(() => {
    const now = performance.now(), t = now / 1000;
    const q = new Quaternion().setFromEuler(new Euler(pitch * Math.PI / 180,
      (moving ? Math.sin(t * 3) * 45 : yaw) * Math.PI / 180, 0));
    const scale = PIXELS_PER_MM * zoom, landmarks = head.local.map((p) => {
      const v = p.clone().applyQuaternion(q).multiplyScalar(scale), perspective = WIDTH / (WIDTH - v.z);
      return { x: 0.5 + v.x * perspective / WIDTH, y: 0.5 - v.y * perspective / HEIGHT, z: -v.z / WIDTH };
    });
    const pose = landmarksToGlassesPose(landmarks, WIDTH, HEIGHT, metadata,
      { data: new Matrix4().makeRotationFromQuaternion(q).toArray() }, { mirrored: false });
    if (moving) {
      // Simulate 30 Hz measurement while renderer remains at display refresh.
      if (now - (frameRef.current || -Infinity) >= 33) { filterRef.current?.update(pose, now); frameRef.current = now; }
      poseRef.current = filterRef.current?.sample(now);
    } else poseRef.current = pose;
    groupRef.current.quaternion.copy(q); groupRef.current.scale.setScalar(scale);
    headProxyRef.current.position.fromArray(pose.templeFit.proxy.center);
    headProxyRef.current.scale.fromArray(pose.templeFit.proxy.radii);
    if (outputRef.current) outputRef.current.textContent = JSON.stringify({ synthetic: true, loadedModel: metrics.current.loadedModel,
      yaw: moving ? Math.sin(t * 3) * 45 : yaw, pitch, zoom,
      leftOpeningDegrees: pose.templeFit.left.bendRadians * 180 / Math.PI,
      rightOpeningDegrees: pose.templeFit.right.bendRadians * 180 / Math.PI,
      leftLimited: pose.templeFit.left.constrained, rightLimited: pose.templeFit.right.constrained,
      renderedFps: metrics.current.renderFps }, null, 2);
  });
  return <>
    <group ref={groupRef}>
      <mesh ref={headProxyRef} renderOrder={-101}><sphereGeometry args={[1, 32, 24]} /><meshStandardMaterial color="#c98a71" /></mesh>
      <mesh geometry={head.geometry} renderOrder={-101}><meshStandardMaterial color="#c98a71" side={DoubleSide} /></mesh>
    </group>
    <Suspense fallback={null}><GlassesModel faceMeshTriangleIndices={face.triangles} modelMetadata={metadata}
      modelUrl={modelUrl}
      lensOpacity={lensOpacity} lensTintStrength={lensTintStrength}
      poseRef={poseRef} poseFilterRef={{ current: null }} debugMetricsRef={metrics} onReady={handleReady} /></Suspense>
  </>;
}

export default function ValidationViewer({ face, models }) {
  const [selected, setSelected] = useState(0), [yaw, setYaw] = useState(0), [pitch, setPitch] = useState(0), [zoom, setZoom] = useState(1), [moving, setMoving] = useState(false);
  const metrics = useRef({}), outputRef = useRef(null), projection = cameraProjection(WIDTH, HEIGHT);
  return <main style={{ maxWidth: 1100, margin: "100px auto 40px", padding: 16 }}>
    <h1>Validación geométrica VTO</h1><p>Replay sintético de un rostro canónico. No mide precisión de MediaPipe ni latencia de webcam.</p>
    <label>Modelo <select value={selected} onChange={(e) => setSelected(Number(e.target.value))}>{models.map((m, i) => <option key={m.url} value={i}>{m.metadata.identity.name}</option>)}</select></label>
    <label>Yaw <select value={yaw} onChange={(e) => setYaw(Number(e.target.value))}>{[-45, -30, -15, 0, 15, 30, 45].map((v) => <option key={v}>{v}</option>)}</select></label>
    <label>Pitch <select value={pitch} onChange={(e) => setPitch(Number(e.target.value))}>{[-25, 0, 25].map((v) => <option key={v}>{v}</option>)}</select></label>
    <label>Distancia <select value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>{[0.7, 1, 1.3].map((v) => <option key={v}>{v}</option>)}</select></label>
    <label><input type="checkbox" checked={moving} onChange={(e) => setMoving(e.target.checked)} />Movimiento rápido, mediciones a 30 Hz</label>
    <div style={{ width: "100%", aspectRatio: "10 / 7", background: "#e5ece8" }}>
      <Canvas camera={{ fov: projection.fovDegrees, near: 1, far: 5000, position: [0, 0, WIDTH] }}>
        <ambientLight intensity={1.5} /><directionalLight position={[300, 400, 700]} intensity={2} />
        <Replay face={face} metadata={models[selected].metadata} modelUrl={models[selected].url}
          lensOpacity={models[selected].lensOpacity} lensTintStrength={models[selected].lensTintStrength}
          yaw={yaw} pitch={pitch} zoom={zoom} moving={moving} metrics={metrics} outputRef={outputRef} />
      </Canvas>
    </div>
    <pre><output ref={outputRef} aria-label="Resultado del replay" /></pre>
  </main>;
}
