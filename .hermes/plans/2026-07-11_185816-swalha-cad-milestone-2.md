# SWALHA CAD — Milestone 2 Implementation Plan

> **For Hermes:** Execute asynchronously as small dependent tasks. Claude Code implements with generous turn limits. Independent review remains disabled; Hermes still verifies every commit, test suite, build, browser behavior, and CI result.

**Goal:** Evolve SWALHA CAD from a primitive modeller into an Onshape-inspired browser CAD workspace with a constraint-aware 2D sketch that produces a watertight 3D extrusion.

**Architecture:** Preserve the M1 rule that the versioned document is the source of truth. Add sketch entities, constraints, profiles, and extrude features to the document and deterministic geometry packages; project them into dedicated sketch and 3D workspace modes. UI components remain local to the Vite app, but adopt reusable design-token and primitive patterns from `swalha1999/swalha-template` rather than importing its Next.js/auth/server stack.

**Tech Stack:** Existing pnpm/TypeScript/React/Vite/Three.js/Zustand/Vitest/Playwright/MCP stack; add `lucide-react` for CAD toolbar icons and small local UI primitives adapted from SWALHA Template patterns.

---

## What can be reused from `swalha1999/swalha-template`

Use/adapt:

- Neutral OKLCH design tokens and semantic variables from `packages/ui/src/styles/globals.css`.
- Compact `Button` variants: default, outline, secondary, ghost, destructive; icon sizes.
- Dropdown menu interaction and visual patterns.
- `cn()` class composition helper pattern.
- Lucide icon convention.
- Dense 48px top bar, muted labels, subtle borders, thin scrollbars, sidebar active states, and accessible focus rings.
- Component/testing conventions and strict TypeScript style.

Do **not** import/migrate:

- Next.js, Hono, Expo, Better Auth, Drizzle, organization/admin shells, database packages, or Tailwind build infrastructure.
- The template’s dashboard information architecture; CAD needs a dedicated desktop workspace.

Implementation choice: create lightweight React/CSS components under `apps/web/src/components/ui/` using the same semantic ideas. This avoids coupling SWALHA CAD to the template’s framework and package namespace.

---

## Onshape-inspired UI direction

Inspired by Onshape’s proven CAD information architecture, without copying its branding/assets:

1. **Light neutral workspace by default** with high-density controls and a blue SWALHA accent.
2. **Top document bar:** SWALHA CAD mark, document name/status, file actions, undo/redo, help/settings slots.
3. **Feature toolbar beneath it:** icon-first Sketch, Extrude, primitive tools, view controls; labels/tooltips and active modes.
4. **Left feature tree:** Origin, planes, sketches, features, and bodies with visibility controls and selection.
5. **Center viewport:** brighter gradient/grid, visible default geometry, view cube, axis triad, compact floating navigation controls.
6. **Right contextual panel:** appears for active sketch/feature editing; dimensions and constraints are grouped densely.
7. **Bottom tabs/status bar:** Part Studio tab, units, constraint state, cursor coordinates, and operation hints.
8. **Resizable/collapsible side panels** with keyboard-accessible splitters.
9. **No dark empty canvas problem:** unselected solids use visible neutral material, selected solids use SWALHA blue outline/highlight.

---

## M2 user-visible result

A user can:

1. Work in an Onshape-inspired Part Studio UI.
2. Choose XY, XZ, or YZ plane and enter Sketch mode.
3. Draw points, connected line segments, rectangles, and circles.
4. Apply coincidence, horizontal, vertical, distance, radius, and angle constraints.
5. See under-constrained, fully constrained, or conflicting state.
6. Detect/select a closed profile.
7. Exit sketch and extrude the profile to a watertight 3D solid.
8. Edit sketch dimensions or extrusion depth and see the solid rebuild deterministically.
9. Save/load the versioned document, undo/redo operations, export STL, and perform core sketch/extrude actions through MCP.

Deferred:

- General nonlinear industrial constraint solver and exhaustive degrees-of-freedom analysis
- Arcs, splines, trim/extend, fillet/chamfer
- Boolean union/subtract/intersect between arbitrary solids
- Multiple sketch regions/holes in one extrusion
- STEP/IGES/BREP/NURBS
- Assembly and collaboration systems

---

## Canonical M2 domain model

Migrate documents to a schema-versioned union and support V1 loading:

