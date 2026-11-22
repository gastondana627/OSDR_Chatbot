import { useEffect, useId, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  ArrowLeft,
  Box,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Info,
  RotateCcw,
  Sparkles,
  Target,
  Upload,
} from "lucide-react";
import {
  buildBrainAwgDemoDataset,
  computeGroupSummaries,
  generateOrdinationSvgSnapshot,
  getProvenanceBadgeText,
  ordinateFromCsvText,
  validateOrdinationJson,
} from "../../utils/brainOrdination.js";

function createAxisLabelSprite(text, hexColor) {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 76;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(8, 13, 23, 0.88)";
  ctx.strokeStyle = hexColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(10, 12, canvas.width - 20, canvas.height - 24, 14);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = hexColor;
  ctx.font = "700 26px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.72, 0.415, 1);
  return sprite;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

const SAMPLE_DOWNLOAD_CSV = [
  "sample_id,condition,model_organism,pathway_panel,cohort_status,Complex_I_Module,Complex_III_Module,Complex_IV_Module,ATP_Synthase_Module,ROS_Detox_SOD_Module,Mitophagy_PINK1_Module,Mito_Dynamics_DRP1_Module,NAD_Salvage_Module",
  "DEMO_GC_01,Ground Control,Drosophila melanogaster,Illustrative OxPhos/ROS Panel,Illustrative Demo (Non-Empirical),860,810,940,880,410,520,390,910",
  "DEMO_GC_02,Ground Control,Drosophila melanogaster,Illustrative OxPhos/ROS Panel,Illustrative Demo (Non-Empirical),890,835,640,915,395,240,375,540",
  "DEMO_GC_03,Ground Control,Drosophila melanogaster,Illustrative OxPhos/ROS Panel,Illustrative Demo (Non-Empirical),820,775,990,855,435,560,415,960",
  "DEMO_SF_01,Spaceflight,Drosophila melanogaster,Illustrative OxPhos/ROS Panel,Illustrative Demo (Non-Empirical),475,520,690,530,960,1120,780,680",
  "DEMO_SF_02,Spaceflight,Drosophila melanogaster,Illustrative OxPhos/ROS Panel,Illustrative Demo (Non-Empirical),445,490,340,510,1040,560,825,290",
  "DEMO_SF_03,Spaceflight,Drosophila melanogaster,Illustrative OxPhos/ROS Panel,Illustrative Demo (Non-Empirical),515,550,740,565,915,1180,745,730",
  "DEMO_AD_01,Alzheimer's Model,Drosophila melanogaster,Illustrative OxPhos/ROS Panel,Illustrative Demo (Non-Empirical),340,380,520,390,1180,680,1120,480",
  "DEMO_AD_02,Alzheimer's Model,Drosophila melanogaster,Illustrative OxPhos/ROS Panel,Illustrative Demo (Non-Empirical),310,350,210,365,1260,290,1190,180",
  "DEMO_AD_03,Alzheimer's Model,Drosophila melanogaster,Illustrative OxPhos/ROS Panel,Illustrative Demo (Non-Empirical),375,410,560,415,1120,730,1060,510",
].join("\n");

export default function BrainAwgOrdinationExplorer({ onBackToChat }) {
  const fileInputId = useId();
  const demoDataset = useMemo(() => buildBrainAwgDemoDataset(), []);

  const [dataset, setDataset] = useState(demoDataset);
  const [selectedId, setSelectedId] = useState(() => demoDataset.samples[0]?.id || "");
  const [hoveredSample, setHoveredSample] = useState(null);
  const [showCentroids, setShowCentroids] = useState(true);
  const [hiddenGroups, setHiddenGroups] = useState(() => new Set());
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [statusAnnouncement, setStatusAnnouncement] = useState("");
  const [webglError, setWebglError] = useState("");
  const [showTable, setShowTable] = useState(true);

  const stageRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const sceneObjectsRef = useRef({
    meshes: [],
    selectionRing: null,
  });
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const groupSummaries = useMemo(() => computeGroupSummaries(dataset.samples), [dataset]);
  const colorByGroup = useMemo(
    () => new Map(groupSummaries.map((g) => [g.group, g.color])),
    [groupSummaries]
  );

  const selectedSample = useMemo(
    () => dataset.samples.find((s) => s.id === selectedId) || dataset.samples[0] || null,
    [dataset, selectedId]
  );

  // Update SPA document title per accessibility guidelines
  useEffect(() => {
    const prevTitle = document.title;
    document.title = "Brain AWG · 3D Ordination Explorer | OSDR ChatBot";
    return () => {
      document.title = prevTitle;
    };
  }, []);

  // Build / rebuild Three.js 3D Ordination Scene
  useEffect(() => {
    const container = stageRef.current;
    if (!container) return undefined;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true,
      });
    } catch (err) {
      setWebglError("WebGL 3D context is unavailable in this browser. Use the accessible sample table below or Export SVG.");
      return undefined;
    }

    setWebglError("");
    const width = Math.max(container.clientWidth || 640, 280);
    const height = Math.max(container.clientHeight || 480, 320);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x060a12, 1);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.setAttribute("aria-hidden", "true");
    container.innerHTML = "";
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(44, width / height, 0.1, 100);
    camera.position.set(6.0, 4.1, 6.4);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.minDistance = 2.4;
    controls.maxDistance = 24;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    // Lighting
    const ambient = new THREE.AmbientLight(0xdbeafe, 0.85);
    scene.add(ambient);
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.05);
    keyLight.position.set(6, 9, 7);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.45);
    fillLight.position.set(-7, -4, -6);
    scene.add(fillLight);

    // Reference subtle floor grid
    const gridHelper = new THREE.GridHelper(6.4, 12, 0x1e293b, 0x0f172a);
    gridHelper.position.y = -2.35;
    scene.add(gridHelper);

    // Coordinate scaling so any ordination fills [-2.0, 2.0] cleanly inside the axis frame
    let maxAbs = 0.001;
    for (const s of dataset.samples) {
      maxAbs = Math.max(maxAbs, Math.abs(s.pc1), Math.abs(s.pc2), Math.abs(s.pc3));
    }
    const coordScale = 2.0 / maxAbs;
    const toVec3 = (pc1, pc2, pc3) =>
      new THREE.Vector3(pc1 * coordScale, pc2 * coordScale, pc3 * coordScale);

    // Axes lines (PC1=X cyan, PC2=Y emerald, PC3=Z violet) with sprites offset ~1.30x past tips
    const axisSpan = 2.5;
    const labelOffsetHorizontal = axisSpan * 1.32;
    const labelOffsetVertical = axisSpan * 1.28;
    const axisSpecs = [
      {
        from: new THREE.Vector3(-axisSpan, 0, 0),
        to: new THREE.Vector3(axisSpan, 0, 0),
        color: 0x38bdf8,
        hex: "#7dd3fc",
        label: `PC1 (${((dataset.variance_explained?.[0] || 0) * 100).toFixed(1)}%)`,
        labelPos: new THREE.Vector3(labelOffsetHorizontal, 0.14, 0),
      },
      {
        from: new THREE.Vector3(0, -axisSpan, 0),
        to: new THREE.Vector3(0, axisSpan, 0),
        color: 0x34d399,
        hex: "#6ee7b7",
        label: `PC2 (${((dataset.variance_explained?.[1] || 0) * 100).toFixed(1)}%)`,
        labelPos: new THREE.Vector3(0, labelOffsetVertical, 0),
      },
      {
        from: new THREE.Vector3(0, 0, -axisSpan),
        to: new THREE.Vector3(0, 0, axisSpan),
        color: 0xa78bfa,
        hex: "#c4b5fd",
        label: `PC3 (${((dataset.variance_explained?.[2] || 0) * 100).toFixed(1)}%)`,
        labelPos: new THREE.Vector3(0, 0.14, labelOffsetHorizontal),
      },
    ];

    for (const axis of axisSpecs) {
      const geo = new THREE.BufferGeometry().setFromPoints([axis.from, axis.to]);
      const mat = new THREE.LineBasicMaterial({
        color: axis.color,
        transparent: true,
        opacity: 0.55,
      });
      scene.add(new THREE.Line(geo, mat));

      const sprite = createAxisLabelSprite(axis.label, axis.hex);
      if (sprite) {
        sprite.position.copy(axis.labelPos);
        scene.add(sprite);
      }
    }

    // Sample spheres
    const sphereGeo = new THREE.SphereGeometry(0.115, 24, 24);
    const interactiveMeshes = [];

    for (const sample of dataset.samples) {
      if (hiddenGroups.has(sample.group)) continue;
      const colorHex = colorByGroup.get(sample.group) || "#38bdf8";
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(colorHex),
        roughness: 0.28,
        metalness: 0.18,
        emissive: new THREE.Color(colorHex),
        emissiveIntensity: sample.id === selectedIdRef.current ? 0.55 : 0.16,
      });
      const mesh = new THREE.Mesh(sphereGeo, mat);
      mesh.position.copy(toVec3(sample.pc1, sample.pc2, sample.pc3));
      mesh.userData = { sample, baseColor: colorHex };
      scene.add(mesh);
      interactiveMeshes.push(mesh);
    }

    // Selection halo ring
    const ringGeo = new THREE.RingGeometry(0.165, 0.215, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
    });
    const selectionRing = new THREE.Mesh(ringGeo, ringMat);
    selectionRing.visible = false;
    scene.add(selectionRing);
    sceneObjectsRef.current = { meshes: interactiveMeshes, selectionRing };

    // Group centroids & dispersion spokes
    if (showCentroids) {
      const centroidGeo = new THREE.OctahedronGeometry(0.16, 0);
      for (const summary of groupSummaries) {
        if (hiddenGroups.has(summary.group)) continue;
        const cPos = toVec3(
          summary.centroid.pc1,
          summary.centroid.pc2,
          summary.centroid.pc3
        );
        const cMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(summary.color),
          emissive: new THREE.Color(summary.color),
          emissiveIntensity: 0.4,
          roughness: 0.2,
          metalness: 0.4,
          wireframe: true,
        });
        const cMesh = new THREE.Mesh(centroidGeo, cMat);
        cMesh.position.copy(cPos);
        scene.add(cMesh);

        const spokePoints = [];
        for (const s of dataset.samples) {
          if (s.group !== summary.group) continue;
          spokePoints.push(cPos, toVec3(s.pc1, s.pc2, s.pc3));
        }
        if (spokePoints.length > 0) {
          const spokeGeo = new THREE.BufferGeometry().setFromPoints(spokePoints);
          const spokeMat = new THREE.LineBasicMaterial({
            color: new THREE.Color(summary.color),
            transparent: true,
            opacity: 0.28,
          });
          scene.add(new THREE.LineSegments(spokeGeo, spokeMat));
        }
      }
    }

    // Raycaster hover & click
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hoveredMesh = null;
    let pointerDownPos = null;

    const getHitMesh = (clientX, clientY) => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(interactiveMeshes, false);
      return hits.length > 0 ? { mesh: hits[0].object, rect } : null;
    };

    const onPointerMove = (e) => {
      const hit = getHitMesh(e.clientX, e.clientY);
      if (hoveredMesh && hoveredMesh !== hit?.mesh) {
        hoveredMesh.scale.setScalar(1);
      }
      if (hit) {
        hoveredMesh = hit.mesh;
        hoveredMesh.scale.setScalar(1.38);
        renderer.domElement.style.cursor = "pointer";
        setHoveredSample({
          sample: hit.mesh.userData.sample,
          color: hit.mesh.userData.baseColor,
          x: Math.min(Math.max(e.clientX - hit.rect.left + 14, 12), hit.rect.width - 210),
          y: Math.min(Math.max(e.clientY - hit.rect.top - 12, 12), hit.rect.height - 96),
        });
      } else {
        hoveredMesh = null;
        renderer.domElement.style.cursor = "grab";
        setHoveredSample(null);
      }
    };

    const onPointerDown = (e) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e) => {
      if (!pointerDownPos) return;
      const moved = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      pointerDownPos = null;
      if (moved > 6) return; // Dragging orbit, not a click
      const hit = getHitMesh(e.clientX, e.clientY);
      if (hit?.mesh?.userData?.sample) {
        const picked = hit.mesh.userData.sample;
        setSelectedId(picked.id);
        setStatusAnnouncement(`Selected sample ${picked.id} in group ${picked.group}.`);
      }
    };

    const onPointerLeave = () => {
      if (hoveredMesh) {
        hoveredMesh.scale.setScalar(1);
        hoveredMesh = null;
      }
      setHoveredSample(null);
    };

    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);

    // ResizeObserver for container-aware responsiveness
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const nextW = Math.max(Math.floor(entry.contentRect.width), 280);
      const nextH = Math.max(Math.floor(entry.contentRect.height), 300);
      camera.aspect = nextW / nextH;
      camera.updateProjectionMatrix();
      renderer.setSize(nextW, nextH);
    });
    resizeObserver.observe(container);

    // Render loop
    let frameId = 0;
    const animate = () => {
      frameId = window.requestAnimationFrame(animate);
      controls.update();

      // Keep selection halo anchored to selected sample and facing camera
      const targetMesh = interactiveMeshes.find(
        (m) => m.userData?.sample?.id === selectedIdRef.current
      );
      if (targetMesh) {
        selectionRing.visible = true;
        selectionRing.position.copy(targetMesh.position);
        selectionRing.quaternion.copy(camera.quaternion);
      } else {
        selectionRing.visible = false;
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      controls.dispose();
      renderer.dispose();
      rendererRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
    };
  }, [dataset, groupSummaries, colorByGroup, showCentroids, hiddenGroups]);

  // Sync emissive highlight when selectedId changes via table/inspector without rebuilding scene
  useEffect(() => {
    for (const mesh of sceneObjectsRef.current.meshes) {
      const isSelected = mesh.userData?.sample?.id === selectedId;
      if (mesh.material) {
        mesh.material.emissiveIntensity = isSelected ? 0.65 : 0.16;
      }
    }
  }, [selectedId]);

  const handleResetCamera = () => {
    if (cameraRef.current && controlsRef.current) {
      cameraRef.current.position.set(6.0, 4.1, 6.4);
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
      setStatusAnnouncement("3D camera view reset to default orientation.");
    }
  };

  const handleToggleGroup = (groupName) => {
    setHiddenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupName)) {
        next.delete(groupName);
      } else {
        next.add(groupName);
      }
      return next;
    });
  };

  const processUploadedFile = async (file) => {
    if (!file) return;
    setUploadError("");
    try {
      const text = await file.text();
      const lowerName = file.name.toLowerCase();
      let parsed;
      if (lowerName.endsWith(".json") || text.trim().startsWith("{")) {
        const rawJson = JSON.parse(text);
        parsed = validateOrdinationJson(rawJson, file.name);
      } else {
        parsed = ordinateFromCsvText(text, {
          filename: file.name,
          permutations: 499,
          seed: 42,
        });
      }
      setDataset(parsed);
      setHiddenGroups(new Set());
      setSelectedId(parsed.samples[0]?.id || "");
      setStatusAnnouncement(
        `Loaded ${parsed.samples.length} samples from ${file.name}. PERMANOVA F = ${parsed.permanova.f_stat.toFixed(2)}, p = ${parsed.permanova.p_value.toFixed(4)}.`
      );
    } catch (err) {
      setUploadError(
        err instanceof Error
          ? err.message
          : "Could not parse uploaded file. Provide a skbio_to_3d.py JSON or sample-by-feature CSV/TSV."
      );
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      processUploadedFile(file);
    }
  };

  const handleExportPng = () => {
    const outCanvas = document.createElement("canvas");
    const outW = 1400;
    const outH = 880;
    outCanvas.width = outW;
    outCanvas.height = outH;
    const ctx = outCanvas.getContext("2d");
    if (!ctx) return;

    // Dark-space publication frame
    ctx.fillStyle = "#080d17";
    ctx.fillRect(0, 0, outW, outH);
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 2;
    ctx.strokeRect(18, 18, outW - 36, outH - 36);

    // Title & provenance badge
    ctx.fillStyle = "#f8fafc";
    ctx.font = "700 24px system-ui, -apple-system, sans-serif";
    ctx.fillText("Brain AWG · 3D Omics Ordination Explorer (scikit-bio rclr + PCoA)", 40, 58);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "500 15px system-ui, -apple-system, sans-serif";
    ctx.fillText(dataset.provenance?.dataset_label || "Ordination Cohort", 40, 84);

    // Badge
    const badgeLabel = getProvenanceBadgeText(dataset);
    ctx.fillStyle = dataset.isIllustrativeDemo ? "rgba(245, 158, 11, 0.16)" : "rgba(16, 185, 129, 0.16)";
    ctx.strokeStyle = dataset.isIllustrativeDemo ? "#f59e0b" : "#10b981";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(790, 32, 570, 36, 18);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = dataset.isIllustrativeDemo ? "#fcd34d" : "#6ee7b7";
    ctx.font = "600 13.5px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(badgeLabel, 1075, 55);
    ctx.textAlign = "left";

    // Draw live Three.js WebGL canvas snapshot
    const webglCanvas = rendererRef.current?.domElement;
    if (webglCanvas) {
      ctx.drawImage(webglCanvas, 40, 104, 940, 660);
      ctx.strokeStyle = "#1e293b";
      ctx.strokeRect(40, 104, 940, 660);
    }

    // Side readout box
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(1004, 104, 356, 660);
    ctx.strokeStyle = "#1e293b";
    ctx.strokeRect(1004, 104, 356, 660);

    const ve = dataset.variance_explained || [0, 0, 0];
    ctx.fillStyle = "#7dd3fc";
    ctx.font = "700 14px system-ui, -apple-system, sans-serif";
    ctx.fillText("ORDINATION STATISTICS", 1026, 138);

    const statsRows = [
      ["PERMANOVA F", Number(dataset.permanova?.f_stat || 0).toFixed(3)],
      [
        "PERMANOVA p-value",
        dataset.permanova?.permutations > 0
          ? Number(dataset.permanova.p_value).toFixed(4)
          : "N/A",
      ],
      ["Permutations", String(dataset.permanova?.permutations || 0)],
      ["Total Samples (n)", String(dataset.samples.length)],
      ["PC1 Variance", `${(ve[0] * 100).toFixed(1)}%`],
      ["PC2 Variance", `${(ve[1] * 100).toFixed(1)}%`],
      ["PC3 Variance", `${(ve[2] * 100).toFixed(1)}%`],
    ];
    statsRows.forEach(([k, v], idx) => {
      const y = 172 + idx * 32;
      ctx.fillStyle = "#94a3b8";
      ctx.font = "500 14px system-ui, -apple-system, sans-serif";
      ctx.fillText(k, 1026, y);
      ctx.fillStyle = "#f8fafc";
      ctx.font = "700 14px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(v, 1338, y);
      ctx.textAlign = "left";
    });

    // Group legend
    ctx.fillStyle = "#7dd3fc";
    ctx.font = "700 14px system-ui, -apple-system, sans-serif";
    ctx.fillText("COHORT GROUPS", 1026, 424);

    groupSummaries.forEach((g, idx) => {
      const y = 458 + idx * 34;
      if (y > 736) return;
      ctx.fillStyle = g.color;
      ctx.beginPath();
      ctx.arc(1036, y - 4, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "600 14px system-ui, -apple-system, sans-serif";
      ctx.fillText(g.group, 1054, y);
      ctx.fillStyle = "#94a3b8";
      ctx.textAlign = "right";
      ctx.fillText(`n = ${g.count}`, 1338, y);
      ctx.textAlign = "left";
    });

    // Footer provenance
    ctx.fillStyle = "#94a3b8";
    ctx.font = "500 13px system-ui, -apple-system, sans-serif";
    ctx.fillText(`Method: ${dataset.provenance?.method || "rclr + PCoA + PERMANOVA"}`, 40, 804);
    ctx.fillStyle = "#64748b";
    ctx.font = "400 12px system-ui, -apple-system, sans-serif";
    ctx.fillText(
      `Provenance: ${(dataset.provenance?.note || "").slice(0, 150)}`,
      40,
      830
    );

    outCanvas.toBlob((blob) => {
      if (blob) {
        downloadBlob(blob, "brain-awg-3d-ordination-snapshot.png");
        setStatusAnnouncement("Exported publication PNG snapshot.");
      }
    }, "image/png");
  };

  const handleExportSvg = () => {
    let yaw = 0.62;
    let pitch = 0.42;
    if (cameraRef.current) {
      const p = cameraRef.current.position;
      const r = Math.hypot(p.x, p.y, p.z) || 1;
      yaw = Math.atan2(p.x, p.z);
      pitch = Math.asin(Math.max(-0.95, Math.min(0.95, p.y / r)));
    }
    const svgText = generateOrdinationSvgSnapshot(dataset, {
      hiddenGroups: Array.from(hiddenGroups),
      showCentroids,
      yaw,
      pitch,
    });
    const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    downloadBlob(blob, "brain-awg-3d-ordination-snapshot.svg");
    setStatusAnnouncement("Exported publication vector SVG snapshot.");
  };

  const handleDownloadSampleCsv = () => {
    const blob = new Blob([SAMPLE_DOWNLOAD_CSV], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, "drosophila_mito_demo_combined.csv");
    setStatusAnnouncement("Downloaded illustrative Drosophila sample CSV template.");
  };

  const ve = dataset.variance_explained || [0, 0, 0];
  const pValDisplay =
    dataset.permanova?.permutations > 0
      ? dataset.permanova.p_value < 0.001
        ? "< 0.001"
        : Number(dataset.permanova.p_value).toFixed(4)
      : "N/A";

  return (
    <div className="brain-awg-page" data-testid="brain-awg-workspace">
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {statusAnnouncement}
      </div>

      {/* Dedicated Workspace Header */}
      <header className="brain-awg-header">
        <div className="brain-awg-header-main">
          <div className="brain-awg-top-row">
            <button
              type="button"
              className="brain-back-link"
              onClick={onBackToChat}
              data-testid="brain-back-to-chat"
            >
              <ArrowLeft size={14} aria-hidden="true" />
              <span>OSDR ChatBot Q&amp;A</span>
            </button>
            <span className="brain-scope-pill">
              <Box size={12} aria-hidden="true" />
              <span>scikit-bio · Decoupled Brain AWG Space</span>
            </span>
          </div>

          <h1 className="brain-awg-title">Brain AWG · 3D Ordination Explorer</h1>
          <p className="brain-awg-subtitle">
            Interactive 3D compositional ordination (<code>rclr</code> + Euclidean/Aitchison PCoA + PERMANOVA) for the Brain AWG Mitochondria Subgroup (<em>Drosophila melanogaster</em> ROS/OxPhos, Thread #3903) and Exosome cohorts (#2612).
          </p>
        </div>

        <div className="brain-awg-header-actions">
          <button
            type="button"
            className="brain-action-btn is-primary"
            onClick={handleExportPng}
            data-testid="brain-export-png"
          >
            <Download size={14} aria-hidden="true" />
            <span>Export PNG</span>
          </button>
          <button
            type="button"
            className="brain-action-btn"
            onClick={handleExportSvg}
            data-testid="brain-export-svg"
          >
            <Download size={14} aria-hidden="true" />
            <span>Export SVG</span>
          </button>
          <button
            type="button"
            className="brain-action-btn"
            onClick={handleResetCamera}
            data-testid="brain-reset-camera"
          >
            <RotateCcw size={14} aria-hidden="true" />
            <span>Reset View</span>
          </button>
          {!dataset.isIllustrativeDemo && (
            <button
              type="button"
              className="brain-action-btn"
              onClick={() => {
                setDataset(demoDataset);
                setHiddenGroups(new Set());
                setSelectedId(demoDataset.samples[0]?.id || "");
                setUploadError("");
                setStatusAnnouncement("Restored illustrative Drosophila OxPhos/ROS demo dataset.");
              }}
              data-testid="brain-reset-demo"
            >
              <Sparkles size={14} aria-hidden="true" />
              <span>Restore Demo</span>
            </button>
          )}
        </div>
      </header>

      {/* Explicit Demo vs Empirical Provenance Banner */}
      <div
        className={`brain-provenance-banner ${dataset.isIllustrativeDemo ? "is-demo" : "is-user"}`}
        data-testid="brain-demo-badge"
      >
        <Info size={15} aria-hidden="true" className="brain-provenance-icon" />
        <div className="brain-provenance-copy">
          <div className="brain-provenance-headline">
            <span className="brain-provenance-pill" data-testid="brain-provenance-pill">
              {getProvenanceBadgeText(dataset)}
            </span>
            {!dataset.isIllustrativeDemo && (
              <strong className="brain-provenance-dataset">
                {dataset.provenance?.dataset_label}
              </strong>
            )}
          </div>
          <span>{dataset.provenance?.note}</span>
        </div>
      </div>

      {/* Main Container-Query Grid: 3D Stage + Side Inspector */}
      <div className="brain-grid">
        <section className="brain-stage-card" aria-labelledby="brain-stage-heading">
          <div className="brain-stage-toolbar">
            <h2 id="brain-stage-heading" className="brain-card-heading">
              3D Aitchison Ordination Space
            </h2>
            <div className="brain-stage-controls">
              <button
                type="button"
                className={`brain-pill-toggle ${showCentroids ? "is-active" : ""}`}
                aria-pressed={showCentroids}
                onClick={() => setShowCentroids((prev) => !prev)}
                data-testid="brain-centroid-toggle"
              >
                <Target size={13} aria-hidden="true" />
                <span>Group Centroids: {showCentroids ? "On" : "Off"}</span>
              </button>
            </div>
          </div>

          <figure className="brain-canvas-figure">
            <div className="brain-canvas-wrap">
              <div
                ref={stageRef}
                className="brain-webgl-canvas"
                data-testid="brain-webgl-canvas"
              />
              {webglError && (
                <div className="brain-webgl-fallback" role="status">
                  {webglError}
                </div>
              )}

              {hoveredSample && (
                <div
                  className="brain-hover-tooltip"
                  style={{ left: `${hoveredSample.x}px`, top: `${hoveredSample.y}px` }}
                  aria-hidden="true"
                >
                  <div className="brain-tooltip-head">
                    <span
                      className="brain-swatch"
                      style={{ background: hoveredSample.color }}
                    />
                    <strong>{hoveredSample.sample.id}</strong>
                  </div>
                  <div className="brain-tooltip-group">{hoveredSample.sample.group}</div>
                  <div className="brain-tooltip-coords">
                    PC1 {hoveredSample.sample.pc1.toFixed(3)} · PC2 {hoveredSample.sample.pc2.toFixed(3)} · PC3 {hoveredSample.sample.pc3.toFixed(3)}
                  </div>
                </div>
              )}

              <div className="brain-axis-legend" aria-hidden="true">
                <span className="axis-chip is-pc1">PC1 {(ve[0] * 100).toFixed(1)}%</span>
                <span className="axis-chip is-pc2">PC2 {(ve[1] * 100).toFixed(1)}%</span>
                <span className="axis-chip is-pc3">PC3 {(ve[2] * 100).toFixed(1)}%</span>
              </div>
            </div>
            <figcaption className="brain-canvas-caption">
              Drag to orbit, scroll to zoom, right-drag to pan, and click any sample sphere (or select a row in the accessible sample table below) to inspect metadata.
            </figcaption>
          </figure>
        </section>

        <aside
          className="brain-inspector-rail"
          aria-label="Ordination upload, statistics, and sample inspector"
        >
          {/* Upload / Dropzone Card */}
          <div className="brain-card">
            <h2 className="brain-card-heading">Load Your Cohort (JSON or CSV/TSV)</h2>
            <div
              className={`brain-dropzone ${isDragOver ? "is-drag-over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              data-testid="brain-dropzone"
            >
              <Upload size={20} aria-hidden="true" className="brain-drop-icon" />
              <p className="brain-drop-title">
                Drop <code>skbio_to_3d.py</code> JSON or any sample-by-feature CSV/TSV
              </p>
              <p className="brain-drop-hint" id={`${fileInputId}-hint`}>
                Runs 100% locally in your browser (client-side <code>rclr</code> + 3D PCoA + PERMANOVA fallback - zero Python setup needed).
              </p>
              <div className="brain-drop-actions">
                <label htmlFor={fileInputId} className="brain-upload-label">
                  Choose File
                </label>
                <input
                  id={fileInputId}
                  type="file"
                  accept=".json,.csv,.tsv,.txt"
                  className="visually-hidden"
                  aria-describedby={`${fileInputId}-hint`}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) processUploadedFile(file);
                    e.target.value = "";
                  }}
                  data-testid="brain-file-input"
                />
                <button
                  type="button"
                  className="brain-ghost-btn"
                  onClick={handleDownloadSampleCsv}
                >
                  <FileSpreadsheet size={13} aria-hidden="true" />
                  <span>Sample CSV</span>
                </button>
              </div>
            </div>
            {uploadError && (
              <p className="brain-error-banner" role="alert" data-testid="brain-upload-error">
                {uploadError}
              </p>
            )}
          </div>

          {/* Statistical Readout Card */}
          <div className="brain-card" data-testid="brain-stats-card">
            <h2 className="brain-card-heading">Statistical Readout</h2>
            <dl className="brain-stat-grid">
              <div className="brain-stat-tile">
                <dt>PERMANOVA F</dt>
                <dd data-testid="brain-permanova-f">
                  {Number(dataset.permanova?.f_stat || 0).toFixed(3)}
                </dd>
              </div>
              <div className="brain-stat-tile">
                <dt>PERMANOVA p-value</dt>
                <dd className="is-accent" data-testid="brain-permanova-p">
                  {pValDisplay}
                </dd>
              </div>
              <div className="brain-stat-tile">
                <dt>Transform</dt>
                <dd className="is-mono">rclr + PCoA</dd>
              </div>
              <div className="brain-stat-tile">
                <dt>Samples / Perms</dt>
                <dd>
                  n={dataset.samples.length} · {dataset.permanova?.permutations || 0}p
                </dd>
              </div>
            </dl>

            <div className="brain-variance-bars" aria-label="Variance explained per principal coordinate">
              {[
                { label: "PC1", val: ve[0], cls: "is-pc1" },
                { label: "PC2", val: ve[1], cls: "is-pc2" },
                { label: "PC3", val: ve[2], cls: "is-pc3" },
              ].map((axis) => (
                <div key={axis.label} className="brain-var-row">
                  <span>{axis.label}</span>
                  <div className="brain-var-track" aria-hidden="true">
                    <div
                      className={`brain-var-fill ${axis.cls}`}
                      style={{ width: `${Math.min(100, Math.max(2, (axis.val || 0) * 100))}%` }}
                    />
                  </div>
                  <strong>{((axis.val || 0) * 100).toFixed(1)}%</strong>
                </div>
              ))}
            </div>

            <div className="brain-group-legend">
              <h3 className="brain-subheading">Cohort Groups (n per group)</h3>
              <ul className="brain-group-list" role="list">
                {groupSummaries.map((g) => {
                  const isHidden = hiddenGroups.has(g.group);
                  return (
                    <li key={g.group} className="brain-group-item">
                      <button
                        type="button"
                        className={`brain-group-toggle ${isHidden ? "is-hidden" : ""}`}
                        aria-pressed={!isHidden}
                        onClick={() => handleToggleGroup(g.group)}
                      >
                        <span className="brain-swatch" style={{ background: g.color }} aria-hidden="true" />
                        <span className="brain-group-name">{g.group}</span>
                        <span className="brain-group-n">n={g.count}</span>
                        {isHidden ? (
                          <EyeOff size={13} aria-hidden="true" />
                        ) : (
                          <Eye size={13} aria-hidden="true" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          {/* Selected Sample Inspector Card */}
          <div className="brain-card" data-testid="brain-sample-inspector">
            <h2 className="brain-card-heading">Selected Sample Inspector</h2>
            {selectedSample ? (
              <div className="brain-sample-detail">
                <div className="brain-sample-header">
                  <span
                    className="brain-swatch is-lg"
                    style={{ background: colorByGroup.get(selectedSample.group) || "#38bdf8" }}
                    aria-hidden="true"
                  />
                  <div>
                    <div className="brain-sample-id">{selectedSample.id}</div>
                    <div className="brain-sample-group">{selectedSample.group}</div>
                  </div>
                </div>

                <div className="brain-coord-strip">
                  <span>
                    <small>PC1</small> {selectedSample.pc1.toFixed(4)}
                  </span>
                  <span>
                    <small>PC2</small> {selectedSample.pc2.toFixed(4)}
                  </span>
                  <span>
                    <small>PC3</small> {selectedSample.pc3.toFixed(4)}
                  </span>
                </div>

                <dl className="brain-meta-list">
                  {Object.entries(selectedSample.metadata || {}).map(([key, val]) => (
                    <div key={key} className="brain-meta-row">
                      <dt>{key}</dt>
                      <dd>{String(val)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : (
              <p className="muted">Click any sphere or table row to inspect sample metadata.</p>
            )}
          </div>
        </aside>
      </div>

      {/* Accessible Semantic Data Table Alternative for 3D Scatter */}
      <section className="brain-table-card" aria-labelledby="brain-table-heading">
        <div className="brain-table-header">
          <div>
            <h2 id="brain-table-heading" className="brain-card-heading">
              Accessible Sample Coordinates Table ({dataset.samples.length} samples)
            </h2>
            <p className="brain-table-note">
              Keyboard-navigable table alternative to the 3D WebGL scatter plot. Select any sample to highlight it in 3D space.
            </p>
          </div>
          <button
            type="button"
            className="brain-ghost-btn"
            aria-expanded={showTable}
            onClick={() => setShowTable((v) => !v)}
          >
            {showTable ? "Collapse Table" : "Expand Table"}
          </button>
        </div>

        {showTable && (
          <div className="brain-table-scroll">
            <table className="brain-coord-table">
              <caption className="visually-hidden">
                3D ordination principal coordinates and metadata for {dataset.provenance?.dataset_label}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Sample ID</th>
                  <th scope="col">Group</th>
                  <th scope="col">PC1 ({(ve[0] * 100).toFixed(1)}%)</th>
                  <th scope="col">PC2 ({(ve[1] * 100).toFixed(1)}%)</th>
                  <th scope="col">PC3 ({(ve[2] * 100).toFixed(1)}%)</th>
                  <th scope="col">Metadata Summary</th>
                </tr>
              </thead>
              <tbody>
                {dataset.samples.map((s) => {
                  const active = s.id === selectedSample?.id;
                  const metaPreview = Object.entries(s.metadata || {})
                    .slice(0, 3)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(" · ");
                  return (
                    <tr key={s.id} className={active ? "is-selected" : ""}>
                      <td>
                        <button
                          type="button"
                          className="brain-row-select-btn"
                          aria-pressed={active}
                          onClick={() => {
                            setSelectedId(s.id);
                            setStatusAnnouncement(`Selected sample ${s.id} in group ${s.group}.`);
                          }}
                        >
                          <span
                            className="brain-swatch"
                            style={{ background: colorByGroup.get(s.group) || "#38bdf8" }}
                            aria-hidden="true"
                          />
                          <span>{s.id}</span>
                        </button>
                      </td>
                      <td>{s.group}</td>
                      <td className="is-mono">{s.pc1.toFixed(4)}</td>
                      <td className="is-mono">{s.pc2.toFixed(4)}</td>
                      <td className="is-mono">{s.pc3.toFixed(4)}</td>
                      <td className="brain-meta-cell">{metaPreview || "None"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Epistemic Guardrails & Open-Source License Footer */}
      <footer className="brain-awg-footer">
        <p>
          <strong>Method:</strong> {dataset.provenance?.method} ·{" "}
          <strong>CLI Adapter:</strong> <code>python scripts/skbio_to_3d.py --counts counts.csv --metadata meta.csv --out ordination.json</code>
        </p>
        <p>
          <strong>Epistemic Guardrails (RR-10 v1.1 EC-01..EC-06, Zenodo DOI 10.5281/zenodo.24439497):</strong>{" "}
          Illustrative demos are strictly separated from empirical NASA OSDR cohorts. Never assert single-study directional gene calls when multi-study OSDR contrasts disagree at FDR q &lt; 0.05. ·{" "}
          <span className="brain-license-inline">MIT License · Open Source v1.0.0</span>
        </p>
      </footer>
    </div>
  );
}
