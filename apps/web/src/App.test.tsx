import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const sceneState = vi.hoisted(() => ({ instances: [] as { dispose: ReturnType<typeof vi.fn> }[] }));

vi.mock('./viewport/create-viewport-scene.js', () => ({
  createViewportScene: vi.fn(() => {
    const instance = {
      scene: {},
      updateDocument: vi.fn(),
      setSelection: vi.fn(),
      setProjection: vi.fn(),
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
  it('renders the toolbar, scene tree, viewport, and properties panel as three columns', () => {
    render(<App />);

    expect(screen.getByText('SWALHA CAD')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Scene tree' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Properties' })).toBeInTheDocument();
    expect(screen.getByText('Box')).toBeInTheDocument();
  });

  it('synchronizes selection: clicking a scene tree row updates the properties panel', () => {
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
});
