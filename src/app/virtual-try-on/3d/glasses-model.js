"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";

/**
 * Three.js component that loads and renders the glasses GLB model.
 * Position, rotation, and scale are updated every frame from the
 * `poseRef` shared by the parent overlay component.
 */
export default function GlassesModel({ modelMetadata, modelUrl, onReady, poseRef }) {
  const groupRef = useRef();
  const occluderRef = useRef();
  const { scene } = useGLTF(modelUrl);

  const model = useMemo(() => {
    const clonedScene = scene.clone(true);

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
      millimetersPerUnit: modelMetadata.normalization.millimetersPerUnit,
      offset: modelMetadata.normalization.offsetRaw,
      scene: clonedScene,
    };
  }, [modelMetadata, scene]);

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  useFrame(() => {
    const group = groupRef.current;
    const occluder = occluderRef.current;
    const pose = poseRef.current;
    if (!group || !occluder) return;

    if (!pose) {
      group.visible = false;
      occluder.visible = false;
      return;
    }

    group.visible = true;
    group.position.set(pose.position[0], pose.position[1], pose.position[2]);
    group.rotation.set(pose.rotation[0], pose.rotation[1], pose.rotation[2]);
    const s = pose.scale;
    group.scale.set(s, s, s);

    occluder.visible = true;
    occluder.position.set(...pose.occluder.position);
    occluder.rotation.set(...pose.occluder.rotation);
    occluder.scale.set(...pose.occluder.scale);
  });

  return (
    <>
      <mesh ref={occluderRef} renderOrder={-100} visible={false}>
        <sphereGeometry args={[1, 40, 24]} />
        <meshBasicMaterial
          colorWrite={false}
          depthTest
          depthWrite
        />
      </mesh>
      <group ref={groupRef} visible={false}>
        <group scale={model.millimetersPerUnit}>
          <primitive object={model.scene} position={model.offset} />
        </group>
      </group>
    </>
  );
}
