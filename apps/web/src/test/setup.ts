import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

// Required by React 19 + @testing-library/react so state updates triggered by
// user-event/fireEvent are treated as test-environment updates instead of
// warning that they were "not wrapped in act(...)".
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  cleanup();
});
