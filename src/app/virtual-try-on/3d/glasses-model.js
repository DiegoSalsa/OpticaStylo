"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";

/**
 * Three.js component that loads and renders the glasses GLB model.
 * Position, rotation, and scale are updated every frame from the
 * `poseRef` shared by the parent overlay component.
 */
export default function GlassesModel({ modelUrl, poseRef, videoDimensions }) {
  const groupRef = useRef();
  const { scene } = useGLTF(modelUrl);
  const { camera } = useThree();

  // Clone the scene so it's safe to reuse
  const clonedScene = useMemo(() => scene.clone(true), [scene]);

  // Keep the orthographic camera frustum in sync with the video dimensions
  useEffect(() => {
    if (!videoDimensions) return;
    const halfW = videoDimensions.width / 2;
    const halfH = videoDimensions.height / 2;
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();
  }, [camera, videoDimensions]);

  useFrame(() => {
    const group = groupRef.current;
    const pose = poseRef.current;
    if (!group) return;

    if (!pose) {
      group.visible = false;
      return;
    }

    group.visible = true;
    group.position.set(pose.position[0], pose.position[1], pose.position[2]);
    group.rotation.set(pose.rotation[0], pose.rotation[1], pose.rotation[2]);
    const s = pose.scale;
    group.scale.set(s, s, s);
  });

  return (
    <group ref={groupRef}>
      <primitive object={clonedScene} />
    </group>
  );
}