```ts
export type SketchPlane = 'XY' | 'XZ' | 'YZ';

export type SketchEntity =
  | { id: string; kind: 'point'; x: number; y: number; construction: boolean }
  | { id: string; kind: 'line'; startId: string; endId: string; construction: boolean }
  | { id: string; kind: 'circle'; centerId: string; radius: number; construction: boolean };

export type SketchConstraint =
  | { id: string; kind: 'coincident'; pointA: string; pointB: string }
  | { id: string; kind: 'horizontal'; lineId: string }
  | { id: string; kind: 'vertical'; lineId: string }
  | { id: string; kind: 'distance'; pointA: string; pointB: string; value: number }
  | { id: string; kind: 'radius'; circleId: string; value: number }
  | { id: string; kind: 'angle'; lineA: string; lineB: string; valueDeg: number };

export interface SketchFeature {
  id: string;
  kind: 'sketch';
  name: string;
  plane: SketchPlane;
  entities: SketchEntity[];
  constraints: SketchConstraint[];
  visible: boolean;
}

export interface ExtrudeFeature {
  id: string;
  kind: 'extrude';
  name: string;
  sketchId: string;
  depth: number;
  direction: 'normal' | 'symmetric';
  visible: boolean;
}

export interface CadDocumentV2 {
  schemaVersion: 2;
  units: 'mm';
  entities: CadEntity[]; // retained M1 primitive bodies
  features: Array<SketchFeature | ExtrudeFeature>;
}
```

V1 files migrate in memory to V2 by adding `features: []`; saves always emit V2 after migration.

---

## Task plan

### Task 1: Adopt SWALHA UI foundations

**Objective:** Add local semantic design tokens and reusable controls adapted from SWALHA Template.

**Files:**
- Create: `apps/web/src/components/ui/Button.tsx`
- Create: `apps/web/src/components/ui/IconButton.tsx`
- Create: `apps/web/src/components/ui/DropdownMenu.tsx`
- Create: `apps/web/src/components/ui/Tooltip.tsx`
- Create: `apps/web/src/components/ui/Separator.tsx`
- Create: `apps/web/src/components/ui/ui.test.tsx`
- Create: `apps/web/src/lib/cn.ts`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/package.json`

**TDD:** variants, disabled state, accessible names, keyboard menu operation, tooltip association.

**Acceptance:** semantic OKLCH tokens, light/dark token sets, Lucide icons, no dependency on `swalha-template` packages.

**Commit:** `feat: add swalha cad ui foundations`

### Task 2: Rebuild the shell as an Onshape-inspired Part Studio

**Objective:** Replace the generic three-column shell with a dense CAD workspace.

**Files:**
- Create: `apps/web/src/components/DocumentBar.tsx`
- Create: `apps/web/src/components/FeatureToolbar.tsx`
- Create: `apps/web/src/components/FeatureTree.tsx`
- Create: `apps/web/src/components/ContextPanel.tsx`
- Create: `apps/web/src/components/StatusBar.tsx`
- Create: `apps/web/src/components/ViewCube.tsx`
- Create: `apps/web/src/components/ViewportControls.tsx`
- Create: `apps/web/src/components/ResizablePanel.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Tests: beside each component; update `App.test.tsx`.

**Acceptance:** two top bars, feature tree, contextual right panel, view cube/axis/navigation overlays, bottom Part Studio/status strip, collapsible/resizable panels, responsive minimum width, keyboard focus order.

**Visual acceptance:** at 1440×900, shapes are visibly lit without selection; no black/empty-looking viewport; layout resembles professional Onshape-class CAD rather than a dashboard.

**Commit:** `feat: redesign workspace for part studio`

### Task 3: Add V2 document schema and V1 migration

**Objective:** Persist sketch and extrude features without breaking M1 files.

**Files:**
- Modify: `packages/document/src/types.ts`
- Modify: `packages/document/src/schema.ts`
- Create: `packages/document/src/migrate.ts`
- Modify: `packages/document/src/commands.ts`
- Modify: `packages/document/src/reducer.ts`
- Modify: `packages/document/src/index.ts`
- Tests: schema/migration/commands/reducer tests.

**TDD:** V1 migration, valid empty V2, sketch references, constraint references, extrude sketch references, invalid dimensions/angles, JSON round-trip, feature create/update/delete commands.

**Commit:** `feat: add version two feature document`

### Task 4: Implement sketch coordinate frames and plane projection

**Objective:** Map 2D sketch coordinates predictably into the lecture’s 3D model/world frames.

**Files:**
- Create: `packages/geometry/src/sketch/plane.ts`
- Create: `packages/geometry/src/sketch/plane.test.ts`
- Modify: `packages/geometry/src/index.ts`

