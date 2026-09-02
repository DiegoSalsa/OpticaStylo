"use client";

import { Environment, Lightformer } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";

import { formatClp } from "@/utils/store-client";

import styles from "./virtual-try-on-3d.module.css";

const GlassesModel = dynamic(() => import("./glasses-model"), { ssr: false });

export default function Glasses3DInterface({ model }) {
  const {
    addSelectedModelToCart,
    cameraActive,
    cameraAspectRatio,
    cameraStatus,
    cameraVisual,
    captureTryOn,
    cartMessage,
    catalogSearch,
    changeCamera,
    displayedStatusMessage,
    faceDetected,
    faceMeshTriangleIndices,
    filteredModels,
    fitAdjustment,
    halfHeight,
    halfWidth,
    handleModelReady,
    handlePhotoSelected,
    isAddingToCart,
    modelError,
    modelMetadata,
    modelReady,
    openPhotoCapture,
    photoImageRef,
    photoInputRef,
    photoUrl,
    poseRef,
    rendererCanvasRef,
    resetFitAdjustment,
    selectedModel,
    setCameraVisual,
    setCatalogSearch,
    setPhotoLoaded,
    setSelectedModel,
    setShowOverlay,
    showOverlay,
    startCamera,
    updateFitAdjustment,
    videoDimensions,
    videoRef,
    viewerState,
  } = model;

  return (
    <section className={styles.experience} aria-label="Probador virtual 3D">
      <aside className={styles.guidePanel}>
        <div className={styles.cameraState} data-active={cameraActive}>
          <span aria-hidden="true" />
          <div>
            <strong>
              {cameraStatus === "ready"
                ? "Cámara activa"
                : cameraStatus === "photo"
                  ? "Foto cargada"
                  : "Cámara inactiva"}
            </strong>
            <small>
              {cameraStatus === "photo"
                ? "Procesada en este dispositivo"
                : "Conexión segura y local"}
            </small>
          </div>
        </div>
        <section
          className={styles.guideCard}
          aria-labelledby="quick-guide-title"
        >
          <p className={styles.panelTitle} id="quick-guide-title">
            Guía rápida
          </p>
          <ol>
            <li>
              <span>1.</span>
              <p>Mantén tu rostro centrado en la guía.</p>
            </li>
            <li>
              <span>2.</span>
              <p>Asegura buena iluminación frontal.</p>
            </li>
            <li>
              <span>3.</span>
              <p>Usa los controles para ajustar visualmente.</p>
            </li>
          </ol>
        </section>
        <section
          className={styles.adjustmentCard}
          aria-labelledby="visual-adjustments-title"
        >
          <p className={styles.panelTitle} id="visual-adjustments-title">
            Ajustes visuales
          </p>
          <label>
            <span>Brillo</span>
            <output>{cameraVisual.brightness}%</output>
            <input
              aria-label="Brillo de la cámara"
              max="125"
              min="75"
              onChange={(event) =>
                setCameraVisual((current) => ({
                  ...current,
                  brightness: Number(event.target.value),
                }))
              }
              type="range"
              value={cameraVisual.brightness}
            />
          </label>
          <label>
            <span>Contraste</span>
            <output>{cameraVisual.contrast}%</output>
            <input
              aria-label="Contraste de la cámara"
              max="125"
              min="75"
              onChange={(event) =>
                setCameraVisual((current) => ({
                  ...current,
                  contrast: Number(event.target.value),
                }))
              }
              type="range"
              value={cameraVisual.contrast}
            />
          </label>
        </section>
        <p className={styles.guidePrivacy}>
          <span aria-hidden="true">●</span> El video no se guarda ni sale de tu
          dispositivo.
        </p>
      </aside>
      <div className={styles.viewerPanel}>
        <div
          className={styles.viewer}
          data-status={viewerState}
          style={
            cameraAspectRatio
              ? { "--camera-aspect-ratio": String(cameraAspectRatio) }
              : undefined
          }
        >
          <video
            className={styles.videoElement}
            ref={videoRef}
            autoPlay
            muted
            playsInline
            data-hidden={cameraStatus !== "ready"}
            style={{
              filter: `brightness(${cameraVisual.brightness}%) contrast(${cameraVisual.contrast}%)`,
            }}
          />

          {photoUrl && (
            <Image
              ref={photoImageRef}
              alt="Foto para probar el marco 3D"
              className={styles.photoElement}
              data-hidden={cameraStatus !== "photo"}
              fill
              onLoad={() => setPhotoLoaded(true)}
              sizes="(max-width: 780px) 100vw, 55vw"
              src={photoUrl}
              style={{
                filter: `brightness(${cameraVisual.brightness}%) contrast(${cameraVisual.contrast}%)`,
              }}
              unoptimized
            />
          )}

          {cameraActive && (
            <Canvas
              key={`${videoDimensions.width}x${videoDimensions.height}`}
              className={styles.threeCanvas}
              data-cropped={Boolean(cameraAspectRatio)}
              data-visible={showOverlay}
              dpr={[1, 1.5]}
              gl={{
                alpha: true,
                antialias: true,
                powerPreference: "high-performance",
                preserveDrawingBuffer: true,
              }}
              onCreated={({ gl }) => {
                rendererCanvasRef.current = gl.domElement;
                gl.toneMappingExposure = 1.1;
              }}
              orthographic
              camera={{
                left: -halfWidth,
                right: halfWidth,
                top: halfHeight,
                bottom: -halfHeight,
                near: -2000,
                far: 2000,
                position: [0, 0, 500],
              }}
              style={{
                "--overlay-aspect-ratio": cameraAspectRatio ?? undefined,
                pointerEvents: "none",
              }}
            >
              <hemisphereLight args={["#ffffff", "#52635e", 1.05]} />
              <directionalLight position={[250, 320, 480]} intensity={1.7} />
              <directionalLight position={[-280, 40, 260]} intensity={0.65} />
              <Environment resolution={128}>
                <Lightformer
                  color="#ffffff"
                  form="rect"
                  intensity={3.4}
                  position={[0, 4, 6]}
                  scale={[8, 3, 1]}
                />
                <Lightformer
                  color="#d9eee7"
                  form="rect"
                  intensity={2.1}
                  position={[-5, 1, 2]}
                  rotation={[0, Math.PI / 2, 0]}
                  scale={[4, 5, 1]}
                />
                <Lightformer
                  color="#f1d8b8"
                  form="rect"
                  intensity={1.5}
                  position={[5, -1, 1]}
                  rotation={[0, -Math.PI / 2, 0]}
                  scale={[3, 4, 1]}
                />
              </Environment>
              <Suspense fallback={null}>
                {modelMetadata && (
                  <GlassesModel
                    key={selectedModel.assetId}
                    faceMeshTriangleIndices={faceMeshTriangleIndices}
                    modelMetadata={modelMetadata}
                    modelUrl={selectedModel.modelUrl}
                    onReady={handleModelReady}
                    poseRef={poseRef}
                  />
                )}
              </Suspense>
            </Canvas>
          )}

          <div className={styles.focusGuide} aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className={styles.faceOval} aria-hidden="true" />

          {cameraStatus !== "ready" && cameraStatus !== "photo" && (
            <div className={styles.viewerPlaceholder}>
              <span className={styles.placeholderIcon} aria-hidden="true">
                <span />
              </span>
              <strong>
                {cameraStatus === "loading"
                  ? "Autoriza tu cámara"
                  : "Activa tu cámara"}
              </strong>
              <span>
                {cameraStatus === "loading"
                  ? "Acepta el permiso que muestra tu navegador."
                  : "Tu imagen se procesa solo en este dispositivo."}
              </span>
              {cameraStatus !== "loading" && (
                <button
                  className={styles.viewerCta}
                  type="button"
                  onClick={() =>
                    typeof window !== "undefined" && !window.isSecureContext
                      ? openPhotoCapture()
                      : startCamera()
                  }
                >
                  {typeof window !== "undefined" && !window.isSecureContext
                    ? "Tomar o subir una foto"
                    : "Probarme este marco"}
                </button>
              )}
            </div>
          )}

          {cameraActive && !faceDetected && (
            <div className={styles.faceHint}>
              <span aria-hidden="true" />
              Centra tu rostro y mira de frente
            </div>
          )}

          {cameraActive && (!modelReady || modelError) && (
            <div className={styles.modelLoading}>
              {modelError
                ? "El marco 3D necesita revisión."
                : "Preparando el marco 3D…"}
            </div>
          )}

          <div className={styles.liveBadge} data-active={cameraActive}>
            <span aria-hidden="true" />
            {cameraStatus === "ready"
              ? "Cámara activa"
              : cameraStatus === "photo"
                ? "Foto cargada"
                : "Cámara apagada"}
          </div>
          <div className={styles.trackingBadge} data-active={faceDetected}>
            <span aria-hidden="true">{faceDetected ? "✓" : "⌁"}</span>
            {faceDetected ? "Rostro detectado" : "Buscando rostro"}
          </div>
        </div>

        <div className={styles.cameraControls}>
          <p>Controles de cámara</p>
          <div className={styles.viewerDock}>
            <button
              className={styles.dockButton}
              disabled={cameraStatus === "loading"}
              onClick={() =>
                cameraStatus === "ready"
                  ? changeCamera()
                  : cameraStatus === "photo" ||
                      (typeof window !== "undefined" && !window.isSecureContext)
                    ? openPhotoCapture()
                    : startCamera()
              }
              type="button"
            >
              <span aria-hidden="true">↻</span>
              {cameraStatus === "ready"
                ? "Cambiar cámara"
                : cameraStatus === "photo"
                  ? "Tomar otra foto"
                  : "Activar cámara"}
            </button>
            <button
              className={styles.captureButton}
              disabled={!faceDetected || !modelReady}
              onClick={captureTryOn}
              type="button"
            >
              <span aria-hidden="true">▣</span>Guardar foto
            </button>
            <button
              aria-pressed={!showOverlay}
              className={styles.dockButton}
              disabled={!cameraActive}
              onClick={() => setShowOverlay((current) => !current)}
              type="button"
            >
              <span aria-hidden="true">◐</span>
              {showOverlay ? "Ver sin marco" : "Ver con marco"}
            </button>
          </div>
        </div>
        <p className={styles.status} aria-live="polite">
          {displayedStatusMessage}
        </p>
        <article className={styles.selectedFrame}>
          <div className={styles.frameThumb} aria-hidden="true">
            <span />
            <span />
            <i />
          </div>
          <div className={styles.selectedFrameCopy}>
            <h2>{selectedModel.name}</h2>
            <p>Modelo {selectedModel.sku}</p>
            <strong>
              {selectedModel.unitPriceCents
                ? formatClp(selectedModel.unitPriceCents)
                : "Muestra 3D"}
            </strong>
          </div>
          <button
            className={styles.addButton}
            disabled={isAddingToCart}
            onClick={addSelectedModelToCart}
            type="button"
          >
            {isAddingToCart ? "Agregando…" : "Agregar al carrito"}
          </button>
          {cartMessage && (
            <p className={styles.cartMessage} role="status">
              {cartMessage}
            </p>
          )}
        </article>
      </div>

      <input
        ref={photoInputRef}
        className={styles.photoInput}
        accept="image/*"
        capture="environment"
        onChange={handlePhotoSelected}
        type="file"
      />

      <aside className={styles.controlsPanel}>
        <div className={styles.catalogHeader}>
          <p className={styles.panelTitle}>Catálogo virtual</p>
          <p>Selecciona un modelo para probártelo en vivo.</p>
        </div>
        <label className={styles.catalogSearch}>
          <span aria-hidden="true">⌕</span>
          <input
            onChange={(event) => setCatalogSearch(event.target.value)}
            placeholder="Buscar marcos…"
            type="search"
            value={catalogSearch}
          />
        </label>
        <div className={styles.modelPicker} aria-live="polite">
          {filteredModels.map((model) => (
            <article
              className={styles.catalogItem}
              data-selected={selectedModel.assetId === model.assetId}
              key={model.assetId}
            >
              <div className={styles.catalogArt} aria-hidden="true">
                <span />
                <span />
                <i />
              </div>
              <div>
                <strong>{model.name}</strong>
                <small>{model.sku}</small>
                <b>
                  {model.unitPriceCents
                    ? formatClp(model.unitPriceCents)
                    : "Muestra técnica"}
                </b>
              </div>
              <button
                aria-pressed={selectedModel.assetId === model.assetId}
                onClick={() => setSelectedModel(model)}
                type="button"
              >
                {selectedModel.assetId === model.assetId
                  ? "Probando"
                  : "Probar"}
              </button>
            </article>
          ))}
          {filteredModels.length === 0 && (
            <p className={styles.emptyCatalog}>
              No encontramos marcos con esa búsqueda.
            </p>
          )}
        </div>
        <div className={styles.fitCard}>
          <div>
            <p className={styles.panelTitle}>Ajuste fino</p>
            <p>
              El calce automático se adapta al rostro; puedes corregirlo
              visualmente.
            </p>
          </div>
          <div className={styles.fitControls}>
            <button
              aria-label="Reducir tamaño del marco"
              disabled={fitAdjustment.scaleFactor <= 0.88}
              onClick={() => updateFitAdjustment("scaleFactor", -0.02)}
              type="button"
            >
              −
            </button>
            <output aria-label="Tamaño del marco">
              {Math.round(fitAdjustment.scaleFactor * 100)}%
            </output>
            <button
              aria-label="Aumentar tamaño del marco"
              disabled={fitAdjustment.scaleFactor >= 1.12}
              onClick={() => updateFitAdjustment("scaleFactor", 0.02)}
              type="button"
            >
              +
            </button>
            <button
              aria-label="Subir el marco"
              disabled={fitAdjustment.verticalOffsetMm <= -6}
              onClick={() => updateFitAdjustment("verticalOffsetMm", -1)}
              type="button"
            >
              ↑
            </button>
            <output aria-label="Altura del marco">
              {fitAdjustment.verticalOffsetMm === 0
                ? "Centro"
                : `${fitAdjustment.verticalOffsetMm > 0 ? "+" : ""}${fitAdjustment.verticalOffsetMm} mm`}
            </output>
            <button
              aria-label="Bajar el marco"
              disabled={fitAdjustment.verticalOffsetMm >= 6}
              onClick={() => updateFitAdjustment("verticalOffsetMm", 1)}
              type="button"
            >
              ↓
            </button>
          </div>
          <button
            className={styles.resetButton}
            onClick={resetFitAdjustment}
            type="button"
          >
            Restablecer ajuste
          </button>
        </div>
        {!selectedModel.isDemo && (
          <p className={styles.licenseNote}>
            Activo con licencia {selectedModel.licenseCode}
            {selectedModel.attribution ? ` · ${selectedModel.attribution}` : ""}
          </p>
        )}
        <Link href="/tienda" className={styles.linkCard}>
          <span aria-hidden="true">←</span> Ver catálogo completo
        </Link>
      </aside>
    </section>
  );
}
