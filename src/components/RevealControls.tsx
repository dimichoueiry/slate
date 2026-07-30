import type { Controller } from '../engine/controller';
import { useUI } from '../store/ui';

function setPresentationStep(ctl: Controller, step: number) {
  const steps = ctl.revealSteps();
  const max = steps.length ? Math.max(...steps) : 0;
  const next = Math.max(0, Math.min(max, step));
  useUI.getState().set({ presentationStep: next, presentationStepStartedAt: Date.now() });
  ctl.markSceneDirty();
}

function startPresentation(ctl: Controller) {
  useUI.getState().set({
    presenting: true,
    revealMode: true,
    presentationStep: 0,
    presentationStepStartedAt: Date.now(),
    editingTextId: null,
    readerObjectId: null,
    readerOrigin: null,
    paletteOpen: false,
    notesOpen: false,
    iconTrayOpen: false,
  });
  ctl.clearSelection();
  ctl.markSceneDirty();
}

function exitPresentation(ctl: Controller) {
  useUI.getState().set({
    presenting: false,
    revealMode: true,
    presentationStep: 0,
    presentationStepStartedAt: Date.now(),
  });
  ctl.markSceneDirty();
}

export default function RevealControls({ ctl }: { ctl: Controller }) {
  const ui = useUI();
  useUI((s) => s.docVersion);
  if (!ui.revealMode && !ui.presenting) return null;

  const steps = ctl.revealSteps();
  const max = steps.length ? Math.max(...steps) : 0;
  const selectedCount = ui.selection.length;

  if (ui.presenting) {
    const canBack = ui.presentationStep > 0;
    const canNext = ui.presentationStep < max;
    return (
      <div className="panel reveal-player">
        <button className="reveal-icon-btn" title="Exit presentation" onClick={() => exitPresentation(ctl)}>
          x
        </button>
        <button
          className="reveal-icon-btn"
          title="Previous"
          disabled={!canBack}
          onClick={() => setPresentationStep(ctl, ui.presentationStep - 1)}
        >
          ←
        </button>
        <div className="reveal-counter">
          <strong>{ui.presentationStep}</strong>
          <span>/</span>
          <span>{max}</span>
        </div>
        <button
          className="reveal-icon-btn primary"
          title="Next"
          disabled={!canNext}
          onClick={() => setPresentationStep(ctl, ui.presentationStep + 1)}
        >
          →
        </button>
        <div className="reveal-progress" aria-hidden>
          {steps.map((step) => (
            <span
              key={step}
              className={step <= ui.presentationStep ? 'active' : ''}
              style={{ width: `${Math.max(14, 100 / Math.max(steps.length, 1))}%` }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="panel reveal-panel">
      <div className="reveal-panel-title">Reveal</div>
      <div className="reveal-step-rail">
        {steps.length === 0 ? (
          <span className="reveal-empty">0 staged</span>
        ) : (
          steps.map((step) => (
            <button
              key={step}
              className="reveal-step-chip"
              title={`Select step ${step}`}
              onClick={() => ctl.selectRevealStep(step)}
            >
              {step}
            </button>
          ))
        )}
      </div>
      <span className="reveal-count">
        {selectedCount ? `${selectedCount} selected` : `${steps.length} step${steps.length === 1 ? '' : 's'}`}
      </span>
      <button className="chrome-btn primary" disabled={steps.length === 0} onClick={() => startPresentation(ctl)}>
        Present
      </button>
      <button className="chrome-btn" onClick={() => useUI.getState().set({ revealMode: false })}>
        Done
      </button>
    </div>
  );
}

export function handlePresentationKey(ctl: Controller, e: KeyboardEvent): boolean {
  const ui = useUI.getState();
  if (!ui.presenting) return false;

  if (e.key === 'Escape') {
    e.preventDefault();
    exitPresentation(ctl);
    return true;
  }
  if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
    e.preventDefault();
    setPresentationStep(ctl, ui.presentationStep + 1);
    return true;
  }
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
    e.preventDefault();
    setPresentationStep(ctl, ui.presentationStep - 1);
    return true;
  }
  if (e.key === 'Home') {
    e.preventDefault();
    setPresentationStep(ctl, 0);
    return true;
  }
  if (e.key === 'End') {
    e.preventDefault();
    const steps = ctl.revealSteps();
    setPresentationStep(ctl, steps.length ? Math.max(...steps) : 0);
    return true;
  }
  return true;
}
