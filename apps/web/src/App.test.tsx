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
});
