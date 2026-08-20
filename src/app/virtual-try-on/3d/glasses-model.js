"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Box3, Vector3 } from "three";

/**
 * Three.js component that loads and renders the glasses GLB model.
 * Position, rotation, and scale are updated every frame from the
 * `poseRef` shared by the parent overlay component.
 */
export default function GlassesModel({ modelUrl, onReady, poseRef, videoDimensions }) {
  const groupRef = useRef();
  const { scene } = useGLTF(modelUrl);
  const { camera } = useThree();

  const model = useMemo(() => {
    const clonedScene = scene.clone(true);
    const bounds = new Box3().setFromObject(clonedScene);
    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    const normalisingScale = size.x > 0 ? 1 / size.x : 1;

    clonedScene.traverse((child) => {
      if (!child.isMesh) return;
      child.frustumCulled = false;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      const adjustedMaterials = materials.map((material) => {
        const adjustedMaterial = material?.clone?.() ?? material;
        if (adjustedMaterial) {
          adjustedMaterial.roughness = Math.max(0.22, adjustedMaterial.roughness ?? 0.45);
          adjustedMaterial.metalness = Math.min(0.72, adjustedMaterial.metalness ?? 0.2);
          adjustedMaterial.needsUpdate = true;
        }
        return adjustedMaterial;
      });
      child.material = Array.isArray(child.material) ? adjustedMaterials : adjustedMaterials[0];
    });
    return {
      normalisingScale,
      offset: [-center.x, -center.y, -bounds.min.z],
      scene: clonedScene,
    };
  }, [scene]);

  useEffect(() => {
    onReady?.();
  }, [onReady]);

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
      <group scale={model.normalisingScale}>
        <primitive object={model.scene} position={model.offset} />
      </group>
    </group>
  );
}
