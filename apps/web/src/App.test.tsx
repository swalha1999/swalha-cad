import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const sceneState = vi.hoisted(() => ({ instances: [] as { dispose: ReturnType<typeof vi.fn> }[] }));

vi.mock('./viewport/create-viewport-scene.js', () => ({
  createViewportScene: vi.fn(() => {
    const instance = {
      scene: {},
      updateDocument: vi.fn(),
      setSelection: vi.fn(),
      setHover: vi.fn(),
      setProjection: vi.fn(),
      setStandardView: vi.fn(),
      resize: vi.fn(),
      getActiveCamera: vi.fn(),
      dispose: vi.fn(),
    };
    sceneState.instances.push(instance);
    return instance;
  }),
}));

const { App } = await import('./App.js');

describe('App', () => {
  it('renders the document bar, feature toolbar, feature tree, viewport, context panel, and status bar', () => {
    render(<App />);

    expect(screen.getByText('SWALHA CAD')).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Feature toolbar' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Scene tree' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Properties' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Part Studio 1' })).toBeInTheDocument();
    expect(screen.getByText('Box')).toBeInTheDocument();
  });

  it('synchronizes selection: clicking a feature tree row updates the context panel', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Cylinder' }));

    expect(screen.getByDisplayValue('Cylinder')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cylinder' })).toHaveAttribute('aria-current', 'true');
  });

  it('undoes and redoes the last command with Ctrl+Z / Ctrl+Shift+Z', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /add box/i }));
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled();

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
  });

  it('also treats Ctrl+Y as redo', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /add box/i }));
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled();

    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });

    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
  });

  it('deletes the selected body when Delete is pressed in the viewport context', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Box' }));

    fireEvent.keyDown(window, { key: 'Delete' });

    expect(screen.queryByRole('button', { name: 'Box' })).not.toBeInTheDocument();
  });

  it('does not delete the selection when Backspace is typed inside a numeric field', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Box' }));
    // The properties panel now shows editable dimension fields for the box.
    const widthField = screen.getByLabelText('Width');

    fireEvent.keyDown(widthField, { key: 'Backspace' });

    // The box row is still present — Backspace edited text, it did not delete geometry.
    expect(screen.getByRole('button', { name: 'Box' })).toBeInTheDocument();
  });

  it('collapses and re-expands the left feature tree panel', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Feature Tree' }));
    expect(screen.queryByRole('navigation', { name: 'Scene tree' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand Feature Tree' }));
    expect(screen.getByRole('navigation', { name: 'Scene tree' })).toBeInTheDocument();
  });
});
