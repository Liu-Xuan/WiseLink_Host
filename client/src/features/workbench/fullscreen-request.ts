export interface FullscreenRequestState {
  isFullscreen: boolean;
  phase: 'idle' | 'pending' | 'unconfirmed';
  message: string | null;
}

interface FullscreenPort {
  read: () => boolean;
  enter?: () => Promise<void> | void;
  exit?: () => Promise<void> | void;
}

interface FullscreenOperation {
  desired: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface FullscreenRequestController {
  toggle: () => void;
  observe: () => void;
  clearFeedback: () => void;
  dispose: () => void;
}

/** A timed-out native request stays locked until its actual result is known. */
export function createFullscreenRequestController(
  port: FullscreenPort,
  publish: (state: FullscreenRequestState) => void,
  timeoutMs = 4000,
): FullscreenRequestController {
  let active: FullscreenOperation | null = null;
  let disposed = false;

  function clearTimer(operation: FullscreenOperation): void {
    if (operation.timer !== null) clearTimeout(operation.timer);
    operation.timer = null;
  }

  function finish(
    operation: FullscreenOperation,
    message: string | null,
  ): void {
    if (disposed || active !== operation) return;
    clearTimer(operation);
    active = null;
    const actual = port.read();
    publish({
      isFullscreen: actual,
      phase: 'idle',
      message: actual === operation.desired ? null : message,
    });
  }

  function toggle(): void {
    if (disposed || active) return;
    const actual = port.read();
    const request = actual ? port.exit : port.enter;
    if (!request) {
      publish({
        isFullscreen: actual,
        phase: 'idle',
        message: actual
          ? '浏览器未提供退出全屏接口，请按 Esc 或使用浏览器菜单退出。'
          : '当前浏览器不支持系统全屏，专注阅读仍可使用。',
      });
      return;
    }
    const operation: FullscreenOperation = { desired: !actual, timer: null };
    active = operation;
    publish({
      isFullscreen: actual,
      phase: 'pending',
      message: actual ? '正在等待浏览器退出全屏…' : '正在等待浏览器进入全屏…',
    });
    operation.timer = setTimeout(() => {
      if (disposed || active !== operation) return;
      if (port.read() === operation.desired) {
        finish(operation, null);
        return;
      }
      // Do not unlock or resend: a late browser response may still apply.
      publish({
        isFullscreen: port.read(),
        phase: 'unconfirmed',
        message:
          '浏览器尚未确认全屏请求，已暂停重复请求。可继续阅读或恢复布局；若已进入系统全屏，可按 Esc 退出。',
      });
    }, timeoutMs);

    const failure = operation.desired
      ? '浏览器未完成全屏请求，专注阅读仍可使用；可再次点击全屏。'
      : '退出全屏未完成，请按 Esc 或使用浏览器菜单退出。';
    try {
      // Call immediately inside the click's user activation, not in an effect.
      Promise.resolve(request()).then(
        () =>
          finish(
            operation,
            operation.desired
              ? '浏览器已结束请求，但尚未进入此工作台的全屏；可继续专注阅读或重试。'
              : '浏览器已结束请求，但工作台仍在全屏；请按 Esc 退出。',
          ),
        () => finish(operation, failure),
      );
    } catch {
      finish(operation, failure);
    }
  }

  return {
    toggle,
    observe: () => {
      if (disposed) return;
      const actual = port.read();
      if (active) {
        if (actual === active.desired) finish(active, null);
        return;
      }
      publish({ isFullscreen: actual, phase: 'idle', message: null });
    },
    clearFeedback: () => {
      if (!disposed && !active) {
        publish({ isFullscreen: port.read(), phase: 'idle', message: null });
      }
    },
    dispose: () => {
      disposed = true;
      if (active) clearTimer(active);
      active = null;
    },
  };
}
