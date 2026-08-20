"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BufferAttribute, BufferGeometry, DoubleSide } from "three";

/**
 * Three.js component that loads and renders the glasses GLB model.
 * Position, rotation, and scale are updated every frame from the
 * `poseRef` shared by the parent overlay component.
 */
export default function GlassesModel({
  faceMeshTriangleIndices,
  modelMetadata,
  modelUrl,
  onReady,
  poseRef,
}) {
  const groupRef = useRef();
  const occluderRef = useRef();
  const { scene } = useGLTF(modelUrl);
  const faceMeshGeometry = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(468 * 3), 3));
    geometry.setIndex(faceMeshTriangleIndices ?? []);
    return geometry;
  }, [faceMeshTriangleIndices]);

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

  useEffect(() => () => faceMeshGeometry.dispose(), [faceMeshGeometry]);

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

    const facePositions = pose.faceMesh?.positions;
    const positionAttribute = faceMeshGeometry.getAttribute("position");
    if (facePositions && faceMeshTriangleIndices?.length > 0) {
      positionAttribute.array.set(facePositions);
      positionAttribute.needsUpdate = true;
      occluder.visible = true;
    } else {
      occluder.visible = false;
    }
  });

  return (
    <>
      <mesh
        ref={occluderRef}
        geometry={faceMeshGeometry}
        frustumCulled={false}
        renderOrder={-100}
        visible={false}
      >
        <meshBasicMaterial
          colorWrite={false}
          depthTest
          depthWrite
          side={DoubleSide}
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