**TDD:** XY/XZ/YZ basis vectors, handedness, point/vector distinction, 2D→3D and 3D→2D round trips, plane normal direction.

**Commit:** `feat: add sketch plane coordinate frames`

### Task 5: Add deterministic sketch topology and profile detection

**Objective:** Validate sketch connectivity and identify one closed non-self-intersecting profile.

**Files:**
- Create: `packages/geometry/src/sketch/topology.ts`
- Create: `packages/geometry/src/sketch/intersections.ts`
- Create: `packages/geometry/src/sketch/profile.ts`
- Tests: corresponding test files.

**TDD:** point/line lookup, connected loops, open chains, duplicate edges, segment intersections, rectangle profile, reversed winding normalization, construction geometry exclusion, circle profile.

**Acceptance:** return structured diagnostics instead of silently accepting invalid topology.

**Commit:** `feat: detect closed sketch profiles`

### Task 6: Implement the scoped geometric constraint solver

**Objective:** Solve M2’s explicit constraint subset deterministically and report constraint state.

**Files:**
- Create: `packages/geometry/src/sketch/constraints/types.ts`
- Create: `packages/geometry/src/sketch/constraints/equations.ts`
- Create: `packages/geometry/src/sketch/constraints/solver.ts`
- Create: `packages/geometry/src/sketch/constraints/status.ts`
- Tests: corresponding test files.

**Approach:** iterative damped Gauss-Newton over point coordinates/radii with analytic or finite-difference Jacobian; deterministic ordering, bounded iterations, tolerance, and rollback on divergence. Horizontal/vertical/coincident may use exact projection before numeric residual solving.

**TDD:** each constraint alone, combined constrained rectangle, convergence tolerance, deterministic repeated solve, contradictory constraints return `conflicting`, incomplete sketch returns `under-constrained`, anchored fully dimensioned rectangle returns `fully-constrained`.

**Commit:** `feat: solve sketch constraints`

### Task 7: Build watertight profile extrusion

**Objective:** Convert a closed line or circle profile into an indexed watertight 3D mesh.

**Files:**
- Create: `packages/geometry/src/features/extrude.ts`
- Create: `packages/geometry/src/features/triangulate-profile.ts`
- Create: `packages/geometry/src/features/extrude.test.ts`
- Modify: `packages/geometry/src/index.ts`

**TDD:** rectangle/circle extrusion, normal/symmetric direction, bounds on all planes, outward winding, unit normals, no zero-area triangles, every manifold edge occurs twice, invalid/open/self-intersecting profile errors.

**Commit:** `feat: extrude sketch profiles`

### Task 8: Resolve feature tree into render/export bodies

**Objective:** Rebuild derived meshes from document features for renderer and STL export.

**Files:**
- Create: `packages/geometry/src/features/evaluate-document.ts`
- Modify: `packages/renderer/src/scene-sync.ts`
- Modify: `packages/export/src/stl.ts`
- Tests: evaluator, renderer sync, export tests.

**Acceptance:** feature order is deterministic; editing sketch or depth rebuilds extrusion; hidden sketch/feature behavior is defined; M1 primitives remain supported; STL includes visible derived solids.

**Commit:** `feat: evaluate document feature tree`

### Task 9: Implement Sketch mode canvas and tools

**Objective:** Let users create sketch geometry on a selected origin plane.

**Files:**
- Create: `apps/web/src/sketch/SketchWorkspace.tsx`
- Create: `apps/web/src/sketch/SketchOverlay.tsx`
- Create: `apps/web/src/sketch/useSketchInteraction.ts`
- Create: `apps/web/src/sketch/tools/point-tool.ts`
- Create: `apps/web/src/sketch/tools/line-tool.ts`
- Create: `apps/web/src/sketch/tools/rectangle-tool.ts`
- Create: `apps/web/src/sketch/tools/circle-tool.ts`
- Modify: `apps/web/src/store/cad-store.ts`
- Tests: state-machine and component tests.

**Acceptance:** choose plane, camera aligns orthographically to plane, grid/snap feedback, Escape cancels active tool, double-click/Enter finishes chains, construction color differs, all actions use commands/history.

**Commit:** `feat: add interactive sketch mode`

### Task 10: Add constraint UI and status feedback

**Objective:** Apply/edit constraints and make solver state understandable.

