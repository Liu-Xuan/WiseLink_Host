// Type definitions for cytoscape-popper extension
declare module 'cytoscape-popper' {
  import { Core, NodeSingular } from 'cytoscape';

  interface PopperOptions {
    content: () => HTMLElement;
    popper?: {
      placement?: string;
      modifiers?: Array<{
        name: string;
        options?: Record<string, unknown>;
      }>;
    };
  }

  interface PopperInstance {
    update(): void;
    destroy(): void;
  }

  function popperExtension(cy: typeof Core): void;

  export default popperExtension;
}

declare module 'cytoscape' {
  interface NodeSingular {
    popper(options: import('cytoscape-popper').PopperOptions): import('cytoscape-popper').PopperInstance;
  }
}
