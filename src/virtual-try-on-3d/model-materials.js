import { TEMPLE_BEND_TRANSITION_MM } from "./temple-fitting.js";

function injectAfter(source, marker, addition) {
  return source.includes(marker)
    ? source.replace(marker, `${marker}\n${addition}`)
    : source;
}

export function prepareTempleMaterial(material, geometry) {
  const uniforms = {
    bendRadians: { value: 0 },
    bendStart: { value: geometry.bendStart },
    bendDirection: { value: geometry.bendDirection },
    side: { value: geometry.side ?? 0 },
    transition: { value: TEMPLE_BEND_TRANSITION_MM },
  };
  material.userData.tryOnTempleUniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTryOnTempleBend = uniforms.bendRadians;
    shader.uniforms.uTryOnTempleBendStart = uniforms.bendStart;
    shader.uniforms.uTryOnTempleBendDirection = uniforms.bendDirection;
    shader.uniforms.uTryOnTempleSide = uniforms.side;
    shader.uniforms.uTryOnTempleTransition = uniforms.transition;
    shader.vertexShader = `
      uniform float uTryOnTempleBend;
      uniform float uTryOnTempleBendStart;
      uniform float uTryOnTempleBendDirection;
      uniform float uTryOnTempleSide;
      uniform float uTryOnTempleTransition;
    ${shader.vertexShader}`;
    shader.vertexShader = injectAfter(
      shader.vertexShader,
      "#include <begin_vertex>",
      `
        float tryOnBendDistance = max(
          0.0, uTryOnTempleBendDirection * (position.z - uTryOnTempleBendStart)
        );
        float tryOnSide = uTryOnTempleSide == 0.0 ? sign(position.x) : uTryOnTempleSide;
        transformed.x += tryOnSide * tan(uTryOnTempleBend)
          * tryOnBendDistance * tryOnBendDistance / (tryOnBendDistance + uTryOnTempleTransition);
      `,
    );
    // Inverse transpose of the X/Z shear keeps specular highlights attached to
    // the deformed surface (front vertices and hinge have zero derivative).
    shader.vertexShader = injectAfter(shader.vertexShader, "#include <beginnormal_vertex>", `
      float tryOnNormalD = max(0.0, uTryOnTempleBendDirection * (position.z - uTryOnTempleBendStart));
      float tryOnNormalSide = uTryOnTempleSide == 0.0 ? sign(position.x) : uTryOnTempleSide;
      float tryOnSlope = tryOnNormalSide * tan(uTryOnTempleBend) * uTryOnTempleBendDirection
        * tryOnNormalD * (tryOnNormalD + 2.0 * uTryOnTempleTransition)
        / pow(tryOnNormalD + uTryOnTempleTransition, 2.0);
      objectNormal.z -= tryOnSlope * objectNormal.x;
    `);
  };
  material.customProgramCacheKey = () => "optica-stylo-temple-v4";
  material.needsUpdate = true;
  return uniforms;
}

export function prepareLensMaterial(material, lensOpacity, lensTintStrength = 1) {
  material.envMapIntensity = 1.9;
  material.roughness = Math.max(0.06, material.roughness ?? 0.1);
  material.transparent = true;
  material.depthWrite = false;

  if (Number.isFinite(lensOpacity)) {
    // El video está fuera de WebGL: la transmisión física no puede muestrearlo.
    // Conservar el tinte del GLB y componerlo sobre la cámara mediante alfa.
    material.transmission = 0;
    material.opacity = Math.min(1, Math.max(0, lensOpacity));
    material.color.multiplyScalar(Math.min(1, Math.max(0, lensTintStrength)));
    material.needsUpdate = true;
    return;
  }

  material.opacity = Math.max(0.1, material.opacity ?? 1);
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
