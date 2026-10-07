"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Box3, BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, Vector3 } from "three";
import { canonicalModelMatrix, runtimeFittingMetadata } from "@/virtual-try-on-3d/model-runtime";
import { prepareLensMaterial, prepareTempleMaterial } from "@/virtual-try-on-3d/model-materials";

function setTempleBend(uniforms, value) { uniforms.bendRadians.value = value; }

export default function GlassesModel({ faceMeshTriangleIndices, lensOpacity, lensTintStrength,
  modelMetadata, modelUrl, onReady, poseRef, poseFilterRef, debugMetricsRef, occlusionEnabled = true }) {
  const groupRef = useRef(), occluderRef = useRef(), renderCount = useRef(0), startedAt = useRef(0);
  const headProxyRef = useRef(), headProxyMeshRef = useRef();
  const templesRef = useRef([]);
  const uploadedMesh = useRef({ geometry: null, positions: null }), fpsWindow = useRef({ started: 0, frames: 0 });
  const { scene } = useGLTF(modelUrl);
  const faceMeshGeometry = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(468 * 3), 3));
    geometry.setIndex(faceMeshTriangleIndices ?? []); return geometry;
  }, [faceMeshTriangleIndices]);
  const model = useMemo(() => {
    const normalized = new Group(), temples = [], matrix = canonicalModelMatrix(modelMetadata);
    const fitting = runtimeFittingMetadata(modelMetadata);
    const lensNames = new Set([...modelMetadata.nodes.lensLeft, ...modelMetadata.nodes.lensRight]);
    const templeNames = new Set([...modelMetadata.nodes.templeLeft, ...modelMetadata.nodes.templeRight]);
    scene.updateMatrixWorld(true);
    scene.traverse((child) => {
      if (!child.isMesh) return;
      // Flatten transforms once. Geometry, shader, anchors and collision samples
      // now share head-local millimetres, even for nested/rotated GLB nodes.
      const geometry = child.geometry.clone().applyMatrix4(matrix.clone().multiply(child.matrixWorld));
      const sign = new Box3().setFromBufferAttribute(geometry.getAttribute("position")).getCenter(new Vector3()).x < 0 ? -1 : 1;
      const side = sign < 0 ? "left" : "right", hinge = fitting.anchors[`hinge${sign < 0 ? "Left" : "Right"}`].position;
      const materials = (Array.isArray(child.material) ? child.material : [child.material]).map((original) => {
        const material = original.clone();
        if (lensNames.has(child.name)) prepareLensMaterial(material, lensOpacity, lensTintStrength);
        else { material.envMapIntensity = 1.65; material.roughness = Math.max(0.14, material.roughness ?? 0.4); }
        if (templeNames.has(child.name) && fitting.capabilities.templeBending) {
          temples.push({ side, uniforms: prepareTempleMaterial(material, { bendStart: hinge[2], bendDirection: -1, side: sign }) });
        }
        return material;
      });
      const mesh = new Mesh(geometry, Array.isArray(child.material) ? materials : materials[0]);
      mesh.name = child.name; mesh.frustumCulled = false; mesh.renderOrder = lensNames.has(child.name) ? 4 : 0;
      normalized.add(mesh);
    });
    return { scene: normalized, temples };
  }, [lensOpacity, lensTintStrength, modelMetadata, scene]);
  useEffect(() => { onReady?.(); }, [onReady, model, faceMeshGeometry]);
  useEffect(() => { templesRef.current = model.temples; return () => { templesRef.current = []; }; }, [model]);
  useEffect(() => () => faceMeshGeometry.dispose(), [faceMeshGeometry]);
  useEffect(() => () => model.scene.traverse((child) => {
    if (!child.isMesh) return; child.geometry.dispose();
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) material.dispose();
  }), [model]);

  useFrame(({ gl }) => {
    const now = performance.now(), group = groupRef.current, occluder = occluderRef.current;
    const pose = poseFilterRef.current ? poseFilterRef.current.sample(now) : poseRef.current;
    if (!startedAt.current) startedAt.current = now;
    renderCount.current++;
    debugMetricsRef.current.renderFps = renderCount.current / Math.max(0.001, (now - startedAt.current) / 1000);
    const window = fpsWindow.current;
    if (!window.started) window.started = now;
    window.frames++;
    if (now - window.started >= 500) {
      debugMetricsRef.current.recentRenderFps = window.frames * 1000 / (now - window.started);
      window.started = now; window.frames = 0;
    }
    debugMetricsRef.current.rendererDpr = gl.getPixelRatio();
    if (!group || !occluder) return;
    group.visible = occluder.visible = Boolean(pose);
    if (headProxyRef.current) headProxyRef.current.visible = Boolean(pose) && occlusionEnabled;
    if (!pose) return;
    debugMetricsRef.current.posePosition = pose.position;
    debugMetricsRef.current.poseQuaternion = pose.quaternion;
    debugMetricsRef.current.renderedPoseScale = pose.scale;
    debugMetricsRef.current.faceEyeDepthMm ??= [0, 0];
    debugMetricsRef.current.faceEyeDepthMm[0] = pose.faceMesh.positions[33 * 3 + 2];
    debugMetricsRef.current.faceEyeDepthMm[1] = pose.faceMesh.positions[263 * 3 + 2];
    debugMetricsRef.current.templeLimits ??= {};
    debugMetricsRef.current.templeLimits.left = pose.templeFit.left.constrained;
    debugMetricsRef.current.templeLimits.right = pose.templeFit.right.constrained;
    // The same transform applies to model and occlusion mask. No allocations here.
    group.position.fromArray(pose.position); group.quaternion.fromArray(pose.quaternion); group.scale.setScalar(pose.scale);
    occluder.position.copy(group.position); occluder.quaternion.copy(group.quaternion); occluder.scale.copy(group.scale);
    if (headProxyRef.current && pose.templeFit.proxy) {
      headProxyRef.current.position.copy(group.position); headProxyRef.current.quaternion.copy(group.quaternion); headProxyRef.current.scale.copy(group.scale);
      headProxyMeshRef.current.position.fromArray(pose.templeFit.proxy.center);
      headProxyMeshRef.current.scale.fromArray(pose.templeFit.proxy.radii);
    }
    for (const { side, uniforms } of templesRef.current) setTempleBend(uniforms, pose.templeBends?.[side === "left" ? 0 : 1] ?? pose.templeFit[side].bendRadians);
    const positions = pose.faceMesh?.positions, attribute = faceMeshGeometry.getAttribute("position");
    if (positions && faceMeshTriangleIndices?.length && occlusionEnabled) {
      if (uploadedMesh.current.geometry !== faceMeshGeometry || uploadedMesh.current.positions !== positions) {
        attribute.array.set(positions); attribute.needsUpdate = true;
        uploadedMesh.current.geometry = faceMeshGeometry; uploadedMesh.current.positions = positions;
      }
    }
    else occluder.visible = false;
  });
  return <>
    <group ref={headProxyRef} visible={false}>
      <mesh ref={headProxyMeshRef} frustumCulled={false} renderOrder={-100}>
        <sphereGeometry args={[1, 24, 16]} />
        <meshBasicMaterial colorWrite={false} depthTest depthWrite side={DoubleSide} />
      </mesh>
    </group>
    <mesh ref={occluderRef} geometry={faceMeshGeometry} frustumCulled={false} renderOrder={-100} visible={false}>
      <meshBasicMaterial colorWrite={false} depthTest depthWrite side={DoubleSide} />
    </mesh>
    <group ref={groupRef} visible={false}><primitive object={model.scene} /></group>
  </>;
}