**Files:**
- Create: `apps/web/src/sketch/ConstraintToolbar.tsx`
- Create: `apps/web/src/sketch/ConstraintGlyphs.tsx`
- Create: `apps/web/src/sketch/DimensionEditor.tsx`
- Create: `apps/web/src/sketch/ConstraintStatus.tsx`
- Modify: `apps/web/src/components/ContextPanel.tsx`
- Modify: `apps/web/src/store/cad-store.ts`
- Tests: components/store.

**Acceptance:** selection-driven constraint availability; dimensions editable in mm/degrees; under-constrained blue, fully constrained black/dark, conflicting red; conflict message identifies constraints; undo/redo works.

**Commit:** `feat: add sketch constraints ui`

### Task 11: Add Extrude feature workflow

**Objective:** Create and edit extrusion from a selected valid profile.

**Files:**
- Create: `apps/web/src/features/ExtrudeDialog.tsx`
- Create: `apps/web/src/features/ExtrudePreview.tsx`
- Modify: `apps/web/src/components/FeatureToolbar.tsx`
- Modify: `apps/web/src/components/FeatureTree.tsx`
- Modify: `apps/web/src/components/ContextPanel.tsx`
- Modify: `apps/web/src/store/cad-store.ts`
- Tests: component/store/preview tests.

**Acceptance:** preview while depth changes; normal/symmetric direction; confirm/cancel; tree selection; edit existing depth; deterministic solid rebuild; STL export includes result.

**Commit:** `feat: add sketch extrusion workflow`

### Task 12: Extend MCP for sketches, constraints, and extrusion

**Objective:** Give agents equivalent control over M2 features.

**Files:**
- Create: `apps/mcp/src/tools/create-sketch.ts`
- Create: `apps/mcp/src/tools/add-sketch-entity.ts`
- Create: `apps/mcp/src/tools/add-constraint.ts`
- Create: `apps/mcp/src/tools/solve-sketch.ts`
- Create: `apps/mcp/src/tools/create-extrude.ts`
- Modify: `apps/mcp/src/server.ts`
- Modify: `docs/mcp.md`
- Tests: handler and subprocess integration tests.

**Acceptance:** typed schemas, structured topology/solver errors, atomic persistence, commands only, no direct state mutation.

**Commit:** `feat: expose sketch and extrude through mcp`

### Task 13: M2 E2E, visual regression, and release gate

**Objective:** Prove the complete sketch-to-solid workflow and professional UI.

**Files:**
- Create: `apps/web/e2e/sketch-extrude.spec.ts`
- Create: `apps/web/e2e/part-studio-visual.spec.ts`
- Create: `apps/web/e2e/screenshots/part-studio.png`
- Create: `apps/mcp/e2e/sketch-extrude-workflow.test.ts`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `.github/workflows/ci.yml` if needed.

**E2E:** create XY sketch → rectangle → dimensions/constraints → fully constrained → extrude → edit depth → save/reload → export/parse STL; repeat through MCP.

**Visual checks at 1440×900:** toolbars aligned, panels readable, shapes visible unselected, view cube/status bar present, no overlap/overflow, screenshot artifact generated.

**Release commands:**

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

**Commit:** `docs: complete milestone two`

---

## Definition of done

- Onshape-inspired Part Studio UI is polished and usable at 1440×900.
- Default and unselected solids are visible; selection state is clear.
- V1 documents load and migrate; V2 saves round-trip.
- XY/XZ/YZ sketches support point, line, rectangle, and circle tools.
- Six scoped constraints solve deterministically with status feedback.
- Closed profiles extrude into validated watertight meshes.
- Sketch/depth edits rebuild renderer and STL deterministically.
- Browser and MCP expose equivalent sketch/extrude operations.
- Unit, integration, E2E, visual screenshot, build, and GitHub CI pass.

## Risks and controls

1. **Constraint solver scope:** industrial solvers are large. Keep M2 to explicit supported entities/constraints, deterministic tolerances, structured conflicts, and no claim of full CAD solver parity.
2. **Profile triangulation:** M2 supports one simple outer loop or one circle, with no holes. Reject ambiguity explicitly.
3. **Feature dependencies:** use IDs and validate references during every load/command; evaluator reports broken references.
4. **UI imitation:** copy interaction principles, density, and layout—not Onshape marks, proprietary icons, or exact branding.
5. **Template coupling:** adapt tokens/patterns locally; do not add Next.js/auth/database infrastructure.
6. **Performance:** rebuild only affected feature outputs and dispose replaced GPU resources; measure before adding caching complexity.
