import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CadCommand, SketchFeature } from '@swalha-cad/document';
import { parseCadCommand } from '@swalha-cad/document';
import {
  centerPointArc,
  centerRectangleCorners,
  circumcircle,
  regularPolygonVertices,
  straightSlot,
  tangentArc,
  threePointArc,
  threePointRectangleCorners,
  type Vec2,
} from '@swalha-cad/geometry';
import type { DocumentSession } from '../document-session.js';
import { runTool, toolErrorResult, toolJsonResult } from '../tool-result.js';
import {
  coordinateSchema,
  findSketch,
  pointRefSchema,
  refToCommitPoint,
  resolveCommit,
  resolvePointCoords,
  validateProspectiveCommand,
  type CommitPoint,
  type CoordinateInput,
  type EntityCommit,
  type PointRefInput,
} from './feature-helpers.js';

const arcDirectionSchema = z.enum(['ccw', 'cw']);

/**
 * A single entity to add, tagged by `type`. Simple entities (point/line/circle/
 * arc) map straight to the document model; the compound forms (rectangles,
 * polygon, slot, 3-point circle, constructive arcs) reuse the same plane-local
 * geometry helpers the browser tools use, so an agent produces identical
 * geometry to a mouse-drawn shape.
 */
const entityInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('point'), x: z.number(), y: z.number() }).strict(),
  z.object({ type: z.literal('line'), start: pointRefSchema, end: pointRefSchema }).strict(),
  z.object({ type: z.literal('circle'), center: pointRefSchema, radius: z.number() }).strict(),
  z.object({ type: z.literal('circle-three-point'), a: coordinateSchema, b: coordinateSchema, c: coordinateSchema }).strict(),
  z
    .object({
      type: z.literal('arc'),
      center: pointRefSchema,
      radius: z.number(),
      startAngle: z.number(),
      endAngle: z.number(),
      direction: arcDirectionSchema,
    })
    .strict(),
  z.object({ type: z.literal('arc-three-point'), start: coordinateSchema, mid: coordinateSchema, end: coordinateSchema }).strict(),
  z.object({ type: z.literal('arc-center-point'), center: coordinateSchema, start: coordinateSchema, through: coordinateSchema }).strict(),
  z
    .object({
      type: z.literal('arc-tangent'),
      start: coordinateSchema,
      tangent: z.tuple([z.number(), z.number()]),
      end: coordinateSchema,
    })
    .strict(),
  z.object({ type: z.literal('rectangle'), corner: pointRefSchema, opposite: pointRefSchema }).strict(),
  z.object({ type: z.literal('center-rectangle'), center: pointRefSchema, corner: pointRefSchema }).strict(),
  z.object({ type: z.literal('three-point-rectangle'), a: pointRefSchema, b: pointRefSchema, third: pointRefSchema }).strict(),
  z.object({ type: z.literal('polygon'), center: pointRefSchema, vertex: pointRefSchema, sides: z.number().int().min(3) }).strict(),
  z.object({ type: z.literal('slot'), centerA: pointRefSchema, centerB: pointRefSchema, radius: z.number() }).strict(),
]);

type EntityInput = z.infer<typeof entityInputSchema>;

export const addSketchEntityInputShape = {
  sketchId: z.string().min(1),
  entity: entityInputSchema,
  construction: z.boolean().optional(),
};

type CommitBuild = { ok: true; commit: EntityCommit } | { ok: false; code: string; message: string };

const asXy = (coord: CoordinateInput): Vec2 => [coord.x, coord.y];

/**
 * Builds the plane-local {@link EntityCommit} for one entity input, resolving
 * point references to coordinates and running the shared shape math. Returns a
 * structured `invalid_reference` (dangling/mistyped point) or
 * `degenerate_geometry` (collinear/zero-size) failure instead of throwing.
 */
