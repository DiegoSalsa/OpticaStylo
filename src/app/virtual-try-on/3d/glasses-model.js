"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BufferAttribute, BufferGeometry, DoubleSide } from "three";

const TEMPLE_DETAIL_PATTERN = /(?:temple|brand_(?:plaque|wordmark)|inner_model_marking)/i;

function injectAfter(source, marker, addition) {
  return source.includes(marker)
    ? source.replace(marker, `${marker}\n${addition}`)
    : source;
}

function prepareTempleMaterial(material, geometry) {
  const uniforms = {
    bendRadians: { value: 0 },
    bendStart: { value: geometry.bendStart },
  };
  material.userData.tryOnTempleUniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTryOnTempleBend = uniforms.bendRadians;
    shader.uniforms.uTryOnTempleBendStart = uniforms.bendStart;
    shader.vertexShader = `
      uniform float uTryOnTempleBend;
      uniform float uTryOnTempleBendStart;
    ${shader.vertexShader}`;
    shader.vertexShader = injectAfter(
      shader.vertexShader,
      "#include <begin_vertex>",
      `
        float tryOnBendDistance = max(0.0, position.z - uTryOnTempleBendStart);
        transformed.x += sign(position.x) * tan(uTryOnTempleBend) * tryOnBendDistance;
      `,
    );
  };
  material.customProgramCacheKey = () => "optica-stylo-temple-v2";
  material.needsUpdate = true;
  return uniforms;
}

function prepareLensMaterial(material) {
  material.envMapIntensity = 1.9;
  material.opacity = Math.max(0.1, material.opacity ?? 1);
  material.roughness = Math.max(0.06, material.roughness ?? 0.1);
  material.transparent = true;
  material.depthWrite = false;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `
        float tryOnLensFresnel = pow(
          1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0),
          2.4
        );
        diffuseColor.rgb = mix(
          diffuseColor.rgb,
          vec3(0.64, 0.82, 0.77),
          tryOnLensFresnel * 0.2
        );
        diffuseColor.a = clamp(diffuseColor.a + tryOnLensFresnel * 0.15, 0.0, 0.24);
        #include <opaque_fragment>
      `,
    );
  };
  material.customProgramCacheKey = () => "optica-stylo-lens-v1";
  material.needsUpdate = true;
}

function actualizarCurvaturaPatillas(uniforms, bendRadians) {
  uniforms.bendRadians.value = bendRadians;
}

/**
 * Componente Three.js que carga y renderiza el modelo GLB de lentes.
 * La posición, rotación y escala se actualizan en cada fotograma desde
 * la referencia de pose compartida por el componente contenedor.
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
  const templeUniformsRef = useRef([]);
  const { scene } = useGLTF(modelUrl);
  const faceMeshGeometry = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(468 * 3), 3));
    geometry.setIndex(faceMeshTriangleIndices ?? []);
    return geometry;
  }, [faceMeshTriangleIndices]);

  const model = useMemo(() => {
    const clonedScene = scene.clone(true);
    const lensNodes = new Set([
      ...modelMetadata.nodes.lensLeft,
      ...modelMetadata.nodes.lensRight,
    ]);
    const templeNodes = new Set([
      ...modelMetadata.nodes.templeLeft,
      ...modelMetadata.nodes.templeRight,
    ]);
    const templeUniforms = [];
    const millimetersPerUnit = modelMetadata.normalization.millimetersPerUnit;
    const hingeDepth = (
      modelMetadata.anchorsRaw.hingeLeft[2]
      + modelMetadata.anchorsRaw.hingeRight[2]
    ) * 0.5;
    const templeGeometry = {
      bendStart: hingeDepth,
    };

    clonedScene.traverse((child) => {
      if (!child.isMesh) return;
      child.frustumCulled = false;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      const adjustedMaterials = materials.map((material) => {
        const adjustedMaterial = material?.clone?.() ?? material;
        if (adjustedMaterial) {
          if (lensNodes.has(child.name)) {
            prepareLensMaterial(adjustedMaterial);
            child.renderOrder = 4;
          } else {
            adjustedMaterial.envMapIntensity = 1.65;
            adjustedMaterial.roughness = Math.max(
              0.14,
              adjustedMaterial.roughness ?? 0.4,
            );
          }
          if (templeNodes.has(child.name) || TEMPLE_DETAIL_PATTERN.test(child.name)) {
            templeUniforms.push(prepareTempleMaterial(adjustedMaterial, templeGeometry));
          }
          adjustedMaterial.needsUpdate = true;
        }
        return adjustedMaterial;
      });
      child.material = Array.isArray(child.material) ? adjustedMaterials : adjustedMaterials[0];
    });
    return {
      millimetersPerUnit,
      offset: modelMetadata.normalization.offsetRaw,
      scene: clonedScene,
      templeUniforms,
    };
  }, [modelMetadata, scene]);

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  useEffect(() => () => faceMeshGeometry.dispose(), [faceMeshGeometry]);

  useEffect(() => () => {
    model.scene.traverse((child) => {
      if (!child.isMesh) return;
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
        material?.dispose?.();
      }
    });
  }, [model]);

  useEffect(() => {
    templeUniformsRef.current = model.templeUniforms;
    return () => {
      templeUniformsRef.current = [];
    };
  }, [model.templeUniforms]);

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
    if (pose.quaternion) {
      group.quaternion.fromArray(pose.quaternion);
    } else {
      group.rotation.set(pose.rotation[0], pose.rotation[1], pose.rotation[2]);
    }
    const s = pose.scale;
    group.scale.set(s, s, s);

    for (const uniforms of templeUniformsRef.current) {
      actualizarCurvaturaPatillas(uniforms, pose.templeBendRadians ?? 0);
    }

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
