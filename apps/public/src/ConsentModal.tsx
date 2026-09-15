import { useEffect, useRef } from 'react';

interface ConsentModalProps {
  readonly title: string;
  readonly body: string;
  readonly onClose: () => void;
}

/**
 * 동의 상세. 열었다는 이유로 체크하지 않는다.
 * focus trap·ESC·포커스 복원을 갖추고 유의사항은 여기에 넣지 않는다.
 */
export function ConsentModal({ title, body, onClose }: ConsentModalProps): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (dialog === null) return;
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="consent-modal-title" ref={dialogRef}>
        <div className="modal-header">
          <h2 id="consent-modal-title">{title}</h2>
          <button type="button" className="modal-close" onClick={onClose} ref={closeRef}>
            닫기
          </button>
        </div>
        <div className="modal-body">{body}</div>
      </div>
    </div>
  );
}