function buildCommit(sketch: SketchFeature, entity: EntityInput): CommitBuild {
  const coordsOf = (ref: PointRefInput): Vec2 | { error: string } => {
    const resolved = resolvePointCoords(sketch, ref);
    return resolved.ok ? resolved.coords : { error: resolved.message };
  };
  const degenerate = (message: string): CommitBuild => ({ ok: false, code: 'degenerate_geometry', message });
  const badRef = (message: string): CommitBuild => ({ ok: false, code: 'invalid_reference', message });
  const refError = (ref: PointRefInput): string | null => {
    const resolved = resolvePointCoords(sketch, ref);
    return resolved.ok ? null : resolved.message;
  };

  switch (entity.type) {
    case 'point':
      return { ok: true, commit: { points: [{ kind: 'new', x: entity.x, y: entity.y }] } };

    case 'line': {
      const startError = refError(entity.start);
      if (startError) return badRef(startError);
      const endError = refError(entity.end);
      if (endError) return badRef(endError);
      return { ok: true, commit: { points: [refToCommitPoint(entity.start), refToCommitPoint(entity.end)], lines: [{ start: 0, end: 1 }] } };
    }

    case 'circle': {
      const centerError = refError(entity.center);
      if (centerError) return badRef(centerError);
      if (!(entity.radius > 0)) return degenerate('Circle radius must be positive.');
      return { ok: true, commit: { points: [refToCommitPoint(entity.center)], circles: [{ center: 0, radius: entity.radius }] } };
    }

    case 'circle-three-point': {
      const circle = circumcircle(asXy(entity.a), asXy(entity.b), asXy(entity.c));
      if (!circle) return degenerate('The three points are collinear or coincident; no circle passes through them.');
      return {
        ok: true,
        commit: { points: [{ kind: 'new', x: circle.center[0], y: circle.center[1] }], circles: [{ center: 0, radius: circle.radius }] },
      };
    }

    case 'arc': {
      const centerError = refError(entity.center);
      if (centerError) return badRef(centerError);
      if (!(entity.radius > 0)) return degenerate('Arc radius must be positive.');
      return {
        ok: true,
        commit: {
          points: [refToCommitPoint(entity.center)],
          arcs: [{ center: 0, radius: entity.radius, startAngle: entity.startAngle, endAngle: entity.endAngle, direction: entity.direction }],
        },
      };
    }

    case 'arc-three-point': {
      const arc = threePointArc(asXy(entity.start), asXy(entity.mid), asXy(entity.end));
      if (!arc) return degenerate('The three arc points are collinear or coincident.');
      return {
        ok: true,
        commit: {
          points: [{ kind: 'new', x: arc.center[0], y: arc.center[1] }],
          arcs: [{ center: 0, radius: arc.radius, startAngle: arc.startAngle, endAngle: arc.endAngle, direction: arc.direction }],
        },
      };
    }

    case 'arc-center-point': {
      const arc = centerPointArc(asXy(entity.center), asXy(entity.start), asXy(entity.through));
      if (!arc) return degenerate('Center-point arc is degenerate (zero radius or zero sweep).');
      return {
        ok: true,
        commit: {
          points: [{ kind: 'new', x: arc.center[0], y: arc.center[1] }],
          arcs: [{ center: 0, radius: arc.radius, startAngle: arc.startAngle, endAngle: arc.endAngle, direction: arc.direction }],
        },
      };
    }

    case 'arc-tangent': {
      const arc = tangentArc(asXy(entity.start), entity.tangent, asXy(entity.end));
      if (!arc) return degenerate('Tangent arc is degenerate (zero tangent/span or a straight-line result).');
      return {
        ok: true,
        commit: {
          points: [{ kind: 'new', x: arc.center[0], y: arc.center[1] }],
          arcs: [{ center: 0, radius: arc.radius, startAngle: arc.startAngle, endAngle: arc.endAngle, direction: arc.direction }],
        },
      };
    }

    case 'rectangle': {
      const cornerCoords = coordsOf(entity.corner);
      if ('error' in cornerCoords) return badRef(cornerCoords.error);
      const oppositeCoords = coordsOf(entity.opposite);
      if ('error' in oppositeCoords) return badRef(oppositeCoords.error);
      const [sx, sy] = cornerCoords;
      const [ex, ey] = oppositeCoords;
      if (sx === ex || sy === ey) return degenerate('Rectangle corners share an axis (zero width or height).');
      const points: CommitPoint[] = [
        refToCommitPoint(entity.corner),
        { kind: 'new', x: ex, y: sy },
        refToCommitPoint(entity.opposite),
        { kind: 'new', x: sx, y: ey },
      ];
      return { ok: true, commit: { points, lines: rectangleLines() } };
    }

    case 'center-rectangle': {
      const centerCoords = coordsOf(entity.center);
      if ('error' in centerCoords) return badRef(centerCoords.error);
      const cornerCoords = coordsOf(entity.corner);
      if ('error' in cornerCoords) return badRef(cornerCoords.error);
      const corners = centerRectangleCorners(centerCoords, cornerCoords);
      if (!corners) return degenerate('Center rectangle is degenerate (corner shares an axis with the center).');
      const points: CommitPoint[] = [
        refToCommitPoint(entity.corner),
        { kind: 'new', x: corners[1][0], y: corners[1][1] },
        { kind: 'new', x: corners[2][0], y: corners[2][1] },
        { kind: 'new', x: corners[3][0], y: corners[3][1] },
      ];
      return { ok: true, commit: { points, lines: rectangleLines() } };
    }

    case 'three-point-rectangle': {
      const a = coordsOf(entity.a);
      if ('error' in a) return badRef(a.error);
      const b = coordsOf(entity.b);
      if ('error' in b) return badRef(b.error);
      const third = coordsOf(entity.third);
      if ('error' in third) return badRef(third.error);
      const corners = threePointRectangleCorners(a, b, third);
      if (!corners) return degenerate('Three-point rectangle is degenerate (zero-length first edge or zero width).');
      const points: CommitPoint[] = [
        refToCommitPoint(entity.a),
        refToCommitPoint(entity.b),
        { kind: 'new', x: corners[2][0], y: corners[2][1] },
        { kind: 'new', x: corners[3][0], y: corners[3][1] },
      ];
      return { ok: true, commit: { points, lines: rectangleLines() } };
    }

    case 'polygon': {
      const centerCoords = coordsOf(entity.center);
      if ('error' in centerCoords) return badRef(centerCoords.error);
      const vertexCoords = coordsOf(entity.vertex);
      if ('error' in vertexCoords) return badRef(vertexCoords.error);
      const vertices = regularPolygonVertices(centerCoords, vertexCoords, entity.sides);
      if (!vertices) return degenerate('Polygon is degenerate (zero radius or fewer than three sides).');
      const points: CommitPoint[] = vertices.map((vertex, index) =>
        index === 0 ? refToCommitPoint(entity.vertex) : ({ kind: 'new', x: vertex[0], y: vertex[1] } as CommitPoint),
      );
      const lines = vertices.map((_, index) => ({ start: index, end: (index + 1) % vertices.length }));
      return { ok: true, commit: { points, lines } };
    }

    case 'slot': {
      const centerACoords = coordsOf(entity.centerA);
      if ('error' in centerACoords) return badRef(centerACoords.error);
      const centerBCoords = coordsOf(entity.centerB);
      if ('error' in centerBCoords) return badRef(centerBCoords.error);
      if (!(entity.radius > 0)) return degenerate('Slot radius must be positive.');
      const slot = straightSlot(centerACoords, centerBCoords, entity.radius);
      if (!slot) return degenerate('Slot is degenerate (coincident centers or non-positive radius).');
      const { aLeft, aRight, bLeft, bRight } = slot.tangentPoints;
      const [capA, capB] = slot.arcs;
      if (!capA || !capB) return degenerate('Slot is missing a cap arc.');
      // Point indices: 0 aLeft, 1 bLeft, 2 aRight, 3 bRight, 4 centerA, 5 centerB.
      const points: CommitPoint[] = [
        { kind: 'new', x: aLeft[0], y: aLeft[1] },
        { kind: 'new', x: bLeft[0], y: bLeft[1] },
        { kind: 'new', x: aRight[0], y: aRight[1] },
        { kind: 'new', x: bRight[0], y: bRight[1] },
        refToCommitPoint(entity.centerA),
        refToCommitPoint(entity.centerB),
      ];
      return {
        ok: true,
        commit: {
          points,
          lines: [
            { start: 0, end: 1 },
            { start: 2, end: 3 },
          ],
          arcs: [
            { center: 4, radius: capA.radius, startAngle: capA.startAngle, endAngle: capA.endAngle, direction: capA.direction },
            { center: 5, radius: capB.radius, startAngle: capB.startAngle, endAngle: capB.endAngle, direction: capB.direction },
          ],
        },
      };
    }

    default: {
      // Exhaustiveness guard: every branch above returns.
      const _never: never = entity;
      return { ok: false, code: 'invalid_entity', message: `Unsupported entity: ${JSON.stringify(_never)}` };
    }
  }
}

