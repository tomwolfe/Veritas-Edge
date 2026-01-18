import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock Web Worker
class WorkerMock {
  url: string;
  onmessage: (event: MessageEvent) => void = () => {};
  constructor(stringUrl: string) {
    this.url = stringUrl;
  }
  postMessage(msg: any) {
    // Basic mock implementation
  }
  terminate() {}
}

vi.stubGlobal('Worker', WorkerMock);

// Mock URL
class MockURL {
  href: string;
  constructor(url: string | URL, base?: string | URL) {
    this.href = url.toString();
  }
  toString() {
    return this.href;
  }
  static createObjectURL = vi.fn();
  static revokeObjectURL = vi.fn();
}

vi.stubGlobal('URL', MockURL);

// Mock ResizeObserver
vi.stubGlobal('ResizeObserver', vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
})));
