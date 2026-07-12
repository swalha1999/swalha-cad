# Onshape UX Reference Notes

These screenshots and interaction notes define the SWALHA CAD Part Studio MVP experience.

## Reference screenshots

1. `01-part-studio-default-planes.jpg` — default Part Studio with origin planes.
2. `02-create-sketch-plane-selection.jpg` — Sketch command awaiting plane selection.
3. `03-active-sketch-normalize-camera-n.jpg` — active sketch before camera normalization.
4. `04-active-sketch-camera-normalized.jpg` — camera normal to the sketch plane.
5. `05-context-sensitive-dimension-selection.jpg` — contextual dimension selection and placement.

## Required interactions

### Sketch entry

- Support preselect-plane/face then Sketch and Sketch then select-plane/face.
- Keep the viewport interactive while the sketch support collector is active.
- Show a clear request to select a sketch plane or planar face.
- Camera aligns normal to the selected sketch support when entering sketch mode.

### Keyboard

- `N`: orient and fit the camera normal to the active sketch plane/face without leaving sketch mode or changing geometry.
- `P`: toggle origin/reference plane visibility without changing feature or sketch state.
- `D`: activate the context-sensitive dimension tool.

### Snapping

- Endpoint/point snapping is enabled by default.
- New lines snap to and reuse previously created points/endpoints instead of creating overlapping duplicates.
- Show clear coincident/inference feedback before placement.
- `Alt/Option` temporarily bypasses snapping.
- Grid display and grid snapping remain independent and optional; sketch coordinates are continuous.

### Context-sensitive dimensions

One `D` command infers the dimension from selected geometry and cursor placement:

- point to point;
- point to line, using perpendicular distance;
- line length;
- line to line angle or separation;
- circle/arc radius or diameter;
- horizontal distance when the annotation cursor moves primarily horizontally;
- vertical distance when it moves primarily vertically;
- true/aligned distance when the cursor is closest to the direct line between the selected points.

The preview must switch live before placement and show witness lines that make the pending constraint unambiguous.

## MVP scope

- Part Studio only.
- No assemblies.
- Prioritize a polished, highly useful workflow immediately familiar to an Onshape user.
- Face-based sketching is required.