function rectangleLines(): { start: number; end: number }[] {
  return [
    { start: 0, end: 1 },
    { start: 1, end: 2 },
    { start: 2, end: 3 },
    { start: 3, end: 0 },
  ];
}

/**
 * Registers `add_sketch_entity`: appends one point/line/circle/arc — or a
 * compound rectangle/polygon/slot/3-point-circle/constructive-arc — to a
 * sketch via a single `feature.update` command. Coincident new points merge by
 * id (matching the browser), and the resulting document is re-validated with
 * the canonical schema before it is persisted, so a rejected add never mutates
 * the document.
 */
export function registerAddSketchEntityTool(server: McpServer, session: DocumentSession): void {
  server.registerTool(
    'add_sketch_entity',
    {
      title: 'Add sketch entity',
      description:
        'Add geometry to a sketch: point, line, circle, arc, or a compound rectangle/polygon/slot/3-point form. Coincident endpoints merge automatically.',
      inputSchema: addSketchEntityInputShape,
    },
    (args) =>
      runTool(async () => {
        const lookup = findSketch(session.getDocument(), args.sketchId);
        if (!lookup.ok) return toolErrorResult(lookup.code, lookup.message);

        const build = buildCommit(lookup.sketch, args.entity);
        if (!build.ok) return toolErrorResult(build.code, build.message);

        const construction = args.construction ?? false;
        const resolved = resolveCommit(lookup.sketch.entities, build.commit, construction, () => session.nextId());
        const created = resolved.created;
        const totalCreated = created.points.length + created.lines.length + created.circles.length + created.arcs.length;
        if (totalCreated === 0) {
          return toolErrorResult('no_geometry', 'The requested entity produced no new geometry.');
        }

        const command: CadCommand = { type: 'feature.update', id: args.sketchId, patch: { entities: resolved.entities } };
        const validation = parseCadCommand(command);
        if (!validation.success) {
          return toolErrorResult('invalid_entity', validation.error.message);
        }
        const prospective = validateProspectiveCommand(session.getDocument(), command);
        if (!prospective.ok) {
          return toolErrorResult('invalid_document', prospective.message);
        }

        const document = await session.applyCommand(command);
        const feature = document.features.find((candidate) => candidate.id === args.sketchId);
        return toolJsonResult({ feature, created });
      }),
  );
}
