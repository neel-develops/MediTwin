/*
 * MediTwin 3D resource stage (Three.js).
 *
 * Renders one stylized bed per stored bed record in an automatic grid of visual sections.
 * Positions are display coordinates computed from the bed's order in its ward — they are
 * never stored and do not represent where a bed physically is. Sections ("Section A", …)
 * are a visual convenience for large wards, not rooms.
 *
 * Every bed part is an InstancedMesh shared by all beds, so 100+ beds render in a handful
 * of draw calls. Picking uses the instance id.
 */
(function (root) {
  'use strict';

  let libPromise = null;
  const loadLib = () => (libPromise = libPromise || Promise.all([
    import('three'),
    import('three/addons/geometries/RoundedBoxGeometry.js'),
    import('three/addons/environments/RoomEnvironment.js'),
  ]).then(([THREE, rb, re]) => ({ THREE, RoundedBox: rb.RoundedBoxGeometry, RoomEnvironment: re.RoomEnvironment })));

  const STATUS_COLORS = { AVAILABLE: '#22b573', OCCUPIED: '#ef4f55', RESERVED: '#f5a524', CLEANING: '#66758c', MAINTENANCE: '#8b5cf6' };
  const STATUS_LABEL = { AVAILABLE: 'Available', OCCUPIED: 'Occupied', RESERVED: 'Reserved', CLEANING: 'Cleaning', MAINTENANCE: 'Maintenance' };
  const DIM = '#d5dce6';
  const DIM_LIGHT = '#e9edf3';

  const BED_W = 1.0, BED_L = 2.0, GAP_X = 0.42, GAP_Z = 0.75, PAD = 0.6, GROUP_GAP = 1.5;

  function groupName(i) {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    return 'Section ' + (i < 26 ? letters[i] : letters[Math.floor(i / 26) - 1] + letters[i % 26]);
  }

  /** Pure layout: index → display position. Exposed for tests. */
  function computeLayout(count, groupSize, aspect) {
    const cols = Math.max(2, Math.ceil(groupSize / 2));
    const rows = Math.ceil(groupSize / cols);
    const groups = Math.max(1, Math.ceil(count / groupSize));
    const groupW = cols * BED_W + (cols - 1) * GAP_X + 2 * PAD;
    const groupD = rows * BED_L + (rows - 1) * GAP_Z + 2 * PAD;
    const gCols = Math.max(1, Math.min(groups, Math.ceil(Math.sqrt((groups * groupD * (aspect || 1.6)) / groupW))));
    const gRows = Math.ceil(groups / gCols);
    const totalW = gCols * groupW + (gCols - 1) * GROUP_GAP;
    const totalD = gRows * groupD + (gRows - 1) * GROUP_GAP;
    const ox = -totalW / 2, oz = -totalD / 2;
    const groupRects = [];
    for (let g = 0; g < groups; g++) {
      const gc = g % gCols, gr = Math.floor(g / gCols);
      const x0 = ox + gc * (groupW + GROUP_GAP), z0 = oz + gr * (groupD + GROUP_GAP);
      const n = Math.min(groupSize, count - g * groupSize);
      groupRects.push({ index: g, x: x0 + groupW / 2, z: z0 + groupD / 2, w: groupW, d: groupD, count: n, start: g * groupSize });
    }
    const positions = [];
    for (let i = 0; i < count; i++) {
      const g = Math.floor(i / groupSize), k = i % groupSize;
      const r = groupRects[g];
      const col = k % cols, row = Math.floor(k / cols);
      positions.push({ x: r.x - r.w / 2 + PAD + col * (BED_W + GAP_X) + BED_W / 2, z: r.z - r.d / 2 + PAD + row * (BED_L + GAP_Z) + BED_L / 2, group: g });
    }
    return { positions, groups: groupRects, width: totalW, depth: totalD };
  }

  // ------------------------------------------------------------------ bed model
  /** Part list for one bed. `at` = local offsets; `color` = which parts take the status colour. */
  function bedParts(lib) {
    const { THREE, RoundedBox: RB } = lib;
    const metal = new THREE.MeshPhysicalMaterial({ color: '#e3e9f1', roughness: 0.32, metalness: 0.45, clearcoat: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: '#39445a', roughness: 0.55 });
    const white = new THREE.MeshPhysicalMaterial({ color: '#f4f7fb', roughness: 0.55, clearcoat: 0.25, envMapIntensity: 0.45 });
    const tinted = () => new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.42, clearcoat: 0.9, clearcoatRoughness: 0.18, envMapIntensity: 0.3 });
    const wheel = new THREE.CylinderGeometry(0.065, 0.065, 0.05, 16); wheel.rotateZ(Math.PI / 2);
    return [
      { geo: wheel, mat: dark, at: [[-0.4, 0.065, -0.8], [0.4, 0.065, -0.8], [-0.4, 0.065, 0.8], [0.4, 0.065, 0.8]] },
      { geo: new THREE.CylinderGeometry(0.035, 0.035, 0.3, 10), mat: metal, at: [[-0.4, 0.25, -0.8], [0.4, 0.25, -0.8], [-0.4, 0.25, 0.8], [0.4, 0.25, 0.8]] },
      { geo: new RB(1.0, 0.12, 1.96, 2, 0.045), mat: metal, at: [[0, 0.44, 0]], pick: true },
      { geo: new RB(0.92, 0.17, 1.84, 3, 0.07), mat: white, at: [[0, 0.585, 0]], pick: true },
      { geo: new RB(0.6, 0.13, 0.34, 3, 0.06), mat: white, at: [[0, 0.72, -0.66]] },
      { geo: new RB(0.98, 0.1, 1.24, 3, 0.045), mat: tinted(), at: [[0, 0.68, 0.31]], color: 'status', pick: true },
      { geo: new RB(0.99, 0.07, 0.2, 3, 0.032), mat: tinted(), at: [[0, 0.725, -0.27]], color: 'light' },
      { geo: new RB(1.04, 0.68, 0.085, 3, 0.038), mat: tinted(), at: [[0, 0.75, -0.98]], color: 'status', pick: true },
      { geo: new RB(1.04, 0.42, 0.075, 3, 0.034), mat: tinted(), at: [[0, 0.63, 0.99]], color: 'status' },
      { geo: new RB(0.035, 0.04, 0.95, 2, 0.016), mat: metal, at: [[-0.53, 0.86, -0.3], [0.53, 0.86, -0.3]] },
      { geo: new THREE.CylinderGeometry(0.018, 0.018, 0.16, 8), mat: metal, at: [[-0.53, 0.78, -0.7], [-0.53, 0.78, 0.1], [0.53, 0.78, -0.7], [0.53, 0.78, 0.1]] },
    ];
  }

  function statusColor(THREE, status, role) {
    const c = new THREE.Color(STATUS_COLORS[status] || '#999');
    return role === 'light' ? c.lerp(new THREE.Color('#ffffff'), 0.55) : c;
  }

  function addLights(lib, scene, renderer) {
    const { THREE, RoomEnvironment } = lib;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
    pmrem.dispose();
    scene.add(new THREE.HemisphereLight(0xffffff, 0xcad8ee, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 1.25);
    sun.position.set(-8, 16, 10);
    scene.add(sun);
    return sun;
  }

  function configureRenderer(THREE, renderer) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.NoToneMapping; // keeps status colours saturated, like the reference
  }

  // ------------------------------------------------------------------ thumbnails
  let thumbPromise = null;
  /** Renders one bed per status to a PNG data URL, for the side panel cards. */
  function thumbnails() {
    if (thumbPromise) return thumbPromise;
    thumbPromise = loadLib().then((lib) => {
      const { THREE } = lib;
      const W = 240, H = 180;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      configureRenderer(THREE, renderer);
      renderer.setPixelRatio(1);
      renderer.setSize(W, H, false);
      const scene = new THREE.Scene();
      addLights(lib, scene, renderer);
      const camera = new THREE.PerspectiveCamera(26, W / H, 0.1, 50);
      camera.position.set(3.1, 2.7, 3.3);
      camera.lookAt(0, 0.45, 0);
      const parts = bedParts(lib);
      const bed = new THREE.Group();
      const meshes = [];
      for (const p of parts) for (const [x, y, z] of p.at) {
        const m = new THREE.Mesh(p.geo, p.color ? p.mat.clone() : p.mat);
        m.position.set(x, y, z);
        m.userData.role = p.color;
        bed.add(m); meshes.push(m);
      }
      bed.rotation.y = Math.PI;
      scene.add(bed);
      const out = {};
      for (const s of Object.keys(STATUS_COLORS)) {
        for (const m of meshes) if (m.userData.role) m.material.color.copy(statusColor(THREE, s, m.userData.role));
        renderer.render(scene, camera);
        out[s] = renderer.domElement.toDataURL('image/png');
      }
      renderer.dispose();
      renderer.forceContextLoss();
      return out;
    });
    return thumbPromise;
  }

  // ------------------------------------------------------------------ stage
  async function create(container, opts) {
    const lib = await loadLib();
    const { THREE, RoundedBox: RB } = lib;
    opts = opts || {};

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    configureRenderer(THREE, renderer);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = 'stage-canvas';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    container.appendChild(renderer.domElement);

    const overlay = document.createElement('div');
    overlay.className = 'stage-overlay';
    container.appendChild(overlay);
    const tooltip = document.createElement('div');
    tooltip.className = 'stage-tooltip';
    tooltip.hidden = true;
    overlay.appendChild(tooltip);
    const selTag = document.createElement('div');
    selTag.className = 'stage-seltag';
    selTag.hidden = true;
    overlay.appendChild(selTag);
    const compass = document.createElement('div');
    compass.className = 'compass';
    compass.setAttribute('aria-hidden', 'true');
    compass.innerHTML = '<div class="compass-rose"><span class="n">N</span><span class="e">E</span><span class="s">S</span><span class="w">W</span><i></i></div>';
    container.appendChild(compass);
    const rose = compass.firstChild;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 400);
    const sun = addLights(lib, scene, renderer);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    scene.add(sun.target);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ opacity: 0.1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.17;
    ground.receiveShadow = true;
    scene.add(ground);

    const parts = bedParts(lib);
    const trayMat = new THREE.MeshPhysicalMaterial({ color: '#dce9fb', roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.15, transparent: true, opacity: 0.88, envMapIntensity: 0.8 });
    const trayActive = trayMat.clone(); trayActive.color.set('#c6dcfb');
    const rimMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.1, clearcoat: 1, transparent: true, opacity: 0.55, envMapIntensity: 1 });
    const ringMat = new THREE.MeshBasicMaterial({ color: '#1f6feb', transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const hoverMat = new THREE.MeshBasicMaterial({ color: '#6ea8ff', transparent: true, opacity: 0.6, side: THREE.DoubleSide });
    const ringGeo = new THREE.RingGeometry(0.78, 0.92, 48);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2; ring.scale.set(1, 1.55, 1); ring.visible = false;
    const hoverRing = new THREE.Mesh(ringGeo, hoverMat);
    hoverRing.rotation.x = -Math.PI / 2; hoverRing.scale.set(1, 1.55, 1); hoverRing.visible = false;
    scene.add(ring, hoverRing);

    const world = new THREE.Group();
    scene.add(world);
    let beds = [];          // bed records in display order
    let indexById = new Map();
    let layout = null;
    let trays = [];
    let groupTags = [];
    let matchSet = null;
    let selectedId = null;
    let hoverId = null;
    let activeGroup = null;
    const tmpM = new THREE.Matrix4();
    const tmpC = new THREE.Color();

    // ------------------------------------------------------------ camera rig
    const rig = { target: new THREE.Vector3(), radius: 30, theta: 0.48, phi: 0.78, min: 5, max: 120, bounds: { x: 20, z: 20 } };
    let tween = null;
    let autoRotate = false;
    let userMoved = false;
    function applyCamera() {
      const r = rig.radius, sp = Math.sin(rig.phi);
      camera.position.set(rig.target.x + r * sp * Math.sin(rig.theta), rig.target.y + r * Math.cos(rig.phi), rig.target.z + r * sp * Math.cos(rig.theta));
      camera.lookAt(rig.target);
      rose.style.transform = `rotate(${rig.theta}rad)`;
    }
    function clampRig() {
      rig.phi = Math.min(1.3, Math.max(0.2, rig.phi));
      rig.radius = Math.min(rig.max, Math.max(rig.min, rig.radius));
      rig.target.x = Math.min(rig.bounds.x, Math.max(-rig.bounds.x, rig.target.x));
      rig.target.z = Math.min(rig.bounds.z, Math.max(-rig.bounds.z, rig.target.z));
    }
    /** Distance at which the whole grid fills the stage from the default angle (measured by projecting its corners). */
    function fitRadius() {
      if (!layout) return 30;
      const hw = layout.width / 2 + 0.3, hd = layout.depth / 2 + 0.3;
      const pts = [];
      for (const x of [-hw, hw]) for (const z of [-hd, hd]) for (const y of [0, 1.6]) pts.push(new THREE.Vector3(x, y, z));
      const saved = { radius: rig.radius, theta: rig.theta, phi: rig.phi, t: rig.target.clone() };
      let r = 40;
      for (let k = 0; k < 4; k++) {
        Object.assign(rig, { radius: r, theta: 0.48, phi: 0.78 });
        rig.target.set(0, 0, 0);
        applyCamera();
        camera.updateMatrixWorld();
        let ext = 0;
        for (const p of pts) {
          const q = p.clone().project(camera);
          ext = Math.max(ext, Math.abs(q.x) / 0.97, Math.abs(q.y) / 0.8); // leave room for labels and the toolbar
        }
        r *= ext;
      }
      Object.assign(rig, { radius: saved.radius, theta: saved.theta, phi: saved.phi });
      rig.target.copy(saved.t);
      return r;
    }
    function animateTo(to, ms) {
      const from = { tx: rig.target.x, tz: rig.target.z, radius: rig.radius, theta: rig.theta, phi: rig.phi };
      const dest = Object.assign({}, from, to);
      while (dest.theta - from.theta > Math.PI) dest.theta -= Math.PI * 2;
      while (dest.theta - from.theta < -Math.PI) dest.theta += Math.PI * 2;
      tween = { from, to: dest, t0: performance.now(), ms: ms || 650 };
      userMoved = true;
      kick();
    }
    function resetView(instant) {
      const to = { tx: 0, tz: 0, radius: fitRadius(), theta: 0.48, phi: 0.78 };
      rig.max = Math.max(to.radius * 2, 20);
      if (instant) { tween = null; rig.target.set(0, 0, 0); Object.assign(rig, { radius: to.radius, theta: to.theta, phi: to.phi }); clampRig(); kick(); }
      else animateTo(to);
      userMoved = false;
    }

    // ------------------------------------------------------------ build
    function clearWorld() {
      for (const child of world.children.slice()) {
        world.remove(child);
        if (child.isInstancedMesh) child.dispose();
        else if (child.userData.ownGeo) child.geometry.dispose();
      }
      for (const t of groupTags) t.remove();
      trays = []; groupTags = [];
      for (const p of parts) p.mesh = null;
    }

    function placeBed(i) {
      const pos = layout.positions[i];
      const lift = beds[i].id === selectedId ? 0.16 : 0;
      for (const p of parts) {
        p.at.forEach(([x, y, z], j) => {
          tmpM.makeTranslation(pos.x + x, y + lift, pos.z + z);
          p.mesh.setMatrixAt(i * p.at.length + j, tmpM);
        });
        p.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    function paintBed(i) {
      const b = beds[i];
      const dim = matchSet && !matchSet.has(b.id);
      for (const p of parts) {
        if (!p.color) continue;
        if (dim) tmpC.set(p.color === 'light' ? DIM_LIGHT : DIM);
        else tmpC.copy(statusColor(THREE, b.status, p.color));
        p.at.forEach((_, j) => p.mesh.setColorAt(i * p.at.length + j, tmpC));
        p.mesh.instanceColor.needsUpdate = true;
      }
    }

    function setBeds(list, options) {
      options = options || {};
      const groupSize = options.groupSize || 10;
      const same = layout && layout.groupSize === groupSize && list.length === beds.length && list.every((b, i) => b.id === beds[i].id);
      beds = list.slice();
      if (same) {
        beds.forEach((_, i) => paintBed(i));
        refreshGroupTags();
        kick();
        return;
      }
      clearWorld();
      indexById = new Map(beds.map((b, i) => [b.id, i]));
      layout = computeLayout(beds.length, groupSize, 1.0); // squarish footprint reads best from the rotated view
      layout.groupSize = groupSize;

      layout.groups.forEach((r) => {
        const tray = new THREE.Mesh(new RB(r.w, 0.16, r.d, 3, 0.14), trayMat);
        tray.userData.ownGeo = true;
        tray.position.set(r.x, -0.08, r.z);
        tray.receiveShadow = true;
        tray.userData.groupIndex = r.index;
        world.add(tray);
        trays.push(tray);
        const rimH = 0.24, t = 0.07;
        for (const [w, d, x, z] of [[r.w, t, r.x, r.z - r.d / 2 + t / 2], [r.w, t, r.x, r.z + r.d / 2 - t / 2], [t, r.d - 2 * t, r.x - r.w / 2 + t / 2, r.z], [t, r.d - 2 * t, r.x + r.w / 2 - t / 2, r.z]]) {
          const rim = new THREE.Mesh(new RB(w, rimH, d, 2, 0.03), rimMat);
          rim.userData.ownGeo = true;
          rim.position.set(x, rimH / 2 - 0.02, z);
          world.add(rim);
        }
        const tag = document.createElement('button');
        tag.type = 'button';
        tag.className = 'group-tag';
        tag.addEventListener('click', (e) => { e.stopPropagation(); opts.onGroupClick && opts.onGroupClick(r.index); });
        overlay.appendChild(tag);
        groupTags.push(tag);
      });

      for (const p of parts) {
        const m = new THREE.InstancedMesh(p.geo, p.mat, Math.max(1, beds.length * p.at.length));
        m.count = beds.length * p.at.length;
        m.castShadow = true;
        m.receiveShadow = true;
        m.userData.perBed = p.at.length;
        if (p.color) m.setColorAt(0, tmpC.set('#ffffff'));
        p.mesh = m;
        world.add(m);
      }
      beds.forEach((_, i) => { placeBed(i); paintBed(i); });
      for (const p of parts) p.mesh.computeBoundingSphere();

      const ext = Math.max(layout.width, layout.depth) / 2 + 4;
      Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 80 });
      sun.shadow.camera.updateProjectionMatrix();
      sun.position.set(-9, 18, 11);
      sun.target.position.set(0, 0, 0);

      refreshGroupTags();
      rig.bounds = { x: layout.width / 2 + 2, z: layout.depth / 2 + 2 };
      if (selectedId != null && !indexById.has(selectedId)) selectedId = null;
      updateRings();
      if (options.resetView !== false) resetView(true);
      kick();
    }

    function refreshGroupTags() {
      if (!layout) return;
      layout.groups.forEach((r, i) => {
        const tag = groupTags[i];
        const members = beds.slice(r.start, r.start + r.count);
        const avail = members.filter((b) => b.status === 'AVAILABLE').length;
        const matching = matchSet ? members.filter((b) => matchSet.has(b.id)).length : null;
        tag.innerHTML = `<strong>${groupName(i)}</strong><span>${matching != null ? `${matching} match` : `${r.count} beds`}</span>`;
        tag.setAttribute('aria-label', `${groupName(i)}: ${r.count} beds, ${avail} available. Open section.`);
        tag.classList.toggle('active', activeGroup === i);
        tag._w = 0;
        trays[i].material = activeGroup === i ? trayActive : trayMat;
      });
    }

    function updateRings() {
      const si = selectedId != null ? indexById.get(selectedId) : undefined;
      ring.visible = si !== undefined;
      if (ring.visible) ring.position.set(layout.positions[si].x, 0.012, layout.positions[si].z);
      const hi = hoverId != null && hoverId !== selectedId ? indexById.get(hoverId) : undefined;
      hoverRing.visible = hi !== undefined;
      if (hoverRing.visible) hoverRing.position.set(layout.positions[hi].x, 0.01, layout.positions[hi].z);
    }

    // ------------------------------------------------------------ input
    const el = renderer.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pointers = new Map();
    let drag = null;

    function pick(clientX, clientY) {
      if (!layout) return null;
      const rect = el.getBoundingClientRect();
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObjects(parts.filter((p) => p.pick && p.mesh).map((p) => p.mesh), false)[0];
      if (hit && hit.instanceId != null) return { bedId: beds[Math.floor(hit.instanceId / hit.object.userData.perBed)].id };
      const t = raycaster.intersectObjects(trays, false)[0];
      if (t) return { groupIndex: t.object.userData.groupIndex };
      return null;
    }

    function pan(dx, dy) {
      const k = rig.radius * 0.0016;
      const right = new THREE.Vector3(Math.cos(rig.theta), 0, -Math.sin(rig.theta));
      const fwd = new THREE.Vector3(Math.sin(rig.theta), 0, Math.cos(rig.theta));
      rig.target.addScaledVector(right, -dx * k).addScaledVector(fwd, -dy * k);
    }

    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      tween = null;
      if (pointers.size === 1) drag = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: 0, mode: e.button === 2 || e.shiftKey || e.ctrlKey ? 'pan' : 'rotate', button: e.button };
      else if (pointers.size === 2) { const [a, b] = Array.from(pointers.values()); drag = { pinch: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, moved: 99 }; }
    });
    el.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) { hoverAt(e.clientX, e.clientY); return; }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!drag) return;
      if (pointers.size >= 2 && drag.pinch) {
        const [a, b] = Array.from(pointers.values());
        const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        rig.radius *= drag.pinch / Math.max(d, 1);
        pan(mx - drag.mx, my - drag.my);
        Object.assign(drag, { pinch: d, mx, my });
      } else {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.x = e.clientX; drag.y = e.clientY;
        drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0));
        if (drag.moved < 4) return; // small jitter during a click is not a drag
        if (drag.mode === 'pan') pan(dx, dy);
        else { rig.theta -= dx * 0.006; rig.phi -= dy * 0.005; }
        el.classList.add('dragging');
      }
      userMoved = true;
      clampRig(); kick();
    });
    const endPointer = (e) => {
      const wasClick = drag && !drag.pinch && drag.moved < 6 && drag.button === 0 && pointers.size === 1;
      pointers.delete(e.pointerId);
      el.classList.remove('dragging');
      if (wasClick && e.type === 'pointerup') {
        const p = pick(e.clientX, e.clientY);
        if (p && p.bedId != null) opts.onBedClick && opts.onBedClick(p.bedId);
        else if (p && p.groupIndex != null) opts.onGroupClick && opts.onGroupClick(p.groupIndex);
      }
      if (pointers.size === 0) drag = null;
    };
    el.addEventListener('pointerup', endPointer);
    el.addEventListener('pointercancel', endPointer);
    el.addEventListener('pointerleave', () => { if (!pointers.size) setHover(null); });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      tween = null; userMoved = true;
      rig.radius *= Math.exp(e.deltaY * 0.0012);
      clampRig(); kick();
    }, { passive: false });

    let hoverFrame = 0;
    function hoverAt(x, y) {
      cancelAnimationFrame(hoverFrame);
      hoverFrame = requestAnimationFrame(() => {
        const p = pick(x, y);
        setHover(p && p.bedId != null ? p.bedId : null, x, y);
        el.style.cursor = p ? 'pointer' : 'grab';
      });
    }
    function setHover(id, x, y) {
      if (id === hoverId && id == null) return;
      hoverId = id;
      if (id == null) { tooltip.hidden = true; updateRings(); kick(); return; }
      const b = beds[indexById.get(id)];
      const rect = container.getBoundingClientRect();
      tooltip.innerHTML = `<strong>${b.bed_code}</strong> · ${STATUS_LABEL[b.status]}`;
      tooltip.style.transform = `translate(${x - rect.left + 14}px, ${y - rect.top + 14}px)`;
      tooltip.hidden = false;
      updateRings(); kick();
    }

    // ------------------------------------------------------------ render loop
    let needsRender = true;
    let raf = 0;
    let disposed = false;
    const v = new THREE.Vector3();
    function kick() { needsRender = true; if (!raf && !disposed) raf = requestAnimationFrame(frame); }
    function project(x, y, z) {
      v.set(x, y, z).project(camera);
      return { x: (v.x * 0.5 + 0.5) * el.clientWidth, y: (-v.y * 0.5 + 0.5) * el.clientHeight, visible: v.z < 1 };
    }
    function frame(now) {
      raf = 0;
      if (disposed) return;
      let animating = false;
      if (tween) {
        const t = Math.min(1, (now - tween.t0) / tween.ms);
        const k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const f = tween.from, d = tween.to;
        rig.target.set(f.tx + (d.tx - f.tx) * k, 0, f.tz + (d.tz - f.tz) * k);
        rig.radius = f.radius + (d.radius - f.radius) * k;
        rig.theta = f.theta + (d.theta - f.theta) * k;
        rig.phi = f.phi + (d.phi - f.phi) * k;
        if (t >= 1) tween = null;
        animating = true;
      }
      if (autoRotate && !drag) { rig.theta += 0.0025; animating = true; }
      if (needsRender || animating) {
        applyCamera();
        renderer.render(scene, camera);
        needsRender = false;
        if (layout) {
          // Section labels float above the back edge of each tray; drop any that would overlap.
          const placed = [];
          const order = layout.groups.map((r, i) => i).sort((a, b) => (b === activeGroup) - (a === activeGroup) || a - b);
          for (const i of order) {
            const r = layout.groups[i];
            const p = project(r.x, 1.4, r.z - r.d / 2 + 0.3);
            const tag = groupTags[i];
            if (!tag._w) { tag._w = tag.offsetWidth || 90; tag._h = tag.offsetHeight || 34; }
            const box = { l: p.x - tag._w / 2 - 3, r: p.x + tag._w / 2 + 3, t: p.y - tag._h - 3, b: p.y + 3 };
            const clash = placed.some((q) => box.l < q.r && box.r > q.l && box.t < q.b && box.b > q.t);
            tag.style.transform = `translate(-50%, -100%) translate(${p.x}px, ${p.y}px)`;
            const show = p.visible && !clash;
            tag.style.visibility = show ? 'visible' : 'hidden';
            if (show) placed.push(box);
          }
        }
        const si = selectedId != null ? indexById.get(selectedId) : undefined;
        if (si !== undefined) {
          const pos = layout.positions[si];
          const p = project(pos.x, 1.55, pos.z - 0.9);
          selTag.textContent = beds[si].bed_code;
          selTag.style.transform = `translate(-50%, -100%) translate(${p.x}px, ${p.y}px)`;
          selTag.hidden = !p.visible;
        } else selTag.hidden = true;
      }
      if (animating) raf = requestAnimationFrame(frame);
    }

    function resize() {
      const w = container.clientWidth, h = container.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (layout && !userMoved && !tween) resetView(true);
      kick();
    }
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    container.addEventListener('keydown', (e) => {
      const map = { ArrowLeft: () => (rig.theta += 0.12), ArrowRight: () => (rig.theta -= 0.12), ArrowUp: () => (rig.phi -= 0.08), ArrowDown: () => (rig.phi += 0.08), '+': () => (rig.radius *= 0.85), '=': () => (rig.radius *= 0.85), '-': () => (rig.radius *= 1.18) };
      if (e.target !== container || !map[e.key]) return;
      e.preventDefault(); tween = null; userMoved = true; map[e.key](); clampRig(); kick();
    });

    return {
      setBeds,
      setMatch(set) { matchSet = set; beds.forEach((_, i) => paintBed(i)); refreshGroupTags(); kick(); },
      select(id, { focus } = {}) {
        const prev = selectedId != null ? indexById.get(selectedId) : undefined;
        selectedId = id != null && indexById.has(id) ? id : null;
        if (prev !== undefined) placeBed(prev);
        if (selectedId != null) placeBed(indexById.get(selectedId));
        updateRings();
        if (focus && selectedId != null) {
          const pos = layout.positions[indexById.get(selectedId)];
          animateTo({ tx: pos.x, tz: pos.z, radius: Math.min(rig.radius, 26), phi: 0.8 });
        }
        kick();
      },
      setActiveGroup(i, { focus } = {}) {
        activeGroup = i;
        refreshGroupTags();
        if (focus && i != null && layout && layout.groups[i]) {
          const r = layout.groups[i];
          animateTo({ tx: r.x, tz: r.z, radius: Math.max(r.w, r.d) * 3.4, phi: 0.8 });
        }
        kick();
      },
      zoom(f) { tween = null; userMoved = true; rig.radius *= f; clampRig(); kick(); },
      rotate(rad) { animateTo({ theta: rig.theta + rad }, 350); },
      resetView: () => resetView(false),
      setAutoRotate(on) { autoRotate = !!on; kick(); },
      get autoRotate() { return autoRotate; },
      dispose() {
        disposed = true; ro.disconnect(); cancelAnimationFrame(raf);
        clearWorld();
        renderer.dispose(); renderer.forceContextLoss();
        container.innerHTML = '';
      },
    };
  }

  root.MTScene = { create, thumbnails, computeLayout, groupName, STATUS_COLORS };
})(window);
