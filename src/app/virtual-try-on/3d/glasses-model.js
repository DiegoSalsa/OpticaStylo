"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";

/**
 * Three.js component that loads and renders the glasses GLB model.
 * Position, rotation, and scale are updated every frame from the
 * `poseRef` shared by the parent overlay component.
 */
export default function GlassesModel({ modelUrl, poseRef }) {
  const groupRef = useRef();
  const { scene } = useGLTF(modelUrl);

  useFrame(() => {
    const group = groupRef.current;
    const pose = poseRef.current;
    if (!group) return;

    if (!pose) {
      group.visible = false;
      return;
    }

    group.visible = true;
    group.position.set(...pose.position);
    group.rotation.set(...pose.rotation);
    const s = pose.scale;
    group.scale.set(s, s, s);
  });

  return (
    <group ref={groupRef}>
      <primitive object={scene} />
    </group>
  );
}
