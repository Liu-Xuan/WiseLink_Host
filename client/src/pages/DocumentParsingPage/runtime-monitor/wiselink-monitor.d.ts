import type { WiseLinkMonitorElement } from './monitor-types';

// Includes the atomic updateInputs method declared by WiseLinkMonitorElement.

declare global {
  interface HTMLElementTagNameMap {
    'wiselink-monitor': WiseLinkMonitorElement;
  }
}

export {};
