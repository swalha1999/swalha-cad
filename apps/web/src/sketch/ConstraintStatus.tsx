import { AlertTriangle, Lock, LockOpen } from 'lucide-react';
import type { ComponentType } from 'react';
import type { SolveStatus } from '@swalha-cad/geometry';
import { useCadStore } from '../store/cad-store-context.js';
import type { SketchSolveState } from '../store/cad-store.js';

const STATUS_LABEL: Record<SolveStatus, string> = {
  'under-constrained': 'Under-constrained',
  'fully-constrained': 'Fully constrained',
  conflicting: 'Conflicting',
};

const STATUS_ICON: Record<SolveStatus, ComponentType> = {
  'under-constrained': LockOpen,
  'fully-constrained': Lock,
  conflicting: AlertTriangle,
};

/** Human-readable degrees-of-freedom line, singular/plural aware. */
function dofLabel(remainingDof: number): string {
  return `${remainingDof} degree${remainingDof === 1 ? '' : 's'} of freedom remaining`;
}

function StatusBody({ solve }: { solve: SketchSolveState }) {
  const Icon = STATUS_ICON[solve.status];
  return (
    <div className={`constraint-status constraint-status--${solve.status}`} aria-label="Constraint status" role="region">
      <div className="constraint-status__headline" data-status={solve.status}>
        <Icon aria-hidden="true" />
        <span className="constraint-status__label">{STATUS_LABEL[solve.status]}</span>
      </div>
      {solve.status === 'under-constrained' && solve.remainingDof > 0 ? (
        <p className="constraint-status__dof">{dofLabel(solve.remainingDof)}</p>
      ) : null}
      {solve.status === 'conflicting' ? (
        <ul className="constraint-status__diagnostics" role="alert">
          {solve.diagnostics.map((diagnostic, index) => (
            <li key={index} className="constraint-status__diagnostic">
              {diagnostic.message}
              {diagnostic.constraintIds.length > 0 ? (
                <span className="constraint-status__ids"> ({diagnostic.constraintIds.join(', ')})</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Contextual solver readout for the active sketch: a coloured status headline
 * (under-constrained blue, fully constrained dark, conflicting red matching the
 * canvas convention), the remaining degrees of freedom, and — on a conflict —
 * the diagnostics identifying the offending constraints so the error is clear
 * and actionable.
 */
export function ConstraintStatus() {
  const solve = useCadStore((state) => state.sketchSolve);
  if (!solve) return null;
  return <StatusBody solve={solve} />;
}
